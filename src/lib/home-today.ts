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
  /** Negative when over. */
  leftFils: number;
  /** Days remaining in the period, including today. At least 1. */
  daysLeft: number;
  /** Even share of what is left, per remaining day. 0 when over. */
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
  /** Period spending per covered day; null when the period has no calendar window. */
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
  /** Last day of the budget period (YYYY-MM-DD), or null when budgets do not apply. */
  budgetPeriodEndISO: string | null;
  /** Split-aware category amounts for one transaction. */
  allocations: (transaction: Transaction) => readonly { category: CategoryId; amountFils: number }[];
  /** The shown period's spending total, from the same projection as the period figures. */
  periodExpenseFils: number;
  /** Calendar window of the shown period, or null (year / all time). */
  averageWindow: { startISO: string; endISO: string } | null;
}

export function localISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  let budgetSpent = 0;
  let todayFils = 0;
  let todayCount = 0;

  for (const transaction of input.transactions) {
    if (transaction.date > todayISO) continue;
    const inWeek = transaction.date >= firstWeekISO;
    const inBudget = budgetLimits.size > 0 && input.inBudgetPeriod(transaction.date);
    if (!inWeek && !inBudget) continue;
    if (!input.isSpending(transaction)) continue;
    if (inWeek) {
      const index = weekIndex.get(transaction.date);
      if (index !== undefined) week[index]!.fils += transaction.amountFils;
      if (transaction.date === todayISO) {
        todayFils += transaction.amountFils;
        todayCount += 1;
      }
    }
    if (inBudget) {
      for (const allocation of input.allocations(transaction)) {
        if (budgetLimits.has(allocation.category)) budgetSpent += allocation.amountFils;
      }
    }
  }

  let budget: HomeBudgetPace | null = null;
  if (budgetLimits.size > 0 && input.budgetPeriodEndISO) {
    let limitFils = 0;
    for (const limit of budgetLimits.values()) limitFils += limit;
    const daysLeft = Math.max(1, dayNumber(input.budgetPeriodEndISO) - dayNumber(todayISO) + 1);
    const leftFils = limitFils - budgetSpent;
    budget = {
      limitFils,
      spentFils: budgetSpent,
      leftFils,
      daysLeft,
      perDayFils: leftFils > 0 ? Math.floor(leftFils / daysLeft) : 0,
    };
  }

  let average: HomeToday['average'] = null;
  if (input.averageWindow) {
    const start = dayNumber(input.averageWindow.startISO);
    const last = Math.min(dayNumber(input.averageWindow.endISO), dayNumber(todayISO));
    const days = last - start + 1;
    if (days > 0) average = { fils: Math.floor(input.periodExpenseFils / days), days };
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
