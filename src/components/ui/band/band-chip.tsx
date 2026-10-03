import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { BandLayout, type BandPalette } from '@/constants/theme';

/**
 * A pill on a band: a 38pt filter (Transactions' All · Spending · Income) or
 * suggestion (Add's category), or a 30pt quiet fact ("3 accounts"). Without
 * `onPress` it is plain text for assistive tech; with it, a button that
 * reports `selected`. A control's hit area is 44pt.
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
    <ThemedText type={onPress ? (selected ? 'smallBold' : 'small') : 'meta'} style={[styles.label, { color: fg }]}>{label}</ThemedText>
  </>;
  const surface = { backgroundColor: selected ? palette.selected : palette.tile };
  if (!onPress) {
    return <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={label} style={[styles.chip, styles.fact, surface]}>{body}</View>;
  }
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint}
    accessibilityState={{ selected }} aria-pressed={selected} onPress={onPress} hitSlop={3}
    style={({ pressed }) => [styles.chip, surface, { opacity: pressed ? 0.75 : 1 }]}>
    {body}
  </Pressable>;
}

const styles = StyleSheet.create({
  chip: {
    minHeight: BandLayout.chipHeight, borderRadius: BandLayout.chipHeight / 2, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-start',
  },
  /** A quiet fact ("3 accounts") is a label, not a control: the design's 30pt pill. */
  fact: { minHeight: 30, borderRadius: 15, paddingHorizontal: 12, paddingVertical: 4, maxWidth: '100%' },
  label: { flexShrink: 1 },
});
