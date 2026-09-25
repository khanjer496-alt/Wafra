import type { MerchantStat } from '@/lib/analytics';
import { categorySupportsType, readMerchantCategoryOverride } from '@/lib/categories';
import { monthKey, shiftMonthKey, toISODate } from '@/lib/format';
import { isIncome, isSpending } from '@/lib/ledger';
import { merchantSpendingKey } from '@/lib/merchant-spending';
import { periodStartISO, toPeriod, type PeriodLike } from '@/lib/period';
import type { CategoryId, Transaction } from '@/lib/types';
import { overrideAppliesTo } from '@/lib/uncategorised';

/* ── Merchant directory ────────────────────────────────────────────────── */

export type MerchantSort = 'amount' | 'visits';

export interface RankedMerchant extends MerchantStat {
  /** 1-based position in the full, unfiltered list for the chosen sort. */
  rank: number;
}

/**
 * Rank the directory. "By visits" ties break on money, then on the name, so
 * the order is stable across renders and the same on every device.
 */
export function rankMerchants(stats: readonly MerchantStat[], sort: MerchantSort): RankedMerchant[] {
  const ordered = [...stats].sort((a, b) => sort === 'visits'
    ? b.count - a.count || b.totalFils - a.totalFils || a.title.localeCompare(b.title)
    : b.totalFils - a.totalFils || b.count - a.count || a.title.localeCompare(b.title));
  return ordered.map((row, index) => ({ ...row, rank: index + 1 }));
}

/** History that starts less than this many days before the period is too thin to call a shop new. */
export const NEW_MERCHANT_MIN_HISTORY_DAYS = 28;

export type NewMerchantResult =
  | { available: true; keys: Set<string> }
  | { available: false; reason: 'all-time' | 'no-history' | 'history-too-short'; keys: Set<string> };

const dayGap = (fromISO: string, toISO: string): number => Math.round(
  (new Date(`${toISO}T12:00:00`).getTime() - new Date(`${fromISO}T12:00:00`).getTime()) / 86_400_000);

/**
 * Merchants seen in the selected period that the ledger has never recorded
 * before it.
 *
 * "New" is a claim about the past, so it is only made when the ledger's
 * history actually reaches back before the period — and by a margin. A ledger
 * whose first row is in this period would otherwise call every shop new.
 * Any earlier row with the same recorded name (a purchase, a refund, a
 * transfer) disqualifies the merchant: the question is whether it is new to
 * this ledger, not whether it was spending before.
 */
export function newMerchantKeys(
  transactions: readonly Transaction[],
  period: PeriodLike,
  currentKeys: Iterable<string>,
): NewMerchantResult {
  const target = toPeriod(period);
  if (target.mode === 'all') return { available: false, reason: 'all-time', keys: new Set() };
  const start = periodStartISO(target);
  let earliest = '';
  const before = new Set<string>();
  for (const tx of transactions) {
    if (!earliest || tx.date < earliest) earliest = tx.date;
    if (tx.date < start) {
      const key = merchantSpendingKey(tx.title);
      if (key) before.add(key);
    }
  }
  if (!earliest || earliest >= start) return { available: false, reason: 'no-history', keys: new Set() };
  if (dayGap(earliest, start) < NEW_MERCHANT_MIN_HISTORY_DAYS) {
    return { available: false, reason: 'history-too-short', keys: new Set() };
  }
  const keys = new Set<string>();
  for (const key of currentKeys) if (key && !before.has(key)) keys.add(key);
  return { available: true, keys };
}

/* ── One merchant, month by month ──────────────────────────────────────── */

export interface MerchantMonth {
  key: string;
  fils: number;
  count: number;
  /** The month falls inside the selected reporting period. */
  selected: boolean;
}

/** At most a year of bars; a single-month period shows this many months of context. */
export const MERCHANT_SERIES_MAX_MONTHS = 12;
export const MERCHANT_SERIES_MIN_MONTHS = 6;

