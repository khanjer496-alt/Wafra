import type { HistoryImportProgress } from '@/lib/history-import';

export const MONEY_PICTURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type MoneyPictureState = 'building' | 'saved' | 'attention' | 'starting';

export interface MoneyPictureProgressInput {
  nowMs: number;
  trialStartTs: number;
  history: HistoryImportProgress | null;
  transactionCount: number;
  activeAccountCount: number;
  obligationCount: number;
  captureReady: boolean;
}

export interface MoneyPictureProgressModel {
  state: MoneyPictureState;
  transactionCount: number;
  activeAccountCount: number;
  obligationCount: number;
  historyScanned: number | null;
  historyFound: number | null;
}

const safeCount = (value: number): number =>
  Number.isSafeInteger(value) && value > 0 ? value : 0;

/**
 * First-week presentation only. This intentionally has no percentage or target:
 * Wafra does not know how many bank messages, accounts, bills, or transactions
 * a person ought to have. The UI may show only facts that already exist.
 */
export function moneyPictureProgress(input: MoneyPictureProgressInput): MoneyPictureProgressModel | null {
  if (!Number.isFinite(input.nowMs) || !Number.isFinite(input.trialStartTs) || input.trialStartTs <= 0) {
    return null;
  }
  const age = Math.max(0, input.nowMs - input.trialStartTs);
  if (age >= MONEY_PICTURE_WINDOW_MS) return null;

  const history = input.history;
  // This surface is useful only while first-run setup is still moving. Once a
  // full history import has actually finished, Home already has the real ledger
  // and keeping a large "setup" card around becomes clutter. Manual users retire
  // it as soon as their first real activity exists for the same reason.
  if (history?.status === 'complete') return null;
  if (!history && (input.transactionCount > 0 || input.activeAccountCount > 0 || input.obligationCount > 0)) {
    return null;
  }

  const state: MoneyPictureState = history?.status === 'failed'
    ? 'attention'
    : history?.status === 'running'
      ? 'building'
      : history?.status === 'paused'
        ? 'saved'
        : input.captureReady ? 'building' : 'starting';

  return {
    state,
    transactionCount: safeCount(input.transactionCount),
    activeAccountCount: safeCount(input.activeAccountCount),
    obligationCount: safeCount(input.obligationCount),
    historyScanned: history ? safeCount(history.scanned) : null,
    historyFound: history ? safeCount(history.found) : null,
  };
}
