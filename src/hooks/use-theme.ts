/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { createContext, useContext, useMemo } from 'react';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useIncreasedContrast } from '@/hooks/use-increased-contrast';

// Presentation-only scope: never changes the saved theme preference.
export const ThemeScope = createContext<'light' | 'dark' | undefined>(undefined);

export function useTheme(override?: 'light' | 'dark') {
  const scope = useContext(ThemeScope);
  const scheme = useColorScheme();
  const theme = override ?? scope ?? (scheme === 'unspecified' ? 'light' : scheme);
  const increasedContrast = useIncreasedContrast();
  const palette = Colors[theme];

  // A stable palette lets memoized screen children skip unrelated renders.
  return useMemo(() => ({
    ...palette,
    controlBorder: increasedContrast ? palette.controlBorderHigh : palette.controlBorder,
  }), [palette, increasedContrast]);
}
