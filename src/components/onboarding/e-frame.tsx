/**
 * The chrome every design-language-E onboarding step shares: a full-bleed
 * band colour, the back control and the five progress dots, one oversized
 * Geist headline, a scrolling body and plain 56pt buttons.
 *
 * The step's colour is its band (useBand), so dark mode deepens it exactly
 * as it deepens the tabs. The footer's actions (anything with an `onPress`)
 * are pinned below the scrolling body, above the bottom safe area and the
 * keyboard, so opening a Watch row or a long Arabic headline never pushes the
 * step's button off screen; they keep their order, so a screen reader meets
 * the content, then the primary action, then the quieter one. At the
 * accessibility sizes only the primary is pinned and the quieter actions end
 * the scroll (splitFooter). Status text in the footer (a restore note) is not
 * an action: it ends the scroll too. The body scrolls above the strip; a
 * hairline marks the edge while there is more to scroll. With the keyboard up
 * the strip is lifted over it on the native driver (no relayout), and a
 * focused field is scrolled clear of it.
 *
 * A step whose footer holds no primary action opts out (`pinActions={false}`)
 * and its footer ends the scroll: the paywall, whose purchase action stays
 * after its price, terms and legal links, and a capture step offering only
 * "How it works".
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type LayoutChangeEvent, type StyleProp,
  type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStepPhase } from '@/components/onboarding/e-motion';
import { ThemedText } from '@/components/themed-text';
import { nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { Icon } from '@/components/ui/icon';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { bandCopy } from '@/lib/band-copy';
import { tapped } from '@/lib/haptics';
import { ONBOARDING_E_TOTAL_STEPS } from '@/lib/onboarding-e';
import { onboardingECopy } from '@/lib/onboarding-e-copy';

/** The side gutter of the boards. */
export const E_GUTTER = 24;
/** The header row's height (back, dots, close) and the body's top padding: layout others line up with. */
export const E_TOP_ROW_HEIGHT = 52;
export const E_BODY_TOP = 12;

/**
 * The largest pattern tile (up to `max`) whose 6 × 2 grid fits the screen
 * between the gutters, with the mosaic's own proportional gap.
 */
export function fitPatternTile(screenWidth: number, max = 52): number {
  const room = Math.max(120, Math.min(screenWidth, 560) - E_GUTTER * 2);
  // 6 tiles and 5 gaps of tile × 6/52.
  return Math.max(16, Math.min(max, Math.floor(room / (6 + 5 * (6 / 52)))));
}

/** A primary button set on a band: the band's text colour as the fill, the band as its label. */
export function bandButtonColor(palette: BandPalette): { fill: string; text: string } {
  return { fill: palette.onBand, text: palette.band };
}

/** Five dots; the current one is a short bar, done ones solid, the rest faint. */
export function EProgressDots({ step, palette }: { step: number; palette: BandPalette }) {
  const words = onboardingECopy(useLanguage());
  const label = words.stepOf(step, ONBOARDING_E_TOTAL_STEPS);
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label}
    accessibilityValue={{ min: 1, max: ONBOARDING_E_TOTAL_STEPS, now: step, text: label }}
    style={styles.dots} testID="onboarding-progress">
    {Array.from({ length: ONBOARDING_E_TOTAL_STEPS }, (_, index) => {
      const n = index + 1;
      return <View key={n} style={[styles.dot, {
        width: n === step ? 18 : 6,
        backgroundColor: n <= step ? palette.onBand : palette.bandRule,
      }]} />;
    })}
  </View>;
}

