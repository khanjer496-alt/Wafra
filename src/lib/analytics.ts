import { isFixedCommitment } from '@/lib/categories';
import { monthKey, shiftMonthKey } from '@/lib/format';
import { inPeriod, previousPeriod, toPeriod, type PeriodLike } from '@/lib/period';
import type { AppState, CategoryId, Transaction } from '@/lib/types';

export interface MerchantStat {
  title: string;
  category: CategoryId;
  totalFils: number;
  count: number;
}

/** Top merchants by spend within a month. */
export function topMerchants(transactions: Transaction[], period: PeriodLike, limit = 5): MerchantStat[] {
  const map = new Map<string, MerchantStat>();
  for (const t of transactions) {
    if (t.type !== 'expense' || t.isTransfer || !inPeriod(t.date, period)) continue;
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
export function categoryMovers(transactions: Transaction[], periodLike: PeriodLike, limit = 4): CategoryMover[] {
  const period = toPeriod(periodLike);
  const prevPeriod = previousPeriod(period);
  if (!prevPeriod) return []; // 'all time' has nothing to compare against
  const cur = new Map<CategoryId, number>();
  const prev = new Map<CategoryId, number>();
  for (const t of transactions) {
    if (t.type !== 'expense' || t.isTransfer) continue;
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

/**
 * Day-to-day spend per weekday (0 = Sunday … 6 = Saturday) within a period.
 *
 * Fixed commitments are excluded, the same way `buildInsights` excludes them
 * from "top category" and "largest purchase". A weekday chart is a claim about
 * habit, and one AED 5,500 rent charge is forty times a grocery run: leave it
 * in and six of the seven bars collapse to stubs while the seventh reports the
 * day of the month the landlord's standing order happens to fall on. That is
 * not a pattern, it is a calendar coincidence — the reading changes completely
 * if the rent is taken a day later.
 */
export function dayOfWeekSpend(transactions: Transaction[], period: PeriodLike): number[] {
  const buckets = new Array(7).fill(0);
  for (const t of transactions) {
    if (t.type !== 'expense' || t.isTransfer || !inPeriod(t.date, period)) continue;
    if (isFixedCommitment(t.category)) continue;
    const day = new Date(`${t.date}T12:00:00`).getDay();
    buckets[day] += t.amountFils;
  }
  return buckets;
}

/** Net worth at the end of each of the last `months` months (oldest first). */
export function netWorthSeries(state: AppState, months = 6): { key: string; fils: number }[] {
  const nowKey = monthKey(new Date());
  const opening = state.accounts.reduce((s, a) => s + a.openingFils, 0);
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) keys.push(shiftMonthKey(nowKey, -i));

  return keys.map((key) => {
    let fils = opening;
    for (const t of state.transactions) {
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
 */
export function categoryTrend(
  transactions: Transaction[],
  category: CategoryId,
  months = 6,
  endKey?: string,
): { key: string; fils: number }[] {
  const nowKey = endKey ?? monthKey(new Date());
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
