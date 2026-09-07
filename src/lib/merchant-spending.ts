import { countsInTotals, isIncome, isSpending } from '@/lib/ledger';
import { checkedMinorSum } from '@/lib/ledger-money';
import { inPeriod, type Period } from '@/lib/period';
import type { Transaction } from '@/lib/types';

/** Match the same recorded identity as topMerchants and transaction filters.
 * Logos, substrings and category inference must never merge financial records. */
export const merchantSpendingKey = (title: string): string => title.trim().toLowerCase();

export function projectMerchantSpending(
  transactions: readonly Transaction[],
  merchant: string,
  period: Period,
  live: Set<string>,
  internal: Set<string>,
) {
  const key = merchantSpendingKey(merchant);
  const activity = key ? transactions.filter(tx =>
    merchantSpendingKey(tx.title) === key && inPeriod(tx.date, period)) : [];
  activity.sort((a, b) => b.date.localeCompare(a.date) || (b.ts ?? 0) - (a.ts ?? 0) || a.id.localeCompare(b.id));
  const spending = activity.filter(tx => isSpending(tx, live, internal));
  const received = activity.filter(tx => isIncome(tx, live, internal));
  const totalFils = checkedMinorSum(spending.map(tx => tx.amountFils));
  const receivedFils = checkedMinorSum(received.map(tx => tx.amountFils));
  const excludedCount = activity.filter(tx => !countsInTotals(tx, live, internal)).length;
  return {
    activity, spending, received, totalFils, receivedFils, excludedCount,
    averageFils: spending.length ? Math.round(totalFils / spending.length) : null,
    averageApproximate: spending.length > 0 && totalFils % spending.length !== 0,
    lastPurchase: spending[0]?.date ?? null,
    // The persisted ledger has no reliable refund-to-purchase relationship.
    // Do not infer refunds from income, title, or a logo, or net them off spend.
    hasConvertedAmounts: spending.some(tx => tx.originalCurrency !== undefined),
  };
}

export const merchantSpendingHref = (title: string): `/merchant?${string}` =>
  `/merchant?name=${encodeURIComponent(title.trim())}`;
