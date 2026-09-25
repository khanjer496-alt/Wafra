/**
 * What the first-run "ready" screen may say about the ledger it just built.
 *
 * Every figure comes from the ledger as it stands: spending uses `isSpending`
 * with the live-account and internal-transfer sets (so moves between the
 * person's own accounts never count), category totals use `allocationsOf`
 * (so a split charge is shared out), and recurring payments come from
 * `detectSubscriptions` with the same exclusions. Nothing is estimated.
 */
import type { CategoryId, Transaction } from '@/lib/types';
import { allocationsOf } from '@/lib/splits';
import type { Subscription } from '@/lib/subscriptions';

export interface ReadyCategory {
  category: CategoryId;
  amountMinor: number;
}

export interface ReadySummary {
  /** Distinct calendar months the ledger's dated entries fall in. */
  months: number;
  /** Every ledger entry, as the result card already counts them. */
  transactions: number;
  /** Distinct merchants among real spending. */
  merchants: number;
  /** Largest spending categories, biggest first (at most `limit`). */
  categories: ReadyCategory[];
  /** Spending outside the categories shown; 0 when nothing is left over. */
  otherMinor: number;
  /** Active recurring charges grouped as subscriptions. */
  subscriptions: number;
  /** Active recurring utility, housing and other commitment bills. */
  bills: number;
  /** First and last month key (YYYY-MM) of spending, for the range label. */
  firstMonth: string | null;
  lastMonth: string | null;
}

const monthOf = (date: string): string | null => (/^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : null);

export function onboardingReadySummary(input: {
  transactions: readonly Transaction[];
  isSpending: (transaction: Transaction) => boolean;
  subscriptions: readonly Pick<Subscription, 'group' | 'status'>[];
  limit?: number;
}): ReadySummary {
  const limit = input.limit ?? 4;
  const months = new Set<string>();
  const merchants = new Set<string>();
  const byCategory = new Map<CategoryId, number>();
  let firstMonth: string | null = null;
  let lastMonth: string | null = null;
  for (const tx of input.transactions) {
    const month = monthOf(tx.date);
    if (month) months.add(month);
    if (!input.isSpending(tx)) continue;
    const title = tx.title?.trim().toLowerCase();
    if (title) merchants.add(title);
    if (month) {
      if (firstMonth === null || month < firstMonth) firstMonth = month;
      if (lastMonth === null || month > lastMonth) lastMonth = month;
    }
    for (const part of allocationsOf(tx)) {
      byCategory.set(part.category, (byCategory.get(part.category) ?? 0) + part.amountFils);
    }
  }
  const ranked = [...byCategory.entries()]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = ranked.slice(0, limit).map(([category, amountMinor]) => ({ category, amountMinor }));
  const otherMinor = ranked.slice(limit).reduce((sum, [, amount]) => sum + amount, 0);
  let subscriptions = 0;
  let bills = 0;
  for (const item of input.subscriptions) {
    if (item.status !== 'active') continue;
    if (item.group === 'subscription') subscriptions += 1;
    else bills += 1;
  }
  return {
    months: months.size,
    transactions: input.transactions.length,
    merchants: merchants.size,
    categories: shown,
    otherMinor,
    subscriptions,
    bills,
    firstMonth,
    lastMonth,
  };
}
