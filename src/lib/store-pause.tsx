import React, { useContext, useLayoutEffect, useRef, type Context } from 'react';

import { createHeldHandle, type HeldStoreHandle, type StoreHandle } from '@/lib/store-selection';

/**
 * Builds a component that pauses everything below it on a store while
 * `paused`, without hiding or unmounting it. Consumers of `valueContext`
 * (useStore) and of `handleContext` (useStoreSelector) below see the value
 * they last rendered, so store changes re-render and recompute nothing and the
 * native views keep showing their last frame. When `paused` turns false, that
 * same render reads the live store, and selectors that did not re-render are
 * told after commit.
 *
 * `mustBeLive(live, held)` true lets a change through at once even while
 * paused (store.tsx uses appStoreMustBeLive below), so a held frame never
 * shows something the user just hid or erased.
 *
 * Concurrency: hold() and resume() flip the handle during render, so a render
 * of an EXISTING boundary that React discards (a transition or a Suspense
 * retry) could leave it held while the committed UI is live. That can't
 * happen today: store dispatches and navigation focus are never transitions,
 * and the only transition that reaches a boundary is a tab's pre-warm mount
 * (ios-tab-gate.tsx), whose boundary is new and leaves nothing behind if
 * discarded. Even so, the boundary reads the value context, so the next store
 * change re-renders it and puts the handle right. Keep store dispatches out of
 * startTransition (store.tsx relies on that for its handle too).
 */
export function createStorePauseBoundary<T>(
  valueContext: Context<T | null>,
  handleContext: Context<StoreHandle<T> | null>,
  mustBeLive: (live: T, held: T) => boolean = () => false,
) {
  function StorePauseBoundary({ paused, children }: { paused: boolean; children: React.ReactNode }) {
    'use no memo';
    const live = useContext(valueContext);
    const source = useContext(handleContext);
    if (live === null || !source) throw new Error('StorePauseBoundary must be used within StoreProvider');
    const slot = useRef<{ source: StoreHandle<T>; handle: HeldStoreHandle<T>; value: T; resumed: boolean } | null>(null);
    if (!slot.current || slot.current.source !== source) {
      slot.current = { source, handle: createHeldHandle(source), value: live, resumed: false };
    }
    const current = slot.current;
    const hold = paused && !mustBeLive(live, current.value);
    if (hold) {
      if (!current.handle.held) current.handle.hold(current.value);
    } else {
      if (current.handle.held) {
        current.handle.resume();
        current.resumed = true;
      }
      current.value = live;
    }
    useLayoutEffect(() => {
      if (hold || !current.resumed) return;
      current.resumed = false;
      current.handle.notify();
    });
    const HandleProvider = handleContext.Provider;
    const ValueProvider = valueContext.Provider;
    return (
      <HandleProvider value={current.handle}>
        <ValueProvider value={hold ? current.value : live}>{children}</ValueProvider>
      </HandleProvider>
    );
  }
  return StorePauseBoundary;
}

/** The part of the app store that decides what may never be held back. */
interface PauseCriticalStore {
  state: {
    privateMode: boolean;
    onboarded: boolean;
    hydrated: boolean;
    transactions: readonly unknown[];
  };
}

/**
 * The app store's pass-through rule (store.tsx). These changes reach a paused
 * tab at once:
 * - Private Mode, so a held frame never shows amounts the user just hid;
 * - `onboarded` and `hydrated`, which change around a reset and restore (Erase
 *   Everything then blocks persistence, `hydrated` false, and OnboardingGate
 *   unmounts the tabs);
 * - a ledger emptied by Erase Everything (clearAll keeps `onboarded`), so even
 *   before that gate runs, a held tab never shows the erased entries.
 */
export function appStoreMustBeLive(live: PauseCriticalStore, held: PauseCriticalStore): boolean {
  return live.state.privateMode !== held.state.privateMode ||
    live.state.onboarded !== held.state.onboarded ||
    live.state.hydrated !== held.state.hydrated ||
    (live.state.transactions.length === 0 && held.state.transactions.length > 0);
}
