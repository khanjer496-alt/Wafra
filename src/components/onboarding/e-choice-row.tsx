/**
 * The one selectable row every multi-select onboarding step uses. A picked
 * row is tinted with a solid outline and a filled check circle; an unpicked
 * one is an outline with an empty circle — never a full colour inversion,
 * so a list with several picked still reads as a list of choices.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import type { BandPalette } from '@/constants/theme';
import { tapped } from '@/lib/haptics';

/** The row surface: outline at rest, tinted with a solid outline when active. */
export function choiceSurface(palette: BandPalette, active: boolean) {
  return {
    borderColor: active ? palette.onBand : palette.bandRule,
    backgroundColor: active ? palette.tile : 'transparent',
  };
}

/** A 26pt check circle: empty ring, or filled with a check. */
export function CheckCircle({ checked, palette }: { checked: boolean; palette: BandPalette }) {
  return <View style={[styles.check, checked
    ? { backgroundColor: palette.onBand, borderColor: palette.onBand }
    : { borderColor: palette.onBandSecondary }]}>
    {checked ? <Icon name="check" size={16} color={palette.band} strokeWidth={2.6} /> : null}
  </View>;
}

export function EChoiceRow({ label, checked, onPress, palette, disabled, testID }: {
  label: string;
  checked: boolean;
  onPress: () => void;
  palette: BandPalette;
  disabled?: boolean;
  testID?: string;
}) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label}
    accessibilityState={{ checked, disabled: !!disabled }} aria-checked={checked} disabled={disabled} testID={testID}
    onPress={() => { tapped(); onPress(); }}
    style={({ pressed }) => [styles.row, choiceSurface(palette, checked), { opacity: pressed ? 0.8 : 1 }]}>
    <CheckCircle checked={checked} palette={palette} />
    <ThemedText type="smallBold" style={[styles.label, { color: palette.onBand }]}>{label}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60, borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, minWidth: 0, fontSize: 17, lineHeight: 23 },
});
