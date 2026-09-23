import { createContext, use, useMemo, useState, type ReactNode } from 'react';

type TabBarMetrics = {
  measuredHeight: number | null;
  setMeasuredHeight: (height: number) => void;
  /**
   * True when the tab bar is the platform's own (iOS native tabs). It is
   * never measured from JS; the safe-area inset under it already accounts
   * for it, and `useTabBarClearance` reads that instead.
   */
  nativeChrome: boolean;
};

const TabBarMetricsContext = createContext<TabBarMetrics>({
  measuredHeight: null,
  setMeasuredHeight: () => undefined,
  nativeChrome: false,
});

export function TabBarMetricsProvider({
  children,
  nativeChrome = false,
}: {
  children: ReactNode;
  nativeChrome?: boolean;
}) {
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const value = useMemo(
    () => ({ measuredHeight, setMeasuredHeight, nativeChrome }),
    [measuredHeight, nativeChrome],
  );
  return <TabBarMetricsContext.Provider value={value}>{children}</TabBarMetricsContext.Provider>;
}

export const useTabBarMetrics = (): TabBarMetrics => use(TabBarMetricsContext);
