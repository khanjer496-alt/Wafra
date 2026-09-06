/** Read-only presentation projections. Never changes a transaction or its classification. */
import type { MonthSummary } from '@/lib/insights';
import type { Budget, CategoryId } from '@/lib/types';

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
export interface PaymentAgendaItem {
  id: string;
  title: string;
  category: CategoryId;
  kind: 'card' | 'bill' | 'recurring';
  dateISO: string;
  daysLeft: number;
  amountFils: number;
  estimated: boolean;
  paid: boolean;
  /** Exact account supplied by the source; omit rather than guess. */
  accountName?: string;
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
