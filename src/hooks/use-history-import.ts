import { collectLegacyReviewSourceKeys } from '@/lib/review-source-bindings';
import { AppState as RNAppState, Platform } from 'react-native';
import { useCallback, useEffect, useMemo } from 'react';
import { historyBackground } from '@/lib/android-history-background';
import { androidSmsCaptureEnabled } from '@/lib/android-capture-sources';

import {
  buildImportPlan,
  isSmsInboxAccessError,
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
import { useStore } from '@/lib/store';

type HistoryScanPage = ScanResult & HistoryImportPage;
const BACKGROUND_HISTORY_PAGE_SIZE = 500;
// Foreground pages are intentionally much smaller than background pages. Even
// with a cooperative parser, planning + reducer work is synchronous JS; a 500
// row page can monopolise Hermes long enough for taps and navigation to look
// dead on a large ledger. Background keeps the throughput-oriented page size.
const FOREGROUND_HISTORY_PAGE_SIZE = 64;
const FOREGROUND_HISTORY_PAGE_GAP_MS = 650;
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
  const canStart = useCallback(() => {
    const current = getStateSnapshot();
    return Platform.OS === 'android' && current.hydrated && current.onboarded &&
      androidSmsCaptureEnabled(current) && isProActive(current) &&
      (current.historyImport?.status === 'paused' || current.historyImport?.status === 'running');
  }, [getStateSnapshot]);

  const coordinator = useMemo(() => createHistoryImportCoordinator<HistoryScanPage>({
    getProgress: () => getStateSnapshot().historyImport,
    getGeneration: getStateGeneration,
    shouldContinue: () => {
      const current = getStateSnapshot();
      return Platform.OS === 'android' &&
        historyBackground.canContinue() &&
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
      const page = await scanInbox(
        0,
        getStateSnapshot().merchantOverrides,
        undefined,
        undefined,
        {
          cursor,
          maxInboxPages: 1,
          pageSize: foreground ? FOREGROUND_HISTORY_PAGE_SIZE : BACKGROUND_HISTORY_PAGE_SIZE,
          legacyReviewSourceKeys: collectLegacyReviewSourceKeys(getStateSnapshot()),
        },
      );
      return {
        ...page,
        scanned: page.scannedCount,
        found: page.parsed.length + page.reviewCandidates.length,
        complete: page.inboxHistoryComplete,
      };
    },
    persistProgress: setHistoryImportProgress,
    classifyError: (error) => isSmsInboxAccessError(error) ? 'inbox-access' : 'page-failed',
    commitPage: async (page, next, canCommit) => {
      if (!canCommit()) return false;
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
      if (page.reviewCandidates.length > 0 || (page.reviewSourceBindings?.length ?? 0) > 0) {
        const reviewReceipt = stageReviewAlerts(page.reviewCandidates, undefined, page.reviewSourceBindings);
        await reviewReceipt.durable;
      }

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
      if (!canCommit()) return false;
      const ledger = page.detectedLaunchMarket
        ? { ...getStateSnapshot(), marketId: page.detectedLaunchMarket }
        : getStateSnapshot();
      const plan = buildImportPlan(page.parsed, ledger, page.newestTs, undefined, page.declined);
      if (RNAppState.currentState === 'active') {
        await waitForForegroundHistoryIdle();
      }
      if (!canCommit()) return false;
      await importBatch({
        ...plan.batch,
        parserRereadComplete: page.inboxHistoryComplete,
        historyImport: next,
      }).durable;
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
    if (!progress || progress.status !== 'paused' || progress.scanned > 0 || progress.error) return;
    const timer = setTimeout(() => {
      void run().catch(() => {
        // The coordinator has persisted a body-free failure. Home and Settings
        // own recovery; a failed cursor must not be marked complete to unblock UI.
      });
    }, FOREGROUND_HISTORY_FIRST_RUN_GRACE_MS);
    return () => clearTimeout(timer);
  }, [getStateSnapshot, run, runnable, state.captureOptOut, state.androidCaptureSources?.sms,
    state.hydrated, state.onboarded]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const unsubscribe = subscribeHistoryImportRequest(() => { void run().catch(() => {}); });
    return () => { unsubscribe(); historyBackground.cancel(); };
  }, [run]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = RNAppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      // Returning to Wafra means the UI wins immediately. A history service
      // that was running while the app was away stops at its next safe
      // coordinator boundary and persists `paused`; it is never restarted just
      // because Android restored the Activity.
      historyBackground.cancel();
    });
    return () => {
      subscription.remove();
    };
  }, []);
}
