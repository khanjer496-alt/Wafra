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
  return values.reduce((sum, v) => sum + Math.round(v / 100) * 100, 0);
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
  const arabic = getLanguage() === 'ar';
  const names = arabic
    ? (short ? MONTHS_SHORT_AR : MONTHS_AR)
    : (short ? MONTHS_SHORT : MONTHS);
  const name = names[(m ?? 1) - 1];
  return `${name} ${y}`;
}

export function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
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
  const d = new Date(`${iso}T12:00:00`);
  const t2 = new Date(`${todayISO}T12:00:00`);
  if (Math.round((t2.getTime() - d.getTime()) / 86400000) === 1) return t('yesterday');
  const arabic = getLanguage() === 'ar';
  const days = arabic ? DAYS_AR : DAYS;
  const months = arabic ? MONTHS_SHORT_AR : MONTHS_SHORT;
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
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
