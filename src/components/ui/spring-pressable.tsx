import React, { useCallback, useEffect } from 'react';
import {
  Platform,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PRESS_IN = {
  damping: 22,
  stiffness: 420,
  mass: 0.55,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
} as const;

const PRESS_OUT = {
  damping: 18,
  stiffness: 280,
  mass: 0.65,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
} as const;

interface SpringPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  opacityTo?: number;
}

/**
 * Shared tactile feedback for surfaces that behave like physical objects.
 *
 * The spring runs on the UI thread and can be interrupted halfway through,
 * which keeps quick taps from queuing an "in" animation behind an "out" one.
 * Reduce Motion retains an immediate opacity cue without moving the surface.
 */
export const SpringPressable = ({
  ...props
}: SpringPressableProps) => {
  if (Platform.OS === 'android') {
    return <AndroidPressable {...props} />;
  }
  return <AnimatedSpringPressable {...props} />;
};

const AndroidPressable = ({
  disabled,
  onPressIn,
  onPressOut,
  opacityTo = 0.88,
  scaleTo: _scaleTo,
  style,
  ...props
}: SpringPressableProps) => (
  <Pressable
    {...props}
    disabled={disabled}
    onPressIn={onPressIn}
    onPressOut={onPressOut}
    style={({ pressed }) => [
      style,
      { opacity: pressed && !disabled ? opacityTo : 1 },
    ]}
  />
);

const AnimatedSpringPressable = ({
  disabled,
  onPressIn,
  onPressOut,
  opacityTo = 0.88,
  scaleTo = 0.975,
  style,
  ...props
}: SpringPressableProps) => {
  const reducedMotion = useReducedMotion();
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pressed.value, [0, 1], [1, opacityTo]),
    transform: [
      {
        scale: reducedMotion
          ? 1
          : interpolate(pressed.value, [0, 1], [1, scaleTo]),
      },
    ],
  }));

  useEffect(() => {
    if (disabled) pressed.value = 0;
  }, [disabled, pressed]);

  // Stable across renders: these are props on the Pressable, and this
  // component wraps most rows in the app. Rebuilding them each render made
  // every row's Pressable re-render whenever its list re-rendered.
  const setPressed = useCallback((next: 0 | 1) => {
    if (disabled && next === 1) return;
    if (reducedMotion) {
      pressed.value = next;
      return;
    }
    pressed.value = withSpring(next, next === 1 ? PRESS_IN : PRESS_OUT);
  }, [disabled, pressed, reducedMotion]);

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    setPressed(1);
    onPressIn?.(event);
  }, [onPressIn, setPressed]);

  const handlePressOut = useCallback((event: GestureResponderEvent) => {
    setPressed(0);
    onPressOut?.(event);
  }, [onPressOut, setPressed]);

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle]}
    />
  );
};
