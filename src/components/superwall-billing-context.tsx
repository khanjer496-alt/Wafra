import { createContext, useContext } from 'react';

import type { ProPlanOffer } from '@/lib/purchases';

export type SuperwallBillingStatus = 'unknown' | 'inactive' | 'active';
export type SuperwallPaywallStatus = 'idle' | 'presented' | 'dismissed' | 'skipped' | 'error';

export type { ProPlanOffer };

/**
 * What the store said about one purchase attempt.
 *
 * `unconfirmed` is deliberately separate from `failed`: the transaction
 * completed but the entitlement has not been verified yet, so the screen must
 * not claim Pro and must not claim nothing was charged either.
 */
export type ProPurchaseOutcome =
  | 'purchased'
  | 'unconfirmed'
  | 'cancelled'
  | 'pending'
  | 'failed'
  | 'unavailable';

export interface WafraBillingValue {
  available: boolean;
  configured: boolean;
  configurationError: string | null;
  subscriptionStatus: SuperwallBillingStatus;
  paywallStatus: SuperwallPaywallStatus;
  onboardingFlowStatus: SuperwallPaywallStatus;
  /** Storefront-formatted prices for the Pro plans, in Wafra's own screen. */
  fetchProOffers: () => Promise<ProPlanOffer[]>;
  /** Native checkout for one plan, owned by Wafra's Pro screen. */
  purchasePro: (productId: string) => Promise<ProPurchaseOutcome>;
  /** Remote campaign surface. Kept for campaigns; /pro does not present it. */
  presentProPaywall: (params?: Record<string, unknown>) => Promise<void>;
  presentOnboardingFlow: () => Promise<void>;
  restorePro: () => Promise<boolean | null>;
  refresh: () => Promise<void>;
}

export const unavailableBilling: WafraBillingValue = {
  available: false,
  configured: false,
  configurationError: null,
  subscriptionStatus: 'unknown',
  paywallStatus: 'idle',
  onboardingFlowStatus: 'idle',
  fetchProOffers: async () => [],
  purchasePro: async () => 'unavailable',
  presentProPaywall: async () => {},
  presentOnboardingFlow: async () => {},
  restorePro: async () => null,
  refresh: async () => {},
};

export const WafraBillingContext = createContext<WafraBillingValue>(unavailableBilling);

export function useWafraBilling(): WafraBillingValue {
  return useContext(WafraBillingContext);
}
