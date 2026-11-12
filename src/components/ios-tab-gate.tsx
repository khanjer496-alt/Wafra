import { useIsFocused, useNavigation, useNavigationState, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { useCoverFreeze, type CoverTransitionNavigation, type CoverTransitionSource } from '@/components/freeze-when-covered';
import { runAfterFirstFrames } from '@/lib/after-first-frames';
import { gateTabsUntilFocus } from '@/lib/covered-screen-freeze';
import { StorePauseBoundary } from '@/lib/store';
import { scheduleTabPrewarm } from '@/lib/tab-prewarm';

/**
 * Pauses a covered tab on the store: it stays mounted and visible to the native
 * tab view, but store changes re-render and recompute nothing below it. When
 * the tab is shown again, the first frames are the frame it was paused on (no
 * catch-up work on the tap); it catches up with the store after those frames.
 */
function PauseWhenCovered({
  covered,
  delayMs,
  transitions,
  fallback,
  children,
}: {
  covered: boolean;
  delayMs?: number;
  transitions: CoverTransitionSource | null;
  fallback: boolean;
  children: React.ReactNode;
}) {
  const frozen = useCoverFreeze({ covered, enabled: true, delayMs, transitions, fallback });
  const pausedNow = frozen && covered;
  const [held, setHeld] = useState(false);
  // Derived during render, so the first paused render already holds.
  if (pausedNow && !held) setHeld(true);
  useEffect(() => {
    if (!held || pausedNow) return undefined;
    const resume = runAfterFirstFrames(() => setHeld(false), { delayMs: 0, idle: false });
    return () => resume.cancel();
  }, [held, pausedNow]);
  return <StorePauseBoundary paused={held}>{children}</StorePauseBoundary>;
}

/**
 * Renders nothing until the tab is first focused or pre-warmed (once, when the
 * app is idle after launch), then keeps the content mounted (state and scroll
 * position survive) and pauses it on the store whenever the tab is unfocused:
 * another tab is selected, or a pushed screen covers the tab shell.
 */
export function TabFocusGate({
  focused,
  selected = focused,
  transitions,
  delayMs,
  prewarm = true,
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
  /** Mount once when the app is idle after launch, before the first focus. */
  prewarm?: boolean;
  children: React.ReactNode;
}) {
  const [visited, setVisited] = useState(focused);
  // Derived from props during render (React's documented pattern), so the
  // first focused render already shows the content instead of a blank frame.
  if (focused && !visited) setVisited(true);
  useEffect(() => {
    if (visited || !prewarm) return undefined;
    const job = scheduleTabPrewarm(() => setVisited(true));
    return () => job.cancel();
  }, [visited, prewarm]);
  if (!visited && !focused) return null;
  return (
    <PauseWhenCovered covered={!focused} delayMs={delayMs}
      transitions={selected ? transitions ?? null : null} fallback={!selected}>
      {children}
    </PauseWhenCovered>
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
    const shell = useNavigation().getParent<CoverTransitionNavigation | undefined>();
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
