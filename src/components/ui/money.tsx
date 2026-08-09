import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText, type TextType } from '@/components/themed-text';
import { Fonts, Motion, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { formatAmount } from '@/lib/format';
import { ledgerCurrencyDisplay } from '@/lib/markets';

type Sign = 'none' | 'auto' | 'minus' | 'plus';

interface MoneyProps {
  fils: number;
  type?: TextType;
  /** Colour of the figure. Defaults to ink. */
  color?: string;
  sign?: Sign;
  decimals?: boolean;
  /** The demoted currency prefix. On by default. */
  prefix?: boolean;
  style?: StyleProp<ViewStyle>;
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

function CurrencyPrefix() {
  return (
    <ThemedText themeColor="textSecondary" style={styles.currencyPrefix}>
      {ledgerCurrencyDisplay()}
    </ThemedText>
  );
}

/**
 * A money figure with its currency demoted: 15px mono in `textSecondary`,
 * sitting on the amount's baseline, so the digits carry the line.
 */
export function Money({
  fils,
  type = 'small',
  color,
  sign = 'none',
  decimals = false,
  prefix = true,
  style,
}: MoneyProps) {
  return (
    <View style={[styles.inline, style]}>
      {prefix && (
        <CurrencyPrefix />
      )}
      <ThemedText type={type} tabular style={color ? { color } : undefined}>
        {signGlyph(fils, sign)}
        {formatAmount(Math.abs(fils), { decimals })}
      </ThemedText>
    </View>
  );
}

/**
 * Hero figure that counts from its previous value on a period change.
 * 900ms, once — a figure that re-animates on every render reads as a glitch.
 */
export function CountUpMoney({
  fils,
  type = 'display',
  color,
  durationMs = Motion.countUp,
}: {
  fils: number;
  type?: TextType;
  color?: string;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(fils);
  const fromRef = useRef(fils);
  const frame = useRef<number | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const from = fromRef.current;
    if (from === fils) return;
    // Reduce Motion, or a screen reader that would announce every frame.
    if (reduced) {
      setDisplay(fils);
      fromRef.current = fils;
      return;
    }
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 4); // ease-out-quart
      setDisplay(Math.round(from + (fils - from) * eased));
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = fils;
      }
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      fromRef.current = fils;
    };
  }, [fils, durationMs, reduced]);

  return <Money fils={display} type={type} color={color} />;
}

interface AmountFieldProps {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  /** 38 on the new-entry sheet, 34 in the limit editor. */
  fontSize?: number;
  helper?: string;
  autoFocus?: boolean;
}

/**
 * The amount input: caps label, demoted currency, a big mono figure on a
 * 1.5px ink underline with a primary caret.
 */
export function AmountField({
  label,
  value,
  onChangeText,
  fontSize = 38,
  helper,
  autoFocus,
}: AmountFieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="micro" themeColor="textTertiary">
        {label}
      </ThemedText>
      <View style={[styles.fieldRow, { borderBottomColor: theme.text }]}>
        <CurrencyPrefix />
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          autoFocus={autoFocus}
          placeholder="0"
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.primary}
          cursorColor={theme.primary}
          style={[
            styles.input,
            {
              color: theme.text,
              fontSize,
              lineHeight: fontSize * 1.1,
              letterSpacing: fontSize * -0.02,
            },
          ]}
        />
      </View>
      {helper && (
        <ThemedText type="meta" themeColor="textTertiary">
          {helper}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The demoted currency: 15px mono in textSecondary, on the amount's baseline.
  currencyPrefix: {
    fontFamily: Fonts.monoMedium,
    fontSize: 15,
    lineHeight: 19,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two - 2,
  },
  field: {
    gap: Spacing.two,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
    borderBottomWidth: 1.5,
    paddingBottom: Spacing.two,
  },
  input: {
    flex: 1,
    padding: 0,
    fontFamily: Fonts.monoSemi,
    fontVariant: ['tabular-nums'],
  },
});
