/**
 * Store-entitlement helpers for Wafra Pro.
 *
 * Superwall owns the storefront purchase/restore flow and subscription status.
 * This module deliberately stays free of the runtime Superwall bridge so its
 * entitlement arithmetic can be tested without loading a native module.
 */
import { Platform } from 'react-native';
import type { CustomerInfo, SubscriptionStatus } from 'expo-superwall';

import {
  publishIosCaptureStatusRefresh,
  setIosStoreCaptureEntitlementLease,
} from '@/lib/capture';
import { ENTITLEMENT_ID, PRO_SKUS } from '@/lib/purchases';

/**
 * A verified store answer mirrored into the app and the iOS App Intent gate.
 * `null` from `entitlementSnapshot` means the store answer is still unknown;
 * callers must preserve their cached value rather than interpreting it as free.
 */
export interface EntitlementSnapshot {
  active: boolean;
  requestDateMs: number;
  /** Exact storefront deadline when known. Purchased Wafra Pro is not lifetime. */
  expirationDateMs: number | null;
}

/**
 * If Superwall has confirmed Pro but transaction detail has not arrived yet,
 * grant the out-of-process iOS capture extension only a bounded lease. A later
 * customer-info update replaces it with the exact storefront expiration.
 */
export const STORE_CAPTURE_FALLBACK_LEASE_MS = 25 * 60 * 60 * 1000;

const PRO_PRODUCT_IDS = new Set<string>(Object.values(PRO_SKUS));

function futureExpirationMs(info: CustomerInfo | null, nowMs: number): number | null {
  if (!info) return null;
  let latest: number | null = null;
  for (const subscription of info.subscriptions) {
    if (!PRO_PRODUCT_IDS.has(subscription.productId) || !subscription.isActive || subscription.isRevoked) {
      continue;
    }
    if (!subscription.expirationDate) continue;
    const candidate = Date.parse(subscription.expirationDate);
    if (!Number.isFinite(candidate) || candidate <= nowMs) continue;
    latest = latest === null ? candidate : Math.max(latest, candidate);
  }
  return latest;
}

/**
 * Convert Superwall's three-state subscription model into Wafra's conservative
 * local entitlement snapshot. UNKNOWN intentionally returns null: offline or
 * unresolved store state is not proof that a paying customer stopped paying.
 */
export function entitlementSnapshot(
  status: SubscriptionStatus,
  customerInfo: CustomerInfo | null,
  verifiedAtMs: number = Date.now(),
): EntitlementSnapshot | null {
  if (!Number.isFinite(verifiedAtMs) || verifiedAtMs < 0) return null;
  if (status.status === 'UNKNOWN') return null;

  const active =
    status.status === 'ACTIVE' &&
    status.entitlements.some((entitlement) => entitlement.id === ENTITLEMENT_ID);

  if (!active) {
    return { active: false, requestDateMs: verifiedAtMs, expirationDateMs: null };
  }

  const exactExpiration = futureExpirationMs(customerInfo, verifiedAtMs);
  return {
    active: true,
    requestDateMs: verifiedAtMs,
    expirationDateMs: exactExpiration ?? verifiedAtMs + STORE_CAPTURE_FALLBACK_LEASE_MS,
  };
}

/** Mirror a confirmed store answer into the out-of-process iOS App Intent gate. */
export async function syncStoreCaptureEntitlement(
  snapshot: EntitlementSnapshot,
): Promise<boolean> {
  if (Platform.OS !== 'ios') return true;
  const applied = await setIosStoreCaptureEntitlementLease(
    snapshot.active ? snapshot.expirationDateMs : null,
    false,
    snapshot.requestDateMs,
  );
  if (applied) publishIosCaptureStatusRefresh();
  return applied;
}

/** Store-owned page where the current customer can manage or cancel renewal. */
export async function subscriptionManagementUrl(): Promise<string | null> {
  if (Platform.OS === 'ios') return 'https://apps.apple.com/account/subscriptions';
  if (Platform.OS === 'android') return 'https://play.google.com/store/account/subscriptions';
  return null;
}
