import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { CoinToken } from '@/components/ui/coins/coin-token';
import { nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { Icon } from '@/components/ui/icon';
import type { BandPalette } from '@/constants/theme';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { cueIsFresh, type CoinCue } from '@/components/transfer-coins/coin-cues';

/** The travelling coin's diameter. */
export const ROUTE_COIN = 12;
/** How long the coin takes to cross from the source to the destination. */
const ROUTE_TRAVEL_MS = 650;

/**
 * The line between a transfer's two ends, with the arrow at the destination.
 * Given a fresh cue, a coin leaves the source end, travels the measured line
 * and fades out at the arrow: the money moved from one place to the other.
 * At rest (and always under Reduce Motion or a screen reader) the coin is
 * hidden and the line reads as a plain arrow. Decorative: the row speaks the
 * route, the amount and the tag.
 */
export function RouteCoinLane({ cue, stacked, rtl, palette, testID }: {
  cue?: CoinCue;
  /** Large text: the route reads downward, so the line and the coin go down too. */
  stacked: boolean;
  /** Arabic: the row is mirrored, so the coin travels towards the left. */
  rtl: boolean;
  palette: BandPalette;
  testID?: string;
}) {
  const motion = useMotionPreference();
  // 1 is "arrived": the coin rests, faded out, at the destination end.
  const progress = useAnimatedNumber(1);
  const distance = useAnimatedNumber(0);
  const span = useRef(0);
  // Read when the coin sets off, not a dependency: a re-render that only
  // restaggers must not restart a coin already travelling.
  const delay = useRef(cue?.delay ?? 0);
  delay.current = cue?.delay ?? 0;
  const at = cue?.at;
  const place = () => distance.setValue(stacked || !rtl ? span.current : -span.current);
  const measure = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    span.current = Math.max(0, (stacked ? height : width) - ROUTE_COIN);
    place();
  };
  // A language or text-size switch flips the direction without a new measurement.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(place, [rtl, stacked]);
  useEffect(() => {
    if (at === undefined || motion.reducedMotion || !motion.ready) return;
    if (!cueIsFresh({ at, delay: delay.current }, Date.now())) return;
    progress.setValue(0);
    const travel = Animated.sequence([
      Animated.delay(delay.current),
      // Timed, not sprung: on a lane this short a spring is over before the eye finds it.
      Animated.timing(progress, { toValue: 1, duration: ROUTE_TRAVEL_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: nativeDriver }),
    ]);
    travel.start();
    // Interrupted, the coin lands where it was going rather than hanging mid-route.
    return () => {
      travel.stop();
      progress.setValue(1);
    };
  }, [at, motion.ready, motion.reducedMotion, progress]);
  const paint = useMemo(() => {
    const along = Animated.multiply(progress, distance);
    return {
      opacity: progress.interpolate({ inputRange: [0, 0.12, 0.8, 1], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
      transform: [stacked ? { translateY: along } : { translateX: along }],
    };
  }, [distance, progress, stacked]);
  return <View testID={testID} onLayout={measure} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    style={stacked ? styles.laneStacked : styles.lane}>
    <View style={[stacked ? styles.lineStacked : styles.line, { backgroundColor: palette.rule }]} />
    {/* Icon mirrors the chevron in Arabic itself. */}
    <Icon name={stacked ? 'arrow-down' : 'chevron-right'} size={14} color={palette.textSecondary} />
    <Animated.View testID={testID ? `${testID}-coin` : undefined}
      style={[stacked ? styles.coinStacked : styles.coin, paint]}>
      <CoinToken size={ROUTE_COIN} />
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  lane: { width: 26, flexShrink: 1, minWidth: 18, height: 20, flexDirection: 'row', alignItems: 'center', pointerEvents: 'none' },
  laneStacked: { width: 16, height: 30, alignItems: 'center', pointerEvents: 'none' },
  line: { flex: 1, height: 1.5, borderRadius: 1, marginEnd: -6 },
  lineStacked: { flex: 1, width: 1.5, borderRadius: 1, marginBottom: -6 },
  coin: { position: 'absolute', start: 0, top: (20 - ROUTE_COIN) / 2 },
  coinStacked: { position: 'absolute', top: 0, start: (16 - ROUTE_COIN) / 2 },
});
