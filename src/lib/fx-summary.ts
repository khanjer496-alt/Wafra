import type { Transaction } from '@/lib/types';
import { totalAsShown } from '@/lib/format';

export interface CurrencyActivity {
  currency: string;
  originalMinor: number;
  localFils: number;
  count: number;
  bankQuotedCount: number;
  referenceCount: number;
  estimatedCount: number;
  latestDate: string;
}

export interface ForeignActivitySummary {
  groups: CurrencyActivity[];
  transactions: Transaction[];
  totalLocalFils: number;
  bankQuotedCount: number;
  referenceCount: number;
  estimatedCount: number;
}

export interface ForeignActivityPreviewSummary {
  groups: CurrencyActivity[];
  remainingCount: number;
  remainingLocalFils: number;
  totalLocalFils: number;
}

/**
 * The compact Home breakdown, reconciled at the whole-AED precision it shows.
 *
 * The card has room for only a few currencies, but its heading covers all of
 * them. The hidden tail therefore needs an explicit remainder row, calculated
 * from the same per-currency rounding as the visible rows.
 */
export function previewForeignActivity(
  summary: ForeignActivitySummary,
  maxGroups = 2,
): ForeignActivityPreviewSummary {
  const limit = Math.max(0, Math.floor(maxGroups));
  const groups = summary.groups.slice(0, limit);
  const remaining = summary.groups.slice(limit);
  return {
    groups,
    remainingCount: remaining.length,
    remainingLocalFils: totalAsShown(remaining.map((group) => group.localFils)),
    totalLocalFils: totalAsShown(summary.groups.map((group) => group.localFils)),
  };
}

/**
 * Summarise charge rows that carry the original amount from a bank alert.
 *
 * AED is the ledger's accounting currency, so local totals continue to use
 * `amountFils`. Original minor units are only ever added within one ISO
 * currency group; adding USD and EUR together would create a precise-looking
 * number with no financial meaning.
 */
export function summarizeForeignActivity(
  transactions: Transaction[],
  include: (transaction: Transaction) => boolean = () => true,
): ForeignActivitySummary {
  const foreign = transactions.filter(
    (tx) =>
      tx.type === 'expense' &&
      !tx.isTransfer &&
      include(tx) &&
      typeof tx.originalCurrency === 'string' &&
      /^[A-Za-z]{3}$/.test(tx.originalCurrency) &&
      Number.isSafeInteger(tx.originalAmountMinor) &&
      (tx.originalAmountMinor ?? 0) > 0,
  );

  const grouped = new Map<string, CurrencyActivity>();
  for (const tx of foreign) {
    const currency = tx.originalCurrency!.toUpperCase();
    const row = grouped.get(currency) ?? {
      currency,
      originalMinor: 0,
      localFils: 0,
      count: 0,
      bankQuotedCount: 0,
      referenceCount: 0,
      estimatedCount: 0,
      latestDate: tx.date,
    };
    row.originalMinor += tx.originalAmountMinor!;
    row.localFils += tx.amountFils;
    row.count += 1;
    row.latestDate = row.latestDate > tx.date ? row.latestDate : tx.date;
    if (tx.fxSource === 'bank') row.bankQuotedCount += 1;
    else if (tx.fxSource === 'reference') row.referenceCount += 1;
    else row.estimatedCount += 1;
    grouped.set(currency, row);
  }

  const groups = [...grouped.values()].sort(
    (a, b) => b.localFils - a.localFils || a.currency.localeCompare(b.currency),
  );
  return {
    groups,
    transactions: foreign,
    // This is a display summary: the headline must equal the whole-AED group
    // rows below it, not a separately rounded sum of their hidden fils.
    totalLocalFils: totalAsShown(groups.map((group) => group.localFils)),
    bankQuotedCount: groups.reduce((sum, group) => sum + group.bankQuotedCount, 0),
    referenceCount: groups.reduce((sum, group) => sum + group.referenceCount, 0),
    estimatedCount: groups.reduce((sum, group) => sum + group.estimatedCount, 0),
  };
}
