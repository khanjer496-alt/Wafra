/** One reconciled ledger view; presentation never invents a second money model. */
import { unreadFormatCount, REPORT_PROMPT_THRESHOLD } from '@/lib/accuracy';
import { periodComparison, type PeriodComparison } from '@/lib/analytics';
import { summarizeCashOutflow } from '@/lib/cash-flow';
import { summarizeForeignActivity, type ForeignActivitySummary } from '@/lib/fx-summary';
import { buildInsights, summarizeMonth, type Insight } from '@/lib/insights';
import { leavingSoon, type Outgoing } from '@/lib/leaving-soon';
import { countsInTotals, internalTransferIds, liveAccountIds } from '@/lib/ledger';
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
  /** Null when a higher-priority prompt hides this calculation. */
  unreadFormats: DashboardProjection['unreadFormats'] | null;
}

const UPCOMING_WITHIN_DAYS = 9;

export function projectDashboard(request: DashboardProjectionRequest & { surface: 'home' }): HomeDashboardProjection;
export function projectDashboard(request: DashboardProjectionRequest & { surface?: 'dashboard' }): DashboardProjection;
export function projectDashboard(request: DashboardProjectionRequest): DashboardProjection | HomeDashboardProjection;
export function projectDashboard(request: DashboardProjectionRequest): DashboardProjection | HomeDashboardProjection {
  const { state, period, now, dismissedInsightId, includeInsights = true } = request;
  const homeOnly = request.surface === 'home';
  const liveAccounts = liveAccountIds(state.accounts);
  const internal = internalTransferIds(state.transactions, state.accounts);
  const summary = summarizeMonth(state.transactions, period, liveAccounts, internal);
  const expenseFils = summary.expenseFils;
  const incomeFils = summary.incomeFils;
  const uncategorisedSummary = uncategorisedMerchants(state);
  const uncategorised = { summary: uncategorisedSummary, shouldPrompt: worthPrompting(uncategorisedSummary) };
  const hideUnreadPrompt = homeOnly && (uncategorised.shouldPrompt ||
    state.reviewTray.pending.some((item) => item.expiresAt > now.getTime()));
  const unreadCount = hideUnreadPrompt ? null : unreadFormatCount(state);
  const unreadFormats = unreadCount === null ? null
    : { count: unreadCount, shouldPrompt: unreadCount >= REPORT_PROMPT_THRESHOLD };

  // The store already provides display order. Stop at the six visible rows
  // rather than allocating a filtered copy of the entire transaction history.
  const activityRows: Transaction[] = [];
  for (const transaction of state.transactions) {
    if (countsInTotals(transaction, liveAccounts, internal) && inPeriod(transaction.date, period)) {
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
      hero: { incomeFils, expenseFils, netFils: incomeFils - expenseFils },
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
