/**
 * The Home dashboard's pure ledger projection.
 *
 * This is an in-process deep module: callers provide one state snapshot and
 * receive one reconciled view model. Account visibility, internal transfers,
 * monetary summaries, comparison windows, prompts, and activity selection all
 * stay behind this interface so the screen cannot accidentally derive adjacent
 * figures from different definitions of the ledger.
 */
import { unreadFormatCount, REPORT_PROMPT_THRESHOLD } from '@/lib/accuracy';
import { periodComparison, type PeriodComparison } from '@/lib/analytics';
import { summarizeCashOutflow } from '@/lib/cash-flow';
import { summarizeForeignActivity, type ForeignActivitySummary } from '@/lib/fx-summary';
import { composition, buildInsights, summarizeMonth, type Insight } from '@/lib/insights';
import { leavingSoon, type Outgoing } from '@/lib/leaving-soon';
import { internalTransferIds, liveAccountIds } from '@/lib/ledger';
import { inPeriod, isCurrentMonth, type Period } from '@/lib/period';
import {
  uncategorisedMerchants,
  worthPrompting,
  type UncategorisedSummary,
} from '@/lib/uncategorised';
import type { Account, AppState, Transaction } from '@/lib/types';

export interface DashboardProjectionRequest {
  state: AppState;
  period: Period;
  now: Date;
  dismissedInsightId?: string | null;
}

export interface DashboardProjection {
  live: boolean;
  hero: {
    incomeFils: number;
    expenseFils: number;
    cashOutFils: number;
    netFils: number;
  };
  comparison: PeriodComparison | null;
  insight: Insight | null;
  upcoming: {
    withinDays: number;
    items: Outgoing[];
  };
  activityRows: Transaction[];
  accountById: ReadonlyMap<string, Account>;
  foreignActivity: ForeignActivitySummary;
  internalTransactionIds: ReadonlySet<string>;
  lastAutomaticCaptureDate?: string;
  unreadFormats: {
    count: number;
    shouldPrompt: boolean;
  };
  uncategorised: {
    summary: UncategorisedSummary;
    shouldPrompt: boolean;
  };
}

/** Home's definition of "soon". Kept with the selection policy it controls. */
const UPCOMING_WITHIN_DAYS = 9;

/**
 * Project every pure fact Home renders from one state/period/time snapshot.
 *
 * The result contains no callbacks or mutable UI state. Interactions,
 * expansion, dismissal state, and rendering remain the screen's work.
 */
export function projectDashboard(request: DashboardProjectionRequest): DashboardProjection {
  const { state, period, now, dismissedInsightId } = request;
  const liveAccounts = liveAccountIds(state.accounts);
  const internal = internalTransferIds(state.transactions, liveAccounts);
  const summary = summarizeMonth(state.transactions, period, liveAccounts, internal);
  const expenseFils = composition(summary).totalFils;
  const incomeFils = Math.round(summary.incomeFils / 100) * 100;
  const cashOutFils = summarizeCashOutflow(state, period, {
    live: liveAccounts,
    internal,
  }).totalFils;
  const unreadCount = unreadFormatCount(state);
  const uncategorisedSummary = uncategorisedMerchants(state);

  const insight = buildInsights(
    state.transactions,
    state.budgets,
    period,
    now,
    state.notSubscriptions,
    liveAccounts,
    internal,
  ).find((item) => item.id !== dismissedInsightId) ?? null;

  return {
    live: isCurrentMonth(period, now),
    hero: {
      incomeFils,
      expenseFils,
      cashOutFils,
      netFils: incomeFils - expenseFils,
    },
    comparison: periodComparison(state.transactions, period, liveAccounts, internal, now),
    insight,
    upcoming: {
      withinDays: UPCOMING_WITHIN_DAYS,
      items: leavingSoon(state, now, { withinDays: UPCOMING_WITHIN_DAYS }),
    },
    activityRows: state.transactions
      .filter(
        (transaction) =>
          !transaction.isTransfer &&
          !internal.has(transaction.id) &&
          liveAccounts.has(transaction.accountId) &&
          inPeriod(transaction.date, period),
      )
      .slice(0, 6),
    accountById: new Map(state.accounts.map((account) => [account.id, account] as const)),
    foreignActivity: summarizeForeignActivity(
      state.transactions,
      (transaction) =>
        liveAccounts.has(transaction.accountId) &&
        !internal.has(transaction.id) &&
        inPeriod(transaction.date, period),
    ),
    internalTransactionIds: internal,
    lastAutomaticCaptureDate: state.transactions.find((transaction) => transaction.source === 'sms')
      ?.date,
    unreadFormats: {
      count: unreadCount,
      shouldPrompt: unreadCount >= REPORT_PROMPT_THRESHOLD,
    },
    uncategorised: {
      summary: uncategorisedSummary,
      shouldPrompt: worthPrompting(uncategorisedSummary),
    },
  };
}
