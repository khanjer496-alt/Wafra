/**
 * Bills' "Next 30 days": every payment that falls inside the window, counted
 * once per time it falls there.
 *
 * The agenda holds one row per obligation, dated at its next due date. That
 * is right for All, and wrong for a window total: a weekly charge lands four
 * or five times in 30 days but was counted once, and a monthly bill already
 * paid this money month vanished even when its next due date was inside the
 * window. Pure: amounts stay in the ledger's minor units, and nothing here
 * decides whether an obligation is real — only how often it repeats.
 */
import { daysBetweenISO } from '@/lib/format';
import type { PaymentAgendaItem } from '@/lib/reference-presentation';

/** How an agenda row repeats; `null` or no entry = it does not (a card statement). */
export interface AgendaRecurrence {
  cadence: 'weekly' | 'monthly' | 'yearly';
  /**
   * Day of month the payment is anchored to, when a short month clamps it
   * (a bill on the 31st falls on 28 Feb and returns to 31 Mar). Defaults to
   * the row's own day.
   */
  anchorDay?: number;
  /** True for a later occurrence already recorded as paid (a bill's paid month). */
  isPaid?: (dateISO: string) => boolean;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `iso` moved by whole calendar months, clamped to the target month's length. */
export function addCalendarMonths(iso: string, months: number, anchorDay?: number): string {
  const total = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1 + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const day = Math.min(anchorDay ?? Number(iso.slice(8, 10)), daysInMonth(year, month));
  return `${year}-${pad(month)}-${pad(day)}`;
}

function addDaysISO(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The dates a repeating payment falls due inside `[today, today + windowDays]`.
 *
 * `firstISO` is the next due date the agenda already shows. It counts when it
 * is inside the window — including when it is already late, which the window
 * has always shown — unless `firstPaid`. Every later date counts only from
 * today onward: a weekly charge that is two weeks late is one late payment,
 * not three.
 */
export function recurrenceDatesInWindow(
  firstISO: string,
  recurrence: AgendaRecurrence,
  todayISO: string,
  windowDays: number,
  firstPaid = false,
): string[] {
  const endISO = addDaysISO(todayISO, windowDays);
  const dates: string[] = [];
  if (!firstPaid && firstISO <= endISO) dates.push(firstISO);
  const anchorDay = recurrence.anchorDay ?? Number(firstISO.slice(8, 10));
  // A yearly payment can repeat at most once in any window this app uses; a
  // weekly one at most windowDays / 7 + 1 times. The cap only guards a bad date.
  for (let step = 1; step <= 60; step += 1) {
    const next = recurrence.cadence === 'weekly'
      ? addDaysISO(firstISO, step * 7)
      : addCalendarMonths(firstISO, recurrence.cadence === 'monthly' ? step : step * 12, anchorDay);
    if (next > endISO) break;
    if (next < todayISO || recurrence.isPaid?.(next)) continue;
    dates.push(next);
  }
  return dates;
}

/**
 * The window's rows: each unpaid obligation due inside it, and each later time
 * a repeating one falls due inside it. A repeat keeps its source row's amount
 * and kind, gets its own date and id, and names its source in `repeatOf` so a
 * tap opens the same obligation.
 */
export function upcomingWindowItems(
  items: readonly PaymentAgendaItem[],
  recurrenceOf: (item: PaymentAgendaItem) => AgendaRecurrence | null | undefined,
  todayISO: string,
  windowDays: number,
): PaymentAgendaItem[] {
  const out: PaymentAgendaItem[] = [];
  for (const item of items) {
    const recurrence = recurrenceOf(item);
    if (!recurrence) {
      if (!item.paid && item.daysLeft <= windowDays) out.push(item);
      continue;
    }
    for (const dateISO of recurrenceDatesInWindow(item.dateISO, recurrence, todayISO, windowDays, item.paid)) {
      if (dateISO === item.dateISO && !item.paid) {
        out.push(item);
        continue;
      }
      out.push({
        ...item,
        id: `${item.id}@${dateISO}`,
        repeatOf: item.id,
        dateISO,
        daysLeft: daysBetweenISO(todayISO, dateISO),
        paid: false,
      });
    }
  }
  return out;
}
