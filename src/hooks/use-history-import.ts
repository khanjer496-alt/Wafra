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
import { useStore } from '@/lib/store';

type HistoryScanPage = ScanResult & HistoryImportPage;

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
      const page = await scanInbox(
        0,
        getStateSnapshot().merchantOverrides,
        undefined,
        undefined,
        { cursor, maxInboxPages: 1, legacyReviewSourceKeys: collectLegacyReviewSourceKeys(getStateSnapshot()) },
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

      // Resolving promises does not give pending UI/input work a macrotask.
      // Separate parsing/review from the synchronous planning/reducer work.
      // This is cooperative scheduling, not a claim of off-thread parsing.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!canCommit()) return false;
      const ledger = page.detectedLaunchMarket
        ? { ...getStateSnapshot(), marketId: page.detectedLaunchMarket }
        : getStateSnapshot();
      const plan = buildImportPlan(page.parsed, ledger, page.newestTs, undefined, page.declined);
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
    void run().catch(() => {
      // The coordinator has persisted a body-free failure. Home and Settings
      // own recovery; a failed cursor must not be marked complete to unblock UI.
    });
  }, [run, runnable, state.captureOptOut, state.hydrated, state.onboarded]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const unsubscribe = subscribeHistoryImportRequest(() => { void run().catch(() => {}); });
    return () => { unsubscribe(); historyBackground.cancel(); };
  }, [run]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = RNAppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      const progress = getStateSnapshot().historyImport;
      if (progress?.status !== 'paused' && progress?.status !== 'running') return;
      void run().catch(() => {});
    });
    return () => subscription.remove();
  }, [getStateSnapshot, run]);
}
