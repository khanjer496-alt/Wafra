/**
 * Billing contracts for Wafra Pro, surfaced through Superwall.
 *
 * Superwall rather than separate client checkout adapters: one entitlement
 * model and one product/purchase API cover both stores. The purchase SURFACE is
 * Wafra's own `/pro` screen, which shows the prices the storefront returned and
 * buys the selected product. Wafra has no account-linking system, so anonymous
 * purchases do not automatically transfer between an Android install and a
 * separate iPhone install.
 *
 * The three moving parts, and which of them is the truth:
 *
 *   Superwall   the storefront entitlement source. Asked at launch, so a lapsed,
 *               refunded or cancelled subscription actually locks again.
 *               A reinstall creates a new anonymous customer and still needs
 *               the user-visible Restore button to attach the store receipt.
 *   state.pro   a cache of that answer, so the app is not blank while the
 *               network is slow.
 *   the trial   local and independent of both. Three days from first launch,
 *               granted before any purchase exists to check.
 *
 * Wafra never sends ledger rows, balances, transaction amounts, SMS bodies,
 * card/account identifiers or the user's first name to Superwall. Optional
 * targeting is limited to product/onboarding metadata.
 *
 * The runtime Superwall bridge lives in superwall-billing-provider.native.tsx.
 * What is here is the pure product/trial contract and it remains testable.
 *
 * SETUP (none of which can be done from here — see docs/billing.md):
 *   1. Create the two subscriptions in App Store Connect and Play with the SKUs below.
 *   2. Superwall → Apps/Products → connect both storefront apps/products.
 *   3. Superwall → Entitlements → attach both products to `pro`.
 *   4. Put the public Superwall keys in the EAS production environment.
 * Until step 4, `/pro` explains that purchases are unavailable in this build.
 */
import { Platform } from 'react-native';

/** The entitlement id configured in Superwall. One, for everything Pro. */
export const ENTITLEMENT_ID = 'pro';

/**
 * Weekly and yearly, and no monthly. The paywall pairs a low-commitment weekly
 * plan with a yearly plan shown as the better deal; a third, middle plan only
 * slows the choice. A subscriber already on the retired monthly plan keeps
 * Pro (RETIRED_PRO_SKUS below).
 */
export const PRO_SKUS = {
  weekly: 'wafra_pro_weekly',
  yearly: 'wafra_pro_yearly',
} as const;

/**
 * Products no longer sold that still carry Pro for whoever holds one. Never
 * offered (PRO_SKUS is the catalogue), but a renewing holder must keep the
 * exact store deadline and renewal grace for iPhone capture (billing.ts)
 * rather than falling back to the short lease meant for missing detail.
 */
export const RETIRED_PRO_SKUS = ['wafra_pro_monthly'] as const;

/** Every product that can carry the `pro` entitlement: sold now, or retired. */
export const PRO_ENTITLEMENT_PRODUCT_IDS: readonly string[] = [
  ...Object.values(PRO_SKUS),
  ...RETIRED_PRO_SKUS,
];

export type ProPlan = keyof typeof PRO_SKUS;

/**
 * One plan as the device's own storefront describes it. `priceString` is the
 * localized price the store returned; Wafra never composes a price itself.
 *
 * `price` and `currencyCode` are the store's raw figures, kept only so two
 * plans from the same storefront can be compared (`yearlySavingPercent`).
 * `weeklyPriceString` is the store SDK's own formatting of the per-week cost
 * of a longer plan. Each is null when the store did not supply it, and the
 * screen then simply leaves out what depended on it.
 */
export interface ProPlanOffer {
  plan: ProPlan;
  productId: string;
  priceString: string;
  price?: number | null;
  currencyCode?: string | null;
  weeklyPriceString?: string | null;
}

/** The subset of a store product Wafra reads. */
export interface StoreProductLike {
  productIdentifier: string;
  localizedPrice: string;
  price?: number | null;
  currencyCode?: string | null;
  weeklyPrice?: string | null;
}

/**
 * Match what the store returned to Wafra's two plans.
 *
 * Play returns a subscription as `<product id>` on some accounts and
 * `<product id>:<base plan id>` on others, and either is the same plan. The
 * identifier is compared on its first segment for that reason, and a product
 * without a localized price is dropped rather than shown priceless — a plan
 * button with no price is exactly the invented-price failure this avoids.
 */
