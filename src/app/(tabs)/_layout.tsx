import { Tabs } from 'expo-router';
import React from 'react';

import { WafraTabBar } from '@/components/tab-bar';

/**
 * Why `detachInactiveScreens` is off.
 *
 * Measured on a signed Release build (emulator-5554, commit 39bd99c): once all
 * four tabs are mounted, every warm tab tap renders exactly ONE frame and that
 * frame misses — 8/8 missed, p50 73-77ms, p90 97-113ms, repeated twice. Cold
 * start was unchanged (2081ms vs 2073ms control) and Home scrolling was fine
 * (13.1% missed, against 57.3% for the system Settings app on the same
 * emulator). So the cost is not startup, not the list, and not the shadows: it
 * is one long synchronous block on the UI thread per tap.
 *
 * That is exactly what react-navigation's default does here. `bottom-tabs`
 * defaults `detachInactiveScreens` to true on Android, and since our tab
 * `animation` is the default `none`, a blurred screen is moved straight to
 * activityState 0 with no interpolation. react-native-screens then reacts to
 * that in ScreenContainer.onUpdate by building a FragmentTransaction that
 * calls `transaction.remove(fragment)` on the tab you left and
 * `transaction.add(id, fragment)` on the tab you opened, and commits it with
 * `commitNowAllowingStateLoss()` — synchronously, on the UI thread, inside the
 * tap's frame. `remove` is not `detach`: it destroys the outgoing screen's
 * entire native View hierarchy and rebuilds the incoming one's from scratch.
 * Our tab screens are 1187-1423 lines each, so that is hundreds of Android
 * Views torn down and re-inflated per tap. One long UI-thread frame, which is
 * the shape we measured.
 *
 * Passing false makes react-native-screens render a plain View for the
 * container and a plain Animated.View per screen, toggling `display` between
 * 'none' and 'flex'. The fragment machinery — and the whole synchronous
 * transaction — is never constructed. Switching tabs becomes two style
 * updates on views that already exist.
 *
 * The tradeoff, stated plainly: every tab the user has visited keeps its
 * native views resident instead of only the focused one, so steady-state
 * memory is higher. `lazy` is still the default true, so a tab costs nothing
 * until it is opened once, and cold start is unaffected.
 *
 * Not paired with `freezeOnBlur`, deliberately. In react-native-screens 4.23.0
 * the react-freeze wrapper lives only inside the `enabled && native` branch of
 * InnerScreen, so with detaching off `freezeOnBlur` silently does nothing —
 * setting it would read as configured and have no effect. It is also off by
 * default today (ENABLE_FREEZE is false and the app never calls enableFreeze),
 * so nothing that was running is being turned off here, and freezing is a
 * JS-thread remedy for a UI-thread cost regardless.
 */
export default function TabsLayout() {
  return (
    <Tabs
      detachInactiveScreens={false}
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <WafraTabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="flow" />
      <Tabs.Screen name="bills" />
      <Tabs.Screen name="wallet" />
    </Tabs>
  );
}
