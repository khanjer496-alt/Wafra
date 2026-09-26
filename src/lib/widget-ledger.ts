import { isFixedCommitment } from '@/lib/categories';
import { projectDashboard } from '@/lib/dashboard-projection';
import { monthEndISO, monthKey, monthStartISO } from '@/lib/format';
import { summarizeHomeToday, type HomeToday } from '@/lib/home-today';
import { isSpending, liveAccountIds } from '@/lib/ledger';
import type { LedgerMoneySpec } from '@/lib/ledger-money';
import type { Outgoing } from '@/lib/leaving-soon';
import { inPeriod } from '@/lib/period';
import { allocationsOf } from '@/lib/splits';
import type { AppState, Budget, Transaction } from '@/lib/types';
import { buildWidgetSnapshot, type WidgetSnapshot, type WidgetSnapshotInput } from '@/lib/widget-snapshot';

/**
 * The inputs Home hands the native widgets, in one place, so the widget sync
 * on Home and the previews on the Widgets screen can never describe two
 * different ledgers. Nothing here formats or invents a figure: it only
 * chooses which of Home's own projections go into `buildWidgetSnapshot`.
 */

/** Home's upcoming payments as the snapshot takes them. Card statements are exact; bills and subscriptions are projections. */
export function widgetUpcomingInput(items: readonly Outgoing[]): WidgetSnapshotInput['upcoming'] {
  return items.map((item) => ({
    title: item.title,
    amountFils: item.amountFils,
    dateISO: item.dateISO,
    overdue: item.overdue,
    estimated: item.kind !== 'card',
  }));
}

/**
 * Today, the week and budget pace for the live month, whatever period Home is
 * showing: widgets always describe the current month.
 */
export function widgetMonthToday(input: {
  transactions: readonly Transaction[];
  budgets: readonly Budget[];
  now: Date;
  liveAccounts: ReadonlySet<string>;
  internalIds: ReadonlySet<string>;
}): HomeToday {
  const currentKey = monthKey(input.now);
  const current = { mode: 'month', key: currentKey } as const;
  const live = input.liveAccounts as Set<string>;
  const internal = input.internalIds as Set<string>;
  return summarizeHomeToday({
    transactions: input.transactions,
    budgets: input.budgets,
    now: input.now,
    isSpending: (transaction) => isSpending(transaction, live, internal),
    inBudgetPeriod: (dateISO) => inPeriod(dateISO, current),
    budgetPeriodStartISO: monthStartISO(currentKey),
    budgetPeriodEndISO: monthEndISO(currentKey),
    allocations: allocationsOf,
    isFixedCommitment,
    averageWindow: null,
  });
}

/**
 * The snapshot the widgets hold right now for this ledger, or null when the
 * app writes none (not loaded, not onboarded, or private mode, which clears
 * it so the widgets ask to open Wafra).
 */
export function widgetSnapshotForLedger(input: {
  state: AppState;
  now: Date;
  moneySpec: LedgerMoneySpec;
  language: 'en' | 'ar';
}): WidgetSnapshot | null {
  const { state, now } = input;
  if (!state.hydrated || !state.onboarded || state.privateMode) return null;
  const dashboard = projectDashboard({
    state,
    period: { mode: 'month', key: monthKey(now) },
    now,
    surface: 'home',
    includeInsights: false,
    includeCleanupPrompts: false,
  });
  const today = widgetMonthToday({
    transactions: state.transactions,
    budgets: state.budgets,
    now,
    liveAccounts: liveAccountIds(state.accounts),
    internalIds: dashboard.internalTransactionIds,
  });
  return buildWidgetSnapshot({
    today,
    currency: input.moneySpec.currency,
    exponent: input.moneySpec.exponent,
    now,
    upcoming: widgetUpcomingInput(dashboard.upcoming.items),
    hideAmounts: false,
    language: input.language,
  });
}
