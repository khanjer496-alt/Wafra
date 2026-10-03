import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTabBarMetrics } from '@/components/ui/tab-bar-metrics';
import { Spacing } from '@/constants/theme';

/**
 * Visual height of the four-destination bar above the safe-area inset: the
 * 64pt floating pill plus the gap under it. Only a first-frame fallback; the
 * bar measures itself.
 */
export const TAB_BAR_HEIGHT = 72;

/**
 * Floor for the iOS system tab bar plus a home indicator (49pt + 34pt).
 *
 * Under native tabs the safe-area inset a tab screen receives already
 * contains the bar: Expo Router mounts a `SafeAreaProvider` per tab, and a
 * `UITabBarController` child's bottom safe area includes its tab bar. That
 * inset is the source of truth. The floor exists so that if a future
 * navigator stops reporting the bar, the last row is padded rather than
 * hidden; it can only over-pad by the height of a home indicator.
 */
const NATIVE_TAB_BAR_FLOOR = 83;

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
  const { measuredHeight, nativeChrome } = useTabBarMetrics();
  if (nativeChrome) {
    // Do not add TAB_BAR_HEIGHT here: the inset is the bar. Adding the custom
    // bar's height on top produced a blank band above the system bar.
    return Math.max(insets.bottom, NATIVE_TAB_BAR_FLOOR) + Spacing.three;
  }
  const fallbackHeight = TAB_BAR_HEIGHT + Math.max(insets.bottom, Spacing.two);
  return (measuredHeight ?? fallbackHeight) + Spacing.three;
}
