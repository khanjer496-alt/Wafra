import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { currentMonthPeriod, type Period } from '@/lib/period';
import { useStore } from '@/lib/store';

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
  const { state } = useStore();
  const [period, setPeriodState] = useState<Period>(() => currentMonthPeriod());

  /**
   * Whether the user chose this period themselves.
   *
   * A ref rather than state: it must not schedule a render of its own, and the
   * effect below has to read it as of the moment it runs rather than as of the
   * render that queued it.
   */
  const chosenByUser = useRef(false);

  const setPeriod = useCallback((p: Period) => {
    chosenByUser.current = true;
    setPeriodState(p);
  }, []);

  const resetPeriod = useCallback(() => {
    chosenByUser.current = false;
    setPeriodState(currentMonthPeriod());
  }, []);

  /**
   * Re-answer "which month is it" once the month start day is actually known.
   *
   * `currentMonthPeriod` reads the start day from a module global that
   * `setMonthStartDay` fills in from persisted settings, and that happens
   * during HYDRATION — after this provider's first render. So the initial
   * value above is always computed with the default start of the 1st, whatever
   * the user set, and nothing ever revisited it.
   *
   * With a start day of the 27th on 2 August that is not a cosmetic slip. The
   * initialiser answers "2026-08"; hydration then moves every date from the
   * 1st to the 26th into "2026-07"; and the app sits on a month whose first
   * day has not arrived yet. Home reported AED 0 in, AED 0 out and AED 0 saved
   * over a ledger holding thirty-nine transactions.
   *
   * Keyed on the start day as well as on hydration, so changing the setting
   * moves the app to the month that now contains today instead of stranding it
   * on the old boundary. A period the user picked is left alone — they are
   * looking at March on purpose.
   */
  useEffect(() => {
    if (!chosenByUser.current) setPeriodState(currentMonthPeriod());
  }, [state.hydrated, state.monthStartDay]);

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
