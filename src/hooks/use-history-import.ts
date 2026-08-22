import { AppState as RNAppState, Platform } from 'react-native';
import { useEffect, useMemo, useRef } from 'react';

import {
  buildImportPlan,
  isSmsInboxAccessError,
  scanInbox,
  type ScanResult,
} from '@/lib/auto-import';
import {
  createHistoryImportCoordinator,
  type HistoryImportCursor,
  type HistoryImportPage,
} from '@/lib/history-import';
import { isProActive } from '@/lib/purchases';
import { markLaunchPhase } from '@/lib/launch-performance';
import { useStore } from '@/lib/store';

type HistoryScanPage = ScanResult & HistoryImportPage;

/**
 * Owns Android's resumable first-history read at the tab-shell level.
 *
 * Android can suspend JavaScript after the app leaves the foreground, so this
 * deliberately promises durable resume rather than uninterrupted background
 * execution. Each provider page and its cursor land in the encrypted ledger
 * together; a foreground return continues from that exact boundary.
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
  const stateRef = useRef(state);
  stateRef.current = state;

  const coordinator = useMemo(() => createHistoryImportCoordinator<HistoryScanPage>({
    getProgress: () => getStateSnapshot().historyImport,
    getGeneration: getStateGeneration,
    shouldContinue: () => {
      const current = getStateSnapshot();
      return Platform.OS === 'android' &&
        RNAppState.currentState === 'active' &&
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
        { cursor, maxInboxPages: 1 },
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

      const reviewReceipt = stageReviewAlerts(page.reviewCandidates);
      await reviewReceipt.durable;
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
      // The page is already durable at this point. If capture was disabled or
      // the app left foreground during that write, leave transient native rows
      // unacknowledged so the ordinary scanner can safely replay/dedupe them.
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

  useEffect(() => {
    if (!runnable || Platform.OS !== 'android') return;
    void coordinator.run().catch(() => {
      // The coordinator has already persisted the body-free failed state.
      // Home and Settings own the visible retry action.
    });
  }, [coordinator, runnable, state.captureOptOut, state.hydrated, state.onboarded]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = RNAppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      const progress = stateRef.current.historyImport;
      if (progress?.status !== 'paused' && progress?.status !== 'running') return;
      void coordinator.run().catch(() => {});
    });
    return () => subscription.remove();
  }, [coordinator]);
}
