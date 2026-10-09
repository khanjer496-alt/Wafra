import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { MIN_FIGURE_SCALE } from '@/lib/large-text-figure';

const SIZES = {
  hero: { fontSize: 56, lineHeight: 62, letterSpacing: -2.2 },
  large: { fontSize: 30, lineHeight: 36, letterSpacing: -1 },
} as const;

/** Geist SemiBold's tabular digit advance per em, with room for separators. */
const DIGIT_ADVANCE = 0.6;

/**
 * A count or a clock time set on a band or inside a stat tile: Geist
 * SemiBold with tabular digits (never Geist Mono, whose separators space
 * out). `BandFigure` is the money version; this one carries no currency.
 * The caller speaks it (the tile or block around it is the accessible unit).
 *
 * A count is never cut ("14,7…" in a narrow tile said nothing): it is sized
 * from its character count to the width its box gives it, the same rule on
 * iOS, Android and the web, down to MIN_FIGURE_SCALE of its size.
 */
export function BandCount({ value, color, size = 'large', testID, style }: {
  value: string;
  color: string;
  size?: keyof typeof SIZES;
  testID?: string;
  style?: StyleProp<TextStyle>;
}) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const base = SIZES[size];
  const scale = Math.max(1, fontScale);
  const wanted = base.fontSize * scale;
  const fits = width > 0 ? width / (Math.max(1, value.length) * DIGIT_ADVANCE) : wanted;
  const ratio = Math.max(MIN_FIGURE_SCALE, Math.min(1, fits / wanted));
  const sized = ratio < 1
    ? { fontSize: base.fontSize * ratio, lineHeight: base.lineHeight * ratio, letterSpacing: base.letterSpacing * ratio }
    : null;
  return <View style={styles.box} onLayout={(event) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  }}>
    <ThemedText testID={testID} tabular numberOfLines={1}
      style={[styles.figure, base, sized, { color }, style]}>{value}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch', minWidth: 0 },
  figure: { fontFamily: Fonts.sansSemi, fontVariant: ['tabular-nums'], maxWidth: '100%' },
});
