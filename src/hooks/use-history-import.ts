import { canonicalCaptureSourceKey } from '@/lib/capture-source-identity';
import { reviewClaimSourceKeys, reviewReceiptSettled, requiresReviewRetention, settleReviewStage, type ReviewStageReceipt } from '@/lib/alert-review-tray';
import { collectLegacyReviewSourceKeys } from '@/lib/review-source-bindings';
import { AppState as RNAppState, Platform } from 'react-native';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { historyBackground } from '@/lib/android-history-background';
import { androidSmsCaptureEnabled } from '@/lib/android-capture-sources';

import {
  buildImportPlan,
  isSmsInboxAccessError,
  hasSmsPermission,
  scanInbox,
  type ScanResult,
} from '@/lib/auto-import';
import {
  createHistoryImportCoordinator,
  subscribeHistoryImportRequest,
  type HistoryImportCursor,
  type HistoryImportPage,
} from '@/lib/history-import';
import { isProActive } from '@/lib/purchases';
import { markLaunchPhase } from '@/lib/launch-performance';
import { waitForForegroundHistoryIdle } from '@/lib/foreground-history-priority';
import { recordRuntimeOperation } from '@/lib/runtime-performance';
import { stageWalletNearMatches } from '@/lib/wallet-near-match';
import { useStore } from '@/lib/store';

// DIAGNOSTIC BUILD ONLY (android/ab-build-396-diag, never merged): reason codes, no message data.
const wafraDiag = (code: string, n = 0): void => { try { console.info('WafraHistoryDiag', code, n); } catch { /* diagnostic only */ } };

type HistoryScanPage = ScanResult & HistoryImportPage;
const BACKGROUND_HISTORY_PAGE_SIZE = 512;
const BACKGROUND_HISTORY_PAGES_PER_COMMIT = 1;
// Foreground pages are intentionally much smaller than background pages. Even
// with a cooperative parser, planning + reducer work is synchronous JS; a 500
// row page can monopolise Hermes long enough for taps and navigation to look
// dead on a large ledger. Background keeps the throughput-oriented page size.
const FOREGROUND_HISTORY_PAGE_SIZE = 128;
const FOREGROUND_HISTORY_PAGES_PER_COMMIT = 1;
const FOREGROUND_HISTORY_PAGE_GAP_MS = 120;
// A brand-new first run may begin by itself, but a previously paused history
// job must never restart merely because the user returned to Wafra. Re-entry is
// an interaction-critical transition and the saved Home card already exposes
// an explicit Continue action.
const FOREGROUND_HISTORY_FIRST_RUN_GRACE_MS = 8_000;

/**
 * Owns Android's resumable first-history read at the tab-shell level.
 * Provider pages and their cursors are durably committed together. A bounded
 * foreground service keeps this same coordinator alive when the app backgrounds.
 * Older binaries and process death still resume at the last saved boundary.
 */
