import React, { createContext, useContext, useMemo, useState } from 'react';

import { currentMonthPeriod, type Period } from '@/lib/period';

interface PeriodContextValue {
  period: Period;
  setPeriod: (p: Period) => void;
  resetPeriod: () => void;
}

const PeriodContext = createContext<PeriodContextValue | null>(null);

/**
 * Session-scoped reporting period shared by Home, Insights, Transactions,
 * and Budgets. Deliberately not persisted: the app always opens on the
 * current month, which is what a fresh glance should show.
 */
export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const [period, setPeriod] = useState<Period>(() => currentMonthPeriod());

  const value = useMemo(
    () => ({
      period,
      setPeriod,
      resetPeriod: () => setPeriod(currentMonthPeriod()),
    }),
    [period],
  );

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod(): PeriodContextValue {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod must be used within PeriodProvider');
  return ctx;
}
