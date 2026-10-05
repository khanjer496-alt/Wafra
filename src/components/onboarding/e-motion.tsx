/**
 * Onboarding E's motion pieces (boards E1, E10, E11), each with its Reduce
 * Motion answer built in:
 *
 * - `StepLayer`: one step's layer in the gate. Between two steps the old one
 *   stays a moment on its own colour while its content fades away, and the new
 *   content rises in as it goes, so there is never an empty colour field. Core
 *   Animated on the native driver (opacity and transform), so Android runs it
 *   too. Reduce Motion or a screen reader swaps the steps at once.
 * - `StepWipe`: the next step's colour grows as a circle from the Continue
 *   button over 420ms (bezier .2,.8,.2,1), over the old step and under the new
 *   content. Under Reduce Motion, a running screen reader or on Android (whose
 *   measured motion bypasses stay) the circle is never drawn and the old step
 *   cross-fades away over the new one instead.
 * - `LogoDraw`: Welcome's mark draws its stroke once; still otherwise.
 * - `useReplayKey`: remounts the example pattern every few seconds so its
 *   tiles pop in again, only while motion is allowed.
 *
 * Transform and opacity only; money is never animated here.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated as CoreAnimated, Easing as CoreEasing, Keyboard, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { Motion } from '@/constants/theme';
import { useMotionPreference } from '@/hooks/use-reduced-motion';

export const E_EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
/** The wipe's length: a first appearance. */
export const WIPE_MS = Motion.appear;

/** Whether this device should run the E flourishes (not Android, not Reduce Motion, not a screen reader). */
export function useEMotion(): boolean {
  const motion = useMotionPreference();
  return motion.ready && !motion.reducedMotion && Platform.OS !== 'android';
}

/** Whether the step change itself animates (all platforms; not Reduce Motion, not a screen reader). */
export function useStepMotion(): boolean {
  const motion = useMotionPreference();
  return motion.ready && !motion.reducedMotion;
}

/**
 * The step change is sequenced, never overlapped: the old content fades out
 * over this long, then the new content fades in. Under the wipe the growing
 * colour fills the gap; without one (Android, or two steps of one colour) the
 * band stays and only the content goes out and comes in. The back control
 * and progress dots do not fade: the old ones go at once, the new ones are
 * there at once, so they read as one header that updates.
 */
export const STEP_LEAVE_MS = 120;
/** The new content starts once the old has gone. */
export const STEP_ARRIVE_DELAY_MS = STEP_LEAVE_MS;
/**
 * How long the gate keeps a leaving step drawn: until its content (and,
 * without a wipe, its colour) has faded; under the wipe the circle then
 * paints the old colour itself. Always inside the gate's 350ms settle lock,
 * so the old step is gone before anything on the new one can be pressed, and
 * nothing on the old one can act while it is drawn.
 */
export function stepLeaveHoldMs(_wipe: boolean): number {
  return STEP_LEAVE_MS + 40;
}

/** What a step's frame needs from its layer: whether it is leaving, and the content's fade. */
export interface StepPhase {
  leaving: boolean;
  /** Opacity and lift for the step's content (not its header); null outside the gate. */
  paint: React.ComponentProps<typeof CoreAnimated.View>['style'] | null;
}
const NO_PHASE: StepPhase = { leaving: false, paint: null };
const StepPhaseContext = React.createContext<StepPhase>(NO_PHASE);
/** The layer's phase for EStepFrame: its header hides at once when leaving; its content fades. */
export function useStepPhase(): StepPhase {
  return React.useContext(StepPhaseContext) ?? NO_PHASE;
}

/** A step that has just been left, still drawn while it fades. */
export interface LeavingStep<S extends string = string> {
  step: S;
  /** Its band. */
  color: string;
  /** Its change drew the wipe: it sits under the circle instead of fading whole. */
  wipe: boolean;
  /** The element last committed for it, so it is not mounted again. */
  element: React.ReactNode;
}

