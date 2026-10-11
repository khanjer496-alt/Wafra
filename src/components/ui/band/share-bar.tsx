import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Motion, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { bandCopy } from '@/lib/band-copy';
import { tapped } from '@/lib/haptics';
import { blendHex } from '@/lib/spending-calendar-tiles';

export interface ShareSegment {
  key: string;
  label: string;
  /** Any non-negative magnitude (minor units are fine). */
  value: number;
  /** The segment's own colour (a category's); without it, a rank-based strength of the band's text colour. */
  color?: string;
}

/** Strength of the band's text colour per rank, for segments without their own colour. */
const RANK_OPACITY = [0.92, 0.7, 0.5] as const;
const REST_OPACITY = 0.24;

/** Coin geometry: a coin lies on its side, face toward the start edge. */
const COIN = 30;
const FACE = 12;
const LIFT = 10;
const MIN_COIN = FACE + 6;
/** Each coin's face sits over the end cap of the one before it. */
const OVERLAP = FACE / 2;
/**
 * At most this many coins: the biggest, then one coin for all the rest, as
 * the spoken summary pools them. Twenty categories at minimum width would run
 * off a 320pt band, and tiny ones would read far bigger than their share.
 */
const MAX_COINS = 7;
const REST_KEY = '__rest';
const DIMMED = 0.32;
const STAGGER = 45;
/** A coin's glow at rest (a little of its colour on the band) and lifted. */
const GLOW_REST = 0.28;
const GLOW_LIFTED = 0.85;
/** Rising into place: a quick spring with one visible bounce. */
const RISE = { stiffness: 240, damping: 15, mass: 0.9 } as const;
/** The tapped coin pops: snappier, with a little more overshoot. */
const POP = { stiffness: 320, damping: 14, mass: 0.8 } as const;
const nativeDriver = Platform.OS !== 'web';

/** Whole-number shares that add up to 100 (largest remainder), in input order. */
export function sharePercents(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((value) => (Math.max(0, value) / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index]! += 1;
    left -= 1;
  }
  return floors;
}

/** A coin without its own colour: the band's text colour laid over the band at its rank's strength. */
export function coinFill(palette: BandPalette, index: number): string {
  return blendHex(palette.onBand, palette.band, RANK_OPACITY[index] ?? REST_OPACITY);
}

/**
 * Shares as a row of coins lying on their side, each in its segment's own
 * colour, then a two-column legend naming every coin with its amount and
 * share. Coins rise into place one after another; tapping a coin (or its
 * legend line) pops it up over a glow of its colour and dims the rest. Past
 * seven, the smallest share one coin ("4 other categories"). Assistive tech
 * hears the three biggest named and the rest as one figure, unchanged by any
 * selection, and Reduce Motion shows everything in place.
 */
