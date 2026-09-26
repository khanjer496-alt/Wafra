import React, { useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useMotionPreference } from '@/hooks/use-reduced-motion';

/**
 * A bar that grows into place once, then eases to new values.
 *
 * Wafra's motion rules: first appearance 420 ms on the standard curve,
 * staggered by the caller's `delay`; later changes spring gently; Reduce
 * Motion or an active screen reader shows the final size at once. The value
 * is never the animation — the bar's size is always the figure's size.
 *
 * `axis: 'width'` takes a percentage (0–100) so right-to-left layouts fill
 * from the correct edge without special cases; `axis: 'height'` takes points.
 */
const FIRST = { duration: 420, easing: Easing.bezier(0.2, 0.8, 0.2, 1), reduceMotion: ReduceMotion.System } as const;
const CHANGE = { damping: 24, stiffness: 260, mass: 0.9, overshootClamping: true, reduceMotion: ReduceMotion.System } as const;

export function GrowBar({ size, axis, delay = 0, style }: {
  size: number;
  axis: 'width' | 'height';
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { ready, reducedMotion } = useMotionPreference();
  const shown = useRef(false);
  const value = useSharedValue(reducedMotion ? size : 0);

  useEffect(() => {
    if (reducedMotion) {
      shown.current = true;
      value.value = size;
      return;
    }
    // Hold still until the screen-reader state is known (see use-reduced-motion).
    if (!ready) return;
    if (!shown.current) {
      shown.current = true;
      value.value = withDelay(delay, withTiming(size, FIRST));
      return;
    }
    value.value = withSpring(size, CHANGE);
  }, [delay, ready, reducedMotion, size, value]);

  const animated = useAnimatedStyle(() =>
    axis === 'width' ? { width: `${value.value}%` } : { height: value.value });
  return <Animated.View style={[style, animated]} />;
}
