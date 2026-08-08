import { getActiveMarket } from '@/lib/markets';
import { getLanguage, t } from '@/lib/i18n';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];
const MONTHS_SHORT_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];
const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Formats fils as "1,234.56". Whole amounts drop the decimals: "1,234".
 *
 * When the decimals are hidden the whole part is ROUNDED, not truncated.
 * Truncating showed a AED 76.99 subscription as "AED 76", and — worse — made
 * lists stop adding up: four rows each losing up to a dirham sat under a total
 * that had rounded once, so Bills printed AED 1,025/mo above rows totalling
 * 1,022. Rounding each row leaves at most half a dirham of drift per row
 * instead of a whole one, and in the common case none at all.
 */
export function formatAmount(fils: number, opts?: { decimals?: boolean }): string {
  const abs = Math.abs(Math.round(fils));
  const cents = abs % 100;
  const showDecimals = opts?.decimals ?? cents !== 0;
  const whole = showDecimals ? Math.floor(abs / 100) : Math.round(abs / 100);
  // Take the sign from what is actually printed, not from the input. A net of
  // −20 fils rounds to zero at whole-dirham precision, and "AED -0" under
  // "Overspent so far this month" is not a number anyone recognizes — the
  // hero sweeps through it every time the month crosses breakeven.
  const sign = fils < 0 && (whole > 0 || (showDecimals && cents > 0)) ? '-' : '';
  const base = `${sign}${groupThousands(whole)}`;
  return showDecimals ? `${base}.${String(cents).padStart(2, '0')}` : base;
}

/**
 * Total of a set of amounts as a reader would add them up on screen.
 *
 * A total printed above a list has to equal that list. Summing the raw fils
 * and rounding once does not: each row is rounded on its own, so the total
 * lands up to half a dirham per row away from what the rows say. Rounding each
 * row first — the same rounding `formatAmount` will apply to it — makes the
 * column add up, which is the only property a heading like "AED 1,025/mo"
 * above four rows is actually claiming.
 *
 * For arithmetic, not display: keep using the raw fils.
 */
export function totalAsShown(values: number[]): number {
  return values.reduce((sum, v) => sum + toWholeDirhamFils(v), 0);
}

/**
 * `fils` snapped to the whole dirham it will be DISPLAYED as.
 *
 * Sum these, never the raw fils, when a figure sits above the rows it totals.
 * This is the primitive; `totalAsShown` is the reducer over it. Both exist on
 * purpose: balances.ts needs to snap one account at a time as it walks the
 * list (some accounts contribute nothing), and insights' composition needs the
 * reducer. Collapsing either into the other put the two callers back on
 * different arithmetic, which is the defect they were written to close.
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

/**
 * "2026-07" key for a date or ISO string, honoring the month start day.
 *
 * This is the hottest function in the app — every list filter, every period
 * check, every grouping calls it once per row — so it does no work a string
 * cannot do. It used to hand the salary-day case to `shiftMonthKey`, which
 * built a `Date` to subtract one month; with a start day of 25 that is the
 * path three quarters of a ledger takes, and a full pass over 10,000 rows
 * went from 0.3ms to 4.1ms purely on allocation. A month key is two integers
 * in a fixed-width string, and subtracting one from it is subtraction.
 */
