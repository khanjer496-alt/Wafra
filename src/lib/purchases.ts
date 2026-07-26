/**
 * Billing abstraction for Wafra Pro.
 *
 * Google Play policy requires digital subscriptions to go through Google Play
 * Billing (react-native-iap). That SDK only functions when the app is
 * installed FROM the Play Store, so on side-load builds purchases are
 * structurally unavailable — the paywall explains this, and the founder
 * unlock (7 taps on the version row in Settings) grants Pro locally.
 *
 * At Play submission time: create these product IDs in Play Console →
 * Monetize → Subscriptions, add react-native-iap, and replace the stubs
 * below with real requestSubscription / getAvailablePurchases calls. The
 * UI (src/app/pro.tsx) needs no changes.
 */

export const PRO_SKUS = {
  monthly: 'wafra_pro_monthly',
  yearly: 'wafra_pro_yearly',
} as const;

export type ProPlan = keyof typeof PRO_SKUS;

/** Display prices until Play Billing supplies localized live ones. */
export const PRO_PRICES: Record<ProPlan, { fils: number; caption: string }> = {
  monthly: { fils: 999, caption: 'per month' },
  yearly: { fils: 7499, caption: 'per year · 2 months free' },
};

/** Every Pro feature is free for this long after first launch. When Play
 *  Billing is wired, also configure a 3-day free trial on the SKUs so store
 *  users see "3 days free" natively. */
export const TRIAL_DAYS = 3;

/** Whole days of trial remaining (0 when over). */
export function trialDaysLeft(
  state: { trialStartTs: number },
  nowMs: number = Date.now(),
): number {
  const start = state.trialStartTs || nowMs;
  const elapsedDays = (nowMs - start) / 86400000;
  return Math.max(0, Math.ceil(TRIAL_DAYS - elapsedDays));
}

/** Pro features unlocked: purchased/founder Pro, or still inside the trial. */
export function isProActive(
  state: { pro: boolean; trialStartTs: number },
  nowMs: number = Date.now(),
): boolean {
  return state.pro || trialDaysLeft(state, nowMs) > 0;
}

/** True once the Play Billing SDK is wired and the app came from the Play Store. */
export function isBillingAvailable(): boolean {
  return false;
}

/** Starts a purchase flow. Resolves true when the entitlement was granted. */
export async function purchasePro(_plan: ProPlan): Promise<boolean> {
  // Play flavor: requestSubscription(PRO_SKUS[plan]) → validate → true.
  return false;
}

/** Restores a previous purchase. Resolves true when Pro should be granted. */
export async function restorePro(): Promise<boolean> {
  // Play flavor: getAvailablePurchases() → check SKUs → true.
  return false;
}