export function useHistoryImport(): void {
  const {
    state,
    getStateSnapshot,
    getStateGeneration,
    importBatch,
    stageReviewAlerts,
    setHistoryImportProgress,
    setMarket,
  } = useStore();
  const legacyReviewKeys = useRef<{
    generation: number;
    startedAt: number;
    keys: string[];
  } | null>(null);
  const canStart = useCallback(() => {
    const current = getStateSnapshot();
    wafraDiag('canStart h' + Number(current.hydrated) + ' o' + Number(current.onboarded) + ' sms' + Number(androidSmsCaptureEnabled(current)) +
      ' pro' + Number(isProActive(current)) + ' st:' + String(current.historyImport?.status) + ' err:' + String(current.historyImport?.error ?? null),
      current.historyImport?.scanned ?? -1);
    return Platform.OS === 'android' && current.hydrated && current.onboarded &&
      androidSmsCaptureEnabled(current) && isProActive(current) &&
      (current.historyImport?.status === 'paused' || current.historyImport?.status === 'running');
  }, [getStateSnapshot]);

  const coordinator = useMemo(() => createHistoryImportCoordinator<HistoryScanPage>({
    getProgress: () => getStateSnapshot().historyImport,
    getGeneration: getStateGeneration,
    shouldContinue: () => {
      const current = getStateSnapshot();
      const bg = historyBackground.canContinue();
      if (!bg || !current.hydrated || !current.onboarded || !androidSmsCaptureEnabled(current) || !isProActive(current)) {
        wafraDiag('shouldContinue-false bg' + Number(bg) + ' h' + Number(current.hydrated) + ' o' + Number(current.onboarded) +
          ' sms' + Number(androidSmsCaptureEnabled(current)) + ' pro' + Number(isProActive(current)));
      }
      return Platform.OS === 'android' &&
        bg &&
        current.hydrated &&
        current.onboarded &&
        androidSmsCaptureEnabled(current) &&
        isProActive(current);
    },
    now: Date.now,
    scanPage: async (cursor: HistoryImportCursor | null) => {
      // Foreground history repair is maintenance work, never interaction-critical.
      // Keep pages small and leave a real idle window between them so Hermes
      // cannot monopolize a CPU core while the user is navigating. Background
      // execution retains the zero-delay fast path.
      const foreground = RNAppState.currentState === 'active';
      if (foreground) {
        await waitForForegroundHistoryIdle(FOREGROUND_HISTORY_PAGE_GAP_MS);
      } else {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (!await hasSmsPermission()) {
        wafraDiag('scan-no-permission');
        throw Object.assign(new Error('SMS history access requires disclosure and permission'), { code: 'ERR_SMS_INBOX_ACCESS' });
      }
      const snapshot = getStateSnapshot();
      const generation = getStateGeneration();
      const historyStartedAt = snapshot.historyImport?.startedAt ?? 0;
      const cachedLegacyKeys = legacyReviewKeys.current;
      if (!cachedLegacyKeys ||
          cachedLegacyKeys.generation !== generation ||
          cachedLegacyKeys.startedAt !== historyStartedAt) {
        legacyReviewKeys.current = {
          generation,
          startedAt: historyStartedAt,
          keys: collectLegacyReviewSourceKeys(snapshot),
        };
      }
      const requestedLegacyReviewKeys = legacyReviewKeys.current?.keys ?? [];
      const scanStartedAt = Date.now();
      const page = await scanInbox(
        0,
        snapshot.merchantOverrides,
        undefined,
        undefined,
        {
          cursor,
          // Parsing itself remains cooperative inside scanInbox. Group several
          // provider pages before one plan/persist boundary so the expensive
          // full-ledger indexes and React transaction-array publication are not
          // repeated hundreds of times on a large retained inbox.
          maxInboxPages: foreground
            ? FOREGROUND_HISTORY_PAGES_PER_COMMIT
            : BACKGROUND_HISTORY_PAGES_PER_COMMIT,
          pageSize: foreground ? FOREGROUND_HISTORY_PAGE_SIZE : BACKGROUND_HISTORY_PAGE_SIZE,
          legacyReviewSourceKeys: requestedLegacyReviewKeys,
          historyRepair: true,
          knownReviewSourceKeys: reviewClaimSourceKeys(snapshot.reviewTray, Date.now()),
          includeNotificationQueue: false,
        },
      );
      recordRuntimeOperation('history-scan-page', Date.now() - scanStartedAt);
      return {
        ...page,
        scanned: page.scannedCount,
        found: page.parsed.length + page.reviewCandidates.length + (page.skippedKnownInboxReviewSourceKeys?.length ?? 0),
        complete: page.inboxHistoryComplete,
      };
    },
    persistProgress: setHistoryImportProgress,
    classifyError: (error) => isSmsInboxAccessError(error) ? 'inbox-access' : 'page-failed',
    commitPage: async (page, next, canCommit) => {
      if (!canCommit()) { wafraDiag('commit-false-1'); return false; }
      const current = getStateSnapshot();
      if (page.detectedLaunchMarket && page.detectedLaunchMarket !== current.marketId) {
        if (!setMarket(page.detectedLaunchMarket)) throw new Error('market_mismatch');
      }

      // stageReviewAlerts([], ..., []) is NOT free: the store calls
      // ensureDurable() and encrypts/saves the complete previous ledger. The
      // importBatch below already saves that state plus this page and cursor.
      // Skip only the genuinely empty stage. Identity bindings still require
      // staging even when no candidate is present, and a real review must be
      // durable before planning against the resulting ledger snapshot.
      let reviewReceipt: ReviewStageReceipt | undefined;
      if (page.reviewCandidates.length > 0 || (page.reviewSourceBindings?.length ?? 0) > 0 ||
          (page.skippedKnownInboxReviewSourceKeys?.length ?? 0) > 0) {
        reviewReceipt = stageReviewAlerts(page.reviewCandidates, undefined, page.reviewSourceBindings, 'hold-source');
        const outcomes = await settleReviewStage(page.reviewCandidates, reviewReceipt);
        {
          // DIAGNOSTIC E: categories, booleans and rounded offsets only; no text, amounts or ids.
          const shape = (key: unknown) => typeof key === 'string'
            ? key.replace(/[0-9a-f]{6,}/g, 'H').replace(/[0-9]+/g, 'N').slice(0, 48) + '/' + key.length : String(key);
          const nowMs = Date.now();
          const tray = getStateSnapshot().reviewTray;
          wafraDiag('E-stage candidates=' + page.reviewCandidates.length + ' outcomes=' + outcomes.length +
            ' livePending=' + (tray?.pending?.length ?? -1) + ' liveTombstones=' + (tray?.tombstones?.length ?? -1) +
            ' hasRetention=' + Number(typeof reviewReceipt.retention === 'function'));
          page.reviewCandidates.forEach((item, index) => {
            const key = canonicalCaptureSourceKey(item.sourceKey, item.observedAt);
            const match = outcomes.find(entry => entry.sourceKey === key);
            const event = (item as { event?: { family?: unknown; status?: unknown; decision?: unknown } }).event;
            wafraDiag('E-item ' + index + ' universal=' + Number(!!event) + ' family=' + String(event?.family ?? (item as { kind?: unknown }).kind ?? '-') +
              ' status=' + String(event?.status ?? '-') + ' decision=' + String(event?.decision ?? '-') +
              ' retain=' + Number(requiresReviewRetention(item)) + ' outcome=' + String(match?.outcome ?? 'NO-MATCH') +
              ' ch=' + String(item.channel) + ' key=' + shape(item.sourceKey) + ' canon=' + shape(key) +
              ' obsMin=' + Math.round((item.observedAt - nowMs) / 60000) +
              ' expH=' + Math.round((((item as { expiresAt?: number }).expiresAt ?? NaN) - nowMs) / 3600000), index);
          });
          outcomes.forEach((entry, index) => wafraDiag('E-receipt ' + index + ' ' + String(entry.outcome) + ' key=' + shape(entry.sourceKey), index));
        }
        if (!canCommit()) { wafraDiag('commit-false-2'); return false; }
        const unresolved = page.reviewCandidates.filter(requiresReviewRetention).map(item =>
          outcomes.find(entry => entry.sourceKey === canonicalCaptureSourceKey(item.sourceKey, item.observedAt)))
          .filter(entry => !entry || !reviewReceiptSettled(entry.outcome));
        // An expired source is a terminal, disclosed loss: History continues.
        if (unresolved.length) { wafraDiag('hold-unresolved', unresolved.length); return { paused: 'review-capacity' as const }; }
      }
      // Cropped candidates still live in the provider; do not skip their cursor.
      if (page.deferredInboxReviews) { wafraDiag('hold-deferred-inbox-reviews', page.reviewCandidates.length); return { paused: 'review-capacity' as const }; }

      // Parsing already yields, but planning + reducer reconciliation below are
      // synchronous JS too. Starting that work in the same turn as a user's tap
      // can still freeze a tab/button even when the parser itself is perfectly
      // chunked. Honour the shared navigation lease before BOTH planning and
      // the ledger mutation. A tap extends the lease; background history keeps
      // the immediate path because there is no visible interaction to protect.
      if (RNAppState.currentState === 'active') {
        await waitForForegroundHistoryIdle();
      } else {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (!canCommit()) { wafraDiag('commit-false-3'); return false; }
      const ledger = page.detectedLaunchMarket
        ? { ...getStateSnapshot(), marketId: page.detectedLaunchMarket }
        : getStateSnapshot();
      const planStartedAt = Date.now();
      const plan = buildImportPlan(page.parsed, ledger, page.newestTs, undefined, page.declined);
      recordRuntimeOperation('history-plan-page', Date.now() - planStartedAt);
      if (RNAppState.currentState === 'active') {
        await waitForForegroundHistoryIdle();
      }
      if (!canCommit()) { wafraDiag('commit-false-4'); return false; }
      const saveStartedAt = Date.now();
      const applyStartedAt = Date.now();
      // Possible Apple Pay duplicates were withheld from the batch. Stage their
      // Review items in this same turn so the page write below carries them;
      // a full Review lane posts the alert instead of dropping it.
      const nearMatches = stageWalletNearMatches(
        plan, () => getStateSnapshot().reviewTray, (items) => stageReviewAlerts(items, undefined, undefined, 'hold-source'));
      const claims = new Set(reviewReceipt?.retainedSourceKeys?.() ?? []);
      const finalReviews = reviewReceipt?.retention?.() ?? [];
      if (!canCommit() || (page.skippedKnownInboxReviewSourceKeys ?? []).some(key => !claims.has(key)) ||
          page.reviewCandidates.some(item => requiresReviewRetention(item) && !finalReviews.some(entry =>
            entry.sourceKey === canonicalCaptureSourceKey(item.sourceKey, item.observedAt) &&
            reviewReceiptSettled(entry.outcome)))) { wafraDiag('commit-false-claims-or-unsettled'); return false; }
      const receipt = importBatch({
          ...nearMatches.plan.batch,
          parserRereadComplete: page.inboxHistoryComplete,
          historyImport: next,
      });
      recordRuntimeOperation('history-apply-page', Date.now() - applyStartedAt);
      const persistStartedAt = Date.now();
      try {
        await receipt.durable;
      } finally {
        recordRuntimeOperation('history-persist-page', Date.now() - persistStartedAt);
        recordRuntimeOperation('history-save-page', Date.now() - saveStartedAt);
      }
      await nearMatches.settle();
      markLaunchPhase('first-history-page');
      // Never acknowledge transient native rows before the ledger write.
      // A pause during persistence leaves them available for safe replay.
      if (canCommit()) await page.commit();
      return true;
    },
  }), [
    getStateGeneration,
    getStateSnapshot,
    importBatch,
    setHistoryImportProgress,
    setMarket,
    stageReviewAlerts,
  ]);

  const runnable = state.historyImport?.status === 'paused' ||
    state.historyImport?.status === 'running';
  const run = useCallback(() => historyBackground.run(() => coordinator.run(), canStart), [canStart, coordinator]);

  useEffect(() => {
    if (!runnable || Platform.OS !== 'android') return;
    const progress = getStateSnapshot().historyImport;
    // Only a genuinely new first-history job auto-starts. A saved/paused job
    // with real progress belongs to the explicit Continue control: silently
    // resuming it on every cold launch was the cause of the blank/reopening
    // state on large ledgers.
    wafraDiag('autostart-effect st:' + String(progress?.status) + ' err:' + String(progress?.error ?? null), progress?.scanned ?? -1);
    if (!progress || progress.status !== 'paused' || progress.scanned > 0 || progress.error) return;
    const timer = setTimeout(() => {
      wafraDiag('autostart-timer-fired');
      void run().catch((error: unknown) => { wafraDiag('run-rejected ' + String((error as { code?: unknown })?.code ?? (error as Error)?.message ?? 'unknown').slice(0, 80));
        // The coordinator has persisted a body-free failure. Home and Settings
        // own recovery; a failed cursor must not be marked complete to unblock UI.
      });
    }, FOREGROUND_HISTORY_FIRST_RUN_GRACE_MS);
    return () => { wafraDiag('autostart-timer-cleared'); clearTimeout(timer); };
  }, [getStateSnapshot, run, runnable, state.captureOptOut, state.androidCaptureSources?.sms,
    state.hydrated, state.onboarded]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const unsubscribe = subscribeHistoryImportRequest(() => { wafraDiag('continue-request'); void run().catch((error: unknown) => { wafraDiag('run-rejected ' + String((error as { code?: unknown })?.code ?? (error as Error)?.message ?? 'unknown').slice(0, 80)); }); });
    return () => { wafraDiag('request-effect-cleanup-cancel'); unsubscribe(); historyBackground.cancel(); };
  }, [run]);

  // Do not cancel a running history job merely because the Activity becomes
  // foreground again. scanInbox dynamically switches to the smaller foreground
  // page and 4ms/64-row parse budget, while navigation taps extend the shared
  // foreground-history lease. The previous foreground cancellation made a
  // multi-hour migration bounce between running/paused every time the user
  // reopened Wafra, which is both confusing and needlessly prolongs the heavy
  // parser-backfill state.
}
