/**
 * Motion shared by Wafra's coin drawings (Spending's coin row, Home's budget
 * stack, a goal's jar, a transfer's route).
 *
 * Every coin moves on core Animated with the native driver, paint only
 * (opacity and transform), so Android animates without layout work. Reduce
 * Motion, or a running screen reader, puts every coin where it ends at once:
 * the drawing is never the only place a figure is written.
 *
 * A group of coins that moves one after another (a stack, a row of day
 * columns, an arriving row and its coin) runs on ONE native-driven clock: a
 * linear `Animated.timing` in milliseconds. Each coin reads its own window of
 * that clock through an interpolation that traces the spring it used to run
 * (rise, overshoot, landing squash), so the whole stagger plays on the UI
 * thread. `Animated.delay` and `Animated.sequence` are JS timers: with them
 * each coin's spring started only when a JS timer fired, and a busy JS thread
 * just after launch or resume delivered the coins late and in clumps.
 */
import { useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';

import { MotionSpring } from '@/constants/theme';

export const nativeDriver = Platform.OS !== 'web';

/** A coin settling into place: quick, with one visible bounce. */
export const COIN_RISE = { stiffness: 240, damping: 15, mass: 0.9 } as const;
/** A tapped coin popping up: snappier, a little more overshoot. */
export const COIN_POP = { stiffness: 320, damping: 14, mass: 0.8 } as const;
/** A coin travelling or a stack changing level: the app's one spring, no wobble. */
export const COIN_MOVE = { ...MotionSpring, overshootClamping: true } as const;
/** Coins in a sequence start this far apart. */
export const COIN_STAGGER = 45;

/** One Animated.Value for the component's life, allocated once. */
export function useAnimatedNumber(initial: number): Animated.Value {
  const ref = useRef<Animated.Value | null>(null);
  if (!ref.current) ref.current = new Animated.Value(initial);
  return ref.current;
}

export interface CoinSpring {
  stiffness: number;
  damping: number;
  mass: number;
  overshootClamping?: boolean;
}

/**
 * A spring from 0 to 1 drawn ahead of time: sample times (ms from its start,
 * strictly increasing, the first 0) and the progress at each (above 1 while it
 * overshoots, exactly 1 at the last). `restMs` is when React Native's own
 * spring would report it finished, so a step that followed it still starts
 * when it used to.
 */
export interface CoinCurve {
  readonly times: readonly number[];
  readonly values: readonly number[];
  readonly restMs: number;
}

const FRAME_MS = 1000 / 60;
/** Progress error allowed when thinning the samples: far below a pixel at coin sizes. */
const CURVE_TOLERANCE = 0.002;

/**
 * The spring Animated.spring runs (the same closed form, damping ratio
 * branches and rest thresholds: 0.001 of displacement and of speed), sampled
 * once a frame and thinned to the points a straight line between cannot
 * stand in for.
 */
export function springCurve(spring: CoinSpring): CoinCurve {
  const k = spring.stiffness;
  const m = spring.mass;
  const zeta = spring.damping / (2 * Math.sqrt(k * m));
  const omega0 = Math.sqrt(k / m);
  const omega1 = omega0 * Math.sqrt(Math.max(0, 1 - zeta * zeta));
  const at = (t: number): [number, number] => {
    if (zeta < 1) {
      const envelope = Math.exp(-zeta * omega0 * t);
      const sin = Math.sin(omega1 * t);
      const cos = Math.cos(omega1 * t);
      const position = 1 - envelope * ((zeta * omega0 / omega1) * sin + cos);
      const velocity = zeta * omega0 * envelope * ((sin * zeta * omega0) / omega1 + cos) -
        envelope * (cos * zeta * omega0 - omega1 * sin);
      return [position, velocity];
    }
    const envelope = Math.exp(-omega0 * t);
    return [1 - envelope * (1 + omega0 * t), envelope * t * omega0 * omega0];
  };
  const times = [0];
  const values = [0];
  // Ten seconds is far past any spring the app uses; the loop always ends.
  for (let frame = 1; frame <= 600; frame += 1) {
    const ms = frame * FRAME_MS;
    const [position, velocity] = at(ms / 1000);
    const overshooting = spring.overshootClamping === true && position > 1;
    const resting = Math.abs(1 - position) <= 0.001 && Math.abs(velocity) <= 0.001;
    times.push(ms);
    if (overshooting || resting || frame === 600) {
      values.push(1);
      break;
    }
    values.push(position);
  }
  const keep = simplify(times, values, CURVE_TOLERANCE);
  return { times: keep.map((i) => times[i]!), values: keep.map((i) => values[i]!), restMs: times[times.length - 1]! };
}

/** Indices of the samples kept (Ramer–Douglas–Peucker on the progress axis). */
function simplify(times: readonly number[], values: readonly number[], tolerance: number): number[] {
  const kept = new Set<number>([0, times.length - 1]);
  const visit = (first: number, last: number) => {
    let worst = -1;
    let worstError = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const share = (times[i]! - times[first]!) / (times[last]! - times[first]!);
      const line = values[first]! + (values[last]! - values[first]!) * share;
      const error = Math.abs(values[i]! - line);
      if (error > worstError) { worst = i; worstError = error; }
    }
    if (worst < 0) return;
    kept.add(worst);
    visit(first, worst);
    visit(worst, last);
  };
  visit(0, times.length - 1);
  return [...kept].sort((a, b) => a - b);
}

