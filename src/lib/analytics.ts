import { monthKey, shiftMonthKey } from '@/lib/format';
import { internalTransferIds, isSpending } from '@/lib/ledger';
import { inPeriod, previousPeriod, toPeriod, type PeriodLike } from '@/lib/period';
import type { AppState, CategoryId, Transaction } from '@/lib/types';

export interface MerchantStat {
  title: string;
  category: CategoryId;
  totalFils: number;
  count: number;
}

/** Top merchants by spend within a month. */
export function topMerchants(
  transactions: Transaction[],
  period: PeriodLike,
  limit = 5,
  live?: Set<string>,
): MerchantStat[] {
  const map = new Map<string, MerchantStat>();
  for (const t of transactions) {
    if (!isSpending(t, live) || !inPeriod(t.date, period)) continue;
    const k = t.title.trim().toLowerCase();
    const cur = map.get(k);
    if (cur) {
      cur.totalFils += t.amountFils;
      cur.count += 1;
    } else {
      map.set(k, { title: t.title, category: t.category, totalFils: t.amountFils, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.totalFils - a.totalFils).slice(0, limit);
}

export interface CategoryMover {
  category: CategoryId;
  currentFils: number;
  previousFils: number;
  deltaFils: number;
}

/** Categories with the biggest spend change vs the previous month. */
export function categoryMovers(
  transactions: Transaction[],
  periodLike: PeriodLike,
  limit = 4,
  live?: Set<string>,
): CategoryMover[] {
  const period = toPeriod(periodLike);
  const prevPeriod = previousPeriod(period);
  if (!prevPeriod) return []; // 'all time' has nothing to compare against
  const cur = new Map<CategoryId, number>();
  const prev = new Map<CategoryId, number>();
  for (const t of transactions) {
    if (!isSpending(t, live)) continue;
    if (inPeriod(t.date, period)) cur.set(t.category, (cur.get(t.category) ?? 0) + t.amountFils);
    else if (inPeriod(t.date, prevPeriod)) prev.set(t.category, (prev.get(t.category) ?? 0) + t.amountFils);
  }
  const cats = new Set<CategoryId>([...cur.keys(), ...prev.keys()]);
  const movers: CategoryMover[] = [];
  for (const category of cats) {
    const currentFils = cur.get(category) ?? 0;
    const previousFils = prev.get(category) ?? 0;
    const deltaFils = currentFils - previousFils;
    if (Math.abs(deltaFils) < 5000) continue; // ignore < AED 50 noise
    movers.push({ category, currentFils, previousFils, deltaFils });
  }
  movers.sort((a, b) => Math.abs(b.deltaFils) - Math.abs(a.deltaFils));
  return movers.slice(0, limit);
}

/** Spend per weekday (0 = Sunday … 6 = Saturday) within a month. */
export function dayOfWeekSpend(
  transactions: Transaction[],
  period: PeriodLike,
  live?: Set<string>,
): number[] {
  const buckets = new Array(7).fill(0);
  for (const t of transactions) {
    if (!isSpending(t, live) || !inPeriod(t.date, period)) continue;
    const day = new Date(`${t.date}T12:00:00`).getDay();
    buckets[day] += t.amountFils;
  }
  return buckets;
}

/**
 * Net worth at the end of each of the last `months` months (oldest first).
 *
 * Two things this must agree with the rest of the app about, and did not:
 *
 * Archived accounts are excluded, as they are in `netWorthFils`. Including
 * their opening balance here while the headline figure excluded it meant
 * hiding a dead card moved the "since February" line by that card's whole
 * balance — the user hid an account and was told they had lost the money.
 *
 * Transfers do not move net worth. Paying AED 3,000 off a card is stored as
 * an income-side transfer on the card account, so counting it raised the
 * series by 3,000 out of nothing every time a card payment was imported.
 * Money moving between your own accounts is not money arriving.
 */
export function netWorthSeries(state: AppState, months = 6): { key: string; fils: number }[] {
  const nowKey = monthKey(new Date());
  const live = new Set(state.accounts.filter((a) => !a.archived).map((a) => a.id));
  const opening = state.accounts.reduce((s, a) => (a.archived ? s : s + a.openingFils), 0);
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) keys.push(shiftMonthKey(nowKey, -i));

  // Only the LEAVING side of a move between your own accounts reads as a
  // transfer; the arriving side is worded exactly like being paid and carries
  // no flag. Excluding one and counting the other made net worth rise every
  // time the user shifted their own money.
  const internal = internalTransferIds(state.transactions, live);

  return keys.map((key) => {
    let fils = opening;
    for (const t of state.transactions) {
      if (t.isTransfer || internal.has(t.id) || !live.has(t.accountId)) continue;
      if (monthKey(t.date) > key) continue;
      fils += t.type === 'income' ? t.amountFils : -t.amountFils;
    }
    return { key, fils };
  });
}

/** Per-month expense totals for one category over the last `months` months (oldest first). */
export function categoryTrend(
  transactions: Transaction[],
  category: CategoryId,
  months = 6,
): { key: string; fils: number }[] {
  const nowKey = monthKey(new Date());
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) keys.push(shiftMonthKey(nowKey, -i));
  return keys.map((key) => {
    let fils = 0;
    for (const t of transactions) {
      if (t.type === 'expense' && !t.isTransfer && t.category === category && monthKey(t.date) === key) {
        fils += t.amountFils;
      }
    }
    return { key, fils };
  });
}