/**
 * The steps still leaving after a change to `active`: the one just left joins
 * (at most two are kept, the newest last) and a step being returned to is no
 * longer leaving. Pure, so a discarded render cannot lose or double one.
 */
export function withLeavingStep<S extends string>(current: readonly LeavingStep<S>[], left: LeavingStep<S>, active: S): LeavingStep<S>[] {
  return [...current.filter((item) => item.step !== left.step && item.step !== active), left].slice(-2);
}

/**
 * While steps are leaving: the keyboard closes (keystrokes must not reach a
 * field on a step that has gone) and, on the web, focus leaves the old step's
 * controls. Once the newest has faded (stepLeaveHoldMs), every
 * leaving step is let go together, so an earlier one never drops out abruptly.
 */
export function useLeavingRelease(leaving: readonly { wipe: boolean }[], release: () => void): void {
  const latest = useRef(release);
  latest.current = release;
  useEffect(() => {
    if (leaving.length === 0) return;
    Keyboard.dismiss();
    if (Platform.OS === 'web' && typeof document !== 'undefined') (document.activeElement as HTMLElement | null)?.blur?.();
    const hold = Math.max(...leaving.map((item) => stepLeaveHoldMs(item.wipe)));
    const timer = setTimeout(() => latest.current(), hold);
    return () => clearTimeout(timer);
  }, [leaving]);
}

/**
 * One step's layer. `leaving` keeps the step drawn (on `color`, its own band)
 * while its content fades and lifts away — under the wipe, or, without one,
 * the whole layer fades off the step beneath. An arriving layer's content
 * rises in. Hidden from assistive tech and touch while it leaves; it comes
 * back if the person returns to that step before it is gone.
 */
export function StepLayer({ leaving, wipe, arriving, follows = false, color, onCommit, children }: {
  leaving: boolean;
  /** This change draws the wipe (the leaving content goes under it, its colour stays for the circle). */
  wipe: boolean;
  /** Animate the content in on mount; false shows it at once. */
  arriving: boolean;
  /** Another step is leaving: wait for its content to go before arriving. */
  follows?: boolean;
  /** The step's band, painted behind it only while it leaves. */
  color: string;
  /** Told the element each time it is committed (effects run only for committed renders). */
  onCommit?: (element: React.ReactNode) => void;
  children: React.ReactNode;
}) {
  const moving = useStepMotion();
  useEffect(() => { onCommit?.(children); }, [children, onCommit]);
  const animate = moving && arriving;
  const content = useAnimatedNumber(animate ? 0 : 1);
  const layer = useAnimatedNumber(1);
  useEffect(() => {
    if (!moving) {
      content.setValue(leaving ? 0 : 1);
      layer.setValue(leaving ? 0 : 1);
      return;
    }
    const run = leaving
      ? CoreAnimated.parallel([
          CoreAnimated.timing(content, { toValue: 0, duration: STEP_LEAVE_MS, easing: CoreEasing.in(CoreEasing.quad),
            useNativeDriver: nativeDriver }),
          ...(wipe ? [] : [CoreAnimated.timing(layer, { toValue: 0, duration: STEP_LEAVE_MS,
            easing: CoreEasing.inOut(CoreEasing.quad), useNativeDriver: nativeDriver })]),
        ])
      : CoreAnimated.parallel([
          CoreAnimated.timing(content, { toValue: 1, duration: Motion.change, delay: follows ? STEP_ARRIVE_DELAY_MS : 0,
            easing: CoreEasing.out(CoreEasing.cubic), useNativeDriver: nativeDriver }),
          CoreAnimated.timing(layer, { toValue: 1, duration: Motion.tap, useNativeDriver: nativeDriver }),
        ]);
    run.start();
    // Interrupted (the person came back, or the layer is removed): the next
    // run carries on from wherever the values are.
    return () => run.stop();
    // `wipe` and `follows` are read when a change starts, not followed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, moving, content, layer]);
  const phase = useMemo<StepPhase>(() => ({ leaving, paint: {
    opacity: content,
    transform: [{ translateY: content.interpolate({ inputRange: [0, 1], outputRange: [leaving ? -10 : 14, 0] }) }],
  } }), [content, leaving]);
  // The frame (EStepFrame) applies the fade to its content and hides its
  // header while leaving, so two headers are never drawn over each other.
  return <CoreAnimated.View pointerEvents={leaving ? 'none' : 'box-none'}
    accessibilityElementsHidden={leaving} importantForAccessibility={leaving ? 'no-hide-descendants' : 'auto'}
    aria-hidden={leaving || undefined}
    style={[StyleSheet.absoluteFillObject, styles.layer, leaving && { backgroundColor: color }, { opacity: layer }]}>
    <StepPhaseContext.Provider value={phase}>
      <View style={styles.layerContent}>{children}</View>
    </StepPhaseContext.Provider>
  </CoreAnimated.View>;
}

/**
 * The colour wipe between two steps: a circle of the new colour growing from
 * the Continue button, drawn over the leaving step and below the new step's
 * content, then removed; `onDone` fires once either way. `from` paints the old
 * colour under it when no leaving step is drawn there.
 */
export function StepWipe({ from, to, onDone, bottomOffset = 64 }: {
  from?: string;
  to: string;
  onDone: () => void;
  /** Distance of the Continue button's centre from the bottom edge. */
  bottomOffset?: number;
}) {
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(0);
  const done = useRef(onDone);
  done.current = onDone;
  // The circle must reach the far top corner from the button's centre.
  const originX = width / 2;
  const originY = height - bottomOffset;
  const radius = Math.ceil(Math.hypot(Math.max(originX, width - originX), originY)) + 8;
  useEffect(() => {
    progress.value = withTiming(1, { duration: WIPE_MS, easing: E_EASE });
    const timer = setTimeout(() => done.current(), WIPE_MS + 20);
    return () => clearTimeout(timer);
  }, [progress]);
  const circle = useAnimatedStyle(() => ({ transform: [{ scale: Math.max(0.001, progress.value) }] }));
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFillObject, { overflow: 'hidden' }, from ? { backgroundColor: from } : null]}>
    <Animated.View style={[{
      position: 'absolute', width: radius * 2, height: radius * 2, borderRadius: radius,
      left: originX - radius, top: originY - radius, backgroundColor: to,
    }, circle]} />
  </View>;
}

