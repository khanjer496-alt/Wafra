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
 * one figure that is good news, like Left in budgets). The value comes first
 * (a `BandFigure size="medium"` or `BandCount` in `statTileColors(...).fg`),
 * so values in a row of tiles share one top line however their labels wrap;
 * then the 13pt label and an optional meta line. About 64pt tall at the
 * default text size; labels wrap rather than truncate at every size.
 * Pressable when it opens something; otherwise read as one piece of text with
 * `accessibilityLabel`.
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
    {children}
    <ThemedText type="meta" style={[styles.label, { color: colors.fgSecondary }]}>{label}</ThemedText>
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
  // Tops align across a row: a short tile does not stretch its value down.
  tile: { flex: 1, minWidth: 0, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, gap: 2, justifyContent: 'flex-start' },
  label: { lineHeight: 17 },
});
