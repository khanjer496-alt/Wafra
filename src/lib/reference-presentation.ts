/** Read-only presentation projections. Never changes a transaction or its classification. */
import type { MonthSummary } from '@/lib/insights';
import type { Budget, CategoryId } from '@/lib/types';

/**
 * A category's usual month: the average over the complete months the ledger
 * fully covers, or null when it covers none of them.
 *
 * A month before the ledger's first entry — or the month it began part-way
 * through — has no history, not zero spending. Dividing a single recorded
 * month by three suggested a third of what the user actually spends.
 */
export function usualMonthlyMinor(
  months: readonly { startISO: string; fils: number }[],
  ledgerStartISO: string | null,
): { averageFils: number; fullMonths: number } | null {
  if (!ledgerStartISO) return null;
  const covered = months.filter((month) => ledgerStartISO <= month.startISO);
  if (covered.length === 0) return null;
  const totalFils = covered.reduce((sum, month) => sum + month.fils, 0);
  return { averageFils: Math.round(totalFils / covered.length), fullMonths: covered.length };
}

/** The denominator is the whole selected period, never the filtered category list. */
export function spendingShare(spentFils: number, totalFils: number): number {
  if (!Number.isFinite(spentFils) || !Number.isFinite(totalFils) || spentFils <= 0 || totalFils <= 0) return 0;
  return Math.min(1, spentFils / totalFils);
}

// One formatter per UI locale. Building an Intl.NumberFormat is far costlier
// than using one, and this runs once per category row on every Spending render.
const shareFormats = new Map<string, Intl.NumberFormat>();
function shareFormat(locale: 'ar-AE' | 'en'): Intl.NumberFormat {
  let format = shareFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
    shareFormats.set(locale, format);
  }
  return format;
}

export function spendingShareLabel(share: number, language: string): string {
  const value = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  const format = shareFormat(language === 'ar' ? 'ar-AE' : 'en');
  return value > 0 && value < 0.001
    ? `${language === 'ar' ? 'أقل من ' : '<'}${format.format(0.001)}`
    : format.format(value);
}

export interface SpendingCategoryRow {
  category: CategoryId;
  spentFils: number;
  /** Null is not zero: no limit, or a report which is not monthly. */
  limitFils: number | null;
  ratio: number | null;
  remainingFils: number | null;
}

export function spendingCategoryRows(
  summary: MonthSummary, budgets: readonly Budget[], monthScoped: boolean,
): SpendingCategoryRow[] {
  const spending = new Map(summary.byCategory.map((row) => [row.category, row.totalFils]));
  const limits = new Map(budgets.filter((b) => b.limitFils > 0).map((b) => [b.category, b.limitFils]));
  const categories = new Set(spending.keys());
  if (monthScoped) for (const category of limits.keys()) categories.add(category);
  return [...categories].map((category) => {
    const spentFils = spending.get(category) ?? 0;
    const limitFils = monthScoped ? limits.get(category) ?? null : null;
    return {
      category, spentFils, limitFils,
      ratio: limitFils === null ? null : spentFils / limitFils,
      remainingFils: limitFils === null ? null : limitFils - spentFils,
    };
  }).sort((a, b) => b.spentFils - a.spentFils || a.category.localeCompare(b.category));
}

/** Aggregate ONLY the categories with limits. Rent without a limit isn't an overrun. */
export function limitedCategorySummary(rows: readonly SpendingCategoryRow[]) {
  let spentFils = 0; let limitFils = 0; let count = 0;
  for (const row of rows) if (row.limitFils !== null) {
    spentFils += row.spentFils; limitFils += row.limitFils; count++;
  }
  return { spentFils, limitFils, count, ratio: limitFils > 0 ? spentFils / limitFils : null };
}

export type AgendaSection = 'overdue' | 'expected-earlier' | 'soon' | 'later' | 'paid';
export type PaymentGroup = 'subscriptions' | 'utilities' | 'cards' | 'loans' | 'other';
export interface PaymentAgendaItem {
  id: string;
  title: string;
  category: CategoryId;
  kind: 'card' | 'bill' | 'recurring';
  /** Exact account when this obligation belongs to one (for example a card due). */
  accountId?: string;
  /** Subscription identity comes from detection, not an entertainment/software guess. */
  group?: PaymentGroup;
  dateISO: string;
  daysLeft: number;
  amountFils: number;
  estimated: boolean;
  paid: boolean;
  /** Exact account supplied by the source; omit rather than guess. */
  accountName?: string;
  /** A later time a repeating payment falls due inside a window: the id of the row it repeats. */
  repeatOf?: string;
}

