import { requireOptionalNativeModule } from 'expo-modules-core';

import { PRO_ENTITLEMENT_PRODUCT_IDS } from '@/lib/purchases';

export interface AndroidPlaySubscriptionSnapshot {
  status: 'active' | 'inactive' | 'unknown';
  activeProductIds: string[];
  pendingProductIds: string[];
  responseCode: number | null;
  needsAcknowledgement?: boolean;
}

interface PlayBillingModule {
  querySubscriptions(): Promise<unknown>;
  acknowledgeSubscriptions?(): Promise<unknown>;
}

const proProducts = new Set(PRO_ENTITLEMENT_PRODUCT_IDS);
let native: PlayBillingModule | null = null;
try {
  native = requireOptionalNativeModule<PlayBillingModule>('WafraPlayBilling');
} catch {
  // An older binary or a non-Android runtime has no fresh query seam.
}

export function isAndroidPlayBillingAvailable(): boolean {
  return typeof native?.querySubscriptions === 'function';
}

function unknown(): AndroidPlaySubscriptionSnapshot {
  return { status: 'unknown', activeProductIds: [], pendingProductIds: [], responseCode: null };
}

function productIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > PRO_ENTITLEMENT_PRODUCT_IDS.length ||
      !value.every((item): item is string => typeof item === 'string' && proProducts.has(item))) return null;
  return [...new Set(value)];
}

/** A successful empty Play response revokes access; errors never mean empty. */
export async function queryAndroidPlaySubscriptions(): Promise<AndroidPlaySubscriptionSnapshot> {
  if (!native || !isAndroidPlayBillingAvailable()) return unknown();
  try {
    const result = await native.querySubscriptions();
    if (!result || typeof result !== 'object') return unknown();
    const value = result as Record<string, unknown>;
    if (value.responseCode !== 0 || (value.status !== 'active' && value.status !== 'inactive')) return unknown();
    const activeProductIds = productIds(value.activeProductIds);
    const pendingProductIds = productIds(value.pendingProductIds);
    if (!activeProductIds || !pendingProductIds ||
        (value.status === 'active') !== (activeProductIds.length > 0)) return unknown();
    return { status: value.status, activeProductIds, pendingProductIds, responseCode: 0,
      ...(typeof value.needsAcknowledgement === 'boolean' ? { needsAcknowledgement: value.needsAcknowledgement } : {}),
    };
  } catch {
    return unknown();
  }
}


const acknowledgementRecoveries = new Map<object, Promise<void>>();
const defaultRecoverySession = {};

/** Call only after locally granting and durably saving Pro. Never blocks checkout UI.
 * Each bounded attempt creates a fresh native query (including after an SDK ACK
 * race). Already acknowledged and pending purchases are no-ops in native code.
 */
export function recoverAndroidPlayAcknowledgements(isStillEntitled: () => boolean, session: object = defaultRecoverySession): Promise<void> {
  if (!native?.acknowledgeSubscriptions) return Promise.resolve();
  const existing = acknowledgementRecoveries.get(session);
  if (existing) return existing;
  const recover = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!isStillEntitled()) return;
      try {
        const result = await native!.acknowledgeSubscriptions!();
        if (result && typeof result === 'object') {
          const value = result as Record<string, unknown>;
          if (value.responseCode === 0 && (value.status === 'active' || value.status === 'inactive') &&
              productIds(value.activeProductIds) && productIds(value.pendingProductIds)) return;
        }
      } catch {
        // Native failures are retryable, never an entitlement revocation or UI error.
      }
      if (attempt < 2) await new Promise<void>(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  };
  const recovery = recover().finally(() => { acknowledgementRecoveries.delete(session); });
  acknowledgementRecoveries.set(session, recovery);
  return recovery;
}
