import React from 'react';

import {
  unavailableBilling,
  WafraBillingContext,
} from '@/components/superwall-billing-context';

/** TypeScript/web-safe fallback. Metro selects the platform file at runtime. */
export function SuperwallBillingProvider({ children }: { children: React.ReactNode }) {
  return (
    <WafraBillingContext.Provider value={unavailableBilling}>
      {children}
    </WafraBillingContext.Provider>
  );
}
