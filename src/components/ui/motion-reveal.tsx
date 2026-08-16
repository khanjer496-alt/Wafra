import React, { useEffect, useRef } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Extrapolation,
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';

import { useMotionPreference } from '@/hooks/use-reduced-motion';

const REVEAL_SPRING = {
  damping: 22,
  stiffness: 220,
  mass: 0.82,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
} as const;

interface MotionRevealProps {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  scaleFrom?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A one-shot reveal that animates paint properties instead of native layout.
 *
 * Android detaches inactive tab views. Reanimated entering layout animations
 * can replay on that attach path and hold back the first draw; this shared
 * value survives it, so the reveal is visible once and every later tab switch
 * is immediate.
 */
export const MotionReveal = ({
  children,
  delay = 0,
  distance = 18,
  scaleFrom = 0.97,
  style,
}: MotionRevealProps) => {
  const { ready, reducedMotion } = useMotionPreference();
  const revealed = useRef(false);
  const progress = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      revealed.current = true;
      progress.value = 1;
      return;
    }
    // Screen-reader state arrives asynchronously. Keep the content still
    // until it is known so TalkBack/VoiceOver can never catch the first frame
    // of a reveal that should have been suppressed.
    if (!ready) return;
    if (revealed.current) return;
    revealed.current = true;
    progress.value = withDelay(
      delay,
      withSpring(1, REVEAL_SPRING),
      ReduceMotion.System,
    );
  }, [delay, progress, ready, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    const value = interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: value,
      transform: [
        { translateY: (1 - value) * distance },
        { scale: scaleFrom + (1 - scaleFrom) * value },
      ],
    };
  });

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
};
