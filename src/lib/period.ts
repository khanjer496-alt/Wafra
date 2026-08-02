import { getMonthStartDay, monthEndISO, monthKey, monthLabel, monthStartISO, shortDate, toISODate } from '@/lib/format';
import { t } from '@/lib/i18n';
import type { Transaction } from '@/lib/types';

/**
 * The app-wide reporting scope. 'month' is the default and richest mode;
 * budgets and pace projections only exist there.
 */
export type Period =
  | { mode: 'month'; key: string }
  | { mode: 'year'; year: number }
  | { mode: 'range'; from: string; to: string }
  | { mode: 'all' };

/** Accepts a bare month key (legacy call sites/tests) or a Period. */
export type PeriodLike = string | Period;

export function toPeriod(p: PeriodLike): Period {
  return typeof p === 'string' ? { mode: 'month', key: p } : p;
}

export function currentMonthPeriod(today = new Date()): Period {
  return { mode: 'month', key: monthKey(today) };
}

export function isCurrentMonth(p: PeriodLike, today = new Date()): boolean {
  const period = toPeriod(p);
  return period.mode === 'month' && period.key === monthKey(today);
}

export function inPeriod(dateISO: string, p: PeriodLike): boolean {
  const period = toPeriod(p);
  switch (period.mode) {
    case 'month':
      return monthKey(dateISO) === period.key;
    case 'year':
      return Number(dateISO.slice(0, 4)) === period.year;
    case 'range':
      return dateISO >= period.from && dateISO <= period.to;
    case 'all':
      return true;
  }
}

export function periodLabel(p: PeriodLike): string {
  const period = toPeriod(p);
  switch (period.mode) {
    case 'month':
      return monthLabel(period.key, true);
    case 'year':
      return String(period.year);
    case 'range':
      return `${shortDate(period.from)} – ${shortDate(period.to)}`;
    case 'all':
      return t('allTimeTitle');
  }
}

/**
 * The dates a period actually covers, when they are not the obvious ones.
 *
 * A "money month" runs from the user's salary day, so with a start day of 25
 * the period called "Jun 2026" is 25 June to 24 July. Every row inside it is
 * dated JULY, under a heading that says June — which reads as a bug even
 * though it is exactly what was asked for. A user looked at that screen and
 * concluded their July payments had gone missing.
 *
 * Returns '' for calendar months and for the modes that already state their
 * own dates, so nothing is repeated back at the user.
 */
export function periodRange(p: PeriodLike): string {
  const period = toPeriod(p);
  if (period.mode !== 'month' || getMonthStartDay() === 1) return '';
  return `${shortDate(monthStartISO(period.key))} – ${shortDate(monthEndISO(period.key))}`;
}

/**
 * The comparison window for "vs previous" insights: previous month, previous
 * year, or the equal-length range immediately before. 'all' has no previous.
 */
export function previousPeriod(p: PeriodLike): Period | null {
  const period = toPeriod(p);
  switch (period.mode) {
    case 'month': {
      const [y, m] = period.key.split('-').map(Number);
      const d = new Date(y, m - 2, 1);
      return { mode: 'month', key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` };
    }
    case 'year':
      return { mode: 'year', year: period.year - 1 };
    case 'range': {
      const from = new Date(`${period.from}T12:00:00`);
      const to = new Date(`${period.to}T12:00:00`);
      const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
      const prevTo = new Date(from);
      prevTo.setDate(prevTo.getDate() - 1);
      const prevFrom = new Date(prevTo);
      prevFrom.setDate(prevFrom.getDate() - days + 1);
      return { mode: 'range', from: toISODate(prevFrom), to: toISODate(prevTo) };
    }
    case 'all':
      return null;
  }
}

function dayOfYear(d: Date): number {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000);
}

/**
 * How long the period is in total, elapsed or not — the denominator for "how
 * far through it are we".
 *
 * Not `daysInMonth`: a money month that starts on the 25th spans two calendar
 * months, so its length is the gap between its own start and end, which is
 * what `monthStartISO`/`monthEndISO` already encode.
 */
export function daysInPeriod(p: PeriodLike, today: Date): number {
  const period = toPeriod(p);
  switch (period.mode) {
    case 'month':
      return (
        Math.round(
          (new Date(`${monthEndISO(period.key)}T12:00:00`).getTime() -
            new Date(`${monthStartISO(period.key)}T12:00:00`).getTime()) /
            86400000,
        ) + 1
      );
    case 'year': {
      const y = period.year;
      return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
    }
    case 'range':
      return (
        Math.round(
          (new Date(`${period.to}T12:00:00`).getTime() -
            new Date(`${period.from}T12:00:00`).getTime()) /
            86400000,
        ) + 1
      );
    default:
      // 'all' has no fixed length; its elapsed span is its length.
      return Math.max(1, elapsedDays(period, today, []));
  }
}

/**
 * Days the period has actually covered so far — the denominator for daily
 * averages. Future days never count; 'all' measures from the earliest entry.
 */
export function elapsedDays(p: PeriodLike, today: Date, transactions: Transaction[]): number {
  const period = toPeriod(p);
  const todayISO = toISODate(today);
  switch (period.mode) {
    case 'month': {
      const nowKey = monthKey(today);
      if (period.key > nowKey) return 0;
      const endISO = period.key === nowKey ? todayISO : monthEndISO(period.key);
      return (
        Math.round(
          (new Date(`${endISO}T12:00:00`).getTime() -
            new Date(`${monthStartISO(period.key)}T12:00:00`).getTime()) /
            86400000,
        ) + 1
      );
    }
    case 'year': {
      if (period.year === today.getFullYear()) return dayOfYear(today);
      if (period.year > today.getFullYear()) return 0;
      return 365;
    }
    case 'range': {
      const endISO = period.to < todayISO ? period.to : todayISO;
      if (endISO < period.from) return 0;
      return (
        Math.round(
          (new Date(`${endISO}T12:00:00`).getTime() - new Date(`${period.from}T12:00:00`).getTime()) /
            86400000,
        ) + 1
      );
    }
    case 'all': {
      let earliest = todayISO;
      for (const t of transactions) {
        if (t.date < earliest) earliest = t.date;
      }
      return (
        Math.round(
          (new Date(`${todayISO}T12:00:00`).getTime() -
            new Date(`${earliest}T12:00:00`).getTime()) /
            86400000,
        ) + 1
      );
    }
  }
}

/** Last covered ISO date of the period (for point-in-time balances). */
export function periodEndISO(p: PeriodLike, today: Date): string {
  const period = toPeriod(p);
  const todayISO = toISODate(today);
  switch (period.mode) {
    case 'month': {
      if (period.key >= monthKey(today)) return todayISO;
      return monthEndISO(period.key);
    }
    case 'year':
      if (period.year >= today.getFullYear()) return todayISO;
      return `${period.year}-12-31`;
    case 'range':
      return period.to < todayISO ? period.to : todayISO;
    case 'all':
      return todayISO;
  }
}
