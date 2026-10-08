/**
 * The thin line of a month's spending under Home's Spent figure: cumulative
 * spending by day (home-hero.ts), over the whole month so a month still
 * running ends part way across, with a dot on today. It draws itself once:
 * a clip window slides open from the start edge while the line inside holds
 * still (two opposite translateX on one native-driven value, no stroke
 * animation on the JS thread). Right to left mirrors it. Decorative: the
 * figure and its spoken label say the money.
 */
import React, { useMemo } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { sparklinePath, sparklinePoints } from '@/lib/home-hero';
import { isRTL } from '@/lib/i18n';

export const SPARKLINE_HEIGHT = 30;

export const HomeSparkline = React.memo(function HomeSparkline({ cumulative, monthDays, ceiling = 0, width, color, dotColor, progress, testID }: {
  cumulative: readonly number[];
  monthDays: number;
  /** The top of the box when it is above the month so far: the same days of last month. */
  ceiling?: number;
  width: number;
  color: string;
  dotColor: string;
  /** 0 hidden, 1 fully drawn: the window's opening, on the hero's clock. */
  progress: Animated.Value | Animated.AnimatedInterpolation<number> | Animated.AnimatedAddition<number>;
  testID?: string;
}) {
  // Inset by the dot's radius at both ends, so today's dot is never clipped.
  const points = useMemo(() => sparklinePoints(cumulative, monthDays, Math.max(0, width - 6), SPARKLINE_HEIGHT, 3, ceiling)
    .map((point) => ({ x: point.x + 3, y: point.y })), [cumulative, monthDays, width, ceiling]);
  const paint = useMemo(() => ({
    window: { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0], extrapolate: 'clamp' }) }] },
    line: { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [width, 0], extrapolate: 'clamp' }) }] },
  }), [progress, width]);
  if (points.length < 2 || width <= 0) return null;
  const last = points[points.length - 1]!;
  return <View testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    style={[styles.frame, { width }, isRTL() && styles.mirrored]}>
    <Animated.View style={[styles.window, { width }, paint.window]}>
      <Animated.View style={paint.line}>
        <Svg width={width} height={SPARKLINE_HEIGHT}>
          <Path d={sparklinePath(points)} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Circle cx={last.x} cy={last.y} r={3} fill={dotColor} />
        </Svg>
      </Animated.View>
    </Animated.View>
  </View>;
});

const styles = StyleSheet.create({
  frame: { height: SPARKLINE_HEIGHT, overflow: 'hidden', pointerEvents: 'none' },
  window: { height: SPARKLINE_HEIGHT, overflow: 'hidden' },
  mirrored: { transform: [{ scaleX: -1 }] },
});
