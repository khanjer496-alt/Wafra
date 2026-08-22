import { t, type Lang, type StringKey } from '@/lib/i18n';
import type {
  Budget,
  CategoryId,
  Goal,
  OnboardingPlanPreferences,
  Transaction,
} from '@/lib/types';

export type OnboardingMarketId = 'AE' | 'SA';
export type OnboardingGoalId = OnboardingPlanPreferences['goalIds'][number];
export type OnboardingBudgetId = OnboardingPlanPreferences['budgetId'];

export interface OnboardingAnswers {
  marketId: OnboardingMarketId;
  goalIds: OnboardingGoalId[];
  budgetId: OnboardingBudgetId;
  monthStartDay: number;
}

export interface GoalPreset {
  id: OnboardingGoalId;
  titleKey: StringKey;
  detailKey: StringKey;
  icon: 'target' | 'plane' | 'home';
  targetByMarket: Record<OnboardingMarketId, number>;
}

export interface BudgetPreset {
  id: OnboardingBudgetId;
  titleKey: StringKey;
  detailKey: StringKey;
  limitsByMarket: Record<OnboardingMarketId, Partial<Record<CategoryId, number>>>;
}

export const GOAL_PRESETS: readonly GoalPreset[] = [
  {
    id: 'emergency',
    titleKey: 'onboardGoalEmergency',
    detailKey: 'onboardGoalEmergencyDetail',
    icon: 'target',
    targetByMarket: { AE: 2_000_000, SA: 2_500_000 },
  },
  {
    id: 'travel',
    titleKey: 'onboardGoalTravel',
    detailKey: 'onboardGoalTravelDetail',
    icon: 'plane',
    targetByMarket: { AE: 1_200_000, SA: 1_500_000 },
  },
  {
    id: 'home',
    titleKey: 'onboardGoalHome',
    detailKey: 'onboardGoalHomeDetail',
    icon: 'home',
    targetByMarket: { AE: 10_000_000, SA: 15_000_000 },
  },
] as const;

const AE_ESSENTIALS: Partial<Record<CategoryId, number>> = {
  groceries: 140_000,
  dining: 60_000,
  transport: 60_000,
  shopping: 50_000,
  entertainment: 40_000,
};
const AE_BALANCED: Partial<Record<CategoryId, number>> = {
  groceries: 180_000,
  dining: 120_000,
  transport: 80_000,
  shopping: 100_000,
  entertainment: 60_000,
};
const AE_FLEXIBLE: Partial<Record<CategoryId, number>> = {
  groceries: 250_000,
  dining: 180_000,
  transport: 120_000,
  shopping: 180_000,
  entertainment: 100_000,
};

const SA_ESSENTIALS: Partial<Record<CategoryId, number>> = {
  groceries: 180_000,
  dining: 75_000,
  transport: 75_000,
  shopping: 60_000,
  entertainment: 50_000,
};
const SA_BALANCED: Partial<Record<CategoryId, number>> = {
  groceries: 220_000,
  dining: 140_000,
  transport: 100_000,
  shopping: 120_000,
  entertainment: 75_000,
};
const SA_FLEXIBLE: Partial<Record<CategoryId, number>> = {
  groceries: 300_000,
  dining: 220_000,
  transport: 150_000,
  shopping: 220_000,
  entertainment: 120_000,
};

export const BUDGET_PRESETS: readonly BudgetPreset[] = [
  {
    id: 'essentials',
    titleKey: 'onboardBudgetEssentials',
    detailKey: 'onboardBudgetEssentialsDetail',
    limitsByMarket: { AE: AE_ESSENTIALS, SA: SA_ESSENTIALS },
  },
  {
    id: 'balanced',
    titleKey: 'onboardBudgetBalanced',
    detailKey: 'onboardBudgetBalancedDetail',
    limitsByMarket: { AE: AE_BALANCED, SA: SA_BALANCED },
  },
  {
    id: 'flexible',
    titleKey: 'onboardBudgetFlexible',
    detailKey: 'onboardBudgetFlexibleDetail',
    limitsByMarket: { AE: AE_FLEXIBLE, SA: SA_FLEXIBLE },
  },
] as const;

