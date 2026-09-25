import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText, type TextType } from '@/components/themed-text';
import { EASE, Fonts, Motion, Spacing } from '@/constants/theme';
import { useLedgerMoney, useMoneyLocaleKey } from '@/hooks/use-ledger-money';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { formatAmount } from '@/lib/format';
import { currencyDisplayLabel, currencyPlacement, formatMinorUnits, type LedgerMoneySpec } from '@/lib/ledger-money';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { diffRollingGlyphs, rollingDelay, type RollingGlyph } from '@/lib/rolling-digits';

const EASING = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);

type Sign = 'none' | 'auto' | 'minus' | 'plus';

interface RollingMoneyProps {
  fils: number;
  moneySpec?: LedgerMoneySpec;
  type?: TextType;
  color?: string;
  sign?: Sign;
  decimals?: boolean;
  prefix?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * Android keeps figures static by default, like the rest of the app's
   * Android motion (bypassed after device traces). Opt in only with a
   * measurement on a real device.
   */
  motionOnAndroid?: boolean;
  testID?: string;
  /**
   * Extra style for the figure's text (language E's band figures set Geist
   * SemiBold with tabular digits and their own size). Applied after the type.
   */
  figureStyle?: StyleProp<TextStyle>;
  /** Extra style for the currency label (its colour on a band). */
  prefixStyle?: StyleProp<TextStyle>;
  /** Larger Text ceiling for the figure (a width-fitted multiplier). */
  maxFontSizeMultiplier?: number;
}

function signGlyph(fils: number, sign: Sign): string {
  switch (sign) {
    case 'minus':
      return '−';
    case 'plus':
      return '+';
    case 'auto':
      return fils < 0 ? '−' : '+';
    default:
      return fils < 0 ? '−' : '';
  }
}

/* The same formatting Money uses, argument for argument: the locale key is an
 * argument only so a device settings change re-formats a memoized figure. */
function figureText(
  fils: number,
  denomination: LedgerMoneySpec | null,
  decimals: boolean | undefined,
  _localeKey: string,
): string {
  return denomination
    ? formatMinorUnits(Math.round(Math.abs(fils)), denomination, decimals === true ? { decimals: true } : undefined)
    : formatAmount(Math.abs(fils), { decimals });
}
const placementFor = (currency: string, _localeKey: string) => currencyPlacement(currency);
const labelFor = (code: string, _localeKey: string) => currencyDisplayLabel(code);

