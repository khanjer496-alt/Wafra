import { createContext, useContext } from 'react';

export type SuperwallBillingStatus = 'unknown' | 'inactive' | 'active';
export type SuperwallPaywallStatus = 'idle' | 'presented' | 'dismissed' | 'skipped' | 'error';

export interface WafraBillingValue {
  available: boolean;
  configured: boolean;
  configurationError: string | null;
  subscriptionStatus: SuperwallBillingStatus;
  paywallStatus: SuperwallPaywallStatus;
  onboardingFlowStatus: SuperwallPaywallStatus;
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
  presentProPaywall: async () => {},
  presentOnboardingFlow: async () => {},
  restorePro: async () => null,
  refresh: async () => {},
};

export const WafraBillingContext = createContext<WafraBillingValue>(unavailableBilling);

export function useWafraBilling(): WafraBillingValue {
  return useContext(WafraBillingContext);
}