const styles = StyleSheet.create({
  layer: { alignItems: 'center' },
  layerContent: { flex: 1, width: '100%' },
});

const AnimatedPath = Animated.createAnimatedComponent(Path);
/** Longer than either stroke of the mark, so a full dash hides it. */
const LOGO_DASH = 60;

/** Wafra's mark (wafra-logo.tsx's geometry), drawing its stroke once when motion is allowed. */
export function LogoDraw({ size = 38, color }: { size?: number; color: string }) {
  const moving = useEMotion();
  const draw = useSharedValue(moving ? 0 : 1);
  useEffect(() => {
    if (!moving) { draw.value = 1; return; }
    draw.value = withDelay(100, withTiming(1, { duration: 1400, easing: E_EASE }));
  }, [draw, moving]);
  const stroke = useAnimatedProps(() => ({ strokeDashoffset: LOGO_DASH * (1 - draw.value) }));
  const common = {
    fill: 'none', stroke: color, strokeWidth: 4.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    strokeDasharray: `${LOGO_DASH} ${LOGO_DASH}`,
  };
  return <Svg width={size} height={size} viewBox="0 0 48 48" accessible={false}>
    <AnimatedPath d="M8 15 L15.5 33 L23 19 L30.5 33 L40 11.5" {...common} animatedProps={stroke} />
    <AnimatedPath d="M34 11.5 H40 V17.5" {...common} animatedProps={stroke} />
  </Svg>;
}

/** A key that changes every `periodMs` while motion is allowed, to replay a pop-in. */
export function useReplayKey(periodMs: number): number {
  const moving = useEMotion();
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => setKey((value) => value + 1), periodMs);
    return () => clearInterval(timer);
  }, [moving, periodMs]);
  return key;
}
