/**
 * Onboarding E's motion pieces (boards E1, E10, E11), each with its Reduce
 * Motion answer built in:
 *
 * - `StepWipe`: the next step's colour grows as a circle from the Continue
 *   button over 420ms (bezier .2,.8,.2,1). Under Reduce Motion, a running
 *   screen reader or on Android (whose measured motion bypasses stay) the
 *   layer is never drawn and the step simply cross-fades in.
 * - `LogoDraw`: Welcome's mark draws its stroke once; still otherwise.
 * - `useReplayKey`: remounts the example pattern every few seconds so its
 *   tiles pop in again, only while motion is allowed.
 *
 * Transform and opacity only; money is never animated here.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Motion } from '@/constants/theme';
import { useMotionPreference } from '@/hooks/use-reduced-motion';

export const E_EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
/** The wipe's length: a first appearance. */
export const WIPE_MS = Motion.appear;

/** Whether this device should run the E flourishes (not Android, not Reduce Motion, not a screen reader). */
export function useEMotion(): boolean {
  const motion = useMotionPreference();
  return motion.ready && !motion.reducedMotion && Platform.OS !== 'android';
}

/** The cross-fade every step enters with; the fallback for the wipe too. */
export function stepEntering(moving: boolean) {
  return moving ? FadeIn.duration(Motion.change).delay(Math.round(WIPE_MS * 0.45)) : FadeIn.duration(Motion.change);
}

/**
 * The colour wipe between two steps. Drawn above the previous colour and
 * below the new step's content, then removed; `onDone` fires once either way.
 */
export function StepWipe({ from, to, onDone, bottomOffset = 64 }: {
  from: string;
  to: string;
  onDone: () => void;
  /** Distance of the Continue button's centre from the bottom edge. */
  bottomOffset?: number;
}) {
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(0);
  const done = useRef(onDone);
  done.current = onDone;
  // The circle must reach the far top corner from the button's centre.
  const originX = width / 2;
  const originY = height - bottomOffset;
  const radius = Math.ceil(Math.hypot(Math.max(originX, width - originX), originY)) + 8;
  useEffect(() => {
    progress.value = withTiming(1, { duration: WIPE_MS, easing: E_EASE });
    const timer = setTimeout(() => done.current(), WIPE_MS + 20);
    return () => clearTimeout(timer);
  }, [progress]);
  const circle = useAnimatedStyle(() => ({ transform: [{ scale: Math.max(0.001, progress.value) }] }));
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFillObject, { backgroundColor: from, overflow: 'hidden' }]}>
    <Animated.View style={[{
      position: 'absolute', width: radius * 2, height: radius * 2, borderRadius: radius,
      left: originX - radius, top: originY - radius, backgroundColor: to,
    }, circle]} />
  </View>;
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
/** Longer than either stroke of the mark, so a full dash hides it. */
const LOGO_DASH = 60;

/** Wafra's mark (wafra-logo.tsx's geometry), drawing its stroke once when motion is allowed. */
export function LogoDraw({ size = 38, color }: { size?: number; color: string }) {
  const moving = useEMotion();
  const draw = useSharedValue(moving ? 0 : 1);
  useEffect(() => {
    if (!moving) { draw.value = 1; return; }
    draw.value = withDelay(100, withTiming(1, { duration: 1400, easing: E_EASE }));
  }, [draw, moving]);
  const stroke = useAnimatedProps(() => ({ strokeDashoffset: LOGO_DASH * (1 - draw.value) }));
  const common = {
    fill: 'none', stroke: color, strokeWidth: 4.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    strokeDasharray: `${LOGO_DASH} ${LOGO_DASH}`,
  };
  return <Svg width={size} height={size} viewBox="0 0 48 48" accessible={false}>
    <AnimatedPath d="M8 15 L15.5 33 L23 19 L30.5 33 L40 11.5" {...common} animatedProps={stroke} />
    <AnimatedPath d="M34 11.5 H40 V17.5" {...common} animatedProps={stroke} />
  </Svg>;
}

/** A key that changes every `periodMs` while motion is allowed, to replay a pop-in. */
export function useReplayKey(periodMs: number): number {
  const moving = useEMotion();
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => setKey((value) => value + 1), periodMs);
    return () => clearInterval(timer);
  }, [moving, periodMs]);
  return key;
}