/** Back (and, in the Settings preview, Close) above a step. */
export function ETopRow({ palette, step, onBack, onClose, disabled }: {
  palette: BandPalette;
  step: number | null;
  onBack?: () => void;
  onClose?: () => void;
  disabled?: boolean;
}) {
  const words = bandCopy(useLanguage());
  // A step leaving under the next one hides its header at once (the new one
  // is drawn at once), so the back control and dots are never doubled.
  const { leaving } = useStepPhase();
  return <View style={[styles.topRow, leaving && styles.hiddenRow]}>
    {onBack ? <Pressable accessibilityRole="button" accessibilityLabel={words.back} testID="onboarding-back"
      accessibilityState={{ disabled: !!disabled }} disabled={disabled} hitSlop={8}
      onPress={() => { tapped(); onBack(); }}
      style={({ pressed }) => [styles.iconButton, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Icon name="chevron-left" size={22} color={palette.onBand} strokeWidth={2.2} />
    </Pressable> : <View style={styles.iconButton} />}
    {step !== null ? <EProgressDots step={step} palette={palette} /> : <View />}
    {onClose ? <Pressable accessibilityRole="button" accessibilityLabel={words.close} testID="onboarding-close"
      onPress={onClose} hitSlop={8}
      style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}>
      <Icon name="close" size={20} color={palette.onBand} />
    </Pressable> : <View style={styles.iconButton} />}
  </View>;
}

/** The step headline: large Geist SemiBold, never serif, never italic. */
export function EHeadline({ children, palette, size = 44, testID }: {
  children: string;
  palette: BandPalette;
  size?: number;
  testID?: string;
}) {
  const largeText = useLargeTextLayout();
  // Oversized already: at the accessibility sizes it starts smaller, still
  // scales with the person's text size, and wraps — never a scale ceiling.
  const fontSize = largeText ? Math.round(size * 0.62) : size;
  return <ThemedText accessibilityRole="header" testID={testID}
    style={[styles.headline, { color: palette.onBand, fontSize, lineHeight: Math.round(fontSize * 1.06) }]}>
    {children}
  </ThemedText>;
}

/** Body copy on the band. */
export function EBody({ children, palette, secondary = true, style, testID }: {
  children: React.ReactNode;
  palette: BandPalette;
  secondary?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  return <ThemedText testID={testID} style={[styles.body, { color: secondary ? palette.onBandSecondary : palette.onBand }, style]}>
    {children}
  </ThemedText>;
}

/** A quiet text action on the band (Skip, Not now, Restore): 48pt tall. */
export function ETextAction({ label, onPress, palette, disabled, testID, accessibilityHint }: {
  label: string;
  onPress: () => void;
  palette: BandPalette;
  disabled?: boolean;
  testID?: string;
  accessibilityHint?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint}
    accessibilityState={{ disabled: !!disabled }} disabled={disabled} testID={testID}
    onPress={() => { tapped(); onPress(); }}
    style={({ pressed }) => [styles.textAction, { opacity: disabled ? 0.45 : pressed ? 0.6 : 1 }]}>
    <ThemedText type="smallBold" style={[styles.textActionLabel, { color: palette.onBand }]}>{label}</ThemedText>
  </Pressable>;
}

/**
 * The fragment type as the JSX runtime in use builds it (React's fragment
 * symbol in the app), so a footer written as `<>…</>` splits into its actions.
 */
const FRAGMENT_TYPE: unknown = (<></>).type;

/** A footer's actions in order: fragments and arrays flattened, empty slots dropped. */
export function footerActions(node: React.ReactNode): React.ReactNode[] {
  if (node === null || node === undefined || typeof node === 'boolean' || node === '') return [];
  if (Array.isArray(node)) return node.flatMap(footerActions);
  if (typeof node === 'object' && 'type' in node && node.type === FRAGMENT_TYPE) {
    return footerActions((node.props as { children?: React.ReactNode }).children);
  }
  return [node];
}

/** Whether a footer item is an action (a button or text action), not status text. */
function isAction(node: React.ReactNode): boolean {
  return typeof node === 'object' && node !== null && 'props' in node &&
    typeof (node.props as { onPress?: unknown }).onPress === 'function';
}

/**
 * Which footer items are pinned and which end the scroll. Pinned, every
 * action is, in its own order (primary first, as every step writes it); status
 * text is never pinned. Not pinned, the whole footer ends the scroll as written.
 *
 * At the accessibility sizes only the primary action is pinned: at 2–3x text
 * on a 640pt phone the primary and a quiet action together took 260–285pt, so
 * the quieter ones (Skip, Not now, Restore) end the scroll, straight after the
 * content. A screen reader then meets the content, the quiet action, and the
 * primary last — the trade for keeping two thirds of a small screen for the step.
 */
export function splitFooter(footer: React.ReactNode, pin = true, largeText = false): {
  pinned: React.ReactNode[];
  scrolled: React.ReactNode[];
} {
  const items = footerActions(footer);
  if (!pin) return { pinned: [], scrolled: items };
  const actions = items.filter(isAction);
  const primary = largeText ? actions.slice(0, 1) : actions;
  return { pinned: primary, scrolled: items.filter((item) => !primary.includes(item)) };
}

/**
 * How long the pinned strip takes to follow the keyboard: iOS reports the
 * keyboard as it starts to move (keyboardWillShow), so the strip rides with
 * it; Android reports it as it lands, so the strip settles quickly after.
 */
export const KEYBOARD_FOLLOW_MS = Platform.OS === 'ios' ? 250 : 180;

/**
 * How far the pinned strip lifts for a keyboard of `keyboard` points. The
 * frame already pads the bottom safe area: iOS reports the keyboard from the
 * screen's edge (so the home-indicator inset is inside it), Android (API 30+)
 * reports it above the navigation bar (ReactRootView: ime − systemBars), so
 * the safe area is never counted twice.
 */
export function keyboardLift(keyboard: number, bottomInset: number, platform: string = Platform.OS): number {
  if (!(keyboard > 0)) return 0;
  return platform === 'ios' ? Math.max(0, keyboard - bottomInset) : keyboard;
}

/**
 * Where to scroll so a focused field sits clear of the viewport's bottom edge
 * (the pinned strip and keyboard are below it), or below its top edge; null
 * when it is already in view. Window coordinates, as measureInWindow gives them.
 */
export function scrollTargetForInput({ viewTop, viewHeight, inputTop, inputHeight, offsetY, margin = 16 }: {
  viewTop: number; viewHeight: number; inputTop: number; inputHeight: number; offsetY: number; margin?: number;
}): number | null {
  const below = inputTop + inputHeight + margin - (viewTop + viewHeight);
  if (below > 0) return offsetY + below;
  const above = viewTop + margin - inputTop;
  if (above > 0) return Math.max(0, offsetY - above);
  return null;
}

/** Scrolls the body so the focused field is clear of the lifted strip, which covers `covered` points of the viewport's foot. */
function revealFocusedInput(scroll: ScrollView | null, offsetY: number, covered: number): void {
  const input = TextInput.State?.currentlyFocusedInput?.();
  const host = scroll?.getNativeScrollRef?.();
  if (!scroll || !input || !host) return;
  host.measureInWindow((_x, viewTop, _width, height) => {
    input.measureInWindow((_ix, inputTop, _iw, inputHeight) => {
      const viewHeight = Math.max(0, height - covered);
      const target = scrollTargetForInput({ viewTop, viewHeight, inputTop, inputHeight, offsetY });
      if (target !== null) scroll.scrollTo({ y: target, animated: true });
    });
  });
}

const keyed = (nodes: React.ReactNode[]) => nodes.map((node, index) => <React.Fragment key={index}>{node}</React.Fragment>);

/**
 * One step: the band, the top row, the scrolling body and, pinned under it,
 * the footer's actions. `step` lights a progress dot; null hides the dots.
 */
export function EStepFrame({ palette, step, onBack, onClose, backDisabled, footer, children, testID, contentStyle,
  pinActions = true }: {
  palette: BandPalette;
  step: number | null;
  onBack?: () => void;
  onClose?: () => void;
  backDisabled?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * False keeps the footer at the end of the scroll, after the content: a step
   * with no primary action to pin (the paywall keeps its purchase action with
   * its price, terms and links; a capture step with only "How it works").
   */
  pinActions?: boolean;
}) {
  const largeText = useLargeTextLayout();
  const insets = useSafeAreaInsets();
  const { pinned, scrolled } = splitFooter(footer, pinActions, largeText);
  // The pinned actions ride above the keyboard (Android's edge-to-edge window
  // does not resize for it: use-keyboard-height.ts). Paint only: the strip is
  // translated on the native driver, so nothing is laid out again while the
  // keyboard moves and the body never jumps; the body gains the same room at
  // its foot, under the strip, so every field can still scroll clear.
  const keyboard = useKeyboardHeight(pinned.length > 0);
  const keyboardBottom = keyboardLift(keyboard, insets.bottom);
  const motion = useMotionPreference();
  const lift = useAnimatedNumber(0);
  useEffect(() => {
    if (!motion.ready || motion.reducedMotion) { lift.setValue(-keyboardBottom); return; }
    const follow = Animated.timing(lift, { toValue: -keyboardBottom, duration: KEYBOARD_FOLLOW_MS,
      easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver });
    follow.start();
    return () => follow.stop();
  }, [keyboardBottom, lift, motion.ready, motion.reducedMotion]);
  // Whether the body is taller than its viewport: the pinned edge then shows a hairline.
  const sizes = useRef({ viewport: 0, content: 0 });
  const [overflows, setOverflows] = useState(false);
  const measure = () => setOverflows(sizes.current.content > sizes.current.viewport + 1);
  // The body shrinks for the keyboard rather than sliding under it, so iOS no
  // longer brings the focused field into view by itself: once the new layout
  // is in, scroll a field that would sit under the strip back into view.
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  useEffect(() => {
    if (keyboardBottom <= 0) return;
    // Once the strip has risen. The body's viewport already ends above the
    // strip's resting place, so only the lift covers it (not the strip again).
    const timer = setTimeout(() => revealFocusedInput(scrollRef.current, scrollY.current, keyboardBottom), KEYBOARD_FOLLOW_MS);
    return () => clearTimeout(timer);
  }, [keyboardBottom]);
  // In the gate the content fades with the step change; the header does not.
  const phase = useStepPhase();
  return <SafeAreaView edges={['top', 'bottom']} style={styles.safe} testID={testID}>
    <View style={styles.column}>
      {onBack || onClose || step !== null
        ? <ETopRow palette={palette} step={step} onBack={onBack} onClose={onClose} disabled={backDisabled} />
        : null}
      <Animated.View style={[styles.column, phase.paint]}>
        <ScrollView keyboardShouldPersistTaps="handled" bounces={largeText} alwaysBounceVertical={false}
          showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} style={styles.scrollView} ref={scrollRef}
          scrollEventThrottle={32} onScroll={(event) => { scrollY.current = event.nativeEvent.contentOffset.y; }}
          onLayout={(event: LayoutChangeEvent) => { sizes.current.viewport = event.nativeEvent.layout.height; measure(); }}
          onContentSizeChange={(_width: number, height: number) => { sizes.current.content = height; measure(); }}>
          <View style={[styles.body_, contentStyle]}>{children}</View>
          {scrolled.length > 0 ? <View style={styles.footer}>{keyed(scrolled)}</View> : null}
          {/* Room for the body to scroll clear of the lifted strip while the keyboard is up. */}
          {keyboardBottom > 0 ? <View testID={testID ? `${testID}-keyboard-room` : undefined} style={{ height: keyboardBottom }} /> : null}
        </ScrollView>
        {pinned.length > 0 ? <Animated.View testID={testID ? `${testID}-actions` : undefined}
          style={[styles.pinned, { backgroundColor: palette.band, borderTopColor: overflows || keyboardBottom > 0 ? palette.bandRule : 'transparent',
            transform: [{ translateY: lift }] }]}>
          {keyed(pinned)}
        </Animated.View> : null}
      </Animated.View>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },
  column: { flex: 1 },
  hiddenRow: { opacity: 0 },
  topRow: {
    minHeight: E_TOP_ROW_HEIGHT, paddingHorizontal: E_GUTTER - 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44 },
  dot: { height: 6, borderRadius: 3 },
  scrollView: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: E_GUTTER, paddingBottom: 20 },
  body_: { paddingTop: E_BODY_TOP, gap: 16 },
  /** What ends the scroll: footer status text, or a footer that is not pinned. */
  footer: { marginTop: 'auto', paddingTop: 24, gap: 6 },
  /** The pinned actions: under the body, above the bottom safe area. */
  pinned: { paddingHorizontal: E_GUTTER, paddingTop: 12, paddingBottom: 8, gap: 6, borderTopWidth: StyleSheet.hairlineWidth },
  headline: { fontFamily: Fonts.sansSemi, letterSpacing: -1.4 },
  body: { fontSize: 17, lineHeight: 25 },
  textAction: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  textActionLabel: { fontSize: 15, textAlign: 'center' },
});
