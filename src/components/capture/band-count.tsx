import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';

const SIZES = {
  hero: { fontSize: 56, lineHeight: 62, letterSpacing: -2.2 },
  large: { fontSize: 30, lineHeight: 36, letterSpacing: -1 },
} as const;

/**
 * A count or a clock time set on a band or inside a stat tile: Geist
 * SemiBold with tabular digits (never Geist Mono, whose separators space
 * out). `BandFigure` is the money version; this one carries no currency.
 * The caller speaks it (the tile or block around it is the accessible unit).
 */
export function BandCount({ value, color, size = 'large', testID, style }: {
  value: string;
  color: string;
  size?: keyof typeof SIZES;
  testID?: string;
  style?: StyleProp<TextStyle>;
}) {
  return <ThemedText testID={testID} tabular numberOfLines={1} adjustsFontSizeToFit
    style={[styles.figure, SIZES[size], { color }, style]}>{value}</ThemedText>;
}

const styles = StyleSheet.create({
  figure: { fontFamily: Fonts.sansSemi, fontVariant: ['tabular-nums'], maxWidth: '100%' },
});
