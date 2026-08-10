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
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type CustomerInfoUpdateListener,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';

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

const MAX_INACTIVE_CACHE_AGE_MS = 25 * 60 * 60 * 1000;

export interface EntitlementSnapshot {
  active: boolean;
  requestDateMs: number;
}

/**
 * RevenueCat can return cached CustomerInfo while offline. An old positive is
 * safe to preserve, but an old negative must not revoke a locally cached Pro
 * flag: after RevenueCat's offline grace that negative can mean "not recently
 * verified", not "the store confirmed expiry".
 */
function entitlementSnapshot(info: CustomerInfo): EntitlementSnapshot | null {
  const requestDateMs = Date.parse(info.requestDate);
  if (!Number.isFinite(requestDateMs)) return null;
  const active = entitled(info);
  if (!active && Date.now() - requestDateMs > MAX_INACTIVE_CACHE_AGE_MS) return null;
  return { active, requestDateMs };
}

/**
 * Keep the local entitlement in step with renewals, refunds, cancellations,
 * grace periods and purchases completed outside this screen.
 */
export async function observeEntitlement(
  listener: (snapshot: EntitlementSnapshot) => void,
): Promise<() => void> {
  if (!(await ready())) return () => {};
  const update: CustomerInfoUpdateListener = (info) => {
    const snapshot = entitlementSnapshot(info);
    if (snapshot) listener(snapshot);
  };
  Purchases.addCustomerInfoUpdateListener(update);
  try {
    const snapshot = entitlementSnapshot(await Purchases.getCustomerInfo());
    if (snapshot) listener(snapshot);
  } catch {
    // Offline is unknown, not inactive. Preserve the cached entitlement.
  }
  return () => {
    Purchases.removeCustomerInfoUpdateListener(update);
  };
}

/**
 * The store's answer about this customer, or null if it could not be reached.
 *
 * NULL IS NOT FALSE, and the caller must not treat it as such. Losing signal
 * on a flight is not the same as never having paid, and locking a paying
 * customer out of their own ledger because the request timed out is the worst
 * thing this file could do.
 */
export async function refreshEntitlement(): Promise<EntitlementSnapshot | null> {
  if (!(await ready())) return null;
  try {
    return entitlementSnapshot(await Purchases.getCustomerInfo());
  } catch {
    return null;
  }
}

/**
 * How a purchase attempt ended.
 *
 * Three outcomes and not a boolean, for the same reason `refreshEntitlement`
 * has three: `false` was carrying both "the user changed their mind" and
 * "this cannot work" — a missing SKU in Play Console, an SDK that never
 * configured, a throw out of getProducts. The paywall could only do one thing
 * with that, and the thing it did was nothing, so a build whose products were
 * not yet activated had a "Get Pro" button that did not respond and never
 * said why. Backing out must stay silent; a broken store must not.
 */
export type PurchaseOutcome = 'granted' | 'cancelled' | 'failed';

export interface StorePrice {
  /** Store-formatted price, including the storefront's currency and locale. */
  priceString: string;
  /** Numeric price in `currencyCode`, used only to calculate the annual saving. */
  price: number;
  currencyCode: string;
}

export type StorePrices = Partial<Record<ProPlan, StorePrice>>;

function packageForPlan(
  offering: PurchasesOffering,
  plan: ProPlan,
): PurchasesPackage | undefined {
  const standard = plan === 'monthly' ? offering.monthly : offering.annual;
  if (standard?.product.identifier === PRO_SKUS[plan]) return standard;
  return offering.availablePackages.find(
    (candidate) => candidate.product.identifier === PRO_SKUS[plan],
  );
}

async function currentPackage(plan: ProPlan): Promise<PurchasesPackage | null> {
  const offering = (await Purchases.getOfferings()).current;
  return offering ? packageForPlan(offering, plan) ?? null : null;
}

/**
 * Localized prices from the App Store or Play storefront currently signed in
 * on this device. `null` means there is no usable store response; callers must
 * say the native price is unavailable, never substitute the ledger currency.
 */
export async function loadStorePrices(): Promise<StorePrices | null> {
  if (!(await ready())) return null;
  try {
    const offering = (await Purchases.getOfferings()).current;
    if (!offering) return null;
    const monthly = packageForPlan(offering, 'monthly')?.product;
    const yearly = packageForPlan(offering, 'yearly')?.product;
    const prices: StorePrices = {};
    if (monthly) {
      prices.monthly = {
        priceString: monthly.priceString,
        price: monthly.price,
        currencyCode: monthly.currencyCode,
      };
    }
    if (yearly) {
      prices.yearly = {
        priceString: yearly.priceString,
        price: yearly.price,
        currencyCode: yearly.currencyCode,
      };
    }
    return Object.keys(prices).length > 0 ? prices : null;
  } catch {
    return null;
  }
}

/** Store-owned page where the current customer can manage or cancel renewal. */
export async function subscriptionManagementUrl(): Promise<string | null> {
  if (await ready()) {
    try {
      const info = await Purchases.getCustomerInfo();
      if (info.managementURL) return info.managementURL;
    } catch {
      // The store's generic subscription page is still useful when RevenueCat
      // cannot refresh CustomerInfo, so fall through to the platform URL.
    }
  }
  if (Platform.OS === 'ios') return 'https://apps.apple.com/account/subscriptions';
  if (Platform.OS === 'android') return 'https://play.google.com/store/account/subscriptions';
  return null;
}

/** Starts a purchase flow. See PurchaseOutcome for what the answers mean. */
export async function purchasePro(plan: ProPlan): Promise<PurchaseOutcome> {
  if (!(await ready())) return 'failed';
  let selectedPackage: PurchasesPackage | null;
  try {
    selectedPackage = await currentPackage(plan);
  } catch {
    return 'failed';
  }
  // No package means the current RevenueCat Offering is incomplete or its
  // store product is not active. Nothing the user did, and nothing they can fix.
  if (!selectedPackage) return 'failed';
  try {
    const { customerInfo } = await Purchases.purchasePackage(selectedPackage);
    // A completed flow that did not grant the entitlement is a failure, not a
    // purchase: RevenueCat and the store disagree, and silently returning
    // would leave a charged customer locked out.
    return entitled(customerInfo) ? 'granted' : 'failed';
  } catch (error) {
    // The one case that is not an error: the user simply closed the sheet.
    // The SDK flags it rather than making callers match on a message.
    return (error as { userCancelled?: boolean } | null)?.userCancelled
      ? 'cancelled'
      : 'failed';
  }
}

/**
 * Restores a previous purchase.
 *
 * true — restored. false — this account has never bought Pro. NULL — the
 * store could not be reached, which IS NOT FALSE; see refreshEntitlement
 * above. Collapsing the last two told a paying subscriber reinstalling on bad
 * connectivity that no purchase existed, which is the sentence most likely to
 * end in a refund request.
 */
export async function restorePro(): Promise<boolean | null> {
  if (!(await ready())) return null;
  try {
    return entitled(await Purchases.restorePurchases());
  } catch {
    return null;
  }
}
