import React, { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * The system text scale as one shared number.
 *
 * iOS can change Larger Text while the app stays in memory. The glyphs redraw
 * at the new size, but React Native keeps each text node's old measured box, so
 * headings and figures come back clipped until a relaunch (seen on iPhone 15,
 * iOS 26.6.2). Text keys itself on this value to remount once per change.
 *
 * One window listener at the root instead of one per text node, and a plain
 * number, so rotation, split view or a browser resize re-render no text.
 */
const FontScaleContext = createContext<number>(1);

export function FontScaleProvider({ children }: { children: React.ReactNode }) {
  const { fontScale } = useWindowDimensions();
  return <FontScaleContext.Provider value={fontScale}>{children}</FontScaleContext.Provider>;
}

export function useFontScale(): number {
  return useContext(FontScaleContext);
}
