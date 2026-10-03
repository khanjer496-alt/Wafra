import { categoryLabel, isFixedCommitment } from '@/lib/categories';
import { billsForMonth } from '@/lib/bills';
import { openDues } from '@/lib/cards';
import { monthEndISO, monthKey, monthStartISO, toISODate } from '@/lib/format';
import { summarizeHomeToday, type HomeToday } from '@/lib/home-today';
import { summarizeMonth } from '@/lib/insights';
import { internalTransferIdsForState, isSpending, liveAccountIds } from '@/lib/ledger';
import type { LedgerMoneySpec } from '@/lib/ledger-money';
import { inPeriod } from '@/lib/period';
import { allocationsOf } from '@/lib/splits';
import { activeSubscriptions, billCommitments, daysUntilNext, fixedCommitments, isSubscriptionDismissed, subscriptionKey, subscriptionLabel, subscriptionMatchesBill, trueSubscriptions, withoutCancelled, type Subscription } from '@/lib/subscriptions';
import { futureAnnualBillAgendaItems } from '@/lib/upcoming-bills';
import { upcomingWindowItems, type AgendaRecurrence } from '@/lib/upcoming-window';
import { spendingCategoryRows, type PaymentAgendaItem } from '@/lib/reference-presentation';
import type { AppState, Budget, Transaction } from '@/lib/types';
import { buildWidgetSnapshot, WIDGET_UPCOMING_DAYS, type WidgetSnapshot, type WidgetSnapshotInput } from '@/lib/widget-snapshot';

/**
 * The inputs Home hands the native widgets, in one place, so the widget sync
 * on Home and the previews on the Widgets screen can never describe two
 * different ledgers. Nothing here formats or invents a figure: it only
 * combines the live-month Today projection with Bills' complete upcoming window.
 * Recurrence detection is supplied by the cooperative caller, never run in render.
 */

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
 * This month as the Spending tab shows it on its first open: the live month,
 * summarizeMonth's definition of spending and spendingCategoryRows' order,
 * with each category named in the widget's language. Limits are left out:
 * the widget draws shares of what was spent.
 */
export function widgetMonthSpending(input: {
  state: Pick<AppState, 'transactions' | 'budgets' | 'customCategories'>;
  now: Date;
  liveAccounts: ReadonlySet<string>;
  internalIds: ReadonlySet<string>;
  language: 'en' | 'ar';
}): NonNullable<WidgetSnapshotInput['spending']> {
  const key = monthKey(input.now);
  const summary = summarizeMonth(input.state.transactions as Transaction[], { mode: 'month', key },
    input.liveAccounts as Set<string>, input.internalIds as Set<string>);
  const rows = spendingCategoryRows(summary, input.state.budgets, true).filter((row) => row.spentFils > 0);
  return {
    monthKey: key,
    totalFils: summary.expenseFils,
    categories: rows.map((row) => ({
      label: categoryLabel(row.category, input.language, input.state.customCategories ?? []),
      fils: row.spentFils,
    })),
  };
}

export interface WidgetLedgerInput {
  state: AppState;
  now: Date;
  moneySpec: LedgerMoneySpec;
  language: 'en' | 'ar';
}