export function proOffersFromProducts(products: readonly StoreProductLike[]): ProPlanOffer[] {
  const offers: ProPlanOffer[] = [];
  for (const [plan, sku] of Object.entries(PRO_SKUS) as [ProPlan, string][]) {
    const match = products.find((product) => {
      const identifier = product.productIdentifier?.trim() ?? '';
      return identifier === sku || identifier.split(':')[0] === sku;
    });
    const priceString = match?.localizedPrice?.trim() ?? '';
    if (!match || !priceString) continue;
    const price = typeof match.price === 'number' && Number.isFinite(match.price) && match.price > 0
      ? match.price : null;
    const currencyCode = match.currencyCode?.trim() || null;
    // The SDK writes "n/a" for a product with no subscription period; only a
    // string carrying an amount is a per-week price.
    const weeklyText = match.weeklyPrice?.trim() ?? '';
    const weeklyPriceString = plan !== 'weekly' && /\d/.test(weeklyText) ? weeklyText : null;
    offers.push({ plan, productId: match.productIdentifier, priceString, price, currencyCode, weeklyPriceString });
  }
  return offers;
}

/** Weeks a yearly plan is compared against: 52, the count stores use for "per week". */
const WEEKS_PER_YEAR = 52;

/**
 * Whole percent the yearly plan saves against paying weekly for a year, from
 * the storefront's own two prices, or null when the claim cannot be made.
 *
 * Rounded DOWN, so the badge can understate the saving but never overstate it:
 * it is a price claim on the screen that sells the product. Null when either
 * plan is missing or has no usable price, when the two prices come from
 * different currencies, or when yearly does not actually save anything.
 */
export function yearlySavingPercent(offers: readonly ProPlanOffer[]): number | null {
  const weekly = offers.find((offer) => offer.plan === 'weekly');
  const yearly = offers.find((offer) => offer.plan === 'yearly');
  const weeklyPrice = weekly?.price;
  const yearlyPrice = yearly?.price;
  if (typeof weeklyPrice !== 'number' || typeof yearlyPrice !== 'number') return null;
  if (!(weeklyPrice > 0) || !(yearlyPrice > 0)) return null;
  if (weekly?.currencyCode && yearly?.currencyCode && weekly.currencyCode !== yearly.currencyCode) return null;
  // The epsilon only absorbs binary-float noise (80.99999… for an exact 81);
  // it is far below any real hundredth of a percent.
  const percent = Math.floor((1 - yearlyPrice / (weeklyPrice * WEEKS_PER_YEAR)) * 100 + 1e-9);
  return percent >= 1 && percent < 100 ? percent : null;
}

/**
 * USD reference prices used only by web previews and web screenshots. Native
 * builds with no usable storefront say the price is unavailable.
 *
 * Never prefix these with the ledger currency. The currency a user tracks and
 * the currency Apple or Google bills are independent — a EUR ledger can be
 * attached to a Canadian App Store account. Native paywalls replace these
 * references with `priceString` from the active storefront.
 */
export const PRO_PRICES: Record<ProPlan, { fils: number }> = {
  weekly: { fils: 499 },
  yearly: { fils: 4999 },
};

export const PRO_REFERENCE_PRICE_STRINGS: Record<ProPlan, string> = {
  weekly: 'US$4.99',
  yearly: 'US$49.99',
};

/** Every Pro feature is free for this long after first launch. Do not also add
 *  a storefront introductory trial: it would begin after this local trial and
 *  silently turn the advertised three days into as many as six. */
export const TRIAL_DAYS = 3;
export const TRIAL_DURATION_MS = TRIAL_DAYS * 86_400_000;

export interface LocalCaptureEntitlementLease {
  expiresAtMs: number | null;
  lifetime: boolean;
}

/**
 * The source-free local grant mirrored into the iOS App Intent store.
 * Purchased `pro` is deliberately absent: only a fresh verified store snapshot
 * may create or extend the separate storefront lease.
 */
export function localCaptureEntitlementLease(
  state: { founderPro?: boolean; trialStartTs: number },
): LocalCaptureEntitlementLease | null {
  if (state.founderPro === true) return { expiresAtMs: null, lifetime: true };
  if (!Number.isFinite(state.trialStartTs) || state.trialStartTs <= 0) return null;
  const expiresAtMs = state.trialStartTs + TRIAL_DURATION_MS;
  return Number.isFinite(expiresAtMs) && expiresAtMs >= 0
    ? { expiresAtMs, lifetime: false }
    : null;
}