const monthDiff = (a: string, b: string): number =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/**
 * Whole-month totals for one merchant.
 *
 * Honest about coverage: the series never starts before the ledger's first
 * recorded month (a month before any data is unknown, not zero), and never
 * runs past the current month. A month inside that window with no activity at
 * this merchant is a real zero and is returned as one, so the chart can draw it
 * empty. Uses the same identity (recorded name) and the same totals rule
 * (`isSpending` / `isIncome`) as the rest of the merchant screen.
 */
export function merchantMonthlySeries(
  transactions: readonly Transaction[],
  merchant: string,
  period: PeriodLike,
  live: Set<string>,
  internal: Set<string>,
  kind: 'expense' | 'income' = 'expense',
  today: Date = new Date(),
): MerchantMonth[] {
  const key = merchantSpendingKey(merchant);
  if (!key || transactions.length === 0) return [];
  let earliest = '';
  for (const tx of transactions) if (!earliest || tx.date < earliest) earliest = tx.date;
  const firstMonth = monthKey(earliest);
  const currentMonth = monthKey(toISODate(today));
  const target = toPeriod(period);

  let startMonth: string;
  let endMonth: string;
  switch (target.mode) {
    case 'month': startMonth = target.key; endMonth = target.key; break;
    case 'year': startMonth = `${target.year}-01`; endMonth = `${target.year}-12`; break;
    case 'range': startMonth = monthKey(target.from); endMonth = monthKey(target.to); break;
    case 'all': startMonth = firstMonth; endMonth = currentMonth; break;
  }
  const selectedStart = startMonth;
  const selectedEnd = endMonth;
  if (endMonth > currentMonth) endMonth = currentMonth;
  if (monthDiff(startMonth, endMonth) + 1 < MERCHANT_SERIES_MIN_MONTHS) {
    startMonth = shiftMonthKey(endMonth, -(MERCHANT_SERIES_MIN_MONTHS - 1));
  }
  if (monthDiff(startMonth, endMonth) + 1 > MERCHANT_SERIES_MAX_MONTHS) {
    startMonth = shiftMonthKey(endMonth, -(MERCHANT_SERIES_MAX_MONTHS - 1));
  }
  if (startMonth < firstMonth) startMonth = firstMonth;
  if (startMonth > endMonth) return [];

  const months: MerchantMonth[] = [];
  const byKey = new Map<string, MerchantMonth>();
  for (let month = startMonth; month <= endMonth; month = shiftMonthKey(month, 1)) {
    const row = { key: month, fils: 0, count: 0, selected: month >= selectedStart && month <= selectedEnd };
    months.push(row);
    byKey.set(month, row);
  }
  const counts = kind === 'income' ? isIncome : isSpending;
  for (const tx of transactions) {
    if (merchantSpendingKey(tx.title) !== key || !counts(tx, live, internal)) continue;
    const row = byKey.get(monthKey(tx.date));
    if (!row) continue;
    row.fils += tx.amountFils;
    row.count += 1;
  }
  return months;
}

/* ── "Always <category>" ───────────────────────────────────────────────── */

/**
 * The saved merchant rule for this name and direction — read exactly as the
 * parser reads it — and, for a candidate category, how many recorded rows an
 * "update existing" choice would move.
 *
 * The count uses `overrideAppliesTo`, the predicate the `setMerchantOverride`
 * reducer applies, and leaves out rows already in the candidate category, so
 * the number printed before a bulk rewrite is the number of rows it changes.
 */
export function merchantRuleSummary(
  transactions: readonly Transaction[],
  overrides: Readonly<Record<string, CategoryId>> | undefined,
  merchant: string,
  kind: 'expense' | 'income' = 'expense',
): { category: CategoryId | null; applies: number; movable: (candidate: CategoryId) => number } {
  const key = merchantSpendingKey(merchant);
  const category = key ? readMerchantCategoryOverride(overrides, key, kind) ?? null : null;
  const matching = key ? transactions.filter((tx) => overrideAppliesTo(tx, key, kind)) : [];
  return {
    category,
    applies: matching.length,
    movable: (candidate) => categorySupportsType(candidate, kind)
      ? matching.reduce((count, tx) => tx.category === candidate ? count : count + 1, 0)
      : 0,
  };
}
