import React, { createContext, useContext, useMemo } from 'react';

import type { LedgerMoneySpec } from '@/lib/ledger-money';

const LedgerMoneyContext = createContext<LedgerMoneySpec | null>(null);

/** Currency/exponent changes update this context; other ledger revisions keep its value. */
export function LedgerMoneyProvider({ moneySpec, children }: {
  moneySpec: LedgerMoneySpec | null;
  children: React.ReactNode;
}) {
  const currency = moneySpec?.currency;
  const exponent = moneySpec?.exponent;
  const value = useMemo<LedgerMoneySpec | null>(() => currency !== undefined && exponent !== undefined
    ? { schemaVersion: 2, currency, exponent } : null, [currency, exponent]);
  return <LedgerMoneyContext.Provider value={value}>{children}</LedgerMoneyContext.Provider>;
}

/** Null preserves standalone/test callers outside the application's provider. */
export function useLedgerMoney(): LedgerMoneySpec | null {
  return useContext(LedgerMoneyContext);
}
