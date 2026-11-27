import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { WafraMark } from '@/components/wafra-logo';
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
  // The unread dot and ring are a static cue, including with reduced motion.
  return <Pressable
    testID="wafra-recap-logo"
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    onPress={onPress}
    onLongPress={onLongPress}
    delayLongPress={750}
    hitSlop={8}
    style={({ pressed }) => [styles.target, { opacity: pressed ? 0.68 : 1 }]}>
    <View style={[styles.ring, {
      borderColor: unread ? theme.primary : theme.cardBorderStrong,
      backgroundColor: unread ? theme.primarySoft : 'transparent',
    }]}>
      <WafraMark size={27} />
      {unread ? <View style={[styles.dot, { backgroundColor: theme.gold, borderColor: theme.background }]} /> : null}
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  target: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', end: -2, top: -1, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
});
