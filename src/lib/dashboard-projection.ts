/** One reconciled ledger view; presentation never invents a second money model. */
import { unreadFormatCount, REPORT_PROMPT_THRESHOLD } from '@/lib/accuracy';
import { periodComparison, type PeriodComparison } from '@/lib/analytics';
import { summarizeCashOutflow } from '@/lib/cash-flow';
import { summarizeForeignActivity, type ForeignActivitySummary } from '@/lib/fx-summary';
import { buildInsights, summarizeMonth, type Insight } from '@/lib/insights';
import { leavingSoon, type Outgoing } from '@/lib/leaving-soon';
import { countsInCashflowTotals, internalTransferIdsForState, liveAccountIds } from '@/lib/ledger';
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
  /**
   * The period has transfer records on live accounts. Home links to Transfers
   * and does not call a period "empty" when its only records are transfers.
   */
  hasPeriodTransfers: boolean;
  /** Null when a higher-priority prompt hides this calculation. */
  unreadFormats: DashboardProjection['unreadFormats'] | null;
}

const UPCOMING_WITHIN_DAYS = 9;

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
    { includeRecurringAnalysis: false },
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
  let duplicates: ReadonlySet<string> | undefined;
  for (const transaction of state.transactions) {
    if (countsInCashflowTotals(transaction, liveAccounts, internal) && inPeriod(transaction.date, period)) {
      if (homeOnly && isTransferCandidate(transaction)) {
        if (!duplicates) duplicates = duplicateTransactionIds(state.transactions);
        if (isListedExternalTransfer(transaction, duplicates)) continue;
      }
      activityRows.push(transaction);
      if (activityRows.length === 6) break;
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
      upcoming, activityRows, accountById, internalTransactionIds: internal,
      unreadFormats, uncategorised,
    };
  }

  // The full dashboard keeps its existing figures and subscription timeline.
  // Omitted Home sections are not represented by fabricated zero amounts.
  const cashOut = summarizeCashOutflow(state, period, { live: liveAccounts, internal });
  const insight = includeInsights ? buildInsights(
    state.transactions, state.budgets, period, now, state.notSubscriptions, liveAccounts, internal,
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
