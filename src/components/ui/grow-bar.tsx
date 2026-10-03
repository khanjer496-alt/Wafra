import React, { useEffect, useRef } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
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

interface GrowBarProps {
  size: number;
  axis: 'width' | 'height';
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

export function GrowBar(props: GrowBarProps) {
  const motion = useMotionPreference();
  // A bypass must bypass the animation engine itself. Updating a shared
  // value in an effect left Android's bar at its initial zero size until
  // remount, even though its amount label had already updated.
  if (Platform.OS === 'android' || motion.reducedMotion) {
    const dimension: ViewStyle = props.axis === 'width' ? { width: `${props.size}%` } : { height: props.size };
    return <View style={[props.style, dimension]} />;
  }
  return <AnimatedGrowBar {...props} ready={motion.ready} />;
}

/** Keep animation hooks in their own component so switching to static is immediate. */
function AnimatedGrowBar({ size, axis, delay = 0, style, ready }: GrowBarProps & { ready: boolean }) {
  const shown = useRef(false);
  const value = useSharedValue(0);

  useEffect(() => {
    // Hold still until the screen-reader state is known (see use-reduced-motion).
    if (!ready) return;
    if (!shown.current) {
      shown.current = true;
      value.value = withDelay(delay, withTiming(size, FIRST));
      return;
    }
    value.value = withSpring(size, CHANGE);
  }, [delay, ready, size, value]);

  const animated = useAnimatedStyle(() =>
    axis === 'width' ? { width: `${value.value}%` } : { height: value.value });
  return <Animated.View style={[style, animated]} />;
}
