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
  type PurchasesStoreProduct,
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

function productForPlan(
  products: PurchasesStoreProduct[],
  plan: ProPlan,
): PurchasesStoreProduct | undefined {
  return products.find((product) => product.identifier === PRO_SKUS[plan]);
}

/**
 * Localized prices from the App Store or Play storefront currently signed in
 * on this device. `null` means there is no usable store response; callers must
 * say the native price is unavailable, never substitute the ledger currency.
 */
export async function loadStorePrices(): Promise<StorePrices | null> {
  if (!(await ready())) return null;
  try {
    const products = await Purchases.getProducts(Object.values(PRO_SKUS));
    const monthly = productForPlan(products, 'monthly');
    const yearly = productForPlan(products, 'yearly');
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
  if (!(await ready())) return null;
  try {
    const info = await Purchases.getCustomerInfo();
    if (info.managementURL) return info.managementURL;
  } catch {
    // The store's generic subscription page is still useful when RevenueCat
    // cannot refresh CustomerInfo, so fall through to the platform URL.
  }
  if (Platform.OS === 'ios') return 'https://apps.apple.com/account/subscriptions';
  if (Platform.OS === 'android') return 'https://play.google.com/store/account/subscriptions';
  return null;
}

/** Starts a purchase flow. See PurchaseOutcome for what the answers mean. */
export async function purchasePro(plan: ProPlan): Promise<PurchaseOutcome> {
  if (!(await ready())) return 'failed';
  let product;
  try {
    const products = await Purchases.getProducts([PRO_SKUS[plan]]);
    product = products[0];
  } catch {
    return 'failed';
  }
  // No such product on this store — the SKU is not activated yet, or is named
  // differently in the console. Nothing the user did, and nothing they can fix.
  if (!product) return 'failed';
  try {
    const { customerInfo } = await Purchases.purchaseStoreProduct(product);
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