const INCOME_RELATIVE_LIMITS: Readonly<
  Record<OnboardingBudgetId, Readonly<Partial<Record<CategoryId, number>>>>
> = {
  essentials: {
    groceries: 0.18,
    dining: 0.05,
    transport: 0.08,
    shopping: 0.04,
    entertainment: 0.02,
  },
  balanced: {
    groceries: 0.18,
    dining: 0.1,
    transport: 0.08,
    shopping: 0.08,
    entertainment: 0.05,
  },
  flexible: {
    groceries: 0.2,
    dining: 0.15,
    transport: 0.1,
    shopping: 0.12,
    entertainment: 0.08,
  },
};

const GOAL_INCOME_MULTIPLIERS: Readonly<Record<OnboardingGoalId, number>> = {
  emergency: 3,
  travel: 1,
  home: 8,
};

export const MONEY_MONTH_DAYS = [1, 25, 27, 28] as const;

export const DEFAULT_ONBOARDING_ANSWERS: OnboardingAnswers = {
  marketId: 'AE',
  goalIds: ['emergency'],
  budgetId: 'balanced',
  monthStartDay: 1,
};

export const DEFAULT_ONBOARDING_PLAN: OnboardingPlanPreferences = {
  goalIds: ['emergency'],
  budgetId: 'balanced',
};

/**
 * A currency-relative starter plan needs credible monthly income, not merely
 * the largest credit in a lifetime ledger. Salary rows are explicit parser or
 * user classifications, so their median is robust to a bonus. Business income
 * is included only after it appears in two distinct months, using the median
 * monthly total. Refunds, gifts, windfalls and own-account movements never set
 * a recurring budget by accident.
 */
export function onboardingIncomeBasis(
  transactions: readonly Pick<
    Transaction,
    'type' | 'amountFils' | 'isTransfer' | 'category' | 'date'
  >[],
): number {
  const salaries: number[] = [];
  const businessByMonth = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type !== 'income' || transaction.isTransfer) continue;
    if (!Number.isSafeInteger(transaction.amountFils) || transaction.amountFils <= 0) continue;
    if (transaction.category === 'salary') {
      salaries.push(transaction.amountFils);
      continue;
    }
    const month = /^\d{4}-\d{2}/.exec(transaction.date)?.[0];
    if (transaction.category !== 'business' || !month) continue;
    const next = (businessByMonth.get(month) ?? 0) + transaction.amountFils;
    if (Number.isSafeInteger(next)) businessByMonth.set(month, next);
  }
  const median = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[middle]
      : sorted[middle - 1] + Math.round((sorted[middle] - sorted[middle - 1]) / 2);
  };
  const salaryBasis = median(salaries);
  const businessBasis = businessByMonth.size >= 2
    ? median([...businessByMonth.values()])
    : 0;
  const basis = salaryBasis + businessBasis;
  return Number.isSafeInteger(basis) ? basis : 0;
}

export function normalizeOnboardingAnswers(
  answers: Partial<OnboardingAnswers>,
): OnboardingAnswers {
  const marketId: OnboardingMarketId = answers.marketId === 'SA' ? 'SA' : 'AE';
  const goalIds = Array.from(new Set(answers.goalIds ?? []))
    .filter((id): id is OnboardingGoalId => GOAL_PRESETS.some((preset) => preset.id === id))
    .slice(0, 2);
  const budgetId = BUDGET_PRESETS.some((preset) => preset.id === answers.budgetId)
    ? answers.budgetId!
    : 'balanced';
  const requestedDay = Math.round(answers.monthStartDay ?? 1);
  const monthStartDay = MONEY_MONTH_DAYS.includes(requestedDay as (typeof MONEY_MONTH_DAYS)[number])
    ? requestedDay
    : 1;

  return {
    marketId,
    goalIds: goalIds.length > 0 ? goalIds : ['emergency'],
    budgetId,
    monthStartDay,
  };
}

