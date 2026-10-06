import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, View, type StyleProp, type ViewStyle } from 'react-native';

import { CoinDisc, GOLD, discGeometry, type CoinTone } from '@/components/ui/coins/coin-disc';
import { CoinColors } from '@/constants/theme';
import {
  COIN_MOVE_CURVE, COIN_RISE_CURVE, COIN_STAGGER, coinStepsEnd, coinTrack, useCoinClock, useCoinRun,
  type CoinClock, type CoinNode, type CoinRun, type CoinStep,
} from '@/components/ui/coins/coin-motion';
import { useAppActive } from '@/hooks/use-app-active';
import { useMotionPreference } from '@/hooks/use-reduced-motion';

/**
 * What a stack draws: each coin's value (0 an empty place, 1 gold) and, when
 * the level moves, the one clock run that moves them.
 */
interface StackPlan {
  /** Held below the stack before its first reveal; nothing counts as shown yet. */
  held: boolean;
  /** Where every coin ends, so an unchanged level keeps the same drawing. */
  ends: readonly number[];
  coins: readonly CoinNode[];
  run: CoinRun | null;
}

/**
 * The coins' moves from `from` (null: never shown) to `level`. First paint
 * drops the gold coins in from the bottom; a drain lifts them off from the
 * old top down; a refill drops new ones on from the old top up. A coin whose
 * place does not change (every empty place, every coin that stays) has no
 * move at all.
 */
export function stackSteps(count: number, from: number | null, level: number): (CoinStep | null)[] {
  const start = from ?? 0;
  return Array.from({ length: count }, (_, index) => {
    const was = index < start ? 1 : 0;
    const now = index < level ? 1 : 0;
    if (was === now) return null;
    const order = from === null ? index : level < start ? start - 1 - index : index - start;
    return { at: Math.max(0, order) * COIN_STAGGER, from: was, to: now, curve: now === 1 ? COIN_RISE_CURVE : COIN_MOVE_CURVE };
  });
}

function planStack(clock: CoinClock, count: number, level: number, settled: number | null,
  live: boolean, reducedMotion: boolean): StackPlan {
  const ends = Array.from({ length: count }, (_, index) => (index < level ? 1 : 0));
  // Reduce Motion, or a change while the stack cannot be watched (the app in
  // the background, Home behind the lock or the splash): the level at once.
  if (reducedMotion || (!live && settled !== null) || settled === level) {
    return { held: false, ends, coins: ends.map((end) => new Animated.Value(end)), run: null };
  }
  // The first reveal waits, below the stack, until it can be watched.
  if (!live) return { held: true, ends: ends.map(() => 0), coins: ends.map(() => new Animated.Value(0)), run: null };
  const steps = stackSteps(count, settled, level);
  const moving = steps.filter((step): step is CoinStep => step !== null);
  // Nothing changes place (an empty stack's first paint): nothing to run.
  if (moving.length === 0) return { held: false, ends, coins: ends.map((end) => new Animated.Value(end)), run: null };
  const run = clock.reserve(coinStepsEnd(moving));
  return {
    held: false, ends,
    coins: steps.map((step, index) => coinTrack(clock.value, run.base, ends[index]!, step ? [step] : [])),
    run,
  };
}

const sameEnds = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * A stack of `total` flat coins, `filled` of them gold from the bottom and the
 * rest drawn as ghosts: what is left sits at the bottom, what has gone is the
 * empty space above it. On first paint the gold coins drop in from the bottom
 * one after another; a later change lifts spent coins off the top (or drops
 * new ones on), so the level visibly moves. The whole stagger is one
 * native-driven clock (coin-motion.ts). Reduce Motion shows the level at
 * once, and so does a change made while the app is in the background.
 * `hold` keeps the first reveal waiting (Home behind the splash or the lock).
 * Decorative: the parent writes and speaks the figure.
 */
export function CoinStack({ total, filled, width, tone = GOLD, ghost, hold = false, style, testID }: {
  total: number;
  filled: number;
  width: number;
  tone?: CoinTone;
  /** The spent coins' colours: usually the surface's own tone, so they read as empty places. */
  ghost: CoinTone;
  /** The screen is not visible yet: hold the first reveal, land later changes at once. */
  hold?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const motion = useMotionPreference();
  const active = useAppActive();
  const live = motion.ready && active && !hold;
  const count = Math.max(1, Math.floor(total));
  const level = Math.max(0, Math.min(count, Math.round(filled)));
  const { face, edge, height } = discGeometry(width);
  // The soft shadow the stack casts where it stands, so it sits on the
  // surface rather than floating over it; it reaches a little past the coin.
  const shadow = Math.max(2, Math.round(face * 0.22));
  const clock = useCoinClock();
  // The level the coins last settled at, so a change knows which end moved.
  // Recorded only once the stack has been shown, so a stack drawn before the
  // screen-reader answer (or behind the splash) still drops in one coin after another.
  const settled = useRef<number | null>(null);
  const drawn = useRef<StackPlan | null>(null);
  const plan = useMemo(() => {
    const next = planStack(clock, count, level, settled.current, live, motion.reducedMotion);
    // Nothing to move and the same drawing: keep the coins already on screen.
    const current = drawn.current;
    return current && !next.run && next.held === current.held && sameEnds(next.ends, current.ends) ? current : next;
    // `settled` and `drawn` are read when the inputs change, never as triggers.
  }, [clock, count, level, live, motion.reducedMotion]);
  useEffect(() => {
    drawn.current = plan;
    if (!plan.held) settled.current = level;
  }, [plan, level]);
  // Reduce Motion turning on mid-run lands the coins too.
  useCoinRun(clock, plan.run, live && !motion.reducedMotion);
  return <View testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    style={[{ width, height: height + (count - 1) * edge + shadow, pointerEvents: 'none' }, style]}>
    <View style={{ position: 'absolute', start: width * 0.04, width: width * 0.92, top: (count - 1) * edge + edge + shadow,
      height: face, borderRadius: width / 2, backgroundColor: CoinColors.shadow, opacity: 0.18,
      transform: [{ scaleY: 0.7 }] }} />
    {plan.coins.map((shown, index) => <View key={index} style={{ position: 'absolute', start: 0, top: (count - 1 - index) * edge }}>
      <CoinDisc width={width} tone={ghost} shine={false} />
      <Slot shown={shown} width={width} tone={tone} testID={testID ? `${testID}-coin-${index}` : undefined} />
    </View>)}
  </View>;
}

/** One gold coin over its ghost, painted from its value: dropped in at 1, lifted away at 0. */
function Slot({ shown, width, tone, testID }: {
  shown: CoinNode;
  width: number;
  tone: CoinTone;
  testID?: string;
}) {
  const paint = useMemo(() => ({
    opacity: shown.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
    transform: [
      { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
      // The spring overshoots its landing a little; the coin squashes there,
      // wider and flatter for a beat, then settles round.
      { scaleX: shown.interpolate({ inputRange: [0, 1, 1.12], outputRange: [1, 1, 1.12], extrapolate: 'clamp' }) },
      { scaleY: shown.interpolate({ inputRange: [0, 1, 1.12], outputRange: [1, 1, 0.72], extrapolate: 'clamp' }) },
    ],
  }), [shown]);
  return <Animated.View testID={testID} style={[{ position: 'absolute', start: 0, top: 0 }, paint]}>
    <CoinDisc width={width} tone={tone} />
  </Animated.View>;
}
