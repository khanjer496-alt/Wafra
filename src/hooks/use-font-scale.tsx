import React, { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

// Share one system-scale subscription across text nodes. ThemedText uses the
// value to refresh native measurements after a live accessibility size change.
// A rotation changes the provider's dimensions, but not its context value.
const FontScaleContext = createContext<number>(1);

export function FontScaleProvider({ children }: { children: React.ReactNode }) {
  const { fontScale } = useWindowDimensions();
  return <FontScaleContext.Provider value={fontScale}>{children}</FontScaleContext.Provider>;
}

export function useFontScale(): number {
  return useContext(FontScaleContext);
}