/** The same dated obligations and recurrence rules as Bills' Next 30 days. */
export function widgetUpcomingForLedger(state: AppState, now: Date, detected: readonly Subscription[]): WidgetSnapshotInput['upcoming'] {
  const live = liveAccountIds(state.accounts);
  const internal = internalTransferIdsForState(state);
  const subs = withoutCancelled(activeSubscriptions(trueSubscriptions([...detected])), state.cancelledSubscriptions);
  const fixed = withoutCancelled(billCommitments(activeSubscriptions(fixedCommitments([...detected]))), state.cancelledSubscriptions);
  const recurring = [...subs, ...fixed].filter(sub => !isSubscriptionDismissed(sub, state.notSubscriptions ?? []));
  const recurringById = new Map(recurring.map(sub => [`sub-${subscriptionKey(sub)}`, sub]));
  const billById = new Map(state.bills.map(bill => [bill.id, bill]));
  const names = new Map(state.accounts.map(account => [account.id, account.name]));
  const items: PaymentAgendaItem[] = openDues(state, now).map(({ due, daysLeft, remainingFils }) => ({
    id: `card-${due.id}`, kind: 'card', category: 'other', title: names.get(due.accountId) ?? '',
    dateISO: due.dueDate, daysLeft, amountFils: remainingFils, estimated: false, paid: false,
  }));
  for (const { bill, status, dueISO, daysLeft } of billsForMonth(state.bills, state.transactions, now, live, internal)) {
    items.push({ id: `bill-${bill.id}`, kind: 'bill', category: bill.category, title: bill.title,
      displayLabel: subscriptionLabel({ title: bill.title, billIdentity: bill.importIdentity }),
      dateISO: dueISO, daysLeft, amountFils: bill.amountFils, estimated: false, paid: status === 'paid' });
  }
  items.push(...futureAnnualBillAgendaItems(state.bills, state.transactions, now, live, internal, WIDGET_UPCOMING_DAYS));
  for (const sub of recurring) {
    if (sub.cadence === 'as-needed' || state.bills.some(bill => subscriptionMatchesBill(sub, bill))) continue;
    items.push({ id: `sub-${subscriptionKey(sub)}`, kind: 'recurring', category: sub.category, title: sub.title,
      displayLabel: subscriptionLabel(sub),
      dateISO: sub.nextExpectedISO, daysLeft: daysUntilNext(sub, now), amountFils: sub.lastAmountFils,
      // The prior receipt confirms a past payment, not this future renewal.
      estimated: true, paid: false });
  }
  const recurrenceOf = (item: PaymentAgendaItem): AgendaRecurrence | null => {
    if (item.kind === 'bill') {
      const bill = billById.get(item.id.slice(5));
      if (!bill) return null;
      return { cadence: bill.yearlyOnISO ? 'yearly' : 'monthly',
        anchorDay: bill.yearlyOnISO ? Number(bill.yearlyOnISO.slice(8, 10)) : bill.dueDay,
        isPaid: date => bill.paidMonths.includes(monthKey(date)) };
    }
    const cadence = recurringById.get(item.id)?.cadence;
    return cadence === 'weekly' || cadence === 'monthly' || cadence === 'yearly' ? { cadence } : null;
  };
  const todayISO = toISODate(now);
  return upcomingWindowItems(items, recurrenceOf, todayISO, WIDGET_UPCOMING_DAYS)
    // Coming up is future-facing: Bills also lists overdue/expected-earlier
    // rows, which must not consume the widget's three upcoming slots.
    .filter(item => !item.paid && item.dateISO >= todayISO)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id))
    .map(item => ({ title: item.title, ...(item.displayLabel ? { displayLabel: item.displayLabel } : {}),
      amountFils: item.amountFils, dateISO: item.dateISO, estimated: item.estimated }));
}

/** Pure formatting after the cooperative caller has finished recurrence detection. */
export function widgetSnapshotForLedger(input: WidgetLedgerInput, detectedSubscriptions: readonly Subscription[]): WidgetSnapshot | null {
  const { state, now } = input;
  if (!state.hydrated || !state.onboarded || state.privateMode) return null;
  const liveAccounts = liveAccountIds(state.accounts);
  const internalIds = internalTransferIdsForState(state);
  const today = widgetMonthToday({
    transactions: state.transactions, budgets: state.budgets, now, liveAccounts, internalIds,
  });
  return buildWidgetSnapshot({
    today, currency: input.moneySpec.currency, exponent: input.moneySpec.exponent, now,
    upcoming: widgetUpcomingForLedger(state, now, detectedSubscriptions),
    hideAmounts: false, language: input.language,
    spending: widgetMonthSpending({ state, now, liveAccounts, internalIds, language: input.language }),
  });
}
