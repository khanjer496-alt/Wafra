/**
 * Home v3's hero: "Spent in <Month>", the small trend beside it, and the thin
 * line of the month's spending under it. Pure: every figure is added up from
 * real ledger rows with the shared spending definition (`isSpending`), over
 * the shared money-month boundaries (`monthStartISO`, salary day included),
 * and compared like for like through the same window Spending's Compare view
 * uses (`comparablePreviousPeriod`: the same number of elapsed days of the
 * month before, never past its end). Nothing here is drawn or stored.
 */
import { monthEndISO, monthStartISO, shiftMonthKey } from '@/lib/format';
import { isSpending } from '@/lib/ledger';
import { comparablePreviousPeriod, daysInPeriod, elapsedDays, type Period } from '@/lib/period';
import type { Transaction } from '@/lib/types';

export type TrendDirection = 'up' | 'down' | 'same';

/** This month's spending so far against the same days of the month before. */
export interface SpendTrend {
  /** Spending from the month's first day to today (or its last day, once it has ended). */
  currentFils: number;
  /** Spending over the same number of days from the start of the month before. */
  previousFils: number;
  /** Whole percent, signed: (current − previous) / previous, rounded. */
  percent: number;
  direction: TrendDirection;
  /** The month compared against. */
  previousKey: string;
  /** Days on each side of the comparison (this month's elapsed days). */
  days: number;
  /** The month is still running, so the earlier month is cut to the same days. */
  partial: boolean;
}

export interface HeroMonthSeries {
  key: string;
  /** Days in the money month, elapsed or not: the line's full width. */
  monthDays: number;
  /** Spending to date at the end of each elapsed day (index 0 is day one). */
  cumulative: number[];
  /** Null with nothing honest to compare against: no spending recorded in the earlier window. */
  trend: SpendTrend | null;
}


/** ISO date `days` after `iso`, noon-anchored so daylight saving cannot move it. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** Inclusive date window a comparison period covers. */
function windowOf(period: Period): { from: string; to: string } | null {
  if (period.mode === 'month') return { from: monthStartISO(period.key), to: monthEndISO(period.key) };
  if (period.mode === 'range') return { from: period.from, to: period.to };
  return null;
}

/**
 * One money month of spending, day by day so far, and its trend against the
 * same days of the month before. One pass over the ledger; only rows dated
 * inside either window are tested against the spending rule.
 */
export function projectHeroMonth(
  transactions: readonly Transaction[],
  key: string,
  today: Date,
  live?: Set<string>,
  internal?: Set<string>,
): HeroMonthSeries {
  const period: Period = { mode: 'month', key };
  const monthDays = daysInPeriod(period, today);
  const elapsed = Math.max(0, Math.min(monthDays, elapsedDays(period, today, [])));
  const startISO = monthStartISO(key);
  const endISO = elapsed > 0 ? addDays(startISO, elapsed - 1) : '';
  const daily = new Array<number>(elapsed).fill(0);
  const dayIndex = new Map<string, number>();
  for (let day = 0; day < elapsed; day += 1) dayIndex.set(addDays(startISO, day), day);

  const previous = elapsed > 0 ? comparablePreviousPeriod(period, today) : null;
  const before = previous ? windowOf(previous) : null;
  let previousFils = 0;
  let previousRows = 0;
  for (const transaction of transactions) {
    const date = transaction.date;
    const inside = elapsed > 0 && date >= startISO && date <= endISO;
    const earlier = before !== null && date >= before.from && date <= before.to;
    if (!inside && !earlier) continue;
    if (!isSpending(transaction, live, internal)) continue;
    if (inside) {
      const at = dayIndex.get(date);
      if (at !== undefined) daily[at]! += transaction.amountFils;
    } else {
      previousFils += transaction.amountFils;
      previousRows += 1;
    }
  }
  const cumulative: number[] = [];
  let running = 0;
  for (const fils of daily) { running += fils; cumulative.push(running); }

  // No spending at all in the earlier window means the ledger did not reach
  // back that far (or nothing was spent): a percentage against nothing is not
  // a trend, so there is no chip (`periodComparison` follows the same rule).
  const trend: SpendTrend | null = previous && previousRows > 0 && previousFils > 0 ? (() => {
    const percent = Math.round(((running - previousFils) / previousFils) * 100);
    return {
      currentFils: running, previousFils, percent,
      direction: percent > 0 ? 'up' : percent < 0 ? 'down' : 'same',
      previousKey: shiftMonthKey(key, -1), days: elapsed, partial: previous.mode === 'range',
    };
  })() : null;
  return { key, monthDays, cumulative, trend };
}

