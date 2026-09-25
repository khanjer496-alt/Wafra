import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { BandLayout, type BandPalette } from '@/constants/theme';

/**
 * A 38pt pill on a band: a filter (Transactions' All · Spending · Income),
 * a suggestion (Add's category), or a quiet fact ("3 accounts"). Without
 * `onPress` it is plain text for assistive tech; with it, a button that
 * reports `selected`. The hit area is 44pt.
 */
export function BandChip({ label, selected = false, onPress, icon, palette, testID, accessibilityHint }: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  palette: BandPalette;
  testID?: string;
  accessibilityHint?: string;
}) {
  const fg = selected ? palette.onSelected : palette.onBand;
  const body = <>
    {icon ? <Icon name={icon} size={16} color={fg} strokeWidth={2} /> : null}
    <ThemedText type={selected ? 'smallBold' : 'small'} style={[styles.label, { color: fg }]}>{label}</ThemedText>
  </>;
  const surface = { backgroundColor: selected ? palette.selected : palette.tile };
  if (!onPress) {
    return <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={label} style={[styles.chip, surface]}>{body}</View>;
  }
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint}
    accessibilityState={{ selected }} onPress={onPress} hitSlop={3}
    style={({ pressed }) => [styles.chip, surface, { opacity: pressed ? 0.75 : 1 }]}>
    {body}
  </Pressable>;
}

const styles = StyleSheet.create({
  chip: {
    minHeight: BandLayout.chipHeight, borderRadius: BandLayout.chipHeight / 2, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-start',
  },
  label: { flexShrink: 1 },
});
