/**
 * The store-facing half of billing. See purchases.ts for the rest and for why
 * RevenueCat at all.
 *
 * Split out for the same reason dedupe.ts and import-plan.ts were: this file
 * imports a native SDK, so nothing here can run under the test harness, and
 * the arithmetic that CAN be tested must not be trapped behind it.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, type CustomerInfo } from 'react-native-purchases';

import { ENTITLEMENT_ID, PRO_SKUS, type ProPlan } from '@/lib/purchases';

/** The public SDK key for this platform, or null when none is configured. */
function apiKey(): string | null {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const key =
    Platform.OS === 'ios' ? extra?.revenueCatIosKey : extra?.revenueCatAndroidKey;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/**
 * True when a purchase can actually be made.
 *
 * False on web, and false with no key configured — which is every build until
 * the store listing exists. The paywall reads this to explain itself rather
 * than opening a flow that cannot complete.
 */
export function isBillingAvailable(): boolean {
  return Platform.OS !== 'web' && apiKey() !== null;
}

let configured = false;

/**
 * Bring the SDK up once per process. Safe to call repeatedly.
 *
 * Never throws: a billing SDK that fails to start must not take the app with
 * it. The consequence of failure is that Pro falls back to the cached flag,
 * which is the same place it would have been anyway.
 */
async function ready(): Promise<boolean> {
  if (!isBillingAvailable()) return false;
  if (configured) return true;
  try {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
    await Purchases.configure({ apiKey: apiKey() as string });
    configured = true;
    return true;
  } catch {
    return false;
  }
}

/** Whether this customer holds the Pro entitlement right now. */
function entitled(info: CustomerInfo): boolean {
  return info.entitlements.active[ENTITLEMENT_ID] !== undefined;
}

/**
 * The store's answer about this customer, or null if it could not be reached.
 *
 * NULL IS NOT FALSE, and the caller must not treat it as such. Losing signal
 * on a flight is not the same as never having paid, and locking a paying
 * customer out of their own ledger because the request timed out is the worst
 * thing this file could do.
 */
export async function refreshEntitlement(): Promise<boolean | null> {
  if (!(await ready())) return null;
  try {
    return entitled(await Purchases.getCustomerInfo());
  } catch {
    return null;
  }
}

/** Starts a purchase flow. Resolves true when the entitlement was granted. */
export async function purchasePro(plan: ProPlan): Promise<boolean> {
  if (!(await ready())) return false;
  try {
    const products = await Purchases.getProducts([PRO_SKUS[plan]]);
    const product = products[0];
    if (!product) return false;
    const { customerInfo } = await Purchases.purchaseStoreProduct(product);
    return entitled(customerInfo);
  } catch {
    // Includes the user simply backing out of the sheet, which is not an
    // error worth showing them.
    return false;
  }
}

/** Restores a previous purchase. Resolves true when Pro should be granted. */
export async function restorePro(): Promise<boolean> {
  if (!(await ready())) return false;
  try {
    return entitled(await Purchases.restorePurchases());
  } catch {
    return false;
  }
}
