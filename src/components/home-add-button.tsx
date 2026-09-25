import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Radius } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';

/**
 * Android's floating Add on Home, bottom-right above the tab bar (bottom-left
 * in RTL, where "end" is). iOS keeps its header "+". No entrance animation:
 * Android deliberately runs most motion off after device traces, and a
 * static button is what Reduce Motion would show anyway.
 */
export function HomeAddButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  return <Pressable testID="home-add-fab" accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    android_ripple={{ color: theme.primaryBorder, borderless: false }}
    style={({ pressed }) => [styles.fab, { bottom: clearance, backgroundColor: theme.primary, opacity: pressed ? 0.88 : 1 }]}>
    <Icon name="plus" size={24} color={theme.onPrimary} />
  </Pressable>;
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute', end: 16, width: 56, height: 56, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center', elevation: 4,
  },
});