export function ShareBar({ segments, palette, labelled = 3, label, formatShare, formatValue, restColor, testID }: {
  segments: readonly ShareSegment[];
  palette: BandPalette;
  /**
   * Formats a share from its value and the bar's total. Pass the formatter
   * and denominator the rows under the bar use, so the legend and the rows
   * never disagree ("Rent 100%" over a row reading 99.5%). Without it, whole
   * percents that add up to 100.
   */
  formatShare?: (value: number, total: number) => string;
  /** A coin's amount ("AED 325.00") in the legend; without it, its share alone. */
  formatValue?: (value: number) => string;
  /** How many of the largest segments the spoken summary names. */
  labelled?: number;
  /** What the bar divides ("Spending"), spoken first. */
  label?: string;
  /** The pooled coin's colour, when segments carry their own. */
  restColor?: string;
  testID?: string;
}) {
  const words = bandCopy(useLanguage());
  const large = useLargeTextLayout();
  const motion = useMotionPreference();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Coins that mount after the first reveal (a new period's categories) appear in place.
  const revealed = useRef(false);
  useEffect(() => {
    if (motion.ready) revealed.current = true;
  });
  const sorted = segments.filter((segment) => segment.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length === 0) {
    // A period with nothing spent clears the selection too, so it cannot return later.
    if (selectedKey !== null) setSelectedKey(null);
    return null;
  }
  const percents = sharePercents(sorted.map((segment) => segment.value));
  const total = sorted.reduce((sum, segment) => sum + segment.value, 0);
  const named = sorted.slice(0, labelled);
  const restCount = sorted.length - named.length;
  const shareText = (from: number, to: number) => formatShare
    ? formatShare(sorted.slice(from, to).reduce((sum, segment) => sum + segment.value, 0), total)
    : words.percent(percents.slice(from, to).reduce((sum, value) => sum + value, 0));
  const spoken = [
    ...named.map((segment, index) => `${segment.label} ${shareText(index, index + 1)}`),
    restCount > 0 ? words.shareOthers(restCount, shareText(named.length, sorted.length)) : null,
  ].filter(Boolean).join(', ');
  const ownCoins = sorted.length > MAX_COINS ? MAX_COINS - 1 : sorted.length;
  const coins = sorted.slice(0, ownCoins).map((segment, index) => ({
    key: segment.key, label: segment.label, value: segment.value, from: index, to: index + 1,
    color: segment.color ?? coinFill(palette, index),
  }));
  if (ownCoins < sorted.length) {
    const pooled = sorted.slice(ownCoins);
    coins.push({ key: REST_KEY, label: words.shareOthers(pooled.length, '').trim(), from: ownCoins, to: sorted.length,
      value: pooled.reduce((sum, segment) => sum + segment.value, 0),
      color: sorted[0]!.color ? restColor ?? palette.bandMark : coinFill(palette, ownCoins) });
  }
  const selected = coins.findIndex((coin) => coin.key === selectedKey);
  // A selection whose category left with a period change clears, so it cannot
  // come back later in a period that has it again.
  if (selectedKey !== null && selected < 0) setSelectedKey(null);
  const select = (key: string) => {
    tapped();
    setSelectedKey((current) => current === key ? null : key);
  };

  return <View testID={testID} style={styles.root}>
    <View accessible accessibilityRole="image" accessibilityLabel={label ? `${words.shareOf} ${label}: ${spoken}` : spoken} style={styles.bar}>
      {coins.map((coin, index) => <Coin key={coin.key} testID={testID ? `${testID}-coin-${coin.key}` : undefined}
        paintTestID={testID ? `${testID}-paint-${coin.key}` : undefined}
        value={coin.value} index={index} fill={coin.color} rim={palette.band}
        selected={index === selected} dimmed={selected >= 0 && index !== selected} appear={!revealed.current}
        ready={motion.ready} reducedMotion={motion.reducedMotion} onPress={() => select(coin.key)} />)}
    </View>
    {/* Visual only: the spoken summary above, and the rows on the sheet, carry the same figures. */}
    <View testID={testID ? `${testID}-legend` : undefined} style={styles.legend}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {coins.map((coin, index) => <Pressable key={coin.key} onPress={() => select(coin.key)} focusable={false}
        accessible={false} importantForAccessibility="no" testID={testID ? `${testID}-legend-${coin.key}` : undefined}
        style={[styles.legendItem, large ? styles.legendItemFull : styles.legendItemHalf,
          { opacity: selected >= 0 && index !== selected ? DIMMED : 1 }]}>
        <View style={[styles.swatch, { backgroundColor: coin.color }]} />
        <View style={styles.legendText}>
          <ThemedText type="meta" numberOfLines={large ? undefined : 2}
            style={[{ color: palette.onBandSecondary }, index === selected && styles.selectedName]}>{coin.label}</ThemedText>
          <ThemedText type="meta" style={{ color: palette.onBand }}>
            {[formatValue?.(coin.value), shareText(coin.from, coin.to)].filter(Boolean).join(' · ')}</ThemedText>
        </View>
      </Pressable>)}
    </View>
  </View>;
}

/** One Animated.Value for the component's life, allocated once. */
function useAnimatedNumber(initial: number): Animated.Value {
  const ref = useRef<Animated.Value | null>(null);
  if (!ref.current) ref.current = new Animated.Value(initial);
  return ref.current;
}

/**
 * One coin: its glow, then the end cap, the body over its inner half, a
 * sheen, and the face. Its motion is paint only (opacity and transform on the
 * native driver), so Android animates it without layout work.
 */
function Coin({ value, index, fill, rim, selected, dimmed, appear, ready, reducedMotion, onPress, testID, paintTestID }: {
  value: number;
  index: number;
  fill: string;
  rim: string;
  selected: boolean;
  dimmed: boolean;
  /** False for a coin that arrives after the bar's first reveal: it appears in place. */
  appear: boolean;
  ready: boolean;
  reducedMotion: boolean;
  onPress: () => void;
  testID?: string;
  /** The faded paint layer, under its own prefix so a coin query never matches it. */
  paintTestID?: string;
}) {
  const shown = useRef(!appear);
  // The rank at first paint sets the stagger; a later re-sort does not replay it.
  const delay = useRef(index * STAGGER);
  const enter = useAnimatedNumber(reducedMotion || !appear ? 1 : 0);
  const lift = useAnimatedNumber(selected ? 1 : 0);
  const fade = useAnimatedNumber(dimmed ? DIMMED : 1);
  const settled = useRef(false);

  useEffect(() => {
    if (reducedMotion) {
      shown.current = true;
      enter.setValue(1);
      return;
    }
    // Hold still until the screen-reader state is known (see use-reduced-motion).
    if (!ready || shown.current) return;
    shown.current = true;
    const rise = Animated.sequence([
      Animated.delay(delay.current),
      Animated.spring(enter, { toValue: 1, ...RISE, useNativeDriver: nativeDriver }),
    ]);
    rise.start();
    // The rise runs once: interrupted, the coin lands where it belongs rather
    // than staying half-faded behind a `shown` that will not let it rerun.
    return () => {
      rise.stop();
      enter.setValue(1);
    };
  }, [enter, ready, reducedMotion]);

  useEffect(() => {
    // The values start where the props put them; only a change animates.
    if (!settled.current) {
      settled.current = true;
      return;
    }
    if (reducedMotion) {
      lift.setValue(selected ? 1 : 0);
      fade.setValue(dimmed ? DIMMED : 1);
      return;
    }
    const change = Animated.parallel([
      Animated.spring(lift, { toValue: selected ? 1 : 0, ...POP, useNativeDriver: nativeDriver }),
      Animated.timing(fade, { toValue: dimmed ? DIMMED : 1, duration: Motion.change,
        easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: nativeDriver }),
    ]);
    change.start();
    return () => change.stop();
  }, [dimmed, fade, lift, reducedMotion, selected]);

  // Built once: new interpolation nodes per render would churn the native driver.
  const chipMotion = useMemo(() => ({
    opacity: enter.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
    transform: [
      {
        translateY: Animated.add(
          enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
          lift.interpolate({ inputRange: [0, 1], outputRange: [0, -LIFT] }),
        ),
      },
      { scale: Animated.add(
        enter.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
        lift.interpolate({ inputRange: [0, 1], outputRange: [0, 0.06] }),
      ) },
    ],
  }), [enter, lift]);
  const glowMotion = useMemo(() => ({
    opacity: Animated.multiply(Animated.multiply(
      enter.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
      lift.interpolate({ inputRange: [0, 1], outputRange: [GLOW_REST, GLOW_LIFTED], extrapolate: 'clamp' }),
    ), fade),
  }), [enter, fade, lift]);

  // A lifted coin rises over the face of the one after it.
  return <View style={[styles.coin, { flexGrow: value, marginStart: index === 0 ? 0 : -OVERLAP, zIndex: selected ? 1 : 0 }]}>
    <Animated.View style={[styles.glow, { boxShadow: `0 0 14px 4px ${fill}` }, glowMotion]} />
    <Animated.View style={[StyleSheet.absoluteFill, styles.inert, chipMotion]}>
      {/* A solid coin of the band's colour under the paint: a dimmed coin darkens
          toward the band instead of showing its neighbour's edges through it. */}
      <View style={[styles.cap, styles.capEnd, { backgroundColor: rim, borderColor: rim }]} />
      <View style={[styles.body, { backgroundColor: rim, borderColor: rim }]} />
      <View style={[styles.cap, styles.capStart, { backgroundColor: rim, borderColor: rim }]} />
      <Animated.View testID={paintTestID} style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <View style={[styles.cap, styles.capEnd, { backgroundColor: fill, borderColor: rim }]} />
        <View testID={testID} style={[styles.body, { backgroundColor: fill, borderColor: rim }]} />
        <View style={styles.sheen} />
        <View style={[styles.cap, styles.capStart, { backgroundColor: fill, borderColor: rim }]}>
          <View style={[styles.faceShade, { backgroundColor: rim }]} />
        </View>
      </Animated.View>
    </Animated.View>
    {/* Visual only: the bar is one spoken image, so no screen reader stops here. */}
    <Pressable onPress={onPress} focusable={false} accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill}
      hitSlop={{ top: LIFT + 4, bottom: 8 }} />
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 18 },
  // Room above for a lifted coin and below for its glow.
  bar: { flexDirection: 'row', height: COIN, marginTop: LIFT + 4, marginBottom: 6 },
  coin: { flexBasis: 0, minWidth: MIN_COIN, height: COIN },
  // An ellipse is a circle squeezed on its x axis; the scale is symmetric, so
  // `start`/`end` placement mirrors under right-to-left on its own.
  cap: { position: 'absolute', top: 0, width: COIN, height: COIN, borderRadius: COIN / 2, borderWidth: 1.5,
    overflow: 'hidden', transform: [{ scaleX: FACE / COIN }] },
  capStart: { start: FACE / 2 - COIN / 2 },
  capEnd: { end: FACE / 2 - COIN / 2 },
  body: { position: 'absolute', top: 0, bottom: 0, start: FACE / 2, end: FACE / 2,
    borderTopWidth: 1.5, borderBottomWidth: 1.5 },
  // A soft highlight along the top of the body: what makes it read as a rounded coin, not a bar.
  sheen: { position: 'absolute', top: 5, height: 3, start: FACE, end: FACE / 2 + 2, borderRadius: 1.5,
    backgroundColor: '#FFFFFF', opacity: 0.32 },
  // The face turns a little from the light.
  faceShade: { ...StyleSheet.absoluteFillObject, opacity: 0.22 },
  inert: { pointerEvents: 'none' },
  // Light only: the spread shadow of a line with no height. A shadow is never
  // painted under its own box, so any height would leave a slit of band in it.
  glow: { position: 'absolute', pointerEvents: 'none', start: 3, end: 3, bottom: -2, height: 0 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  legendItemHalf: { width: '50%', paddingEnd: 8 },
  legendItemFull: { width: '100%' },
  legendText: { flex: 1, minWidth: 0, gap: 1 },
  selectedName: { fontFamily: Fonts.sansSemi },
  // An upright pill: a coin seen face-on, small.
  swatch: { width: 7, height: 14, borderRadius: 3.5, marginTop: 2 },
});
