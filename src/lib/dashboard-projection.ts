/** One reconciled ledger view; presentation never invents a second money model. */
import { unreadFormatCount, REPORT_PROMPT_THRESHOLD } from '@/lib/accuracy';
import { periodComparison, type PeriodComparison } from '@/lib/analytics';
import { summarizeCashOutflow } from '@/lib/cash-flow';
import { summarizeForeignActivity, type ForeignActivitySummary } from '@/lib/fx-summary';
import { buildInsights, summarizeMonth, type Insight } from '@/lib/insights';
import { leavingSoon, type Outgoing } from '@/lib/leaving-soon';
import { internalTransferIds, liveAccountIds } from '@/lib/ledger';
import { inPeriod, isCurrentMonth, type Period } from '@/lib/period';
import { uncategorisedMerchants, worthPrompting, type UncategorisedSummary } from '@/lib/uncategorised';
import type { Account, AppState, Transaction } from '@/lib/types';

export interface DashboardProjectionRequest {
  state: AppState;
  period: Period;
  now: Date;
  dismissedInsightId?: string | null;
  /** Screens that do not render insights need not run their historical analysis. */
  includeInsights?: boolean;
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

const UPCOMING_WITHIN_DAYS = 9;

export function projectDashboard(request: DashboardProjectionRequest): DashboardProjection {
  const { state, period, now, dismissedInsightId, includeInsights = true } = request;
  const liveAccounts = liveAccountIds(state.accounts);
  const internal = internalTransferIds(state.transactions, liveAccounts);
  const summary = summarizeMonth(state.transactions, period, liveAccounts, internal);
  const expenseFils = summary.expenseFils;
  const incomeFils = summary.incomeFils;
  const cashOut = summarizeCashOutflow(state, period, { live: liveAccounts, internal });
  const unreadCount = unreadFormatCount(state);
  const uncategorisedSummary = uncategorisedMerchants(state);
  const insight = includeInsights ? buildInsights(
    state.transactions, state.budgets, period, now, state.notSubscriptions, liveAccounts, internal,
  ).find((item) => item.id !== dismissedInsightId) ?? null : null;

  // The store already provides display order. Stop at the six visible rows
  // rather than allocating a filtered copy of the entire transaction history.
  const activityRows: Transaction[] = [];
  for (const transaction of state.transactions) {
    if (!transaction.isTransfer && !internal.has(transaction.id) &&
      liveAccounts.has(transaction.accountId) && inPeriod(transaction.date, period)) {
      activityRows.push(transaction);
      if (activityRows.length === 6) break;
    }
  }

  return {
    live: isCurrentMonth(period, now),
    hero: { incomeFils, expenseFils, cashOutFils: cashOut.totalFils,
      cardPaymentsFils: cashOut.cardPaymentsFils, accountOutflowFils: cashOut.accountOutflowFils,
      netFils: incomeFils - expenseFils },
    comparison: periodComparison(state.transactions, period, liveAccounts, internal, now),
    insight,
    upcoming: { withinDays: UPCOMING_WITHIN_DAYS,
      items: leavingSoon(state, now, { withinDays: UPCOMING_WITHIN_DAYS }) },
    activityRows,
    accountById: new Map(state.accounts.map((account) => [account.id, account] as const)),
    foreignActivity: summarizeForeignActivity(state.transactions,
      (transaction) => liveAccounts.has(transaction.accountId) &&
        !internal.has(transaction.id) && inPeriod(transaction.date, period)),
    internalTransactionIds: internal,
    lastAutomaticCaptureDate: state.transactions.find((transaction) => transaction.source === 'sms')?.date,
    unreadFormats: { count: unreadCount, shouldPrompt: unreadCount >= REPORT_PROMPT_THRESHOLD },
    uncategorised: { summary: uncategorisedSummary, shouldPrompt: worthPrompting(uncategorisedSummary) },
  };
}
