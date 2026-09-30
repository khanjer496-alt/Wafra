import { shiftISO, toISODate } from '@/lib/format';
import { widgetLogoIdFor, type WidgetLogoId } from '@/lib/widget-logo';
import type { HomeToday } from '@/lib/home-today';

/**
 * The few figures a Home Screen widget, Lock Screen widget or Android Glance
 * widget may show, and nothing else. The ledger stays in encrypted app storage;
 * widgets read only this summary from the shared app-group container.
 *
 * Privacy (owner decision 2026-09-25): amounts are shown on the Home Screen
 * while the phone is unlocked and redacted on the Lock Screen and in StandBy.
 * `amountsSensitive` tells the native widget to apply its platform's redaction
 * (SwiftUI `.privacySensitive()`); `hidden` removes amounts entirely when the
 * user turns widget amounts off.
 * Bill titles are the ones Bills already shows (a card may appear as its masked
 * last four digits); no transaction text and no full account number is written.
 */
export const WIDGET_SNAPSHOT_VERSION = 1;
export const WIDGET_UPCOMING_DAYS = 30;

export interface WidgetBill {
  /** Optional, bundled artwork id. Older snapshots safely fall back to an initial. */
  logoId?: WidgetLogoId | null;
  title: string;
  /** Minor units of the ledger currency; null when amounts are hidden. */
  amountMinor: number | null;
  estimated: boolean;
  /** YYYY-MM-DD */
  dueISO: string;
}

export interface WidgetSnapshot {
  version: typeof WIDGET_SNAPSHOT_VERSION;
  /** Epoch ms; widgets show "as of" and treat anything older than a day as stale. */
  generatedAt: number;
  /** App language, so widgets match the app even when the phone is set differently. */
  language: 'en' | 'ar';
  /** Local date of the last entry in last7Minor (today when generated), YYYY-MM-DD. */
  todayISO: string;
  currency: string;
  /** Minor-unit exponent of the currency (2 for AED/USD, 3 for KWD, 0 for JPY). */
  exponent: number;
  amountsSensitive: boolean;
  /** When true, every amount below is null and widgets show counts and dates only. */
  hidden: boolean;
  todayMinor: number | null;
  todayCount: number;
  /** Seven days ending today, oldest first. */
  last7Minor: (number | null)[];
  leftInBudgetsMinor: number | null;
  perDayMinor: number | null;
  budgetsOver: number;
  bills: WidgetBill[];
}

export interface WidgetSnapshotInput {
  today: HomeToday;
  currency: string;
  exponent: number;
  now: Date;
  upcoming: readonly { title: string; displayLabel?: string; amountFils: number; dateISO: string; estimated?: boolean; overdue?: boolean; paid?: boolean }[];
  /** The user turned widget amounts off entirely. */
  hideAmounts: boolean;
  language: 'en' | 'ar';
}

export function buildWidgetSnapshot(input: WidgetSnapshotInput): WidgetSnapshot {
  const hidden = input.hideAmounts;
  const money = (value: number): number | null => (hidden ? null : value);
  const budget = input.today.budget;
  const todayISO = toISODate(input.now);
  const endISO = shiftISO(todayISO, WIDGET_UPCOMING_DAYS);
  return {
    version: WIDGET_SNAPSHOT_VERSION,
    generatedAt: input.now.getTime(),
    language: input.language,
    todayISO,
    currency: input.currency,
    exponent: input.exponent,
    amountsSensitive: true,
    hidden,
    todayMinor: money(input.today.todayFils),
    todayCount: input.today.todayCount,
    last7Minor: input.today.week.map((day) => money(day.fils)),
    leftInBudgetsMinor: budget ? money(budget.leftFils) : null,
    perDayMinor: budget ? money(budget.perDayFils) : null,
    budgetsOver: budget?.overCount ?? 0,
    bills: input.upcoming
      .filter((item) => !item.overdue && !item.paid && item.dateISO >= todayISO && item.dateISO <= endISO)
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
      .slice(0, 3)
      .map((item) => ({
        title: item.displayLabel ?? item.title,
        logoId: widgetLogoIdFor(item.title),
        amountMinor: money(item.amountFils),
        estimated: item.estimated ?? false,
        dueISO: item.dateISO,
      })),
  };
}
