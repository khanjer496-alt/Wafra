import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { BandPalette } from '@/constants/theme';

export type StatTileTone = 'band' | 'accent';

/** Background and text colours of a stat tile, for figures set inside it. */
export function statTileColors(palette: BandPalette, tone: StatTileTone): { bg: string; fg: string; fgSecondary: string } {
  return tone === 'accent'
    ? { bg: palette.accent, fg: palette.onAccent, fgSecondary: palette.onAccentSecondary }
    : { bg: palette.tile, fg: palette.onBand, fgSecondary: palette.onBandSecondary };
}

/**
 * A figure tile on a band: the band's own tone (or the mint accent for the
 * one figure that is good news, like Left in budgets). Label on top, the
 * value (usually a `BandFigure size="large"` in `statTileColors(...).fg`),
 * then a meta line. Pressable when it opens something; otherwise read as one
 * piece of text with `accessibilityLabel`.
 */
export function StatTile({ label, meta, metaTone = 'normal', children, tone = 'band', palette, onPress,
  accessibilityLabel, accessibilityHint, testID, style }: {
  label: string;
  meta?: string;
  /** A meta line that is a warning keeps the tile's text colour but reads bold. */
  metaTone?: 'normal' | 'strong';
  children?: React.ReactNode;
  tone?: StatTileTone;
  palette: BandPalette;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = statTileColors(palette, tone);
  const body = <>
    <ThemedText type="small" style={{ color: colors.fgSecondary }}>{label}</ThemedText>
    {children}
    {meta ? <ThemedText type={metaTone === 'strong' ? 'smallBold' : 'meta'} style={{ color: colors.fgSecondary }}>{meta}</ThemedText> : null}
  </>;
  if (onPress) {
    return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint} onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: colors.bg, opacity: pressed ? 0.85 : 1 }, style]}>
      {body}
    </Pressable>;
  }
  return <View testID={testID} accessible={accessibilityLabel !== undefined} accessibilityRole={accessibilityLabel !== undefined ? 'text' : undefined}
    accessibilityLabel={accessibilityLabel} style={[styles.tile, { backgroundColor: colors.bg }, style]}>
    {body}
  </View>;
}

const styles = StyleSheet.create({
  tile: { flex: 1, minWidth: 0, borderRadius: 22, padding: 14, gap: 4 },
});
