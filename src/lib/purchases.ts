/**
 * Billing for Wafra Pro, through RevenueCat.
 *
 * RevenueCat rather than Play Billing directly, because iOS is coming: the
 * thing it actually buys is one entitlement that both stores feed, so a
 * subscriber on Android stays a subscriber when they pick up an iPhone. With
 * a single store that would not be worth a dependency.
 *
 * The three moving parts, and which of them is the truth:
 *
 *   RevenueCat  the ONLY source of entitlement. Asked at launch, so a lapsed,
 *               refunded or cancelled subscription actually locks again, and
 *               a reinstall restores without the user hunting for a button.
 *   state.pro   a cache of that answer, so the app is not blank while the
 *               network is slow — and, on side-load builds, the founder
 *               unlock, which is why it is still writable by hand.
 *   the trial   local and independent of both. Three days from first launch,
 *               granted before any purchase exists to check.
 *
 * Nothing financial ever reaches RevenueCat: it sees a purchase and an
 * anonymous id, never a transaction, a balance or an SMS. Worth being precise
 * about, because onboarding promises there is no server.
 *
 * The store-facing half lives in billing.ts, which imports the SDK and so
 * cannot be loaded by the test harness. What is here is the arithmetic — the
 * trial clock, the prices, the saving — and it is tested.
 *
 * SETUP (none of which can be done from here — see docs/billing.md):
 *   1. RevenueCat project → add the Play app → paste the Play service account.
 *   2. Create the two subscriptions in Play Console with the SKUs below.
 *   3. RevenueCat → Entitlements → create `pro`, attach both products.
 *   4. Put the PUBLIC SDK key in app.json → expo.extra.revenueCatAndroidKey.
 * Until step 4, isBillingAvailable() is false and the app behaves exactly as
 * it does today.
 */
/** The entitlement id configured in RevenueCat. One, for everything Pro. */
export const ENTITLEMENT_ID = 'pro';

export const PRO_SKUS = {
  monthly: 'wafra_pro_monthly',
  yearly: 'wafra_pro_yearly',
} as const;

export type ProPlan = keyof typeof PRO_SKUS;

/** Display prices until Play Billing supplies localized live ones. */
export const PRO_PRICES: Record<ProPlan, { fils: number }> = {
  monthly: { fils: 999 },
  yearly: { fils: 7499 },
};

/**
 * How many months of the monthly price the yearly plan saves.
 *
 * Derived rather than written down. The paywall claimed "2 months free"
 * beside prices that actually save four and a half — a number in the sales
 * copy and a number in the price table, with nothing checking they agreed.
 * Understating the discount only cost conversions, but the next edit could
 * as easily have overstated it, and that is a claim in a store listing.
 */
export function yearlySavingMonths(prices = PRO_PRICES): number {
  const saved = prices.monthly.fils * 12 - prices.yearly.fils;
  return Math.floor(saved / prices.monthly.fils);
}

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
