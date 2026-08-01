import { t } from '@/lib/i18n';
import { getActiveMarket } from '@/lib/markets';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Formats fils as "1,234.56". Whole amounts drop the decimals: "1,234".
 *
 * Dropping the fils ROUNDS to the nearest dirham. It used to truncate, which
 * understated every headline figure by up to a dirham and — worse — let a
 * total disagree with the rows it is made of: Wallet showed a net worth of
 * 96,467 above two accounts that read 93,891 and 2,575. Rounding here, and
 * summing already-rounded parts in `netWorthFils`, makes the two agree by
 * construction rather than by luck.
 */
export function formatAmount(fils: number, opts?: { decimals?: boolean }): string {
  const abs = Math.abs(Math.round(fils));
  const cents = abs % 100;
  const showDecimals = opts?.decimals ?? cents !== 0;
  const whole = showDecimals ? Math.floor(abs / 100) : Math.round(abs / 100);
  // "-0" is not a figure. Sub-dirham amounts shown to the dirham are zero.
  const sign = fils < 0 && (showDecimals || whole > 0) ? '-' : '';
  const base = `${sign}${groupThousands(whole)}`;
  return showDecimals ? `${base}.${String(cents).padStart(2, '0')}` : base;
}

/**
 * `fils` snapped to the whole dirham it will be DISPLAYED as.
 *
 * Sum these, never the raw fils, when a figure sits above the rows it totals.
 */
export function toWholeDirhamFils(fils: number): number {
  return Math.round(fils / 100) * 100;
}

/** "AED 1,234.56" — currency symbol follows the active market. */
export function formatAED(fils: number, opts?: { decimals?: boolean }): string {
  return `${getActiveMarket().currency.display} ${formatAmount(fils, opts)}`;
}

/** Compact form for chart labels: "1.2k", "18k". */
export function formatCompactAED(fils: number): string {
  const aed = Math.abs(fils) / 100;
  if (aed >= 1_000_000) {
    const m = aed / 1_000_000;
    return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10}M`;
  }
  if (aed >= 1000) {
    const k = aed / 1000;
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return String(Math.round(aed));
}

export function parseAmountToFils(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Salary-day month start. With startDay = 25, the "July" money month runs
 * 25 Jul – 24 Aug, matching when salaries actually land. 1 = calendar months.
 * Set once from persisted settings; every month grouping in the app follows.
 */
let MONTH_START_DAY = 1;

export function setMonthStartDay(day: number): void {
  const d = Math.round(day);
  MONTH_START_DAY = Number.isFinite(d) ? Math.min(28, Math.max(1, d)) : 1;
}

export function getMonthStartDay(): number {
  return MONTH_START_DAY;
}

/** "2026-07" key for a date or ISO string, honoring the month start day. */
export function monthKey(date: string | Date): string {
  const iso = typeof date === 'string' ? date : toISODate(date);
  if (MONTH_START_DAY > 1 && Number(iso.slice(8, 10)) < MONTH_START_DAY) {
    return shiftMonthKey(iso.slice(0, 7), -1);
  }
  return iso.slice(0, 7);
}

/** First covered ISO date of a report month. */
export function monthStartISO(key: string): string {
  return `${key}-${String(MONTH_START_DAY).padStart(2, '0')}`;
}

/** Last covered ISO date of a report month (day before the next start). */
export function monthEndISO(key: string): string {
  if (MONTH_START_DAY === 1) {
    return `${key}-${String(daysInMonth(key)).padStart(2, '0')}`;
  }
  const d = new Date(`${monthStartISO(shiftMonthKey(key, 1))}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return toISODate(d);
}

export function monthLabel(key: string, short = false): string {
  const [y, m] = key.split('-').map(Number);
  const name = (short ? MONTHS_SHORT : MONTHS)[(m ?? 1) - 1];
  return `${name} ${y}`;
}

export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Days a report month covers. With MONTH_START_DAY = 1 that is the calendar
 * length; with a salary-day start it still is, because the window
 * [day D of month M, day D-1 of month M+1] holds exactly as many days as M.
 */
export function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * Whole days from `fromISO` to `toISO`; negative once `toISO` has passed.
 * Both ends are anchored at noon so a clock change can never round to ±1 day.
 */
export function daysBetweenISO(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T12:00:00`).getTime();
  const to = new Date(`${toISO}T12:00:00`).getTime();
  return Math.round((to - from) / 86_400_000);
}

/** `iso` moved by `days`, staying a valid date across month and year ends. */
export function shiftISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** "17 Jul" from an ISO date. */
export function shortDate(iso: string): string {
  const d = Number(iso.slice(8, 10));
  const m = Number(iso.slice(5, 7));
  return `${d} ${MONTHS_SHORT[m - 1] ?? ''}`;
}

/** "Today", "Yesterday", or "Friday, 18 Jul". */
export function friendlyDate(iso: string, todayISO: string): string {
  if (iso === todayISO) return t('today');
  if (daysBetweenISO(iso, todayISO) === 1) return t('yesterday');
  const d = new Date(`${iso}T12:00:00`);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/**
 * Account name without its trailing card digits, e.g.
 * "FAB Credit Card •3644" becomes "FAB Credit Card".
 *
 * Rows show the last 4 in their own meta line and the badge already carries
 * the bank, so leaving the digits in the title only cost width and pushed the
 * name into an ellipsis.
 */
export function cardTitle(name: string): string {
  return name.replace(/\s*[•·*]+\s*\d{3,4}\s*$/, '').trim() || name;
}

export function greetingForHour(hour: number): string {
  if (hour < 12) return t('goodMorning');
  if (hour < 17) return t('goodAfternoon');
  return t('goodEvening');
}
