import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { WafraMark } from '@/components/wafra-logo';
import { EASE, Motion } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';

export function RecapLogoTrigger({
  unread,
  accessibilityLabel,
  onPress,
  onLongPress,
}: {
  unread: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!unread || reducedMotion) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.055, { duration: Motion.pulse / 2, easing: Easing.bezier(...EASE) }),
        withTiming(1, { duration: Motion.pulse / 2, easing: Easing.bezier(...EASE) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [pulse, reducedMotion, unread]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return <Pressable
    testID="wafra-recap-logo"
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    onPress={onPress}
    onLongPress={onLongPress}
    delayLongPress={750}
    hitSlop={8}
    style={({ pressed }) => [styles.target, { opacity: pressed ? 0.68 : 1 }]}>
    <Animated.View style={[styles.ring, {
      borderColor: unread ? theme.primary : theme.cardBorderStrong,
      backgroundColor: unread ? theme.primarySoft : 'transparent',
    }, animated]}>
      <WafraMark size={27} />
      {unread ? <View style={[styles.dot, { backgroundColor: theme.gold, borderColor: theme.background }]} /> : null}
    </Animated.View>
  </Pressable>;
}

const styles = StyleSheet.create({
  target: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', end: -2, top: -1, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
});
