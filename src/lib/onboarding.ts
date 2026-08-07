import { t, type Lang, type StringKey } from '@/lib/i18n';
import type { Budget, CategoryId, Goal } from '@/lib/types';

export type OnboardingMarketId = 'AE' | 'SA';
export type OnboardingGoalId = 'emergency' | 'travel' | 'home';
export type OnboardingBudgetId = 'essentials' | 'balanced' | 'flexible';

export interface OnboardingAnswers {
  marketId: OnboardingMarketId;
  goalIds: OnboardingGoalId[];
  budgetId: OnboardingBudgetId;
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

export const DEFAULT_ONBOARDING_ANSWERS: OnboardingAnswers = {
  marketId: 'AE',
  goalIds: ['emergency'],
  budgetId: 'balanced',
};

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
  return {
    marketId,
    goalIds: goalIds.length > 0 ? goalIds : ['emergency'],
    budgetId,
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

export function allOnboardingGoalTitles(): string[] {
  return GOAL_PRESETS.flatMap((preset) => [t(preset.titleKey, 'en'), t(preset.titleKey, 'ar')]);
}
