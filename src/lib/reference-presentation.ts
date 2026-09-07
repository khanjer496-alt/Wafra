/** Read-only presentation projections. Never changes a transaction or its classification. */
import type { MonthSummary } from '@/lib/insights';
import type { Budget, CategoryId } from '@/lib/types';

/** The denominator is the whole selected period, never the filtered category list. */
export function spendingShare(spentFils: number, totalFils: number): number {
  if (!Number.isFinite(spentFils) || !Number.isFinite(totalFils) || spentFils <= 0 || totalFils <= 0) return 0;
  return Math.min(1, spentFils / totalFils);
}

export function spendingShareLabel(share: number, language: string): string {
  const value = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  const format = new Intl.NumberFormat(language === 'ar' ? 'ar-AE' : 'en', {
    style: 'percent', maximumFractionDigits: 1,
  });
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
  /** Subscription identity comes from detection, not an entertainment/software guess. */
  group?: PaymentGroup;
  dateISO: string;
  daysLeft: number;
  amountFils: number;
  estimated: boolean;
  paid: boolean;
  /** Exact account supplied by the source; omit rather than guess. */
  accountName?: string;
}

export function paymentGroupFor(item: Pick<PaymentAgendaItem, 'kind' | 'category' | 'group'>): PaymentGroup {
  if (item.kind === 'card') return 'cards';
  if (item.group) return item.group;
  if (item.category === 'utilities' || item.category === 'telecom') return 'utilities';
  return item.category === 'loan' ? 'loans' : 'other';
}

/** Separate what a payment is before showing when it is due. */
export function groupPaymentKinds(items: readonly PaymentAgendaItem[], includePaid: boolean) {
  const order: PaymentGroup[] = ['subscriptions', 'utilities', 'cards', 'loans', 'other'];
  return order.map((key) => ({ key,
    sections: groupPaymentAgenda(items.filter((item) => paymentGroupFor(item) === key), includePaid),
  })).filter((group) => group.sections.length > 0 || group.key === 'subscriptions' || group.key === 'utilities');
}
export function groupPaymentAgenda(items: readonly PaymentAgendaItem[], includePaid: boolean) {
  const order: AgendaSection[] = ['overdue', 'expected-earlier', 'soon', 'later', 'paid'];
  const groups = new Map(order.map((key) => [key, [] as PaymentAgendaItem[]]));
  for (const item of items) {
    if (item.paid && !includePaid) continue;
    const key: AgendaSection = item.paid ? 'paid'
      : item.daysLeft < 0 ? (item.estimated ? 'expected-earlier' : 'overdue')
        : item.daysLeft <= 7 ? 'soon' : 'later';
    groups.get(key)!.push(item);
  }
  return order.map((key) => ({ key, items: groups.get(key)!.sort((a, b) =>
    (key === 'paid' ? b.dateISO.localeCompare(a.dateISO) : a.dateISO.localeCompare(b.dateISO)) || a.id.localeCompare(b.id))
  })).filter((group) => group.items.length > 0);
}
