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
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion as useReanimatedReducedMotion } from 'react-native-reanimated';

export interface MotionPreference {
  /** The app-wide policy: OS Reduce Motion or an active screen reader. */
  reducedMotion: boolean;
  /** Whether the asynchronous screen-reader state is known. */
  ready: boolean;
}

function useMotionState(trackReadiness: boolean): MotionPreference {
  // Reanimated exposes the launch-time value synchronously, so an entering
  // animation cannot race the async AccessibilityInfo query on first paint.
  const launchReduced = useReanimatedReducedMotion();
  const [motionReduced, setMotionReduced] = useState(launchReduced);
  const [screenReader, setScreenReader] = useState(false);
  const [screenReaderKnown, setScreenReaderKnown] = useState(false);
  const reduceMotionEventSeen = useRef(false);
  const screenReaderEventSeen = useRef(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive && !reduceMotionEventSeen.current) setMotionReduced(value);
      })
      .catch(() => {});
    AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => {
        if (alive && !screenReaderEventSeen.current) {
          setScreenReader(value);
          if (trackReadiness) setScreenReaderKnown(true);
        }
      })
      // A failed native query must not leave every reveal hidden forever.
      .catch(() => {
        if (alive && trackReadiness && !screenReaderEventSeen.current) {
          setScreenReaderKnown(true);
        }
      });

    const subs = [
      AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
        reduceMotionEventSeen.current = true;
        setMotionReduced(value);
      }),
      AccessibilityInfo.addEventListener('screenReaderChanged', (value) => {
        screenReaderEventSeen.current = true;
        setScreenReader(value);
        if (trackReadiness) setScreenReaderKnown(true);
      }),
    ];
    return () => {
      alive = false;
      subs.forEach((s) => s.remove());
    };
  }, [trackReadiness]);

  return {
    reducedMotion: motionReduced || screenReader,
    // Reanimated's synchronous positive value is already conclusive. When it
    // is false, wait for the screen-reader query before starting motion.
    ready: motionReduced || (trackReadiness && screenReaderKnown),
  };
}

export function useMotionPreference(): MotionPreference {
  return useMotionState(true);
}

export function useReducedMotion(): boolean {
  // Existing consumers only need the policy boolean. Not tracking readiness
  // avoids a no-op first-load render when the async query answers `false`.
  return useMotionState(false).reducedMotion;
}
