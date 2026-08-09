import { ledgerCurrencyCode } from '@/lib/markets';
import type { Transaction } from '@/lib/types';

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

/**
 * Summarise charge rows that carry the original amount from a bank alert.
 *
 * `localFils` is the row's stored `amountFils`, so "local" here means the
 * LEDGER's accounting currency — the one those fils are denominated in — not
 * whichever market pack happens to be active. Original minor units are only ever added
 * within one ISO currency group; adding USD and EUR together would create a
 * precise-looking number with no financial meaning.
 *
 * FOREIGN MEANS "NOT THE LOCAL CURRENCY", and that comparison was missing.
 * Every row carrying an `originalCurrency` counted, including rows whose
 * original currency IS the local one — which the parser produces whenever a
 * bank states the amount in its own currency explicitly. Under the SA pack a
 * SAR 100.00 charge therefore sat in "Foreign spending" with its `amountFils`
 * printed beside it under the local currency's name: two figures, both labelled
 * SAR, that disagree, because one of them is the AED equivalent this ledger
 * stores. A charge in the money you spend every day is not foreign activity.
 *
 * `localCurrency` is a parameter with the ledger's own currency as its default
 * so a caller — or a test — can ask the question for a currency without having
 * to move the global first.
 */
export function summarizeForeignActivity(
  transactions: Transaction[],
  include: (transaction: Transaction) => boolean = () => true,
  localCurrency: string = ledgerCurrencyCode(),
): ForeignActivitySummary {
  const local = localCurrency.trim().toUpperCase();
  const foreign = transactions.filter(
    (tx) =>
      tx.type === 'expense' &&
      !tx.isTransfer &&
      include(tx) &&
      typeof tx.originalCurrency === 'string' &&
      /^[A-Za-z]{3}$/.test(tx.originalCurrency) &&
      tx.originalCurrency.toUpperCase() !== local &&
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
    totalLocalFils: groups.reduce((sum, group) => sum + group.localFils, 0),
    bankQuotedCount: groups.reduce((sum, group) => sum + group.bankQuotedCount, 0),
    referenceCount: groups.reduce((sum, group) => sum + group.referenceCount, 0),
    estimatedCount: groups.reduce((sum, group) => sum + group.estimatedCount, 0),
  };
}
