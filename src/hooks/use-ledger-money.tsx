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

/**
 * The device number conventions ledger-money.ts formats with, as render state.
 *
 * Those conventions are a module-level setting (setDisplayMoneyLocale), which
 * React cannot see. Money is compiled and memoized on its props, so without
 * this key a figure kept "1,234.56" after the phone switched to "1.234,56"
 * until its amount happened to change. The store provider publishes the key
 * it applied; it changes only when the device settings do.
 */
const MoneyLocaleContext = createContext<string>('');

export function MoneyLocaleProvider({ localeKey, children }: {
  localeKey: string;
  children: React.ReactNode;
}) {
  return <MoneyLocaleContext.Provider value={localeKey}>{children}</MoneyLocaleContext.Provider>;
}

export function useMoneyLocaleKey(): string {
  return useContext(MoneyLocaleContext);
}
