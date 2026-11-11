import { useIsFocused } from '@react-navigation/native';
import React, { useState } from 'react';
import { Platform } from 'react-native';

import { FreezeWhenCovered } from '@/components/freeze-when-covered';
import { gateTabsUntilFocus } from '@/lib/covered-screen-freeze';

/**
 * Renders nothing until the tab is first focused, then keeps the content
 * mounted (state and scroll position survive) and pauses it whenever the tab
 * is unfocused: another tab is selected, or a pushed screen covers the tab
 * shell. Refocusing renders it once from the current store.
 */
export function TabFocusGate({ focused, children }: { focused: boolean; children: React.ReactNode }) {
  const [visited, setVisited] = useState(focused);
  // Derived from props during render (React's documented pattern), so the
  // first focused render already shows the content instead of a blank frame.
  if (focused && !visited) setVisited(true);
  if (!visited && !focused) return null;
  return (
    <FreezeWhenCovered covered={!focused} enabled>
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
    return (
      <TabFocusGate focused={focused}>
        <Screen {...props} />
      </TabFocusGate>
    );
  }
  GatedTab.displayName = `IosTabGate(${Screen.displayName ?? Screen.name ?? 'Tab'})`;
  return GatedTab;
}
