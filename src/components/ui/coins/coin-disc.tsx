import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { CoinColors } from '@/constants/theme';
import { blendHex } from '@/lib/spending-calendar-tiles';

export interface CoinTone {
  face: string;
  side: string;
  rim: string;
}

/** The gold coin, from the theme. */
export const GOLD: CoinTone = { face: CoinColors.face, side: CoinColors.side, rim: CoinColors.rim };

/**
 * An empty place in a stack, drawn on `surface`: the surface lifted a little
 * toward `ink`, with a rim clearly darker than its edge so stacked empty coins
 * stay separate coins rather than merging into one solid can.
 */
export function ghostTone(surface: string, ink: string): CoinTone {
  return { face: blendHex(ink, surface, 0.08), side: blendHex(ink, surface, 0.16), rim: blendHex(ink, surface, 0.42) };
}

/** A flat coin's proportions at a width: the face seen from above, and the edge below it. */
export function discGeometry(width: number) {
  const face = Math.round(width * 0.36);
  const edge = Math.max(3, Math.round(width * 0.13));
  return { width, face, edge, height: face + edge };
}

/**
 * One coin lying flat, seen from a little above: an elliptical face over a
 * short edge. An ellipse is a circle squeezed on its y axis, so the coin needs
 * no SVG and paints the same on iOS, Android and the web. Decorative: the
 * caller writes the amount it stands for.
 */
export function CoinDisc({ width, tone = GOLD, shine = true, style, testID }: {
  width: number;
  tone?: CoinTone;
  /** A soft highlight on the face; off for a ghost (spent) coin. */
  shine?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { face, edge, height } = discGeometry(width);
  const ellipse = (top: number) => ({
    position: 'absolute' as const, start: 0, top: top + face / 2 - width / 2, width, height: width,
    borderRadius: width / 2, transform: [{ scaleY: face / width }],
  });
  return <View testID={testID} style={[{ width, height, pointerEvents: 'none' }, style]}>
    {/* The edge: the lower ellipse and the band joining it to the face. */}
    <View style={[ellipse(edge), { backgroundColor: tone.side, borderWidth: 1, borderColor: tone.rim }]} />
    <View style={[styles.edge, { top: face / 2, height: edge, backgroundColor: tone.side, borderColor: tone.rim }]} />
    {/* The face, an inner ring stamped into it, and a highlight. */}
    <View style={[ellipse(0), { backgroundColor: tone.face, borderWidth: 1, borderColor: tone.rim }]} />
    <View style={[ellipse(0), styles.ring, { borderColor: tone.side, transform: [{ scaleY: face / width }, { scale: 0.7 }] }]} />
    {shine ? <View style={[styles.shine, { width: width * 0.28, height: face * 0.22, top: face * 0.18, start: width * 0.2,
      borderRadius: face * 0.11, backgroundColor: CoinColors.shine }]} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', start: 0, end: 0, borderStartWidth: 1, borderEndWidth: 1 },
  ring: { backgroundColor: 'transparent', borderWidth: 1.5, opacity: 0.55 },
  shine: { position: 'absolute', opacity: 0.45 },
});
