import { isFixedCommitment } from '@/lib/categories';
import { monthKey, shiftMonthKey } from '@/lib/format';
import { internalTransferIds, isSpending } from '@/lib/ledger';
import {
  comparablePreviousPeriod,
  inPeriod,
  periodLabel,
  toPeriod,
  type PeriodLike,
} from '@/lib/period';
import { allocationsOf, amountInCategory } from '@/lib/splits';
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
  internal?: Set<string>,
): MerchantStat[] {
  const map = new Map<string, MerchantStat>();
  for (const t of transactions) {
    if (!isSpending(t, live, internal) || !inPeriod(t.date, period)) continue;
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
  internal?: Set<string>,
  today: Date = new Date(),
): CategoryMover[] {
  const period = toPeriod(periodLike);
  // Cut to the same elapsed length, NOT the whole previous period. Comparing
  // sixteen days of this month against thirty-one of last is a subtraction of
  // two different-sized things, and it reads as improvement every time: a
  // ledger spending an identical amount every day of both months reported
  // every category DOWN, all month, until the final day.
  const prevPeriod = comparablePreviousPeriod(period, today, transactions);
  if (!prevPeriod) return []; // 'all time' has nothing to compare against
  const cur = new Map<CategoryId, number>();
  const prev = new Map<CategoryId, number>();
  for (const t of transactions) {
    if (!isSpending(t, live, internal)) continue;
    // Split rows contribute to several categories at once, so movers are
    // computed over allocations rather than the row's headline category.
    const target = inPeriod(t.date, period) ? cur : inPeriod(t.date, prevPeriod) ? prev : null;
    if (!target) continue;
    for (const a of allocationsOf(t)) {
      target.set(a.category, (target.get(a.category) ?? 0) + a.amountFils);
    }
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

/**
 * Day-to-day spend per weekday (0 = Sunday … 6 = Saturday) within a period.
 *
 * Fixed commitments are excluded, the same way `buildInsights` excludes them
 * from "top category" and "largest purchase". A weekday chart is a claim about
 * habit, and one AED 5,500 rent charge is forty times a grocery run: leave it
 * in and six of the seven bars collapse to stubs while the seventh reports the
 * day of the month the landlord's standing order happens to fall on. That is
 * not a pattern, it is a calendar coincidence — the reading changes completely
 * if the rent is taken a day later. Measured on the July 2026 demo: Wednesday
 * read 7,821 against a next-highest 1,682, 4.7x, purely because 1 July 2026
 * was a Wednesday.
 */
export function dayOfWeekSpend(
  transactions: Transaction[],
  period: PeriodLike,
  live?: Set<string>,
  internal?: Set<string>,
): number[] {
  const buckets = new Array(7).fill(0);
  for (const t of transactions) {
    if (!isSpending(t, live, internal) || !inPeriod(t.date, period)) continue;
    if (isFixedCommitment(t.category)) continue;
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
  //
  // Paired over ALL accounts, not `live`: the leaving leg is very often on the
  // account being retired, and pairing over the live set alone meant hiding
  // that account restored the arrival to the series as fresh money. Whether an
  // account is shown is a separate question, asked below on `live`.
  const internal = internalTransferIds(state.transactions, state.accounts);

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

/**
 * Per-month expense totals for one category, `months` months ending at
 * `endKey` (oldest first).
 *
 * `endKey` defaults to the calendar month, but the caller normally passes the
 * month being reported on. The window used to be hard-anchored to today, so on
 * a screen reporting July the strip ran to August and the sentence under it
 * named a month the rest of the screen was not talking about.
 *
 * This one also spelled the spending rule out by hand, and in the positive form —
 * an expense that is not flagged — which is the mirror of the shape the
 * contract scan for hand-rolled definitions was looking for, so it never saw
 * it. It therefore skipped only the flagged side of a transfer: a hidden card
 * kept contributing to the trend line under
 * a category whose monthly total on Flow excluded it, and a legacy own-account
 * sweep (stored with a structural title and no flag) drew a spike in a month
 * where Flow showed nothing. Same two sets as everywhere else.
 */
export function categoryTrend(
  transactions: Transaction[],
  category: CategoryId,
  months = 6,
  endKey?: string,
  live?: Set<string>,
  internal?: Set<string>,
): { key: string; fils: number }[] {
  // SIGNATURE HAZARD, named because it is the kind that does not fail at
  // compile time. Before this merge one branch had (txs, cat, months, live,
  // internal) and the other had (txs, cat, months, endKey) — same arity,
  // incompatible fourth parameter. A `Set` arriving as `endKey` is compared
  // with === against a "YYYY-MM" string, so every bucket reads zero and the
  // strip renders as "no spending in this category" rather than as a bug.
  // Any JS caller (the test harness is plain JS; tsc cannot see it) that still
  // passes the old shape gets a name-the-problem throw instead.
  if (endKey != null && typeof endKey !== 'string') {
    throw new TypeError(
      'categoryTrend: the 4th argument is endKey ("YYYY-MM"); liveAccounts and internalTransferIds are 5th and 6th',
    );
  }
  const nowKey = endKey ?? monthKey(new Date());
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) keys.push(shiftMonthKey(nowKey, -i));
  return keys.map((key) => {
    let fils = 0;
    for (const t of transactions) {
      if (isSpending(t, live, internal) && monthKey(t.date) === key) {
        fils += amountInCategory(t, category);
      }
    }
    return { key, fils };
  });
}

export interface TrendShape {
  averageFils: number;
  latestFils: number;
  minFils: number;
  maxFils: number;
  /** The series never really moved, so "average" and "latest" say one thing. */
  flat: boolean;
  /** Latest against the average, as a fraction: 0.18 is 18% above. */
  latestVsAverage: number;
  latestIsHighest: boolean;
  latestIsLowest: boolean;
}

/**
 * What a six-month series actually says, so the sentence under it can branch.
 *
 * Rent is the same AED 5,500 every month, and the caption read "AED 5,500 a
 * month on average, AED 5,500 in the latest" — a template with no branch,
 * printing one number twice and calling it an observation. A flat series is a
 * finding ("it has not moved in six months"); it just is not the same finding
 * as a rising one, and the copy has to know which one it is holding.
 *
 * Kept because /stats ships: src/app/stats.tsx is its only consumer, and
 * dropping the screen would make this dead code.
 */
export function trendShape(points: { fils: number }[]): TrendShape {
  if (points.length === 0) {
    return {
      averageFils: 0,
      latestFils: 0,
      minFils: 0,
      maxFils: 0,
      flat: true,
      latestVsAverage: 0,
      latestIsHighest: true,
      latestIsLowest: true,
    };
  }
  const values = points.map((p) => p.fils);
  const minFils = Math.min(...values);
  const maxFils = Math.max(...values);
  const latestFils = values[values.length - 1];
  const averageFils = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
  // Flat within a dirham, or within 1% of the biggest month — a standing order
  // that drifts by a few fils has still not moved.
  const flat = maxFils - minFils <= Math.max(100, maxFils * 0.01);
  return {
    averageFils,
    latestFils,
    minFils,
    maxFils,
    flat,
    latestVsAverage: averageFils > 0 ? (latestFils - averageFils) / averageFils : 0,
    latestIsHighest: latestFils === maxFils,
    latestIsLowest: latestFils === minFils,
  };
}

export interface PeriodComparison {
  /** Spending in the period so far. */
  currentFils: number;
  /** Spending in the previous period, over the SAME number of elapsed days. */
  previousFils: number;
  /** current − previous. Positive means more is going out than last time. */
  deltaFils: number;
  /** null when previous is zero — a ratio against nothing is not a ratio. */
  ratio: number | null;
  /** What the previous period is called, for the sentence under the figure. */
  previousLabel: string;
  /** True while the current period is still running, so the comparison is partial. */
  partial: boolean;
}

/**
 * This period's spending against the same stretch of the one before it.
 *
 * Returns null rather than a zero when there is nothing to compare against,
 * which is the case that matters most: a ledger with one month of history has
 * no previous month, and answering "+100%" against zero would be the app's
 * loudest claim built on its thinnest evidence. Every caller must render
 * nothing at all in that case — not a dash, not a 0%.
 */
export function periodComparison(
  transactions: Transaction[],
  periodLike: PeriodLike,
  live?: Set<string>,
  internal?: Set<string>,
  today: Date = new Date(),
): PeriodComparison | null {
  const period = toPeriod(periodLike);
  const previous = comparablePreviousPeriod(period, today, transactions);
  if (!previous) return null;

  let currentFils = 0;
  let previousFils = 0;
  let previousRows = 0;
  for (const t of transactions) {
    if (!isSpending(t, live, internal)) continue;
    if (inPeriod(t.date, period)) currentFils += t.amountFils;
    else if (inPeriod(t.date, previous)) {
      previousFils += t.amountFils;
      previousRows += 1;
    }
  }

  // No rows at all in the comparison window means the ledger did not exist
  // yet, which is different from a month where nothing was spent. Both would
  // read as previousFils === 0; only the first one makes the comparison a lie.
  if (previousRows === 0) return null;

  return {
    currentFils,
    previousFils,
    deltaFils: currentFils - previousFils,
    ratio: previousFils > 0 ? (currentFils - previousFils) / previousFils : null,
    previousLabel: periodLabel(previous.mode === 'range' ? previousPeriodOf(period) : previous),
    partial: previous.mode === 'range',
  };
}

/**
 * The name to print for the comparison window.
 *
 * `comparablePreviousPeriod` returns a RANGE mid-month — 25 Jun to 10 Jul —
 * and "25 Jun – 10 Jul" is a true label that nobody reads as "last month".
 * So the label comes from the whole previous period and the `partial` flag
 * carries the caveat, which lets the screen say "vs Jul, same 16 days" instead
 * of a date range the reader has to decode.
 */
function previousPeriodOf(period: ReturnType<typeof toPeriod>) {
  const [y, m] = period.mode === 'month' ? period.key.split('-').map(Number) : [0, 0];
  if (period.mode === 'month') {
    const d = new Date(y, m - 2, 1);
    return {
      mode: 'month' as const,
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    };
  }
  if (period.mode === 'year') return { mode: 'year' as const, year: period.year - 1 };
  return period;
}