export function buildOnboardingPlan(
  source: Partial<OnboardingAnswers>,
  language: Lang,
): {
  answers: OnboardingAnswers;
  budgets: Budget[];
  goals: Omit<Goal, 'id'>[];
} {
  const answers = normalizeOnboardingAnswers(source);
  const budgetPreset = BUDGET_PRESETS.find((preset) => preset.id === answers.budgetId)!;
  const budgets = Object.entries(budgetPreset.limitsByMarket[answers.marketId]).map(
    ([category, limitFils]) => ({
      category: category as CategoryId,
      limitFils: limitFils!,
    }),
  );
  const goals = answers.goalIds.map((id) => {
    const preset = GOAL_PRESETS.find((candidate) => candidate.id === id)!;
    return {
      title: t(preset.titleKey, language),
      emoji: preset.icon,
      targetFils: preset.targetByMarket[answers.marketId],
      savedFils: 0,
    };
  });

  return { answers, budgets, goals };
}

/**
 * Resolve currency-free first-run choices only after real ledger activity has
 * established both the currency and a usable income basis.
 *
 * Percentages, rather than AED/SAR literals, are what make the same promise
 * honest in every supported ISO ledger currency. A currency alone is not
 * enough: inventing a salary would be just as misleading as relabelling an AED
 * preset as USD, so the plan remains pending until income exists.
 */
export function buildDeferredOnboardingPlan(
  preferences: OnboardingPlanPreferences,
  ledgerCurrency: string | null | undefined,
  monthlyIncomeFils: number | null | undefined,
  monthStartDay: number,
  language: Lang,
): {
  answers: OnboardingPlanPreferences & { currency: string; monthStartDay: number };
  budgets: Budget[];
  goals: Omit<Goal, 'id'>[];
} | null {
  const currency = ledgerCurrency?.trim().toUpperCase() ?? '';
  const largestMultiplier = Math.max(...Object.values(GOAL_INCOME_MULTIPLIERS));
  if (
    !currency ||
    !Number.isSafeInteger(monthlyIncomeFils) ||
    monthlyIncomeFils! <= 0 ||
    monthlyIncomeFils! > Math.floor(Number.MAX_SAFE_INTEGER / largestMultiplier)
  ) {
    return null;
  }
  const normalized = normalizeOnboardingAnswers({
    goalIds: preferences.goalIds,
    budgetId: preferences.budgetId,
    monthStartDay,
  });
  const ratios = INCOME_RELATIVE_LIMITS[normalized.budgetId];
  const budgets = Object.entries(ratios)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
    .map(([category, ratio]) => ({
      category: category as CategoryId,
      limitFils: Math.max(1, Math.round(monthlyIncomeFils! * ratio)),
    }));
  const goals = normalized.goalIds.map((id) => {
    const preset = GOAL_PRESETS.find((candidate) => candidate.id === id)!;
    return {
      title: t(preset.titleKey, language),
      emoji: preset.icon,
      targetFils: monthlyIncomeFils! * GOAL_INCOME_MULTIPLIERS[id],
      savedFils: 0,
    };
  });
  return {
    answers: {
      currency,
      goalIds: normalized.goalIds,
      budgetId: normalized.budgetId,
      monthStartDay: normalized.monthStartDay,
    },
    budgets,
    goals,
  };
}

/**
 * Add starter rows without ever replacing work the user did while a deferred
 * plan was waiting for currency evidence.
 */
export function mergeDeferredOnboardingPlan(
  existingBudgets: readonly Budget[],
  existingGoals: readonly Goal[],
  starterBudgets: readonly Budget[],
  starterGoals: readonly Goal[],
): { budgets: Budget[]; goals: Goal[] } {
  const existingCategories = new Set(existingBudgets.map((budget) => budget.category));
  const existingGoalTitles = new Set(
    existingGoals.map((goal) => goal.title.trim().toLocaleLowerCase()),
  );
  return {
    budgets: [
      ...existingBudgets,
      ...starterBudgets.filter((budget) => !existingCategories.has(budget.category)),
    ],
    goals: [
      ...existingGoals,
      ...starterGoals.filter(
        (goal) => !existingGoalTitles.has(goal.title.trim().toLocaleLowerCase()),
      ),
    ],
  };
}

export function allOnboardingGoalTitles(): string[] {
  return GOAL_PRESETS.flatMap((preset) => [t(preset.titleKey, 'en'), t(preset.titleKey, 'ar')]);
}
