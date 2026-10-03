import { billsForMonth, type BillWithStatus } from '@/lib/bills';
import { daysBetweenISO, monthKey, monthStartISO, shiftMonthKey, shiftISO, toISODate } from '@/lib/format';
import type { Bill, Transaction } from '@/lib/types';
import type { PaymentAgendaItem } from '@/lib/reference-presentation';

/**
 * Annual bills absent from the current money month's agenda but due inside
 * this window. Monthly bills already have a base row that recurrence expands.
 * Reconcile against ALL bills in each future month, preserving the rule that
 * one ambiguous payment cannot settle two obligations from the same provider.
 */
export function futureAnnualBillAgendaItems(
  bills: Bill[], transactions: Transaction[], now: Date,
  live: Set<string>, internal: Set<string>, windowDays: number,
): PaymentAgendaItem[] {
  if (!bills.some(bill => bill.yearlyOnISO)) return [];
  const todayISO = toISODate(now), endISO = shiftISO(todayISO, windowDays);
  const lastMonth = monthKey(endISO);
  const items: PaymentAgendaItem[] = [];
  for (let key = shiftMonthKey(monthKey(now), 1); key <= lastMonth; key = shiftMonthKey(key, 1)) {
    const at = new Date(`${monthStartISO(key)}T12:00:00`);
    for (const { bill, dueISO, status } of billsForMonth(bills, transactions, at, live, internal)) {
      if (!bill.yearlyOnISO || dueISO < todayISO || dueISO > endISO) continue;
      items.push({ id: `bill-${bill.id}`, kind: 'bill', title: bill.title, category: bill.category,
        dateISO: dueISO, daysLeft: daysBetweenISO(todayISO, dueISO), amountFils: bill.amountFils,
        estimated: false, paid: status === 'paid' });
    }
  }
  return items;
}

/** Resolve the original bill in the month of the tapped occurrence, not today's month. */
export function billForAgendaOccurrence(
  bills: Bill[], transactions: Transaction[], selection: { id: string; dueISO: string } | null,
  now: Date, live: Set<string>, internal: Set<string>,
): BillWithStatus | null {
  if (!selection) return null;
  const row = billsForMonth(bills, transactions, new Date(`${selection.dueISO}T12:00:00`), live, internal)
    .find(item => item.bill.id === selection.id && item.dueISO === selection.dueISO);
  if (!row) return null;
  const daysLeft = daysBetweenISO(toISODate(now), row.dueISO);
  return { ...row, daysLeft,
    status: row.status === 'paid' ? 'paid' : daysLeft < 0 ? 'overdue' : daysLeft <= 5 ? 'due-soon' : 'upcoming' };
}
