/**
 * Billing abstraction for Wafra Pro, and the line between free and paid.
 *
 * Store policy requires digital subscriptions to go through the platform's own
 * billing — Google Play Billing on Android, StoreKit on iOS (react-native-iap
 * speaks both). Those SDKs only function when the app was installed from the
 * store, so on side-load and TestFlight-less builds purchases are structurally
 * unavailable — the paywall explains this, and the founder unlock (7 taps on
 * the version row in Settings) grants Pro locally.
 *
 * At submission time: create these product IDs in Play Console → Monetize →
 * Subscriptions and in App Store Connect → Subscriptions, add react-native-iap,
 * and replace the stubs below with real purchase / restore calls. The UI
 * (src/app/pro.tsx) needs no changes.
 *
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
import { Platform } from 'react-native';

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

/* ─────────────────── What is free and what is paid ─────────────────── */

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

/* ─────────────────────────── Billing ─────────────────────────── */

export type BillingStore = 'play' | 'appStore' | 'none';

/** Which store would handle a purchase here. Used for copy, not for gating. */
export function billingStore(): BillingStore {
  if (Platform.OS === 'android') return 'play';
  if (Platform.OS === 'ios') return 'appStore';
  return 'none';
}

/** True once the store billing SDK is wired and the app came from that store. */
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
