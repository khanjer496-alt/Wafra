import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

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
  const [period, setPeriodState] = useState<Period>(() => currentMonthPeriod());

  const setPeriod = useCallback((p: Period) => {
    setPeriodState(p);
  }, []);

  const resetPeriod = useCallback(() => {
    setPeriodState(currentMonthPeriod());
  }, []);

  /**
   * There is deliberately no effect re-answering "which month is it" after
   * hydration.
   *
   * There used to be one, and it was load-bearing: `currentMonthPeriod` read
   * the money-month start day out of a module global that hydration filled in,
   * so the initialiser above ran with the wrong start day and had to be
   * corrected a render later. Now `monthKey` is the first seven characters of
   * the ISO date and consults nothing, so the initialiser is already right and
   * a correction pass would only be a chance to get it wrong.
   */

  const value = useMemo(
    () => ({ period, setPeriod, resetPeriod }),
    [period, setPeriod, resetPeriod],
  );

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod(): PeriodContextValue {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod must be used within PeriodProvider');
  return ctx;
}