/** The coin springs, drawn once. */
export const COIN_RISE_CURVE = springCurve(COIN_RISE);
export const COIN_MOVE_CURVE = springCurve(COIN_MOVE);

/** One move of one coin on a group clock: from `from` to `to`, starting `at` ms into the run. */
export interface CoinStep {
  at: number;
  from: number;
  to: number;
  curve: CoinCurve;
}

/** Where a coin's moves end, in ms from the start of the run. */
export function coinStepsEnd(steps: readonly CoinStep[]): number {
  return steps.reduce((end, step) => Math.max(end, step.at + step.curve.times[step.curve.times.length - 1]!), 0);
}

/** A coin's value: a plain value when it stands still, its target plus a window of the clock while it moves. */
export type CoinNode = Animated.Value | Animated.AnimatedAddition<number>;

/**
 * One coin on its group's clock. It rests at `target`; while its steps run it
 * is offset from there by where they put it, so before the first step it shows
 * that step's `from` and after the last it shows `target`. A coin with no
 * steps is a plain value at `target` and is not tied to the clock at all.
 */
export function coinTrack(clock: Animated.Value, base: number, target: number, steps: readonly CoinStep[]): CoinNode {
  const rest = new Animated.Value(target);
  const input: number[] = [];
  const output: number[] = [];
  for (const step of steps) {
    step.curve.times.forEach((time, index) => {
      const moment = base + step.at + time;
      // Interpolation needs increasing input; a later step never starts before an earlier one ends.
      if (input.length > 0 && moment <= input[input.length - 1]!) return;
      input.push(moment);
      output.push(step.from + (step.to - step.from) * step.curve.values[index]! - target);
    });
  }
  if (input.length < 2) return rest;
  return Animated.add(rest, clock.interpolate({ inputRange: input, outputRange: output, extrapolate: 'clamp' }));
}

/** A planned run of a group's clock; `state` keeps an interrupted run from replaying. */
export interface CoinRun {
  base: number;
  end: number;
  state: 'pending' | 'running' | 'done';
}

/**
 * A group's one clock. It only moves forward: every run is reserved after the
 * last one, so the coins of a new plan read "not started" (their `from`) at
 * whatever value the clock still holds, and nothing flashes between plans.
 */
export interface CoinClock {
  readonly value: Animated.Value;
  /** Reserve `duration` ms after every run already planned. */
  reserve(duration: number): CoinRun;
  /** Run the clock across the reserved window on the UI thread; the returned stop lands it at the end. */
  play(run: CoinRun): () => void;
}

const linear = (t: number) => t;

export function createCoinClock(): CoinClock {
  const value = new Animated.Value(0);
  let reserved = 0;
  return {
    value,
    reserve(duration) {
      const base = reserved;
      reserved = base + Math.max(1, Math.ceil(duration));
      return { base, end: reserved, state: 'pending' };
    },
    play(run) {
      value.setValue(run.base);
      const animation = Animated.timing(value, {
        toValue: run.end, duration: run.end - run.base, easing: linear,
        isInteraction: false, useNativeDriver: nativeDriver,
      });
      animation.start();
      // Interrupted (a newer plan, unmount, the app leaving the foreground),
      // every coin lands where it was going.
      return () => {
        animation.stop();
        value.setValue(run.end);
      };
    },
  };
}

/** One clock for the component's life. */
export function useCoinClock(): CoinClock {
  const ref = useRef<CoinClock | null>(null);
  if (!ref.current) ref.current = createCoinClock();
  return ref.current;
}

/**
 * Plays `run` on `clock` once, while `live` (motion allowed, the screen
 * visible and the app in the foreground). Leaving `live`, replacing the run or
 * unmounting lands every coin at its end; a landed run never replays.
 */
export function useCoinRun(clock: CoinClock, run: CoinRun | null, live: boolean): void {
  useEffect(() => {
    if (!run || !live || run.state !== 'pending') return;
    run.state = 'running';
    const land = clock.play(run);
    return () => {
      land();
      run.state = 'done';
    };
  }, [clock, run, live]);
}
