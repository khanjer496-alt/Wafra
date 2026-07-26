import { daysInMonth, monthKey } from '@/lib/format';
import type { Bill, Transaction } from '@/lib/types';

export type BillStatus = 'paid' | 'overdue' | 'due-soon' | 'upcoming';

export interface BillWithStatus {
  bill: Bill;
  status: BillStatus;
  /** Days until due this month; negative when overdue. */
  daysLeft: number;
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
  const lastDay = daysInMonth(key);

  const rows = bills.map((bill) => {
    const dueDay = Math.min(bill.dueDay, lastDay);
    const daysLeft = dueDay - today.getDate();
    const manuallyPaid = bill.paidMonths.includes(key);
    const autoReconciled = !manuallyPaid && paidByTransaction(bill, transactions, key);
    let status: BillStatus;
    if (manuallyPaid || autoReconciled) status = 'paid';
    else if (daysLeft < 0) status = 'overdue';
    else if (daysLeft <= 5) status = 'due-soon';
    else status = 'upcoming';
    return { bill, status, daysLeft, autoReconciled };
  });

  const rank: Record<BillStatus, number> = { overdue: 0, 'due-soon': 1, upcoming: 2, paid: 3 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || a.daysLeft - b.daysLeft);
  return rows;
}
