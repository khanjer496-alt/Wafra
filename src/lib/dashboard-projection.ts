/** One reconciled ledger view; presentation never invents a second money model. */
import { unreadFormatCount, REPORT_PROMPT_THRESHOLD } from '@/lib/accuracy';
import { periodComparison, type PeriodComparison } from '@/lib/analytics';
import { summarizeCashOutflow } from '@/lib/cash-flow';
import { summarizeForeignActivity, type ForeignActivitySummary } from '@/lib/fx-summary';
import { buildInsights, summarizeMonth, type Insight } from '@/lib/insights';
import { leavingSoon, type Outgoing } from '@/lib/leaving-soon';
import { countsInCashflowTotals, internalTransferIdsForState, isIncome, isSpending, liveAccountIds } from '@/lib/ledger';
import { inPeriod, isCurrentMonth, type Period } from '@/lib/period';
import { duplicateTransactionIds, isListedExternalTransfer } from '@/lib/transfer-activity';
import { isTransferCandidate } from '@/lib/transfer-reconciliation';
import { uncategorisedMerchants, worthPrompting, type UncategorisedSummary } from '@/lib/uncategorised';
import type { Account, AppState, Transaction } from '@/lib/types';

export interface DashboardProjectionRequest {
  state: AppState;
  period: Period;
  now: Date;
  dismissedInsightId?: string | null;
  /** Screens that do not render insights need not run their historical analysis. */
  includeInsights?: boolean;
  /** Home can paint money first and defer cleanup scans until after interaction. */
  includeCleanupPrompts?: boolean;
  /** Home renders cashflow, cards/bills and one priority prompt. */
  surface?: 'dashboard' | 'home';
}

export interface DashboardProjection {
  live: boolean;
  hero: {
    incomeFils: number; expenseFils: number; cashOutFils: number;
    cardPaymentsFils: number; accountOutflowFils: number; netFils: number;
  };
  comparison: PeriodComparison | null;
  insight: Insight | null;
  upcoming: { withinDays: number; items: Outgoing[] };
  activityRows: Transaction[];
  accountById: ReadonlyMap<string, Account>;
  foreignActivity: ForeignActivitySummary;
  internalTransactionIds: ReadonlySet<string>;
  lastAutomaticCaptureDate?: string;
  unreadFormats: { count: number; shouldPrompt: boolean };
  uncategorised: { summary: UncategorisedSummary; shouldPrompt: boolean };
}

export interface HomeDashboardProjection extends Pick<DashboardProjection,
  'upcoming' | 'activityRows' | 'accountById' | 'internalTransactionIds' | 'uncategorised'> {
  hero: Pick<DashboardProjection['hero'], 'incomeFils' | 'expenseFils' | 'netFils'>;
  /** The period has transfer records on live accounts; Home links to Transfers. */
  hasPeriodTransfers: boolean;
  /**
   * The period has any record on a live account. Recent activity lists only
   * cash-flow rows, so a month holding only card-payment settlements, internal
   * movements or transfers is still not an "empty month".
   */
  hasPeriodRecords: boolean;
  /** Null when a higher-priority prompt hides this calculation. */
  unreadFormats: DashboardProjection['unreadFormats'] | null;
  /** Each recent-activity day's whole total on the month line's terms (income +, spending −); absent when unfinished. */
  activityDayTotals: ReadonlyMap<string, number>;
}

const UPCOMING_WITHIN_DAYS = 9;
/** Rows Home may read past its sixth to finish the last listed day's total. */
const DAY_TOTAL_LOOKAHEAD = 50;

/** Date-only probe; a sorted prefix is not enough to stop a day's scan early. */
function datesAreNewestFirst(transactions: readonly Transaction[]): boolean {
  for (let index = 1; index < transactions.length; index += 1) {
    if (transactions[index - 1]!.date < transactions[index]!.date) return false;
  }
  return true;
}

