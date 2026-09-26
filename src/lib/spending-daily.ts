import type { DailySpend } from '@/lib/analytics';
import { isFixedCommitment } from '@/lib/categories';
import { monthEndISO, monthStartISO, shiftMonthKey, toISODate } from '@/lib/format';
import { isSpending } from '@/lib/ledger';
import { toPeriod, type PeriodLike } from '@/lib/period';
import { allocationsOf } from '@/lib/splits';
import type { Transaction } from '@/lib/types';

export interface SpendingDailyView {
  days: DailySpend[];
  /** The dates drawn on this page; the selected reporting scope stays unchanged. */
  from: string;
  to: string;
  paged: boolean;
  /** Calendar month, independent of the user's salary-month boundary. */
  monthKey: string;
  previousMonthKey: string | null;
  nextMonthKey: string | null;
}

const validDate = (iso: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(iso)
  && Number.isFinite(Date.parse(`${iso}T12:00:00Z`))
  && new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso;
const calendarMonthEnd = (key: string): string => {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year!, month!, 0, 12)).toISOString().slice(0, 10);
};

/**
 * Daily spending for any reporting scope. Short ranges retain every day;
 * longer scopes page by calendar month so years of history never mount
 * thousands of tiles. Money months and years retain their salary boundaries.
 */
export function spendingDailyView(
  transactions: Transaction[],
  periodLike: PeriodLike,
  live?: Set<string>,
  internal?: Set<string>,
  include: (transaction: Transaction) => boolean = () => true,
  options: { todayISO?: string; monthKey?: string } = {},
): SpendingDailyView {
  const period = toPeriod(periodLike);
  const today = options.todayISO ?? toISODate(new Date());
  let scopeFrom: string;
  let scopeTo: string;
  if (period.mode === 'month') {
    scopeFrom = monthStartISO(period.key); scopeTo = monthEndISO(period.key);
  } else if (period.mode === 'year') {
    scopeFrom = monthStartISO(`${period.year}-01`); scopeTo = monthEndISO(`${period.year}-12`);
  } else if (period.mode === 'range') {
    scopeFrom = period.from; scopeTo = period.to;
  } else {
    scopeFrom = `${today.slice(0, 7)}-01`;
    scopeTo = calendarMonthEnd(today.slice(0, 7));
    for (const transaction of transactions) {
      if (!validDate(transaction.date) || !isSpending(transaction, live, internal) || !include(transaction)) continue;
      if (transaction.date < scopeFrom) scopeFrom = transaction.date;
      if (transaction.date > scopeTo) scopeTo = transaction.date;
    }
  }
  const empty: SpendingDailyView = { days: [], from: '', to: '', paged: false,
    monthKey: today.slice(0, 7), previousMonthKey: null, nextMonthKey: null };
  if (!validDate(scopeFrom) || !validDate(scopeTo) || scopeFrom > scopeTo) return empty;
  const span = Math.round((Date.parse(`${scopeTo}T12:00:00Z`) - Date.parse(`${scopeFrom}T12:00:00Z`)) / 86400000) + 1;
  const paged = period.mode === 'year' || period.mode === 'all' || span > 42;
  const firstKey = scopeFrom.slice(0, 7); const lastKey = scopeTo.slice(0, 7);
  const requested = /^\d{4}-(0[1-9]|1[0-2])$/.test(options.monthKey ?? '') ? options.monthKey! : today.slice(0, 7);
  const key = requested < firstKey ? firstKey : requested > lastKey ? lastKey : requested;
  const from = paged && `${key}-01` > scopeFrom ? `${key}-01` : scopeFrom;
  const monthEnd = calendarMonthEnd(key);
  const to = paged && monthEnd < scopeTo ? monthEnd : scopeTo;
  const days: DailySpend[] = [];
  const byDate = new Map<string, DailySpend>();
  const day = new Date(`${from}T12:00:00Z`);
  // At most 42 dates for a short range, at most 31 for a month page.
  for (let i = 0; i < 42; i += 1) {
    const dateISO = day.toISOString().slice(0, 10);
    if (dateISO > to) break;
    const value = { dateISO, fils: 0, fixedFils: 0 };
    days.push(value); byDate.set(dateISO, value);
    day.setUTCDate(day.getUTCDate() + 1);
  }
  for (const transaction of transactions) {
    const target = byDate.get(transaction.date);
    if (!target || !isSpending(transaction, live, internal) || !include(transaction)) continue;
    for (const allocation of allocationsOf(transaction)) {
      if (isFixedCommitment(allocation.category)) target.fixedFils += allocation.amountFils;
      else target.fils += allocation.amountFils;
    }
  }
  return { days, from, to, paged, monthKey: key,
    previousMonthKey: paged && key > firstKey ? shiftMonthKey(key, -1) : null,
    nextMonthKey: paged && key < lastKey ? shiftMonthKey(key, 1) : null };
}
