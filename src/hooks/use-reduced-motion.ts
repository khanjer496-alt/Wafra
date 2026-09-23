/**
 * Whether animation should be suppressed for this user.
 *
 * Two different settings, one answer, because both mean "do not animate this":
 *
 * - Reduce Motion is the explicit request. Someone with vestibular sensitivity
 *   turned it on and every OS-level animation in the system respects it.
 * - A running screen reader is the implicit one. A figure that counts up from
 *   0 to 8,545 over 700ms re-renders its text ~60 times a second, and VoiceOver
 *   and TalkBack announce a changed value every time — the hero balance alone
 *   fires roughly forty announcements before it settles, and the user hears
 *   digits stuttering instead of their balance.
 *
 * Callers jump to the final value rather than dropping it. The information is
 * never the animation.
 *
 * The OS state is read ONCE for the whole app and shared through
 * `useSyncExternalStore`. Before this it was a `useState`/`useEffect` pair per
 * instance — every `SpringPressable`, `ProgressBar`, chart bar, sheet and
 * `MotionReveal` fired its own two native queries and registered its own two
 * listeners on mount, and each Home section stayed invisible until its OWN
 * screen-reader promise resolved. One query per app answers everyone, and the
 * answer is already known by the time the second screen mounts.
 */
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion as useReanimatedReducedMotion } from 'react-native-reanimated';

export interface MotionPreference {
  /** The app-wide policy: OS Reduce Motion or an active screen reader. */
  reducedMotion: boolean;
  /** Whether the asynchronous screen-reader state is known. */
  ready: boolean;
}

interface MotionSnapshot {
  reduced: boolean;
  screenReader: boolean;
  /** The screen-reader query has answered (or failed) or an event arrived. */
  known: boolean;
}

let snapshot: MotionSnapshot = { reduced: false, screenReader: false, known: false };
let started = false;
let reduceMotionEventSeen = false;
let screenReaderEventSeen = false;
const listeners = new Set<() => void>();

function update(patch: Partial<MotionSnapshot>): void {
  const next = { ...snapshot, ...patch };
  if (
    next.reduced === snapshot.reduced &&
    next.screenReader === snapshot.screenReader &&
    next.known === snapshot.known
  ) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Query the OS once and keep following it. Safe to call any number of times. */
export function startMotionPreference(): void {
  if (started) return;
  started = true;
  AccessibilityInfo.isReduceMotionEnabled()
    .then((value) => {
      if (!reduceMotionEventSeen) update({ reduced: value });
    })
    .catch(() => {});
  AccessibilityInfo.isScreenReaderEnabled()
    .then((value) => {
      if (!screenReaderEventSeen) update({ screenReader: value, known: true });
    })
    // A failed native query must not leave every reveal hidden forever.
    .catch(() => {
      if (!screenReaderEventSeen) update({ known: true });
    });
  // Never removed: the preference outlives every component.
  AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
    reduceMotionEventSeen = true;
    update({ reduced: value });
  });
  AccessibilityInfo.addEventListener('screenReaderChanged', (value) => {
    screenReaderEventSeen = true;
    update({ screenReader: value, known: true });
  });
}

function subscribe(listener: () => void): () => void {
  startMotionPreference();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): MotionSnapshot => snapshot;

function useMotionState(): MotionPreference {
  // Reanimated exposes the launch-time value synchronously, so an entering
  // animation cannot race the async AccessibilityInfo query on first paint.
  const launchReduced = useReanimatedReducedMotion();
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const motionReduced = launchReduced || state.reduced;
  return {
    reducedMotion: motionReduced || state.screenReader,
    // A positive Reduce Motion answer is already conclusive. When it is false,
    // wait for the screen-reader query before starting motion.
    ready: motionReduced || state.known,
  };
}

export function useMotionPreference(): MotionPreference {
  return useMotionState();
}

export function useReducedMotion(): boolean {
  return useMotionState().reducedMotion;
}
