import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, View, type StyleProp, type ViewStyle } from 'react-native';

import { CoinDisc, GOLD, discGeometry, type CoinTone } from '@/components/ui/coins/coin-disc';
import { COIN_MOVE, COIN_RISE, COIN_STAGGER, nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { useMotionPreference } from '@/hooks/use-reduced-motion';

/**
 * A stack of `total` flat coins, `filled` of them gold from the bottom and the
 * rest drawn as ghosts: what is left sits at the bottom, what has gone is the
 * empty space above it. On first paint the gold coins drop in from the bottom
 * one after another; a later change lifts spent coins off the top (or drops
 * new ones on), so the level visibly moves. Reduce Motion shows the level at
 * once. Decorative: the parent writes and speaks the figure.
 */
export function CoinStack({ total, filled, width, tone = GOLD, ghost, style, testID }: {
  total: number;
  filled: number;
  width: number;
  tone?: CoinTone;
  /** The spent coins' colours: usually the surface's own tone, so they read as empty places. */
  ghost: CoinTone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const motion = useMotionPreference();
  const count = Math.max(1, Math.floor(total));
  const level = Math.max(0, Math.min(count, Math.round(filled)));
  const { edge, height } = discGeometry(width);
  // The level the coins last settled at, so a change knows which end moved.
  // Recorded only once motion can start, so a stack drawn before the
  // screen-reader answer arrives still drops in one coin after another.
  const previous = useRef<number | null>(null);
  const from = previous.current;
  useEffect(() => { if (motion.ready) previous.current = level; });
  return <View testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    style={[{ width, height: height + (count - 1) * edge, pointerEvents: 'none' }, style]}>
    {Array.from({ length: count }, (_, index) => {
      const top = (count - 1 - index) * edge;
      // First paint: bottom up. A drain: from the old top down. A refill: from the old top up.
      const order = from === null ? index : level < from ? from - 1 - index : index - from;
      return <View key={index} style={{ position: 'absolute', start: 0, top }}>
        <CoinDisc width={width} tone={ghost} shine={false} />
        <Slot on={index < level} delay={Math.max(0, order) * COIN_STAGGER} width={width} tone={tone}
          ready={motion.ready} reducedMotion={motion.reducedMotion} testID={testID ? `${testID}-coin-${index}` : undefined} />
      </View>;
    })}
  </View>;
}

/** One gold coin over its ghost: dropped in when it fills, lifted away when it is spent. */
function Slot({ on, delay, width, tone, ready, reducedMotion, testID }: {
  on: boolean;
  delay: number;
  width: number;
  tone: CoinTone;
  ready: boolean;
  reducedMotion: boolean;
  testID?: string;
}) {
  const shown = useAnimatedNumber(reducedMotion && on ? 1 : 0);
  const appeared = useRef(false);
  // Read when a move starts, not a dependency: a re-render that only recomputes
  // the stagger must not interrupt a coin already on its way.
  const wait = useRef(delay);
  wait.current = delay;
  useEffect(() => {
    const target = on ? 1 : 0;
    if (reducedMotion) {
      appeared.current = true;
      shown.setValue(target);
      return;
    }
    // Hold still until the screen-reader state is known (see use-reduced-motion).
    if (!ready) return;
    const first = !appeared.current;
    appeared.current = true;
    const move = Animated.sequence([
      Animated.delay(wait.current),
      Animated.spring(shown, { toValue: target, ...(first || on ? COIN_RISE : COIN_MOVE), useNativeDriver: nativeDriver }),
    ]);
    move.start();
    // A newer change carries on from wherever the coin is, so a quick edit
    // reverses it smoothly instead of snapping it home first.
    return () => move.stop();
  }, [on, ready, reducedMotion, shown]);
  const paint = useMemo(() => ({
    opacity: shown.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }],
  }), [shown]);
  return <Animated.View testID={testID} style={[{ position: 'absolute', start: 0, top: 0 }, paint]}>
    <CoinDisc width={width} tone={tone} />
  </Animated.View>;
}