export function monthKey(date: string | Date): string {
  const iso = typeof date === 'string' ? date : toISODate(date);
  if (MONTH_START_DAY > 1 && Number(iso.slice(8, 10)) < MONTH_START_DAY) {
    const month = Number(iso.slice(5, 7));
    if (month > 1) return `${iso.slice(0, 4)}-${month <= 10 ? '0' : ''}${month - 1}`;
    return `${Number(iso.slice(0, 4)) - 1}-12`;
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
  const arabic = getLanguage() === 'ar';
  const names = arabic
    ? (short ? MONTHS_SHORT_AR : MONTHS_AR)
    : (short ? MONTHS_SHORT : MONTHS);
  const name = names[(m ?? 1) - 1];
  return `${name} ${y}`;
}

/**
 * `key` moved by `delta` whole months, wrapping the year.
 *
 * Integer arithmetic rather than a `Date`, for the same reason `monthKey`
 * stopped calling this: the answer is a division with remainder, and building
 * a calendar object to get it costs an allocation. `Math.floor` on the total
 * month count is what carries a negative delta back across January.
 */
export function shiftMonthKey(key: string, delta: number): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return `${year}-${month < 10 ? '0' : ''}${month}`;
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
 * Days since 1970-01-01 for an exact `YYYY-MM-DD` string, or NaN for anything
 * else. Hinnant's days-from-civil: the calendar is arithmetic, and a `Date`
 * only has to be built to hide that.
 *
 * The shape check is not decoration. Callers that hand this a timestamp, an
 * empty string or a half-typed date get NaN here and fall back to the `Date`
 * path, which produces exactly what it always did for those inputs. Only
 * well-formed dates take the fast route, and for those the two agree by
 * construction.
 */
function epochDay(iso: string): number {
  if (iso.length !== 10 || iso.charCodeAt(4) !== 45 || iso.charCodeAt(7) !== 45) return NaN;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return NaN;
  const shifted = y - (m <= 2 ? 1 : 0);
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

/**
 * Whole days from `fromISO` to `toISO`; negative once `toISO` has passed.
 * Both ends are anchored at noon so a clock change can never round to ±1 day.
 *
 * Lives here rather than in each module that needs it: date arithmetic
 * re-implemented per module is how the app ended up with two different answers
 * for "when is this due".
 *
 * The noon anchoring is why the arithmetic path below is a straight
 * substitution rather than an approximation: two local noons are 23, 24 or 25
 * hours apart across a clock change, all of which round to the same whole day
 * the civil calendar gives. Subscription detection calls this once per charge
 * over the whole ledger, so the two `Date` objects it used to build were 5ms
 * of allocation per pass at 10,000 rows.
 */
export function daysBetweenISO(fromISO: string, toISO: string): number {
  const fromDay = epochDay(fromISO);
  const toDay = epochDay(toISO);
  if (!Number.isNaN(fromDay) && !Number.isNaN(toDay)) return toDay - fromDay;
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
  const months = getLanguage() === 'ar' ? MONTHS_SHORT_AR : MONTHS_SHORT;
  return `${d} ${months[m - 1] ?? ''}`;
}

/** "Today", "Yesterday", or "Friday, 18 Jul". */
export function friendlyDate(iso: string, todayISO: string): string {
  if (iso === todayISO) return t('today');
  if (daysBetweenISO(iso, todayISO) === 1) return t('yesterday');
  const d = new Date(`${iso}T12:00:00`);
  const arabic = getLanguage() === 'ar';
  const days = arabic ? DAYS_AR : DAYS;
  const months = arabic ? MONTHS_SHORT_AR : MONTHS_SHORT;
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

/**
 * Weekday names by index, Sunday-first — the order `dayOfWeekSpend` buckets
 * into and the order the UAE week runs in.
 *
 * These live here rather than in the screen that draws the weekday chart
 * because the translated arrays are already here, feeding `friendlyDate`. A
 * screen-local `const WEEKDAYS = ['Sun', ...]` is invisible to the Arabic
 * gate — it is an array of one-word strings, so nothing flags it — and the
 * chart under an otherwise fully-Arabic screen stays in English forever.
 */
export function weekdayName(index: number): string {
  const days = getLanguage() === 'ar' ? DAYS_AR : DAYS;
  return days[index] ?? '';
}

/** The same name, abbreviated for an axis label. Arabic is not abbreviated. */
export function weekdayShort(index: number): string {
  if (getLanguage() === 'ar') return DAYS_AR[index] ?? '';
  return (DAYS[index] ?? '').slice(0, 3);
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


/**
 * When a transaction happened, to the minute, or null if unknown.
 *
 * Rows imported before `ts` existed still know: the SMS fingerprint is
 * `s{timestamp}-{amount}`, and that timestamp has been in every SMS row since
 * the first version. Reading it back is free and needs no migration.
 */
export function transactionTime(tx: { ts?: number; smsKey?: string }): Date | null {
  if (tx.ts) return new Date(tx.ts);
  const m = tx.smsKey?.match(/^s(\d{10,})-/);
  if (!m) return null;
  const d = new Date(Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "18 Jul 2026, 14:32" — the full stamp, for a detail view. */
export function fullDateTime(tx: { date: string; ts?: number; smsKey?: string }): string {
  const day = new Date(`${tx.date}T12:00:00`);
  const stamp = day.toLocaleDateString(getLanguage() === 'ar' ? 'ar-AE' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const at = transactionTime(tx);
  if (!at) return stamp;
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `${stamp}, ${hh}:${mm}`;
}

/** "14:32", or empty when the row carries no clock. */
export function clockTime(tx: { ts?: number; smsKey?: string }): string {
  const at = transactionTime(tx);
  if (!at) return '';
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}
