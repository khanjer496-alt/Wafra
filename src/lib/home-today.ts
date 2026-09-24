import type { Budget, CategoryId, Transaction } from '@/lib/types';

/**
 * Home's "today and this week" figures.
 *
 * Every amount uses the caller's spending predicate, which must be the shared
 * `isSpending` definition with the same live-account and internal-transfer sets
 * the dashboard uses. This module adds up and never decides what counts as
 * spending. It has no other app imports, so Home's test harness can load it
 * as-is.
 */
export interface HomeWeekDay {
  /** Local calendar date, YYYY-MM-DD. */
  dateISO: string;
  /** 0 = Sunday … 6 = Saturday, from the local calendar. */
  weekday: number;
  fils: number;
  today: boolean;
}

export interface HomeBudgetPace {
  limitFils: number;
  /** Spending in budgeted categories only. */
  spentFils: number;
  /**
   * What is still unspent, category by category. An over-budget category
   * contributes nothing; its overspend is never offset by another category's
   * headroom. Never negative.
   */
  leftFils: number;
  /** Budgeted categories already over their limit. */
  overCount: number;
  /** Total overspend across over-budget categories. */
  overFils: number;
  /** Days remaining in the period, including today. At least 1. */
  daysLeft: number;
  /** Even share of what is left, per remaining day. */
  perDayFils: number;
}

export interface HomeToday {
  todayFils: number;
  todayCount: number;
  /** Seven days ending today, oldest first. */
  week: HomeWeekDay[];
  weekFils: number;
  /** Null when no budgets apply to this period. */
  budget: HomeBudgetPace | null;
  /**
   * Everyday spending per covered day of the shown period, fixed commitments
   * left out (as every other habit figure in the app does). Null when the
   * period has no calendar window or has not started.
   */
  average: { fils: number; days: number } | null;
}

export interface HomeTodayInput {
  transactions: readonly Transaction[];
  budgets: readonly Budget[];
  now: Date;
  /** The shared spending definition, already bound to live and internal sets. */
  isSpending: (transaction: Transaction) => boolean;
  /** Whether a transaction belongs to the budget period. */
  inBudgetPeriod: (dateISO: string) => boolean;
  /** First and last day of the budget period (YYYY-MM-DD), or null when budgets do not apply. */
  budgetPeriodStartISO: string | null;
  budgetPeriodEndISO: string | null;
  /** Split-aware category amounts for one transaction. */
  allocations: (transaction: Transaction) => readonly { category: CategoryId; amountFils: number }[];
  /** Rent, business and other fixed commitments: left out of the daily average. */
  isFixedCommitment: (category: CategoryId) => boolean;
  /** Calendar window of the shown period, or null (year / all time). */
  averageWindow: { startISO: string; endISO: string } | null;
}

export function localISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Whether the ledger is fully newest-first (the store's order). Checked once
// per ledger array: an early stop is only safe when every later row is older.
const newestFirstCache = new WeakMap<readonly Transaction[], boolean>();
function isNewestFirst(transactions: readonly Transaction[]): boolean {
  const cached = newestFirstCache.get(transactions);
  if (cached !== undefined) return cached;
  let ordered = true;
  for (let i = 1; i < transactions.length; i += 1) {
    if (transactions[i]!.date > transactions[i - 1]!.date) { ordered = false; break; }
  }
  newestFirstCache.set(transactions, ordered);
  return ordered;
}

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
};

export function summarizeHomeToday(input: HomeTodayInput): HomeToday {
  const todayISO = localISODate(input.now);
  const week: HomeWeekDay[] = [];
  for (let back = 6; back >= 0; back -= 1) {
    const day = new Date(input.now.getFullYear(), input.now.getMonth(), input.now.getDate() - back, 12);
    week.push({ dateISO: localISODate(day), weekday: day.getDay(), fils: 0, today: back === 0 });
  }
  const weekIndex = new Map(week.map((day, index) => [day.dateISO, index] as const));
  const firstWeekISO = week[0]!.dateISO;

  const budgetLimits = new Map<CategoryId, number>();
  if (input.budgetPeriodEndISO) {
    for (const budget of input.budgets) {
      if (budget.limitFils > 0) budgetLimits.set(budget.category, budget.limitFils);
    }
  }
  const spentByCategory = new Map<CategoryId, number>();
  let todayFils = 0;
  let todayCount = 0;
  let averageFils = 0;
  const window = input.averageWindow;

  // Oldest date any figure needs. On a newest-first ledger (the store's order)
  // the walk stops there instead of visiting years of history on every paint.
  let floorISO = firstWeekISO;
  if (budgetLimits.size > 0 && input.budgetPeriodStartISO && input.budgetPeriodStartISO < floorISO) floorISO = input.budgetPeriodStartISO;
  if (window && window.startISO < floorISO) floorISO = window.startISO;
  const newestFirst = isNewestFirst(input.transactions);

  for (const transaction of input.transactions) {
    if (transaction.date < floorISO) {
      if (newestFirst) break;
      continue;
    }
    if (transaction.date > todayISO) continue;
    const inWeek = transaction.date >= firstWeekISO;
    const inBudget = budgetLimits.size > 0 && input.inBudgetPeriod(transaction.date);
    const inAverage = window !== null && transaction.date >= window.startISO && transaction.date <= window.endISO;
    if (!inWeek && !inBudget && !inAverage) continue;
    if (!input.isSpending(transaction)) continue;
    if (inWeek) {
      const index = weekIndex.get(transaction.date);
      if (index !== undefined) week[index]!.fils += transaction.amountFils;
      if (transaction.date === todayISO) {
        todayFils += transaction.amountFils;
        todayCount += 1;
      }
    }
    if (inBudget || inAverage) {
      for (const allocation of input.allocations(transaction)) {
        if (inBudget && budgetLimits.has(allocation.category)) {
          spentByCategory.set(allocation.category, (spentByCategory.get(allocation.category) ?? 0) + allocation.amountFils);
        }
        if (inAverage && !input.isFixedCommitment(allocation.category)) averageFils += allocation.amountFils;
      }
    }
  }

  let budget: HomeBudgetPace | null = null;
  if (budgetLimits.size > 0 && input.budgetPeriodEndISO) {
    let limitFils = 0;
    let spentFils = 0;
    let leftFils = 0;
    let overCount = 0;
    let overFils = 0;
    for (const [category, limit] of budgetLimits) {
      const spent = spentByCategory.get(category) ?? 0;
      limitFils += limit;
      spentFils += spent;
      if (spent > limit) { overCount += 1; overFils += spent - limit; } else leftFils += limit - spent;
    }
    const daysLeft = Math.max(1, dayNumber(input.budgetPeriodEndISO) - dayNumber(todayISO) + 1);
    budget = { limitFils, spentFils, leftFils, overCount, overFils, daysLeft, perDayFils: Math.floor(leftFils / daysLeft) };
  }

  let average: HomeToday['average'] = null;
  if (window) {
    const start = dayNumber(window.startISO);
    const last = Math.min(dayNumber(window.endISO), dayNumber(todayISO));
    const days = last - start + 1;
    if (days > 0) average = { fils: Math.floor(averageFils / days), days };
  }

  return {
    average,
    todayFils,
    todayCount,
    week,
    weekFils: week.reduce((sum, day) => sum + day.fils, 0),
    budget,
  };
}
