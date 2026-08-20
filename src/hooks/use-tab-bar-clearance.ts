import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';

/** Visual height of the four-destination bar above the safe-area inset. */
export const TAB_BAR_HEIGHT = 58;

/**
 * Bottom padding a tab screen's scroll content needs so the floating tab bar
 * never covers the last row.
 *
 * This used to be a hardcoded 110 copied into every tab screen, which ignored
 * the safe-area inset — on a device with a tall navigation bar the pill sat
 * over the final list item.
 */
export function useTabBarClearance() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + Math.max(insets.bottom, Spacing.two) + Spacing.three;
}
