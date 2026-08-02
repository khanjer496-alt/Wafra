/**
 * The entering animation for a view that lives directly inside a tab screen —
 * or `undefined` on Android, where it is not an entrance but a stall.
 *
 * The four tab screens sit under react-navigation's `bottom-tabs`, which
 * defaults `detachInactiveScreens` to true on Android. Every tab switch there
 * runs a `commitNowAllowingStateLoss()` FragmentTransaction:
 * `transaction.remove()` on the tab you left, `transaction.add()` on the one
 * you opened. `ScreenFragment.onCreateView` re-wraps the same `Screen` view via
 * `screen.recycle()`, so React does not remount and component state survives —
 * but the native view subtree is detached from the window and re-attached, and
 * a Reanimated entering animation can start again on that path even though no
 * React mount happened.
 *
 * Measured on a signed Release build (emulator-5554, systrace on the default
 * detaching path): the tab's ACTION_UP lands, then ~33 consecutive
 * `Choreographer#doFrame` slices run animation callbacks with *no traversal* —
 * nothing is measured, laid out or drawn — and the first traversal/draw arrives
 * 548ms after the tap. Returning to the previous tab cost another 182ms. The
 * durations line up with what these screens actually ask for: Home and Flow
 * stagger `FadeInDown` to delay 120 + duration 320 = 440ms, Wallet's net-worth
 * columns reach 5 x 45 + 360 = 585ms, and Bills' recurring rows reach
 * min(i, 8) x 40 + 300 = 620ms. So more than half a second of a tab switch is
 * an entrance the user did not ask to watch a second time.
 *
 * Removing the config is the whole fix. `undefined` means Reanimated never
 * registers a layout animation for the view, so there is nothing to replay and
 * nothing to hold the first frame back. It costs no state, no timers and no
 * extra renders — the alternative, clearing `entering` after the first
 * entrance, needs a completion callback or a timeout per animated view and
 * still pays the stall on the tab's first visit.
 *
 * iOS keeps the animation. `UINavigationController`-backed screens there are
 * not torn off the window on a tab switch, and iOS Release interactions were
 * verified immediate on this build, so there is no reason to spend the motion.
 *
 * Reduce Motion is honoured on both platforms. Flow and Bills were not checking
 * it before this hook existed; routing every tab-screen entrance through one
 * place fixed that as a side effect.
 *
 * Scope is deliberate: this is for screens whose native views get detached and
 * re-attached under them. Sheets, modals and pushed stack screens are mounted
 * and unmounted for real, so their entrances mean what they say — they keep
 * using {@link useReducedMotion} directly.
 */
import { useCallback } from 'react';
import { Platform } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

export function useScreenEntering() {
  const reducedMotion = useReducedMotion();
  // Generic rather than typed against Reanimated's builder union: the call site
  // already knows what it built, and passing the type straight through keeps
  // `entering={enter(FadeInDown.duration(320))}` checked exactly as tightly as
  // `entering={FadeInDown.duration(320)}` was.
  return useCallback(
    <T>(animation: T): T | undefined =>
      Platform.OS === 'android' || reducedMotion ? undefined : animation,
    [reducedMotion],
  );
}
