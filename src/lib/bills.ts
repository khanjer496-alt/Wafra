import { monthEndISO, monthKey, monthStartISO, toISODate } from '@/lib/format';
import { isSpending } from '@/lib/ledger';
import type { Bill, Transaction } from '@/lib/types';

/**
 * The calendar date a monthly bill falls due inside a given money month.
 *
 * A money month starting on the 25th spans two calendar months, so "day 3"
 * belongs to the second of them and "day 28" to the first. Clamped to the
 * month's own end, so a bill on the 31st still lands on a day that exists.
 */
export function dueDateInMonth(key: string, dueDay: number): string {
  const startISO = monthStartISO(key);
  const endISO = monthEndISO(key);
  const startDay = Number(startISO.slice(8, 10));
  const base = dueDay >= startDay ? startISO : endISO;
  const [y, m] = [Number(base.slice(0, 4)), Number(base.slice(5, 7))];
  const lastOfThatMonth = new Date(y, m, 0).getDate();
  const day = Math.min(dueDay, lastOfThatMonth);
  const iso = `${base.slice(0, 7)}-${String(day).padStart(2, '0')}`;
  // Never outside the month it is supposed to describe.
  return iso < startISO ? startISO : iso > endISO ? endISO : iso;
}

export type BillStatus = 'paid' | 'overdue' | 'due-soon' | 'upcoming';

export interface BillWithStatus {
  bill: Bill;
  status: BillStatus;
  /** Days until due this month; negative when overdue. */
  daysLeft: number;
  /** The actual calendar date this bill falls due, inside the money month. */
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
    // The paid flag is keyed to the MONEY month, so the date has to be found
    // inside that same month. It was calendar arithmetic — `bill.dueDay -
    // today.getDate()` — which describes a different month entirely once the
    // month starts on a salary day. With a start of the 25th, a bill due on
    // the 28th and paid on 28 June read "Paid" all through July while its
    // countdown talked about 28 July, and the July payment stayed invisible
    // until the 25th.
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
