import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { useThemePreference } from '@/lib/theme-preference';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const preference = useThemePreference();
  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    // A pinned choice beats the OS here too; the server render still has to be
    // the light palette or the first paint mismatches.
    return preference === 'system' ? colorScheme : preference;
  }

  return 'light';
}
