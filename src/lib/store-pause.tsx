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
 * paused (store.tsx: Private Mode and onboarding/Erase Everything), so a held
 * frame never shows something the user just hid or erased.
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
