import { daysInMonth, monthKey, toISODate } from '@/lib/format';
import { isSpending } from '@/lib/ledger';
import type { Bill, Transaction } from '@/lib/types';

/**
 * The calendar date a monthly bill falls due in a given month.
 *
 * Clamped to the month's own end, so a bill on the 31st still lands on a day
 * that exists: in February it falls due on the 28th, or the 29th in a leap
 * year.
 */
export function dueDateInMonth(key: string, dueDay: number): string {
  const day = Math.min(Math.max(dueDay, 1), daysInMonth(key));
  return `${key}-${String(day).padStart(2, '0')}`;
}

export type BillStatus = 'paid' | 'overdue' | 'due-soon' | 'upcoming';

export interface BillWithStatus {
  bill: Bill;
  status: BillStatus;
  /** Days until due this month; negative when overdue. */
  daysLeft: number;
  /** The actual calendar date this bill falls due this month. */
  dueISO: string;
  /** True when paid was inferred from an imported transaction, not marked manually. */
  autoReconciled?: boolean;
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
    if (!isSpending(t) || monthKey(t.date) !== key) continue;
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
    // The paid flag and the countdown must describe the SAME month, so the
    // date is derived from the month key rather than from calendar arithmetic
    // on today's date. The old `bill.dueDay - today.getDate()` form is what
    // made a bill due on the 28th and paid on 28 June read "Paid" all through
    // July while counting down to 28 July.
    const dueISO = dueDateInMonth(key, bill.dueDay);
    const daysLeft = Math.round(
      (new Date(`${dueISO}T12:00:00`).getTime() - new Date(`${todayISO}T12:00:00`).getTime()) /
        86400000,
    );
    const manuallyPaid = bill.paidMonths.includes(key);
    const autoReconciled = !manuallyPaid && paidByTransaction(bill, transactions, key);
    let status: BillStatus;
    if (manuallyPaid || autoReconciled) status = 'paid';
    else if (daysLeft < 0) status = 'overdue';
    else if (daysLeft <= 5) status = 'due-soon';
    else status = 'upcoming';
    return { bill, status, daysLeft, dueISO, autoReconciled };
  });

  const rank: Record<BillStatus, number> = { overdue: 0, 'due-soon': 1, upcoming: 2, paid: 3 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || a.daysLeft - b.daysLeft);
  return rows;
}
