import { Tabs } from 'expo-router';
import React from 'react';

import { WafraTabBar } from '@/components/tab-bar';
import { useAutoImport } from '@/hooks/use-auto-import';
import { useHistoryImport } from '@/hooks/use-history-import';

/**
 * Capture belongs to the signed-in tab shell, not to whichever tab happened
 * to render first. Android can restore directly onto Bills/Flow/Wallet after
 * an app update; mounting the parser migration only inside Home left those
 * sessions showing the old ledger indefinitely.
 *
 * Status rendering remains on Home. This owner watches launch/foreground and
 * owns the once-per-session notification work without creating a second UI.
 */
function CaptureOwner() {
  useHistoryImport();
  useAutoImport(true, false);
  return null;
}

/**
 * No `detachInactiveScreens` override here, and it is not an oversight.
 *
 * Setting it to false was tried and it made Android worse, not better, by a
 * wide margin. Signed Release builds, same emulator, warm and reseeded, A/B/A
 * so the control ran on both sides of the change:
 *
 *   default (detaching on)   7/7 janky, p50 81ms, p90 129ms
 *                            8/8 janky, p50 69ms, p90 150ms
 *   detachInactiveScreens=0  8/8 janky, p50 500ms, p90 2050ms
 *                            8/8 janky, p50 200ms, p90 500ms   (+22.7MB PSS)
 *
 * Three to seven times slower and 22.7MB heavier. Keeping every visited tab's
 * native views resident and toggling `display` does not avoid the work — it
 * hands Android four full view trees to lay out and composite instead of one,
 * and the fragment transaction it was meant to dodge was never the dominant
 * cost anyway.
 *
 * The cost systrace actually points at lives in the tab screens themselves:
 * after the tap, ~33 frames run animation callbacks and draw nothing, and the
 * window matches the tab screens' own entering animations rather than anything
 * this file configures. See `src/hooks/use-screen-entering.ts` — that is where
 * the fix is, and `scripts/test/perf-config.test.js` is what keeps both halves
 * honest.
 */
export default function TabsLayout() {
  return (
    <>
      <CaptureOwner />
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <WafraTabBar {...props} />}>
        <Tabs.Screen name="index" />
        <Tabs.Screen name="flow" />
        <Tabs.Screen name="bills" />
        <Tabs.Screen name="wallet" />
      </Tabs>
    </>
  );
}
