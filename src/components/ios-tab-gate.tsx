import { useIsFocused, useNavigation, useNavigationState, useRoute } from '@react-navigation/native';
import React, { useState } from 'react';
import { Platform } from 'react-native';

import { FreezeWhenCovered, type CoverTransitionSource } from '@/components/freeze-when-covered';
import { gateTabsUntilFocus } from '@/lib/covered-screen-freeze';

/**
 * Renders nothing until the tab is first focused, then keeps the content
 * mounted (state and scroll position survive) and pauses it whenever the tab
 * is unfocused: another tab is selected, or a pushed screen covers the tab
 * shell. Refocusing renders it once from the current store.
 */
export function TabFocusGate({
  focused,
  selected = focused,
  transitions,
  delayMs,
  children,
}: {
  focused: boolean;
  /**
   * This tab is the one the tab bar shows. It is then covered only when the
   * whole shell is (a push, or a page sheet that keeps it visible), so it never
   * freezes on the timer, only when a covering push has ended, and only it
   * listens to the shell's transitions: a swipe-back must not wake the hidden
   * sibling tabs. A tab left for a sibling has no transition and uses the timer.
   */
  selected?: boolean;
  /** The tab shell's route in the root stack, for push/swipe-back timing. */
  transitions?: CoverTransitionSource | null;
  delayMs?: number;
  children: React.ReactNode;
}) {
  const [visited, setVisited] = useState(focused);
  // Derived from props during render (React's documented pattern), so the
  // first focused render already shows the content instead of a blank frame.
  if (focused && !visited) setVisited(true);
  if (!visited && !focused) return null;
  return (
    <FreezeWhenCovered covered={!focused} enabled delayMs={delayMs}
      transitions={selected ? transitions : null} fallback={!selected}>
      {children}
    </FreezeWhenCovered>
  );
}

/**
 * Wraps a tab route's screen on iOS only. Android and web get the very same
 * component back, so their behavior and the screen's own tests are unchanged.
 * Capture and History are never gated: they run in the tab shell's
 * CaptureOwner (app-tabs-layout.ios.tsx), outside every tab.
 */
export function withIosTabGate<P extends object>(Screen: React.ComponentType<P>): React.ComponentType<P> {
  if (!gateTabsUntilFocus(Platform.OS)) return Screen;
  function GatedTab(props: P) {
    const focused = useIsFocused();
    // The tab's parent is the tab shell's route in the root stack. Its events
    // time the freeze under a push and release it as a swipe-back begins. A
    // switch between tabs sends none; the gate's fallback delay covers that.
    const shell = useNavigation().getParent();
    // The tab bar's current tab, from the NativeTabs navigator state.
    const ownKey = useRoute().key;
    const selected = useNavigationState((state) => state.routes[state.index]?.key) === ownKey;
    return (
      <TabFocusGate focused={focused} selected={selected} transitions={shell ?? null}>
        <Screen {...props} />
      </TabFocusGate>
    );
  }
  GatedTab.displayName = `IosTabGate(${Screen.displayName ?? Screen.name ?? 'Tab'})`;
  return GatedTab;
}
