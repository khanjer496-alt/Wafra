import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Radius } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { isRTL } from '@/lib/i18n';

const FILL_SPRING = {
  damping: 24,
  stiffness: 260,
  mass: 0.82,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
} as const;

export interface ProgressBarProps {
  /** 0..1; values above 1 are clamped but can switch the color to danger. */
  ratio: number;
  color: string;
  height?: number;
  trackColor?: string;
  accessibilityLabel?: string;
}

export function ProgressBar({
  ratio,
  color,
  height = 8,
  trackColor,
  accessibilityLabel,
}: ProgressBarProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(ratio, 1));
  const animatedRatio = useSharedValue(reducedMotion ? clamped : 0);

  useEffect(() => {
    animatedRatio.value = reducedMotion ? clamped : withSpring(clamped, FILL_SPRING);
  }, [animatedRatio, clamped, reducedMotion]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: animatedRatio.value }],
  }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[
        styles.track,
        { backgroundColor: trackColor ?? theme.track, height, borderRadius: height / 2 },
      ]}>
      <Animated.View
        style={[
          styles.fill,
          {
            backgroundColor: color,
            borderRadius: height / 2,
            transformOrigin: isRTL() ? 'right center' : 'left center',
          },
          fillStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    overflow: 'hidden',
    borderRadius: Radius.full,
  },
  fill: {
    height: '100%',
    width: '100%',
  },
});
