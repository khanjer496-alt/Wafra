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

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    const apply = (values: boolean[]) => {
      if (alive) setReduced(values.some(Boolean));
    };

    Promise.all([
      AccessibilityInfo.isReduceMotionEnabled(),
      AccessibilityInfo.isScreenReaderEnabled(),
    ])
      .then(apply)
      .catch(() => {
        // Web and older platforms may not implement either query. Animating is
        // the safe default there; it is what every user got before this hook.
      });

    const subs = [
      AccessibilityInfo.addEventListener('reduceMotionChanged', (v) =>
        setReduced((prev) => v || prev),
      ),
      AccessibilityInfo.addEventListener('screenReaderChanged', (v) =>
        setReduced((prev) => v || prev),
      ),
    ];
    return () => {
      alive = false;
      subs.forEach((s) => s.remove());
    };
  }, []);

  return reduced;
}
