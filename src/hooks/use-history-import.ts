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
// Every page costs one provider query (the SMS provider sorts the whole
// matching inbox per call — there is no SQL LIMIT), one store dispatch that
// re-renders every mounted screen, and one forced encrypted ledger write. The
// page size is the multiplier on all three. 100-row pages paid that overhead
// twenty times more often than 2,000-row pages did while the parse loop was
// already yielding per frame-sized slice; 500 keeps each page's JS work short
// without turning a large inbox into hundreds of full-ledger commits.
const HISTORY_IMPORT_PAGE_SIZE = 500;
// One idle window between pages so a page commit never lands back-to-back
// with the next provider read. Not a measured phone constant; see the parse
// yield notes in auto-import.ts for the trace flag that verifies it.
const FOREGROUND_HISTORY_PAGE_GAP_MS = 120;
// ...but a fixed window is the wrong shape, because the thing it is meant to
// offset is not fixed. A page commit reconciles the WHOLE ledger — capture
// duplicates, transfer links, the transfer graph — so it costs more with every
// page that lands. Measured over the shipping modules with 500-row pages, the
// commit alone grows from 22ms at 1k rows to 199ms at 20k, and four mounted
// tab screens reproject on top of each one. A 120ms window against a 200ms
// block leaves the interface a minority share of the thread for the whole
// import, which is what "I cannot even open Settings" is.
//
// So yield for as long as the last page actually took, bounded. The import
// takes longer in wall-clock and the app stays usable while it runs, which is
// the right trade for maintenance work that is explicitly not
// interaction-critical. Ceiling keeps a pathological page from stalling
// progress altogether; floor keeps the original behaviour on small ledgers.
const FOREGROUND_HISTORY_PAGE_GAP_CEILING_MS = 1_000;

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

  const coordinator = useMemo(() => {
  // How long the previous page's commit held the thread. It belongs to the
  // coordinator rather than the component: nothing renders from it, and it
  // must reset with the coordinator it paces.
  let lastPageCostMs = 0;
  return createHistoryImportCoordinator<HistoryScanPage>({
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
        setTimeout(resolve, RNAppState.currentState === 'active'
          ? Math.min(
            FOREGROUND_HISTORY_PAGE_GAP_CEILING_MS,
            Math.max(FOREGROUND_HISTORY_PAGE_GAP_MS, lastPageCostMs),
          )
          : 0));
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

      // Resolving promises does not give pending UI/input work a macrotask.
      // Separate parsing/review from the synchronous planning/reducer work.
      // This is cooperative scheduling, not a claim of off-thread parsing.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!canCommit()) return false;
      const ledger = page.detectedLaunchMarket
        ? { ...getStateSnapshot(), marketId: page.detectedLaunchMarket }
        : getStateSnapshot();
      const plan = buildImportPlan(page.parsed, ledger, page.newestTs, undefined, page.declined);
      // Measured around the synchronous planning/reducer work and its write,
      // which is the part that actually holds the thread.
      const commitStartedAt = Date.now();
      await importBatch({
        ...plan.batch,
        parserRereadComplete: page.inboxHistoryComplete,
        historyImport: next,
      }).durable;
      lastPageCostMs = Math.max(0, Date.now() - commitStartedAt);
      markLaunchPhase('first-history-page');
      // Never acknowledge transient native rows before the ledger write.
      // A pause during persistence leaves them available for safe replay.
      if (canCommit()) await page.commit();
      return true;
    },
  });
  }, [
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
