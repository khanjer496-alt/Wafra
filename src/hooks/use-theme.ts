/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useMemo } from 'react';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useIncreasedContrast } from '@/hooks/use-increased-contrast';

export function useTheme() {
  const scheme = useColorScheme();
  const theme = scheme === 'unspecified' ? 'light' : scheme;
  const increasedContrast = useIncreasedContrast();
  const palette = Colors[theme];

  // A stable palette lets memoized screen children skip unrelated renders.
  return useMemo(() => ({
    ...palette,
    controlBorder: increasedContrast ? palette.controlBorderHigh : palette.controlBorder,
  }), [palette, increasedContrast]);
}
