import { collectLegacyReviewSourceKeys } from '@/lib/review-source-bindings';
import { AppState as RNAppState, Platform } from 'react-native';
import { useCallback, useEffect, useMemo } from 'react';
import { historyBackground } from '@/lib/android-history-background';

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
const HISTORY_IMPORT_PAGE_SIZE = 100;
const FOREGROUND_HISTORY_PAGE_GAP_MS = 500;
const FOREGROUND_HISTORY_COMMIT_GAP_MS = 120;
// Resuming the window is not idle time. Give Android a usable frame/input
// window before parser-migration maintenance restarts; subsequent pages retain
// the normal 500ms cooperative gap.
const FOREGROUND_HISTORY_RESUME_GRACE_MS = 2_000;

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
      !current.captureOptOut && isProActive(current) &&
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
        !current.captureOptOut &&
        isProActive(current);
    },
    now: Date.now,
    scanPage: async (cursor: HistoryImportCursor | null) => {
      // Foreground history repair is maintenance work, never interaction-critical.
      // Keep pages small and leave a real idle window between them so Hermes
      // cannot monopolize a CPU core while the user is navigating. Background
      // execution retains the zero-delay fast path.
      await new Promise<void>((resolve) =>
        setTimeout(resolve, RNAppState.currentState === 'active' ? FOREGROUND_HISTORY_PAGE_GAP_MS : 0));
      const page = await scanInbox(
        0,
        getStateSnapshot().merchantOverrides,
        undefined,
        undefined,
        {
          cursor,
          maxInboxPages: 1,
          pageSize: HISTORY_IMPORT_PAGE_SIZE,
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
        await waitForForegroundHistoryIdle(FOREGROUND_HISTORY_COMMIT_GAP_MS);
      } else {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (!canCommit()) return false;
      const ledger = page.detectedLaunchMarket
        ? { ...getStateSnapshot(), marketId: page.detectedLaunchMarket }
        : getStateSnapshot();
      const plan = buildImportPlan(page.parsed, ledger, page.newestTs, undefined, page.declined);
      if (RNAppState.currentState === 'active') {
        await waitForForegroundHistoryIdle(FOREGROUND_HISTORY_COMMIT_GAP_MS);
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
    // Hydration already does substantial ledger normalization. Starting parser
    // migration in the same commit makes a cold/recreated launch look frozen
    // even though the history job itself yields between pages. Give the first
    // usable screen the same grace period as a foreground resume.
    const timer = setTimeout(() => {
      void run().catch(() => {
        // The coordinator has persisted a body-free failure. Home and Settings
        // own recovery; a failed cursor must not be marked complete to unblock UI.
      });
    }, FOREGROUND_HISTORY_RESUME_GRACE_MS);
    return () => clearTimeout(timer);
  }, [run, runnable, state.captureOptOut, state.hydrated, state.onboarded]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const unsubscribe = subscribeHistoryImportRequest(() => { void run().catch(() => {}); });
    return () => { unsubscribe(); historyBackground.cancel(); };
  }, [run]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const subscription = RNAppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        if (resumeTimer !== null) {
          clearTimeout(resumeTimer);
          resumeTimer = null;
        }
        return;
      }
      const progress = getStateSnapshot().historyImport;
      if (progress?.status !== 'paused' && progress?.status !== 'running') return;
      if (resumeTimer !== null) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        const latest = getStateSnapshot().historyImport;
        if (RNAppState.currentState !== 'active' ||
          (latest?.status !== 'paused' && latest?.status !== 'running')) return;
        void run().catch(() => {});
      }, FOREGROUND_HISTORY_RESUME_GRACE_MS);
    });
    return () => {
      if (resumeTimer !== null) clearTimeout(resumeTimer);
      subscription.remove();
    };
  }, [getStateSnapshot, run]);
}
