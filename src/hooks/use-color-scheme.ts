import { useColorScheme as useSystemColorScheme } from 'react-native';

import { useThemePreference } from '@/lib/theme-preference';

/**
 * The scheme the app paints in: the user's choice when they have made one,
 * the OS otherwise.
 *
 * Every colour in the app already flows through `useTheme`, which flows
 * through here, so overriding at this one point is enough — no screen has to
 * know a preference exists.
 */
export function useColorScheme() {
  const preference = useThemePreference();
  const system = useSystemColorScheme();
  return preference === 'system' ? system : preference;
}
