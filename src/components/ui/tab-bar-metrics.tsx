import { createContext, use, useMemo, useState, type ReactNode } from 'react';

type TabBarMetrics = {
  measuredHeight: number | null;
  setMeasuredHeight: (height: number) => void;
};

const TabBarMetricsContext = createContext<TabBarMetrics>({
  measuredHeight: null,
  setMeasuredHeight: () => undefined,
});

export function TabBarMetricsProvider({ children }: { children: ReactNode }) {
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const value = useMemo(() => ({ measuredHeight, setMeasuredHeight }), [measuredHeight]);
  return <TabBarMetricsContext.Provider value={value}>{children}</TabBarMetricsContext.Provider>;
}

export const useTabBarMetrics = (): TabBarMetrics => use(TabBarMetricsContext);