export interface SparkPoint { x: number; y: number }

/**
 * The month's cumulative spending as a line inside `width` × `height`: one
 * point at the month's start (nothing spent yet) and one at the end of each
 * elapsed day, spread over the whole month so a month still running ends
 * part way across. The top of the box is the larger of the month so far and
 * `ceiling` (the same days of last month, when known), so a month running
 * under last month's pace ends below the top. A month with nothing spent is a
 * flat line on the baseline. Left to right;
 * the caller mirrors it for right-to-left reading.
 */
export function sparklinePoints(cumulative: readonly number[], monthDays: number, width: number, height: number,
  inset = 1.5, ceiling = 0): SparkPoint[] {
  if (cumulative.length === 0 || !(monthDays > 0) || !(width > 0) || !(height > 0)) return [];
  const days = Math.max(monthDays, cumulative.length);
  const top = Math.max(1, Number.isFinite(ceiling) ? ceiling : 0, ...cumulative);
  const drawable = Math.max(0, height - inset * 2);
  const y = (fils: number) => inset + (1 - Math.max(0, fils) / top) * drawable;
  const points: SparkPoint[] = [{ x: 0, y: y(0) }];
  cumulative.forEach((fils, index) => points.push({ x: ((index + 1) / days) * width, y: y(fils) }));
  return points;
}

/** The points as an SVG path (`M x,y L x,y …`), rounded to a tenth of a point; empty for no points. */
export function sparklinePath(points: readonly SparkPoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`).join(' ');
}

/* ── Over last month's pace ───────────────────────────────────────────── */

/** Spending so far above the same days of last month ('over'), or not ('within'). */
export type PaceState = 'within' | 'over';

export function paceState(trend: SpendTrend | null): PaceState | null {
  if (!trend) return null;
  return trend.currentFils > trend.previousFils ? 'over' : 'within';
}

/** What Home remembers between visits: the last state it saw, and the day it last nudged. */
export interface PaceMemory {
  month: string;
  state: PaceState;
  nudgedOn: string | null;
}

/**
 * The nudge fires when this month's spending is seen crossing from at or
 * under last month's pace to over it: the earlier observation (this session
 * or a stored one, same money month) said 'within' and this one says 'over'.
 * At most once a day. A first observation, a new month, or a month that has
 * no comparison yet never nudges; it only records what it saw.
 */
export function nextPaceMemory(memory: PaceMemory | null, month: string, state: PaceState | null,
  todayISO: string): { memory: PaceMemory | null; nudge: boolean } {
  if (state === null) return { memory, nudge: false };
  const crossed = memory !== null && memory.month === month && memory.state === 'within' && state === 'over';
  const nudge = crossed && memory.nudgedOn !== todayISO;
  const nudgedOn = nudge ? todayISO : memory?.nudgedOn ?? null;
  if (memory && memory.month === month && memory.state === state && memory.nudgedOn === nudgedOn) return { memory, nudge };
  return { memory: { month, state, nudgedOn }, nudge };
}

/** A stored memory, or null when it is missing or not one. */
export function readPaceMemory(value: unknown): PaceMemory | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PaceMemory>;
  if (typeof raw.month !== 'string' || !/^\d{4}-\d{2}$/.test(raw.month)) return null;
  if (raw.state !== 'within' && raw.state !== 'over') return null;
  const nudgedOn = typeof raw.nudgedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.nudgedOn) ? raw.nudgedOn : null;
  return { month: raw.month, state: raw.state, nudgedOn };
}

