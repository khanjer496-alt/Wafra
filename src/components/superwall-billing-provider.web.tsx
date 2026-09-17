import React from 'react';

import {
  unavailableBilling,
  WafraBillingContext,
} from '@/components/superwall-billing-context';

/** Superwall is native-only in Wafra; the web export keeps a safe no-billing shell. */
export function SuperwallBillingProvider({ children }: { children: React.ReactNode }) {
  return (
    <WafraBillingContext.Provider value={unavailableBilling}>
      {children}
    </WafraBillingContext.Provider>
  );
}
