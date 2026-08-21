/**
 * Billing for Wafra Pro, through RevenueCat.
 *
 * RevenueCat rather than separate store adapters: one entitlement model and
 * one validation path cover both stores. Wafra has no account-linking system,
 * so anonymous purchases do not automatically transfer between an Android
 * install and a separate iPhone install.
 *
 * The three moving parts, and which of them is the truth:
 *
 *   RevenueCat  the ONLY source of entitlement. Asked at launch, so a lapsed,
 *               refunded or cancelled subscription actually locks again.
 *               A reinstall creates a new anonymous customer and still needs
 *               the user-visible Restore button to attach the store receipt.
 *   state.pro   a cache of that answer, so the app is not blank while the
 *               network is slow.
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
import { Platform } from 'react-native';

/** The entitlement id configured in RevenueCat. One, for everything Pro. */
export const ENTITLEMENT_ID = 'pro';

export const PRO_SKUS = {
  monthly: 'wafra_pro_monthly',
  yearly: 'wafra_pro_yearly',
} as const;

export type ProPlan = keyof typeof PRO_SKUS;

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
  monthly: { fils: 999 },
  yearly: { fils: 7499 },
};

export const PRO_REFERENCE_PRICE_STRINGS: Record<ProPlan, string> = {
  monthly: 'US$9.99',
  yearly: 'US$74.99',
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

/** Every Pro feature is free for this long after first launch. Do not also add
 *  a storefront introductory trial: it would begin after this local trial and
 *  silently turn the advertised three days into as many as six. */
export const TRIAL_DAYS = 3;

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
 * the real entitlement gate is RevenueCat, asked at every launch.
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
 * reading the inbox; iPhone delivers it through a Shortcut and the relay. Both
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
 *            iPhone relay capture. Identical value, identical gate, both platforms.
 *
 * `requiresPro` is the single place that decision lives. Screens ask it rather
 * than testing `Platform.OS`, which is how the two platforms stay in step.
 */

/**
 * How a transaction reaches the ledger.
 *
 * `manual` covers typing an entry and pasting a bank message: the user is
 * holding the message and handing it over. `inboxScan` (Android) and
 * `relayCapture` (iPhone) are the same feature wearing the platform's clothes —
 * Wafra collecting messages without being asked.
 */
export type CaptureMethod = 'manual' | 'inboxScan' | 'relayCapture';

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
  if (Platform.OS === 'ios') return 'relayCapture';
  return null;
}

/**
 * Which store would handle a purchase here. Used for COPY, not for gating —
 * `isBillingAvailable()` in billing.ts is the gate, and it additionally
 * requires a configured RevenueCat key.
 *
 * This one function is all that survives of the other branch's billing stub;
 * its `isBillingAvailable`/`purchasePro`/`restorePro` returned a hardcoded
 * `false` and would have shadowed billing.ts's real implementations at every
 * import site that reached for the nearer name.
 */
export type BillingStore = 'play' | 'appStore' | 'none';

export function billingStore(): BillingStore {
  if (Platform.OS === 'android') return 'play';
  if (Platform.OS === 'ios') return 'appStore';
  return 'none';
}
