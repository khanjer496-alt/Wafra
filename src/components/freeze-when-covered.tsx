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

/** The root stack's per-route transition events (a React Navigation `navigation` object). */
export interface CoverTransitionSource {
  addListener(
    type: 'transitionStart' | 'transitionEnd',
    listener: (event: { data?: { closing?: boolean } }) => void,
  ): () => void;
}

/**
 * Pauses `children` while `covered` (another screen is on top).
 *
 * With `transitions` (the covered route's navigation in the root stack), it
 * freezes when the covering push has ENDED (`transitionEnd`, closing), so a
 * slow push never blanks a screen that is still sliding; and it releases when
 * the screen WILL appear (`transitionStart`, not closing), which is the start
 * of an iOS swipe-back, so the screen is never blank during the gesture. A
 * cancelled gesture re-freezes on its own `transitionEnd`.
 *
 * `delayMs` is only a fallback for covering that sends no stack transition
 * (switching tabs), or a push whose events never arrive. A push that has
 * started suppresses it until that push ends. `fallback` false turns it off,
 * for a screen that may stay visible while covered without any transition
 * (behind an iOS page-sheet modal): it then freezes only on a real push end.
 *
 * Uncovering always releases in the same render, so the first frame back is
 * current. `enabled` false renders the children untouched (web).
 */
export function FreezeWhenCovered({
  covered,
  enabled,
  delayMs = COVER_FREEZE_DELAY_MS,
  transitions,
  fallback = true,
  children,
}: {
  covered: boolean;
  enabled: boolean;
  delayMs?: number;
  transitions?: CoverTransitionSource | null;
  fallback?: boolean;
  children: React.ReactNode;
}) {
  const [frozen, setFrozen] = useState(false);
  // A covering push has started and not ended yet: the fallback must wait.
  const pushInProgress = useRef(false);
  useEffect(() => {
    if (!enabled || !transitions) return undefined;
    const removeStart = transitions.addListener('transitionStart', (event) => {
      if (event.data?.closing) {
        pushInProgress.current = true;
      } else {
        pushInProgress.current = false;
        setFrozen(false);
      }
    });
    const removeEnd = transitions.addListener('transitionEnd', (event) => {
      if (!event.data?.closing) return;
      pushInProgress.current = false;
      setFrozen(true);
    });
    return () => {
      removeStart();
      removeEnd();
    };
  }, [enabled, transitions]);
  useEffect(() => {
    if (!enabled || !covered) {
      pushInProgress.current = false;
      setFrozen(false);
      return undefined;
    }
    if (!fallback) return undefined;
    const timer = setTimeout(() => {
      if (!pushInProgress.current) setFrozen(true);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [covered, enabled, delayMs, fallback]);
  if (!enabled) return <>{children}</>;
  return (
    <Suspense fallback={null}>
      <FreezeSuspender freeze={frozen && covered}>{children}</FreezeSuspender>
    </Suspense>
  );
}