/**
 * Whole days of trial remaining, always within 0…TRIAL_DAYS.
 *
 * Both ends are clamped, and the upper one is not decoration. `trialStartTs`
 * can sit in the FUTURE — a device whose clock was fast at first launch and
 * later corrected, a restored backup, a user who moved the date deliberately.
 * Unclamped, `TRIAL_DAYS - elapsed` then grows without bound and the paywall
 * offered "your first 3 days — 8 days left", a sentence that argues with
 * itself on the screen that sells the product.
 *
 * What this does NOT claim to be is tamper-proof. A local clock cannot be one:
 * moving the date backwards has always stretched a trial derived from it, and
 * no arithmetic here can tell that apart from a genuinely slow clock without
 * server state. The bound keeps the figure honest and keeps the grant finite;
 * the real entitlement gate is the store-backed Superwall status, refreshed at launch.
 */
export function trialDaysLeft(
  state: { trialStartTs: number },
  nowMs: number = Date.now(),
): number {
  const start = state.trialStartTs || nowMs;
  const elapsedDays = Math.max(0, (nowMs - start) / 86400000);
  return Math.min(TRIAL_DAYS, Math.max(0, Math.ceil(TRIAL_DAYS - elapsedDays)));
}

/** Pro features unlocked: purchased Pro, or still inside the trial. */
export function isProActive(
  state: { pro: boolean; founderPro?: boolean; trialStartTs: number },
  nowMs: number = Date.now(),
): boolean {
  return state.pro || state.founderPro === true || trialDaysLeft(state, nowMs) > 0;
}

/* ─────────────────── What is free and what is paid ─────────────────── */

/**
 * WHERE THE PAYWALL SITS, AND WHY IT MOVED.
 *
 * Wafra's promise is that you never type a transaction. Android delivers it by
 * reading the inbox; iPhone delivers it through a personal local automation. Both
 * are Wafra doing the work, both are Pro. But iOS ALSO has to offer pasting a
 * message, because Apple allows nothing else without that setup — and pasting
 * was gated too, on a screen titled "Read my inbox" that on iPhone cannot read
 * an inbox. The effect was a wall where an iPhone user paid for the privilege
 * of doing the work by hand, on a screen that lied about what it did, while an
 * Android user got the automatic version for the same money.
 *
 * So the line is drawn by WHO DOES THE WORK, not by platform:
 *
 *   free   — you hand Wafra a message (type it, or paste the bank alert) and it
 *            parses, categorises and files it. That is a better keyboard, and
 *            charging for a better keyboard on one platform only is indefensible.
 *   Pro    — Wafra collects messages by itself: the Android inbox scan, and the
 *            iPhone local automation. Identical value, identical gate, both platforms.
 *
 * `requiresPro` is the single place that decision lives. Screens ask it rather
 * than testing `Platform.OS`, which is how the two platforms stay in step.
 */

/**
 * How a transaction reaches the ledger.
 *
 * `manual` covers typing an entry and pasting a bank message: the user is
 * holding the message and handing it over. `inboxScan` (Android) and
 * `localAutomation` (iPhone) are the same feature wearing the platform's clothes —
 * Wafra collecting messages without being asked.
 */
export type CaptureMethod = 'manual' | 'inboxScan' | 'localAutomation';

/**
 * The only gate. Anything a user does by hand stays free on every platform;
 * anything Wafra does on its own is Pro on every platform.
 */
export function requiresPro(method: CaptureMethod): boolean {
  return method !== 'manual';
}

/** What "automatic" means on this device — and whether it exists here at all. */
export function autoCaptureMethod(): Exclude<CaptureMethod, 'manual'> | null {
  if (Platform.OS === 'android') return 'inboxScan';
  if (Platform.OS === 'ios') return 'localAutomation';
  return null;
}

/**
 * Which native storefront owns subscription management. Used for copy/routing;
 * purchase availability itself is owned by the Superwall provider.
 */
export type BillingStore = 'play' | 'appStore' | 'none';

export function billingStore(): BillingStore {
  if (Platform.OS === 'android') return 'play';
  if (Platform.OS === 'ios') return 'appStore';
  return 'none';
}