export function paymentGroupFor(item: Pick<PaymentAgendaItem, 'kind' | 'category' | 'group'>): PaymentGroup {
  if (item.kind === 'card') return 'cards';
  if (item.group) return item.group;
  if (item.category === 'utilities' || item.category === 'telecom') return 'utilities';
  return item.category === 'loan' ? 'loans' : 'other';
}

const PAYMENT_AGENDA_SECTION_ORDER: AgendaSection[] = ['overdue', 'expected-earlier', 'soon', 'later', 'paid'];

const paymentAgendaSectionFor = (item: PaymentAgendaItem): AgendaSection =>
  item.paid ? 'paid'
    : item.daysLeft < 0 ? (item.estimated ? 'expected-earlier' : 'overdue')
      : item.daysLeft <= 7 ? 'soon' : 'later';

const comparePaymentAgendaItems = (key: AgendaSection) =>
  (a: PaymentAgendaItem, b: PaymentAgendaItem): number =>
    (key === 'paid' ? b.dateISO.localeCompare(a.dateISO) : a.dateISO.localeCompare(b.dateISO)) ||
      a.id.localeCompare(b.id);

/** Separate what a payment is before showing when it is due. */
export function groupPaymentKinds(items: readonly PaymentAgendaItem[], includePaid: boolean) {
  const order: PaymentGroup[] = ['subscriptions', 'utilities', 'cards', 'loans', 'other'];
  return order.map((key) => ({ key,
    sections: groupPaymentAgenda(items.filter((item) => paymentGroupFor(item) === key), includePaid),
  })).filter((group) => group.sections.length > 0 || group.key === 'subscriptions' || group.key === 'utilities');
}
export function groupPaymentAgenda(items: readonly PaymentAgendaItem[], includePaid: boolean) {
  const groups = new Map(PAYMENT_AGENDA_SECTION_ORDER.map((key) => [key, [] as PaymentAgendaItem[]]));
  for (const item of items) {
    if (item.paid && !includePaid) continue;
    const key = paymentAgendaSectionFor(item);
    groups.get(key)!.push(item);
  }
  return PAYMENT_AGENDA_SECTION_ORDER.map((key) => ({
    key,
    items: groups.get(key)!.sort(comparePaymentAgendaItems(key)),
  })).filter((group) => group.items.length > 0);
}

export interface PaymentAgendaWindowSection {
  key: AgendaSection;
  /** Only the highest-priority rows needed for the current rendered window. */
  items: PaymentAgendaItem[];
  /** Full section cardinality, including rows intentionally not materialised. */
  totalCount: number;
}

/**
 * Bounded agenda projection for the Bills ScrollView.
 *
 * `groupPaymentAgenda()` is the right primitive for exports/tests that need the
 * complete ordered list. It is the wrong primitive for a screen that renders
 * 24 rows: after recurrence detection completed, the old path allocated every
 * candidate into buckets and fully sorted all of them, then immediately threw
 * almost all of those sorted arrays away. That synchronous render happens on
 * the JS thread and can turn a cooperative background scan into a visible
 * freeze when its result lands.
 *
 * Keep only the best `limit` rows per section while scanning. The screen still
 * knows the exact hidden count and preserves the same ordering, while work and
 * retained arrays are bounded by the number of rows the user can actually see.
 */
export function groupPaymentAgendaWindow(
  items: readonly PaymentAgendaItem[],
  includePaid: boolean,
  limit: number,
): PaymentAgendaWindowSection[] {
  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const groups = new Map(PAYMENT_AGENDA_SECTION_ORDER.map((key) => [key, {
    items: [] as PaymentAgendaItem[],
    totalCount: 0,
  }]));

  for (const item of items) {
    if (item.paid && !includePaid) continue;
    const key = paymentAgendaSectionFor(item);
    const group = groups.get(key)!;
    group.totalCount += 1;
    if (boundedLimit === 0) continue;

    const compare = comparePaymentAgendaItems(key);
    const kept = group.items;
    // Once full, a row that sorts after the current worst cannot enter the
    // visible window. Avoid an insertion/splice for the usual long-tail case.
    if (kept.length === boundedLimit && compare(item, kept[kept.length - 1]) >= 0) continue;

    let low = 0;
    let high = kept.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (compare(item, kept[mid]) < 0) high = mid;
      else low = mid + 1;
    }
    kept.splice(low, 0, item);
    if (kept.length > boundedLimit) kept.pop();
  }

  return PAYMENT_AGENDA_SECTION_ORDER.map((key) => {
    const group = groups.get(key)!;
    return { key, items: group.items, totalCount: group.totalCount };
  }).filter((group) => group.totalCount > 0);
}