/** One rolling position: the old digit leaves upward as the new one arrives. */
function RollingGlyphView({ glyph, height, type, color, figureStyle, maxFontSizeMultiplier }: {
  glyph: RollingGlyph;
  height: number;
  type: TextType;
  color?: string;
  figureStyle?: StyleProp<TextStyle>;
  maxFontSizeMultiplier?: number;
}) {
  const progress = useSharedValue(glyph.changed ? 0 : 1);
  useEffect(() => {
    if (!glyph.changed) return;
    progress.value = withDelay(
      rollingDelay(glyph, Motion.digitStagger),
      withTiming(1, { duration: Motion.change, easing: EASING }),
    );
  }, [glyph, progress]);

  const incoming = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * height }],
  }));
  const outgoing = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateY: -progress.value * height }],
  }));
  const textStyle = [styles.glyph, figureStyle, color ? { color } : undefined];

  if (!glyph.changed) {
    return <ThemedText type={type} tabular style={textStyle} maxFontSizeMultiplier={maxFontSizeMultiplier}>{glyph.char}</ThemedText>;
  }
  return (
    <View style={styles.clip}>
      <Animated.View style={incoming}>
        <ThemedText type={type} tabular style={textStyle} maxFontSizeMultiplier={maxFontSizeMultiplier}>{glyph.char}</ThemedText>
      </Animated.View>
      {glyph.previous ? (
        <Animated.View style={[StyleSheet.absoluteFill, outgoing]}>
          <ThemedText type={type} tabular style={textStyle} maxFontSizeMultiplier={maxFontSizeMultiplier}>{glyph.previous}</ThemedText>
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * A money figure that rolls ONLY its changed digits when the value changes —
 * once, each changed digit 60 ms after the last, over the change duration.
 * Unchanged digits, marks and the currency never move; the first appearance
 * is static; nothing ever spins.
 *
 * Opt-in and separate from Money on purpose: it formats with the same helpers
 * and speaks the same label (currency ISO code + full formatted amount), so
 * swapping one for the other changes motion, never content. Under Reduce
 * Motion or a running screen reader it is exactly a static figure — a
 * screen reader hears the final value once, not digits in flight.
 */
export function RollingMoney({
  fils,
  moneySpec,
  type = 'small',
  color,
  sign = 'none',
  decimals,
  prefix = true,
  style,
  motionOnAndroid = false,
  testID,
  figureStyle,
  prefixStyle,
  maxFontSizeMultiplier,
}: RollingMoneyProps) {
  const contextMoney = useLedgerMoney();
  const localeKey = useMoneyLocaleKey();
  const reducedMotion = useReducedMotion();
  const denomination = moneySpec ?? contextMoney;
  const currency = denomination?.currency ?? ledgerCurrencyDisplay();
  const amount = `${signGlyph(fils, sign)}${figureText(fils, denomination, decimals, localeKey)}`;
  const label = `${prefix ? `${currency} ` : ''}${amount}`;
  const placement = placementFor(currency, localeKey);
  const motion = !reducedMotion && (Platform.OS !== 'android' || motionOnAndroid);

  // Derived during render (not in an effect) so the frame that first shows a
  // new value is already the rolling one — never a flash of the final figure.
  const [shown, setShown] = useState(amount);
  // Keyed by the value it rolls to: consecutive values always differ, so a
  // change arriving mid-roll restarts cleanly from what was on screen.
  const [roll, setRoll] = useState<{ id: string; glyphs: RollingGlyph[] } | null>(null);
  if (amount !== shown) {
    setShown(amount);
    const glyphs = motion ? diffRollingGlyphs(shown, amount) : [];
    setRoll(glyphs.some((glyph) => glyph.changed) ? { id: amount, glyphs } : null);
  }
  // Settle back to one static text once the last digit has landed.
  useEffect(() => {
    if (!roll) return;
    const rolling = roll.glyphs.filter((glyph) => glyph.changed).length;
    const timer = setTimeout(() => setRoll(null),
      Math.max(0, rolling - 1) * Motion.digitStagger + Motion.change + 34);
    return () => clearTimeout(timer);
  }, [roll]);
  // Motion switched off mid-roll (a screen reader started): stop at once.
  const activeRoll = motion ? roll : null;

  // The figure's line box, measured on its static paint (a first appearance is
  // always static), is how far a digit travels. Unmeasured → cross-fade only.
  const [lineHeight, setLineHeight] = useState(0);

  const currencyNode = prefix ? (
    <ThemedText themeColor="textSecondary" style={[styles.currencyPrefix, prefixStyle]}>
      {labelFor(currency, localeKey)}
    </ThemedText>
  ) : null;
  const figure = activeRoll ? (
    <View key={activeRoll.id} style={styles.glyphRow}>
      {activeRoll.glyphs.map((glyph) => (
        <RollingGlyphView key={glyph.key} glyph={glyph} height={lineHeight} type={type} color={color} figureStyle={figureStyle} maxFontSizeMultiplier={maxFontSizeMultiplier} />
      ))}
    </View>
  ) : (
    <ThemedText type={type} tabular maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.value, figureStyle, color ? { color } : undefined]}
      onLayout={({ nativeEvent }) => {
        const next = Math.round(nativeEvent.layout.height);
        if (next !== lineHeight) setLineHeight(next);
      }}>
      {amount}
    </ThemedText>
  );
  const [first, second] = placement.position === 'after' ? [figure, currencyNode] : [currencyNode, figure];
  return (
    <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={label}
      style={[styles.inline, !placement.spaced && styles.tight, style]}>
      {first}
      {second}
    </View>
  );
}

const styles = StyleSheet.create({
  currencyPrefix: {
    fontFamily: Fonts.sansMedium,
    fontSize: 15,
    lineHeight: 19,
  },
  inline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: Spacing.two - 2,
  },
  tight: { gap: 1 },
  value: { flexShrink: 1, minWidth: 0 },
  // Figures read left to right in every language, Arabic included.
  glyphRow: { flexDirection: 'row', direction: 'ltr', alignItems: 'baseline' },
  glyph: { flexShrink: 0 },
  clip: { overflow: 'hidden' },
});
