import { useContext } from 'react';

import { BandPalettes, type BandId, type BandPalette } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ThemeScope } from '@/hooks/use-theme';

/**
 * The scheme bands paint in: a presentation scope first (a sheet previewing a
 * dark surface), then the user's choice, then the OS — the same order
 * `useTheme` follows, so a band and the sheet under it never disagree.
 */
export function useBandScheme(override?: 'light' | 'dark'): 'light' | 'dark' {
  const scope = useContext(ThemeScope);
  const scheme = useColorScheme();
  return override ?? scope ?? (scheme === 'dark' ? 'dark' : 'light');
}

/**
 * The resolved band palette for a screen's band id, in the current scheme.
 * The object is a module constant, so it is referentially stable across
 * renders and safe in memo dependencies.
 */
export function useBand(id: BandId, override?: 'light' | 'dark'): BandPalette {
  return BandPalettes[useBandScheme(override)][id];
}
