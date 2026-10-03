import type { WidgetBill, WidgetSnapshot, WidgetSpending } from '@/lib/widget-snapshot';
import type { WidgetsCopy } from '@/lib/widgets-copy';

/**
 * What the two native widgets draw from a snapshot, as plain values, so the
 * Widgets screen previews the widget rather than a lookalike. Every rule here
 * mirrors targets/widget (WafraSnapshot.swift, WafraWidgetViews.swift) and
 * modules/wafra-widgets/android (WafraWidgets.kt, WidgetSnapshot.kt): the
 * "<CURRENCY> 1,234.56" format with Latin digits, the due words, the bundled logo or fallback
 * initial, three bills from today on, and the one line under Today's figure.
 * Pure; no React.
 */

export const WIDGET_DASH = '—';

/** "1,234.56" with exactly `exponent` decimals and Latin digits, or null. */
export function widgetNumber(minor: number, exponent: number): string | null {
  if (!Number.isSafeInteger(minor) || !Number.isInteger(exponent) || exponent < 0 || exponent > 4) return null;
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? digits.slice(digits.length - exponent) : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/** The currency code and number apart (the band figure sets the code smaller), or null when hidden. */
export function widgetAmountParts(minor: number | null, snapshot: WidgetSnapshot): { currency: string; number: string } | null {
  if (snapshot.hidden || minor === null) return null;
  const number = widgetNumber(minor, snapshot.exponent);
  return number === null ? null : { currency: snapshot.currency, number };
}

/** "<CURRENCY> 1,234.56", or "—" when the amount is hidden or unusable. */
export function widgetMoneyText(minor: number | null, snapshot: WidgetSnapshot): string {
  const parts = widgetAmountParts(minor, snapshot);
  return parts ? `${parts.currency} ${parts.number}` : WIDGET_DASH;
}

const LETTER = /\p{L}/u;
const ARABIC_ARTICLE = ['\u0627', '\u0644'];
/** Left-to-right mark: keeps Latin figures and masked numbers in order inside Arabic. */
const LRM = '\u200E';

/**
 * First letter of a title, upper-cased, for its tile; null when it has none (a
 * masked card). The Arabic article is skipped ("الكهرباء" -> "ك"), as in both
 * native widgets.
 */
export function widgetInitial(title: string): string | null {
  const chars = [...title];
  const start = chars.findIndex((char) => LETTER.test(char));
  if (start < 0) return null;
  const next = chars[start + 2];
  const article = chars[start] === ARABIC_ARTICLE[0] && chars[start + 1] === ARABIC_ARTICLE[1];
  const letter = article && next !== undefined && LETTER.test(next) ? next : chars[start]!;
  return letter.toUpperCase();
}

/**
 * A bill title as the widgets set it: one without a letter (a masked card such
 * as "•••• 1234") is held left to right inside Arabic so its digits and dots
 * do not swap sides.
 */
export function widgetBillTitle(bill: WidgetBill, snapshot: WidgetSnapshot): string {
  if (!bill.title) return WIDGET_DASH;
  return snapshot.language === 'ar' && widgetInitial(bill.title) === null ? `${LRM}${bill.title}${LRM}` : bill.title;
}

function dayNumber(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return Math.round(time / 86_400_000);
}

/**
 * The due pill: "Today", "Tomorrow", the weekday within the coming week
 * ("Monday"), then "in 9 days", so a weekday never means next week's. A date
 * that cannot be counted from today falls back to "Mon 5 Oct".
 */
export function widgetDueLabel(dueISO: string, todayISO: string, words: WidgetsCopy): string {
  const due = dayNumber(dueISO);
  if (due === null) return dueISO;
  const date = new Date(due * 86_400_000);
  const today = dayNumber(todayISO);
  const ahead = today === null ? Number.NaN : due - today;
  if (ahead === 0) return words.widgetToday;
  if (ahead === 1) return words.widgetTomorrow;
  if (ahead >= 2 && ahead <= 6) return words.weekdays[date.getUTCDay()]!;
  if (ahead >= 7) return words.widgetInDays(ahead);
  return `${words.weekdaysShort[date.getUTCDay()]} ${date.getUTCDate()} ${words.monthsShort[date.getUTCMonth()]}`;
}

/** The bills Coming up lists: due today or later, at most three, in the snapshot's order. */
export function widgetUpcomingBills(snapshot: WidgetSnapshot): WidgetBill[] {
  return snapshot.bills.filter((bill) => bill.dueISO >= snapshot.todayISO).slice(0, 3);
}

/**
 * A bill's amount as the widget prints it: "≈ " before an estimate, "—" when
 * hidden. Inside Arabic it is held left to right, so "≈" stays before the
 * currency code as both native widgets draw it.
 */
export function widgetBillAmount(bill: WidgetBill, snapshot: WidgetSnapshot): string {
  const amount = widgetMoneyText(bill.amountMinor, snapshot);
  if (amount === WIDGET_DASH) return amount;
  const text = bill.estimated ? `≈ ${amount}` : amount;
  return snapshot.language === 'ar' ? `${LRM}${text}${LRM}` : text;
}

/**
 * What the listed bills add up to, for Coming up's header: "≈" when any of
 * them is an estimate, null when an amount is hidden or unknown (a partial
 * sum would understate what is due).
 */
export function widgetBillsTotal(bills: readonly WidgetBill[], snapshot: WidgetSnapshot): string | null {
  if (snapshot.hidden || bills.length === 0) return null;
  let total = 0;
  for (const bill of bills) {
    if (bill.amountMinor === null || !Number.isSafeInteger(bill.amountMinor)) return null;
    total += bill.amountMinor;
    if (!Number.isSafeInteger(total)) return null;
  }
  const amount = widgetMoneyText(total, snapshot);
  if (amount === WIDGET_DASH) return null;
  const text = bills.some((bill) => bill.estimated) ? `≈ ${amount}` : amount;
  return snapshot.language === 'ar' ? `${LRM}${text}${LRM}` : text;
}

/**
 * How much of this month's budgets is used, for the bar under Today's
 * figure: (limits - left) / limits, clamped to 0..1, as the Lock Screen
 * gauge reads it. `over` when any budget is past its limit. Null without
 * budgets, when hidden, or for an older snapshot without the limits.
 */
export function widgetBudgetProgress(snapshot: WidgetSnapshot): { fraction: number; over: boolean } | null {
  const total = snapshot.budgetTotalMinor ?? null;
  const left = snapshot.leftInBudgetsMinor;
  if (snapshot.hidden || total === null || left === null || total <= 0) return null;
  const fraction = Math.min(1, Math.max(0, (total - left) / total));
  return { fraction, over: snapshot.budgetsOver > 0 };
}

/** "1,836": whole major units, half up, as Home's week columns print them. */
export function widgetWholeNumber(minor: number, exponent: number): string | null {
  if (!Number.isSafeInteger(minor) || !Number.isInteger(exponent) || exponent < 0 || exponent > 4) return null;
  const scale = 10 ** exponent;
  const whole = Math.floor((Math.abs(minor) + Math.floor(scale / 2)) / scale);
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${minor < 0 && whole > 0 ? '-' : ''}${grouped}`;
}

/**
 * "AED 6,656": an amount in whole units for a tight line (the week under
 * Today's bars, Spending's total), "—" when hidden or unknown. Isolated
 * left to right inside Arabic. Spoken labels keep the exact amount.
 */
export function widgetWholeMoney(minor: number | null, snapshot: WidgetSnapshot): string {
  if (snapshot.hidden || minor === null) return WIDGET_DASH;
  const number = widgetWholeNumber(minor, snapshot.exponent);
  if (number === null) return WIDGET_DASH;
  const text = `${snapshot.currency} ${number}`;
  return snapshot.language === 'ar' ? `${LRM}${text}${LRM}` : text;
}

/** Opacity of each share-bar segment on the Spending band: three named, the rest quiet. */
export const WIDGET_SEGMENT_ALPHAS = [0.92, 0.7, 0.5] as const;
export const WIDGET_SEGMENT_REST_ALPHA = 0.24;

export interface WidgetSpendingView {
  month: string;
  /** "AED 5,480", or null when hidden. */
  total: string | null;
  /** Share-bar segments in order; empty when hidden or nothing was spent. */
  segments: { share: number; alpha: number }[];
  /** The three largest categories: name and whole-unit amount (null when hidden). */
  top: { label: string; amount: string | null }[];
}

/**
 * What the Spending widget draws from the snapshot's month. Null for a
 * snapshot without it (written before the widget existed), so the widget
 * asks the person to open Wafra instead of drawing an empty month.
 */
export function widgetSpendingView(snapshot: WidgetSnapshot, words: WidgetsCopy): WidgetSpendingView | null {
  const spending: WidgetSpending | null | undefined = snapshot.spending;
  if (!spending || !/^\d{4}-(0[1-9]|1[0-2])$/.test(spending.monthKey)) return null;
  const month = words.months[Number(spending.monthKey.slice(5, 7)) - 1]!;
  const whole = (minor: number | null) => snapshot.hidden || minor === null ? null : widgetWholeNumber(minor, snapshot.exponent);
  const totalNumber = whole(spending.totalMinor);
  const amounts = [...spending.categories.map((row) => row.amountMinor), spending.otherMinor];
  const known = !snapshot.hidden && amounts.every((value) => value !== null && Number.isSafeInteger(value) && value >= 0);
  const sum = known ? amounts.reduce<number>((acc, value) => acc + (value ?? 0), 0) : 0;
  const named = spending.categories.length;
  const segments = known && sum > 0
    ? amounts.map((value, index) => ({ share: (value ?? 0) / sum,
      // "Other" is always quiet, however few categories precede it.
      alpha: index < named ? WIDGET_SEGMENT_ALPHAS[index] ?? WIDGET_SEGMENT_REST_ALPHA : WIDGET_SEGMENT_REST_ALPHA }))
      .filter((segment) => segment.share > 0)
    : [];
  return {
    month,
    total: totalNumber === null ? null : widgetWholeMoney(spending.totalMinor, snapshot),
    segments,
    top: spending.categories.slice(0, 3).map((row) => ({ label: row.label, amount: whole(row.amountMinor) })),
  };
}

/**
 * The one line under Today's figure: what is left in (or over) budgets when
 * budgets are set and amounts are shown, otherwise today's payment count.
 */
export function widgetTodayLine(snapshot: WidgetSnapshot, words: WidgetsCopy): string {
  const left = snapshot.leftInBudgetsMinor;
  if (left !== null && !snapshot.hidden) {
    const amount = widgetMoneyText(Math.abs(left), snapshot);
    return left < 0 ? words.widgetOverBudgets(amount) : words.widgetLeftInBudgets(amount);
  }
  return words.widgetPayments(snapshot.todayCount);
}

/**
 * Seven bar heights (0..1) oldest first, relative to the week's largest day.
 * Hidden or unknown days are a flat stub (0) so the bars never imply a figure
 * the snapshot does not carry.
 */
export function widgetWeekShares(snapshot: WidgetSnapshot): number[] {
  const values = snapshot.last7Minor.map((value) => (snapshot.hidden || value === null ? 0 : Math.max(0, value)));
  const peak = Math.max(0, ...values);
  return values.map((value) => (peak > 0 ? value / peak : 0));
}

/** Exact seven-day total only when all seven amounts are known and safely additive. */
export function widgetWeekTotal(snapshot: WidgetSnapshot): number | null {
  if (snapshot.hidden || snapshot.last7Minor.length !== 7) return null;
  let total = 0;
  for (const value of snapshot.last7Minor) {
    if (value === null || !Number.isSafeInteger(value)) return null;
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}
