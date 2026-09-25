import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Motion, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { keypadHasDecimal, type KeypadDigit, type KeypadKey } from '@/lib/amount-keypad';
import { keyed } from '@/lib/haptics';

interface AmountKeypadProps {
  /** The entry currency's ISO exponent: 0 hides the decimal key, 3 allows three decimals. */
  exponent: number;
  onKey: (key: KeypadKey) => void;
  /** Spoken names for the two non-digit keys and the grid. */
  labels: { keypad: string; decimal: string; backspace: string };
  /** The device's decimal mark, shown on the decimal key ("." or ","). */
  decimalMark: string;
  disabled?: boolean;
  testID?: string;
}

const ROWS: readonly (readonly KeypadDigit[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

function BackspaceGlyph({ color }: { color: string }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round">
      <Path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" />
      <Path d="M17.5 9.5l-5 5M12.5 9.5l5 5" />
    </Svg>
  );
}

/**
 * The in-app amount keypad on Add: 1–9, then decimal · 0 · delete. Every key
 * is a real 56pt button with a spoken name and a soft tick. The decimal key is
 * absent (an empty cell keeps the grid) for a whole-unit currency.
 *
 * Laid out left-to-right in every language, like a phone's own dial pad —
 * Arabic phones do not mirror their number pads either.
 */
export function AmountKeypad({
  exponent,
  onKey,
  labels,
  decimalMark,
  disabled = false,
  testID = 'amount-keypad',
}: AmountKeypadProps) {
  const theme = useTheme();
  const press = (key: KeypadKey) => {
    if (disabled) return;
    keyed();
    onKey(key);
  };
  const keyStyle = ({ pressed }: { pressed: boolean }) => [
    styles.key,
    { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
      opacity: disabled ? 0.4 : 1 },
  ];
  const digit = (value: KeypadDigit) => (
    <Pressable key={value} testID={`${testID}-${value}`} accessibilityRole="button"
      accessibilityLabel={value} accessibilityState={{ disabled }} disabled={disabled}
      onPress={() => press(value)} style={keyStyle}>
      <ThemedText style={styles.keyText}>{value}</ThemedText>
    </Pressable>
  );
  return (
    <View testID={testID} accessibilityLabel={labels.keypad} style={styles.grid}>
      {ROWS.map((row) => (
        <View key={row.join('')} style={styles.row}>{row.map(digit)}</View>
      ))}
      <View style={styles.row}>
        {keypadHasDecimal(exponent) ? (
          <Pressable testID={`${testID}-decimal`} accessibilityRole="button"
            accessibilityLabel={labels.decimal} accessibilityState={{ disabled }} disabled={disabled}
            onPress={() => press('decimal')} style={keyStyle}>
            <ThemedText style={styles.keyText}>{decimalMark}</ThemedText>
          </Pressable>
        ) : <View style={styles.key} importantForAccessibility="no" />}
        {digit('0')}
        <Pressable testID={`${testID}-backspace`} accessibilityRole="button"
          accessibilityLabel={labels.backspace} accessibilityState={{ disabled }} disabled={disabled}
          onPress={() => press('backspace')} style={keyStyle}>
          <BackspaceGlyph color={theme.text} />
        </Pressable>
      </View>
    </View>
  );
}

interface KeypadAmountDisplayProps {
  /** ISO code of the entry currency, shown demoted before the figure. */
  currency: string;
  /** The formatted keypad string ("1,284.5"); "0" when empty. */
  text: string;
  empty: boolean;
  /** Increments on every added character; the newest one fades in. */
  fadeKey: number;
  /** False under Reduce Motion or a screen reader: no fade at all. */
  animate: boolean;
  invalid?: boolean;
  /** One sentence for a screen reader: the currency and the whole amount. */
  spokenLabel: string;
  errorText?: string;
  testID?: string;
}

/** What a form can do with the display: move assistive focus to it. */
export interface KeypadAmountDisplayHandle {
  focus: () => void;
}

/**
 * The amount as the keypad builds it. The character just added fades in over
 * 90 ms (never a movement, and nothing at all under Reduce Motion); the rest
 * of the figure is plain text. Figures read left to right in every language.
 *
 * Its ref answers `focus()` by moving screen-reader focus here, so a form's
 * "focus the first invalid field" lands on the amount even though no text
 * input is mounted while the keypad is in use.
 */
export const KeypadAmountDisplay = forwardRef<KeypadAmountDisplayHandle, KeypadAmountDisplayProps>(function KeypadAmountDisplay({
  currency,
  text,
  empty,
  fadeKey,
  animate,
  invalid = false,
  spokenLabel,
  errorText,
  testID = 'amount-display',
}, ref) {
  const theme = useTheme();
  const figureRef = useRef<View>(null);
  useImperativeHandle(ref, () => ({
    focus: () => {
      const node = findNodeHandle(figureRef.current);
      if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    },
  }), []);
  const color = empty ? theme.textTertiary : theme.text;
  // Step the size down as the figure grows so twelve digits and their group
  // marks still fit one line on a 360pt phone.
  const size = text.length > 12 ? { fontSize: 32, lineHeight: 40 }
    : text.length > 8 ? { fontSize: 40, lineHeight: 50 } : null;
  const head = empty ? text : text.slice(0, -1);
  const tail = empty ? '' : text.slice(-1);
  return (
    <View style={styles.displayWrap}>
      <View ref={figureRef} testID={testID} accessible accessibilityRole="text" accessibilityLabel={spokenLabel}
        accessibilityLiveRegion="polite"
        style={[styles.display, { borderBottomColor: invalid ? theme.expense : 'transparent' }]}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.displayCurrency}>{currency}</ThemedText>
        <View style={styles.figure}>
          <ThemedText tabular style={[styles.figureText, size, { color }]}>{head}</ThemedText>
          {tail ? (
            <Animated.View key={fadeKey}
              entering={animate && fadeKey > 0 ? FadeIn.duration(Motion.keyFade) : undefined}>
              <ThemedText tabular style={[styles.figureText, size, { color }]}>{tail}</ThemedText>
            </Animated.View>
          ) : null}
        </View>
      </View>
      {errorText ? (
        <ThemedText type="meta" themeColor="expense" accessibilityLiveRegion="polite" style={styles.displayError}>
          {errorText}
        </ThemedText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  grid: { gap: Spacing.two, direction: 'ltr' },
  row: { flexDirection: 'row', gap: Spacing.two },
  key: {
    flex: 1,
    minHeight: 56,
    borderRadius: Radius.control + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { fontFamily: Fonts.sansMedium, fontSize: 24, lineHeight: 30 },
  displayWrap: { gap: Spacing.one, alignItems: 'center' },
  display: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: Spacing.two,
    direction: 'ltr',
    borderBottomWidth: 2,
    paddingBottom: Spacing.one,
    maxWidth: '100%',
  },
  displayCurrency: { fontSize: 18, lineHeight: 24 },
  figure: { flexDirection: 'row', alignItems: 'baseline', flexShrink: 1 },
  figureText: { fontFamily: Fonts.monoSemi, fontSize: 48, lineHeight: 58, letterSpacing: -1 },
  displayError: { textAlign: 'center' },
});
