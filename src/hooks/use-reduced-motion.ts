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
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion as useReanimatedReducedMotion } from 'react-native-reanimated';

export function useReducedMotion(): boolean {
  // Reanimated exposes the launch-time value synchronously, so an entering
  // animation cannot race the async AccessibilityInfo query on first paint.
  const launchReduced = useReanimatedReducedMotion();
  const [motionReduced, setMotionReduced] = useState(launchReduced);
  const [screenReader, setScreenReader] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setMotionReduced(value);
      })
      .catch(() => {});
    AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => {
        if (alive) setScreenReader(value);
      })
      .catch(() => {});

    const subs = [
      AccessibilityInfo.addEventListener('reduceMotionChanged', setMotionReduced),
      AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader),
    ];
    return () => {
      alive = false;
      subs.forEach((s) => s.remove());
    };
  }, []);

  return motionReduced || screenReader;
}
