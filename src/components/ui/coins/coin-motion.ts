/**
 * Motion shared by Wafra's coin drawings (Spending's coin row, Home's budget
 * stack, a goal's jar, a transfer's route).
 *
 * Every coin moves on core Animated with the native driver, paint only
 * (opacity and transform), so Android animates without layout work. Reduce
 * Motion, or a running screen reader, puts every coin where it ends at once:
 * the drawing is never the only place a figure is written.
 */
import { useRef } from 'react';
import { Animated, Platform } from 'react-native';

import { MotionSpring } from '@/constants/theme';

export const nativeDriver = Platform.OS !== 'web';

/** A coin settling into place: quick, with one visible bounce. */
export const COIN_RISE = { stiffness: 240, damping: 15, mass: 0.9 } as const;
/** A tapped coin popping up: snappier, a little more overshoot. */
export const COIN_POP = { stiffness: 320, damping: 14, mass: 0.8 } as const;
/** A coin travelling or a stack changing level: the app's one spring, no wobble. */
export const COIN_MOVE = { ...MotionSpring, overshootClamping: true } as const;
/** Coins in a sequence start this far apart. */
export const COIN_STAGGER = 45;

/** One Animated.Value for the component's life, allocated once. */
export function useAnimatedNumber(initial: number): Animated.Value {
  const ref = useRef<Animated.Value | null>(null);
  if (!ref.current) ref.current = new Animated.Value(initial);
  return ref.current;
}
