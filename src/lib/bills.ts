import {
  daysBetweenISO,
  daysInMonth,
  getMonthStartDay,
  monthKey,
  shiftMonthKey,
  toISODate,
} from '@/lib/format';
import type { Bill, Transaction } from '@/lib/types';

export type BillStatus = 'paid' | 'overdue' | 'due-soon' | 'upcoming';

export interface BillWithStatus {
  bill: Bill;
  status: BillStatus;
  /** The calendar date this bill falls due on in the report month. */
  dueISO: string;
  /** Days until due this month; negative when overdue. */
  daysLeft: number;
  /** True when paid was inferred from an imported transaction, not marked manually. */
  autoReconciled?: boolean;
}

/**
 * The calendar date a `dueDay` lands on inside report month `key`. The single
 * definition of when a bill is due — the Bills screen, Home's "leaving soon"
 * list and the scheduled reminders all read it from here, so they can never
 * disagree about which day, or which month, a bill belongs to.
 *
 * Two things it gets right that `new Date(year, month, dueDay)` does not:
 *
 * - A day past the end of the month is CLAMPED. Left to the Date constructor,
 *   day 31 of February silently rolls forward to 2 or 3 March, so anything
 *   keyed off it fires days after the bill was actually due.
 * - With a salary-day month start the day is placed inside the window the
 *   report month really covers. With MONTH_START_DAY = 25 the "June" month
 *   runs 25 Jun – 24 Jul, so due-day 30 is 30 June and due-day 10 is 10 July.
 */
export function billDueISO(dueDay: number, key: string): string {
  const day = Math.min(31, Math.max(1, Math.round(dueDay) || 1));
  // Days before the start day sit in the tail of the window, which falls in
  // the following calendar month.
  const monthOf = day < getMonthStartDay() ? shiftMonthKey(key, 1) : key;
  const clamped = Math.min(day, daysInMonth(monthOf));
  return `${monthOf}-${String(clamped).padStart(2, '0')}`;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * A bill counts as paid this month if an imported expense matches it:
 * same month, similar title (either contains the other), amount within ±15%.
 * Keeps reminders honest when the actual debit was auto-imported from SMS.
 */
function paidByTransaction(bill: Bill, transactions: Transaction[], key: string): boolean {
  const billTitle = normalize(bill.title);
  if (!billTitle) return false;
  for (const t of transactions) {
    if (t.type !== 'expense' || t.isTransfer || monthKey(t.date) !== key) continue;
    if (t.amountFils < bill.amountFils * 0.85 || t.amountFils > bill.amountFils * 1.15) continue;
    const txTitle = normalize(t.title);
    // Every string contains "", so a title that normalizes to nothing (a row
    // titled "—" or "***") would otherwise mark any similar-sized bill paid.
    if (!txTitle) continue;
    if (txTitle.includes(billTitle) || billTitle.includes(txTitle)) return true;
  }
  return false;
}

/** Status of each bill for the month containing `today`, sorted most urgent first. */
export function billsForMonth(
  bills: Bill[],
  transactions: Transaction[],
  today: Date,
): BillWithStatus[] {
  const key = monthKey(today);
  const todayISO = toISODate(today);

  const rows = bills.map((bill) => {
    const dueISO = billDueISO(bill.dueDay, key);
    const daysLeft = daysBetweenISO(todayISO, dueISO);
    const manuallyPaid = bill.paidMonths.includes(key);
    const autoReconciled = !manuallyPaid && paidByTransaction(bill, transactions, key);
    let status: BillStatus;
    if (manuallyPaid || autoReconciled) status = 'paid';
    else if (daysLeft < 0) status = 'overdue';
    else if (daysLeft <= 5) status = 'due-soon';
    else status = 'upcoming';
    return { bill, status, dueISO, daysLeft, autoReconciled };
  });

  const rank: Record<BillStatus, number> = { overdue: 0, 'due-soon': 1, upcoming: 2, paid: 3 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || a.daysLeft - b.daysLeft);
  return rows;
}
