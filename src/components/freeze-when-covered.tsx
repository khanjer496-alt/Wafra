import React, { Suspense, useEffect, useRef, useState } from 'react';

import { COVER_FREEZE_DELAY_MS } from '@/lib/covered-screen-freeze';

/**
 * Suspends its children without unmounting them: state is kept, but React does
 * not render them again until they are released. This is the technique
 * react-freeze (used by react-native-screens) is built on, kept small and local
 * so no dependency is added.
 *
 * Throwing a promise during render is the mechanism, hence the opt-out of the
 * React Compiler for this one component.
 */
export function FreezeSuspender({ freeze, children }: { freeze: boolean; children: React.ReactNode }) {
  'use no memo';
  const pending = useRef<{ promise?: Promise<void>; resolve?: () => void }>({});
  if (freeze) {
    if (!pending.current.promise) {
      pending.current.promise = new Promise<void>((resolve) => { pending.current.resolve = resolve; });
    }
    throw pending.current.promise;
  }
  if (pending.current.promise) {
    pending.current.resolve?.();
    pending.current.promise = undefined;
    pending.current.resolve = undefined;
  }
  return <>{children}</>;
}

/**
 * Pauses `children` while `covered` (another screen is on top). The freeze waits
 * `delayMs` so the screen stays painted for the push animation; uncovering
 * releases it in the same render, so the first frame back is current.
 * `enabled` false renders the children untouched (iOS and web today).
 */
export function FreezeWhenCovered({
  covered,
  enabled,
  delayMs = COVER_FREEZE_DELAY_MS,
  children,
}: {
  covered: boolean;
  enabled: boolean;
  delayMs?: number;
  children: React.ReactNode;
}) {
  const [frozen, setFrozen] = useState(false);
  useEffect(() => {
    if (!enabled || !covered) {
      setFrozen(false);
      return undefined;
    }
    const timer = setTimeout(() => setFrozen(true), delayMs);
    return () => clearTimeout(timer);
  }, [covered, enabled, delayMs]);
  if (!enabled) return <>{children}</>;
  return (
    <Suspense fallback={null}>
      <FreezeSuspender freeze={frozen && covered}>{children}</FreezeSuspender>
    </Suspense>
  );
}
