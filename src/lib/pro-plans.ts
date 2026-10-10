/**
 * The Pro plans as the paywalls present them: the order, each plan's name and
 * period, and its renewal sentence. Shared by the Pro screen, the Pro sheet
 * and the onboarding paywall so the three cannot drift. Prices are never
 * here: they are the storefront's own strings (purchases.ts).
 */
import { t } from '@/lib/i18n';
import type { ProPlan } from '@/lib/purchases';

/** Yearly first: it is the plan the screens recommend and preselect. */
export const PLAN_ORDER: ProPlan[] = ['yearly', 'weekly'];

/** The plan's name on a plan row and in the purchase button. */
export function planLabel(plan: ProPlan): string {
  return plan === 'yearly' ? t('yearly') : t('weekly');
}

/** "per year" / "per week", beside the store's price string. */
export function planPeriod(plan: ProPlan): string {
  return plan === 'yearly' ? t('perYear') : t('perWeek');
}

/** The renewal sentence under the plans, filled with the store's price string. */
export function planChargeTimingKey(plan: ProPlan): 'proChargeTimingYear' | 'proChargeTimingWeek' {
  return plan === 'yearly' ? 'proChargeTimingYear' : 'proChargeTimingWeek';
}