/**
 * The Home insight widget needs one ranked observation, not the entire dashboard
 * projection. Keep this separate so Home does not also build cash-outflow, period
 * comparison, foreign-activity and a second subscription timeline just to render
 * one optional card.
 */
export function projectDashboardInsight(
  state: AppState,
  period: Period,
  now: Date,
  dismissedInsightId?: string | null,
): Insight | null {
  const liveAccounts = liveAccountIds(state.accounts);
  const internal = internalTransferIdsForState(state);
  return buildInsights(
    state.transactions,
    state.budgets,
    period,
    now,
    state.notSubscriptions,
    liveAccounts,
    internal,
    { includeRecurringAnalysis: false, cancelledSubscriptions: state.cancelledSubscriptions, customCategories: state.customCategories },
  ).find((item) => item.id !== dismissedInsightId) ?? null;
}

export function projectDashboard(request: DashboardProjectionRequest & { surface: 'home' }): HomeDashboardProjection;
export function projectDashboard(request: DashboardProjectionRequest & { surface?: 'dashboard' }): DashboardProjection;
export function projectDashboard(request: DashboardProjectionRequest): DashboardProjection | HomeDashboardProjection;
export function projectDashboard(request: DashboardProjectionRequest): DashboardProjection | HomeDashboardProjection {
  const {
    state,
    period,
    now,
    dismissedInsightId,
    includeInsights = true,
    includeCleanupPrompts = true,
  } = request;
  const homeOnly = request.surface === 'home';
  const liveAccounts = liveAccountIds(state.accounts);
  const internal = internalTransferIdsForState(state);
  const summary = summarizeMonth(state.transactions, period, liveAccounts, internal);
  const expenseFils = summary.expenseFils;
  const incomeFils = summary.incomeFils;
  const historyImportBusy = homeOnly && state.historyImport?.status === 'running';
  // Parser exceptions no longer occupy Home. They remain available from the
  // bank-alert/settings workflow, so they must not suppress unrelated cleanup
  // prompts such as merchant categorisation or unread formats here.
  const uncategorisedSummary = historyImportBusy || (homeOnly && !includeCleanupPrompts)
    ? { merchants: [], paymentPurposes: [], rowCount: 0, totalFils: 0 }
    : uncategorisedMerchants(state);
  const uncategorised = { summary: uncategorisedSummary, shouldPrompt: worthPrompting(uncategorisedSummary) };
  const hideUnreadPrompt = historyImportBusy ||
    (homeOnly && (!includeCleanupPrompts || uncategorised.shouldPrompt));
  const unreadCount = hideUnreadPrompt ? null : unreadFormatCount(state);
  const unreadFormats = unreadCount === null ? null
    : { count: unreadCount, shouldPrompt: unreadCount >= REPORT_PROMPT_THRESHOLD };

  // The store already provides display order. Stop at the six visible rows
  // rather than allocating a filtered copy of the entire transaction history.
  // Home leaves out transfers that the Transfers screen is guaranteed to list.
  // It must not rebuild the transfer graph here, so the test is row-local:
  // unconfirmed transfers (whose listing depends on the whole ledger, e.g. a
  // likely card repayment) stay in recent activity rather than disappear.
  const activityRows: Transaction[] = [];
  // Home only: each listed day's total on the month line's own terms
  // (isIncome +, isSpending −), so the days reconcile with Spent · In · Net;
  // transfers, withdrawals and other movements stay listed but add nothing.
  // The whole day counts, not just the rows shown: after the sixth row the
  // scan goes on to finish that row's day, for at most DAY_TOTAL_LOOKAHEAD
  // more rows. A day it cannot finish gets no total rather than a partial
  // one, and an out-of-order ledger gets none at all.
  const activityDayTotals = new Map<string, number>();
  const dayTotals = homeOnly && datesAreNewestFirst(state.transactions);
  const addToDay = (transaction: Transaction) => {
    const signed = isIncome(transaction, liveAccounts, internal) ? transaction.amountFils
      : isSpending(transaction, liveAccounts, internal) ? -transaction.amountFils : 0;
    activityDayTotals.set(transaction.date, (activityDayTotals.get(transaction.date) ?? 0) + signed);
  };
  let lookahead = 0;
  let duplicates: ReadonlySet<string> | undefined;
  for (const transaction of state.transactions) {
    const full = activityRows.length === 6;
    if (full && (!dayTotals || transaction.date < activityRows[5]!.date)) break;
    if (full && ++lookahead > DAY_TOTAL_LOOKAHEAD) { activityDayTotals.delete(activityRows[5]!.date); break; }
    if (countsInCashflowTotals(transaction, liveAccounts, internal) && inPeriod(transaction.date, period)) {
      if (homeOnly && isTransferCandidate(transaction)) {
        if (!duplicates) duplicates = duplicateTransactionIds(state.transactions);
        if (isListedExternalTransfer(transaction, duplicates)) continue;
      }
      if (!full) activityRows.push(transaction);
      if (dayTotals && (!full || activityDayTotals.has(transaction.date))) addToDay(transaction);
    }
  }

  const upcoming = { withinDays: UPCOMING_WITHIN_DAYS,
    items: homeOnly
      ? leavingSoon(state, now, { withinDays: UPCOMING_WITHIN_DAYS, kinds: ['card', 'bill'] })
      : leavingSoon(state, now, { withinDays: UPCOMING_WITHIN_DAYS }) };
  const accountById = new Map(state.accounts.map((account) => [account.id, account] as const));
  if (homeOnly) {
    return {
      // Home answers the everyday economic question. Cash withdrawals,
      // deposits, investments and unresolved transfers remain visible as
      // account activity, but do not distort Income / Spending / Net.
      hero: { incomeFils, expenseFils, netFils: incomeFils - expenseFils },
      hasPeriodTransfers: state.transactions.some(transaction => liveAccounts.has(transaction.accountId) &&
        inPeriod(transaction.date, period) && isTransferCandidate(transaction)),
      hasPeriodRecords: activityRows.length > 0 || state.transactions.some(transaction =>
        liveAccounts.has(transaction.accountId) && inPeriod(transaction.date, period)),
      upcoming, activityRows, activityDayTotals, accountById, internalTransactionIds: internal,
      unreadFormats, uncategorised,
    };
  }

  // The full dashboard keeps its existing figures and subscription timeline.
  // Omitted Home sections are not represented by fabricated zero amounts.
  const cashOut = summarizeCashOutflow(state, period, { live: liveAccounts, internal });
  const insight = includeInsights ? buildInsights(
    state.transactions, state.budgets, period, now, state.notSubscriptions, liveAccounts, internal,
    { cancelledSubscriptions: state.cancelledSubscriptions, customCategories: state.customCategories },
  ).find((item) => item.id !== dismissedInsightId) ?? null : null;

  return {
    live: isCurrentMonth(period, now),
    hero: { incomeFils, expenseFils, cashOutFils: cashOut.totalFils,
      cardPaymentsFils: cashOut.cardPaymentsFils, accountOutflowFils: cashOut.accountOutflowFils,
      netFils: incomeFils - expenseFils },
    comparison: periodComparison(state.transactions, period, liveAccounts, internal, now),
    insight,
    upcoming,
    activityRows,
    accountById,
    foreignActivity: summarizeForeignActivity(state.transactions,
      (transaction) => liveAccounts.has(transaction.accountId) &&
        !internal.has(transaction.id) && inPeriod(transaction.date, period)),
    internalTransactionIds: internal,
    lastAutomaticCaptureDate: state.transactions.find((transaction) => transaction.source === 'sms')?.date,
    unreadFormats: unreadFormats!, // Only the Home branch can omit this scan.
    uncategorised,
  };
}
