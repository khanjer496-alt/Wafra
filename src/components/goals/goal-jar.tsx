import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { GOLD, discGeometry, type CoinTone } from '@/components/ui/coins/coin-disc';
import { CoinStack } from '@/components/ui/coins/coin-stack';
import { CoinColors, type BandPalette } from '@/constants/theme';
import { filledCoins, shareOf } from '@/lib/coin-math';

/** A full jar holds this many coins. */
export const JAR_COINS = 10;
/** Coin width inside the jar. */
const COIN = 84;
const COIN_HEIGHT = discGeometry(COIN).height + (JAR_COINS - 1) * discGeometry(COIN).edge;

/** The glass body, its lip and its lid. */
const BODY_WIDTH = 124;
/** Room under the coins (the glass base) and over a full stack (the shoulder). */
const BASE = 10;
const SHOULDER = 14;
const BODY_HEIGHT = COIN_HEIGHT + BASE + SHOULDER;
const LIP_WIDTH = 92;
const LIP_HEIGHT = 10;
const LID_WIDTH = 102;
const LID_HEIGHT = 16;
export const JAR_HEIGHT = LID_HEIGHT + LIP_HEIGHT - 2 + BODY_HEIGHT;
export const JAR_WIDTH = BODY_WIDTH;

/** Strength of the band's text colour in the glass: the tint, and the outline. */
const GLASS_FILL = 0.08;
const GLASS_EDGE = 0.42;

/** Empty places in the jar are just glass. */
const EMPTY: CoinTone = { face: 'transparent', side: 'transparent', rim: 'transparent' };

/**
 * Coins of the jar that a goal's savings fill. Any money saved shows at
 * least one coin, and only a reached goal fills the jar.
 */
export function jarCoins(savedFils: number, targetFils: number): number {
  return filledCoins(shareOf(savedFils, targetFils), JAR_COINS);
}

/** A glass shape: a faint tint of the band's text colour behind, and its outline. */
function Glass({ palette, shape }: { palette: BandPalette; shape: StyleProp<ViewStyle> }) {
  return <>
    <View style={[shape, styles.glassLayer, { backgroundColor: palette.onBand, opacity: GLASS_FILL }]} />
    <View style={[shape, styles.glassLayer, styles.glassEdge, { borderColor: palette.onBand, opacity: GLASS_EDGE }]} />
  </>;
}

/**
 * A glass jar with a gold lid, filling with coins as a goal is saved toward.
 * The coins stand in the jar's base; what has been saved is the level, the
 * rest is clear glass. Adding money while the screen is open drops the new
 * coins in (CoinStack). Decorative: the screen writes and speaks the figures,
 * so the whole drawing is hidden from assistive tech.
 */
export function GoalJar({ savedFils, targetFils, palette, style, testID }: {
  savedFils: number;
  targetFils: number;
  palette: BandPalette;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const filled = jarCoins(savedFils, targetFils);
  return <View testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    style={[styles.jar, style]}>
    {/* The lid: a band of gold, its top catching the light. */}
    <View style={[styles.lid, { backgroundColor: GOLD.side, borderColor: GOLD.rim }]}>
      <View style={[styles.lidTop, { backgroundColor: GOLD.face }]} />
      <View style={[styles.lidShine, { backgroundColor: CoinColors.shine }]} />
    </View>
    {/* The lip under the lid. */}
    <View style={styles.lip}>
      <Glass palette={palette} shape={styles.lipShape} />
    </View>
    <View style={styles.body}>
      <Glass palette={palette} shape={styles.bodyShape} />
      <CoinStack testID={testID ? `${testID}-coins` : undefined} total={JAR_COINS} filled={filled} width={COIN}
        ghost={EMPTY} style={styles.coins} />
      {/* The front of the glass, over the coins: two highlights down its sides. */}
      <View style={[styles.highlight, { backgroundColor: palette.onBand }]} />
      <View style={[styles.highlightDot, { backgroundColor: palette.onBand }]} />
      <View style={[styles.reflection, { backgroundColor: palette.onBand }]} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  jar: { width: JAR_WIDTH, height: JAR_HEIGHT, alignItems: 'center', pointerEvents: 'none' },
  lid: { width: LID_WIDTH, height: LID_HEIGHT, borderRadius: 6, borderWidth: 1, overflow: 'hidden', zIndex: 1 },
  lidTop: { position: 'absolute', top: 0, start: 0, end: 0, height: LID_HEIGHT * 0.45 },
  lidShine: { position: 'absolute', top: 2, start: 8, end: LID_WIDTH * 0.45, height: 2, borderRadius: 1, opacity: 0.7 },
  lip: { width: LIP_WIDTH, height: LIP_HEIGHT, marginBottom: -2 },
  lipShape: { borderRadius: 4 },
  body: { width: BODY_WIDTH, height: BODY_HEIGHT },
  bodyShape: { borderTopStartRadius: 26, borderTopEndRadius: 26, borderBottomStartRadius: 34, borderBottomEndRadius: 34 },
  glassLayer: { ...StyleSheet.absoluteFillObject },
  glassEdge: { borderWidth: 2, backgroundColor: 'transparent' },
  coins: { position: 'absolute', bottom: BASE, start: (BODY_WIDTH - COIN) / 2 },
  highlight: { position: 'absolute', top: SHOULDER + 8, start: 9, width: 6, height: BODY_HEIGHT * 0.5, borderRadius: 3, opacity: 0.3 },
  highlightDot: { position: 'absolute', top: SHOULDER + 16 + BODY_HEIGHT * 0.5, start: 10, width: 4, height: 10, borderRadius: 2, opacity: 0.22 },
  reflection: { position: 'absolute', top: SHOULDER + 18, end: 8, width: 3, height: BODY_HEIGHT * 0.3, borderRadius: 1.5, opacity: 0.14 },
});
