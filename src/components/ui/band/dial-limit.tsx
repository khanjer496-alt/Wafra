import React, { useMemo, useRef } from 'react';
import { PanResponder, Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLedgerMoney, useMoneyLocaleKey } from '@/hooks/use-ledger-money';
import { tapped } from '@/lib/haptics';
import { bandCopy } from '@/lib/band-copy';
import { formatAmount, ledgerTypicalMinor } from '@/lib/format';
import { currencyDisplayLabel, formatMinorUnits, type LedgerMoneySpec } from '@/lib/ledger-money';
import { ledgerCurrencyDisplay } from '@/lib/markets';

const SIZE = 150;
const STROKE = 18;
const RADIUS = (200 - STROKE) / 2 - 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Snap to the step, inside [0, max]. Pure; exported for tests. */
export function snapDialValue(valueMinor: number, stepMinor: number, maxMinor: number): number {
  const step = Math.max(1, Math.round(stepMinor));
  const snapped = Math.round(valueMinor / step) * step;
  return Math.max(0, Math.min(maxMinor, snapped));
}

/** The value a touch at (x, y) inside a `size` box points at, clockwise from the top. */
export function dialValueAt(x: number, y: number, size: number, maxMinor: number, stepMinor: number): number {
  const angle = Math.atan2(x - size / 2, -(y - size / 2));
  const turn = (angle < 0 ? angle + 2 * Math.PI : angle) / (2 * Math.PI);
  return snapDialValue(turn * maxMinor, stepMinor, maxMinor);
}

const text = (minor: number, spec: LedgerMoneySpec | null, _localeKey: string) => spec
  ? formatMinorUnits(Math.round(minor), spec, { decimals: false })
  : formatAmount(minor, { decimals: false });

/**
 * A monthly limit set by turning a dial: the arc fills clockwise to the
 * value, the value sits in the middle with its currency, and ± steppers
 * either side move it by one currency-scaled step (`ledgerTypicalMinor(25)`:
 * AED 25, ¥2,500, KWD 2.500). Adjustable for assistive tech — swipe up/down
 * raises or lowers by a step and the value is announced with its currency.
 * The dial never animates the number; the caller saves.
 */
export function DialLimit({ valueMinor, onChange, maxMinor, stepMinor, palette, on = 'sheet', label, moneySpec, testID }: {
  valueMinor: number;
  onChange: (next: number) => void;
  /** Full turn. Defaults to four times the value or ~AED 5,000, whichever is larger. */
  maxMinor?: number;
  stepMinor?: number;
  palette: BandPalette;
  /** Colours for a dial set on the sheet (Limit sheet) or on a band (onboarding). */
  on?: 'sheet' | 'band';
  /** What the limit is for ("Dining"), spoken with the value. */
  label: string;
  moneySpec?: LedgerMoneySpec;
  testID?: string;
}) {
  const words = bandCopy(useLanguage());
  const contextMoney = useLedgerMoney();
  const localeKey = useMoneyLocaleKey();
  const spec = moneySpec ?? contextMoney;
  const step = stepMinor ?? ledgerTypicalMinor(25);
  const max = maxMinor ?? Math.max(ledgerTypicalMinor(5000), snapDialValue(valueMinor * 4, step, Number.MAX_SAFE_INTEGER));
  const currency = spec?.currency ?? ledgerCurrencyDisplay();
  const valueText = text(valueMinor, spec, localeKey);
  const stepText = `${currency} ${text(step, spec, localeKey)}`;
  const colors = on === 'band'
    ? { track: palette.bandRule, arc: palette.onBand, fg: palette.onBand, fg2: palette.onBandSecondary, key: palette.tile }
    : { track: palette.rule, arc: palette.tint, fg: palette.text, fg2: palette.textSecondary, key: palette.card };
  const share = max > 0 ? Math.max(0, Math.min(1, valueMinor / max)) : 0;

  const latest = useRef({ max, step, onChange, valueMinor });
  latest.current = { max, step, onChange, valueMinor };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      const next = dialValueAt(locationX, locationY, SIZE, latest.current.max, latest.current.step);
      if (next !== latest.current.valueMinor) latest.current.onChange(next);
    },
    onPanResponderMove: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      const next = dialValueAt(locationX, locationY, SIZE, latest.current.max, latest.current.step);
      if (next !== latest.current.valueMinor) latest.current.onChange(next);
    },
    onPanResponderTerminationRequest: () => false,
  }), []);

  const nudge = (direction: 1 | -1) => {
    const next = snapDialValue(valueMinor + direction * step, step, max);
    if (next !== valueMinor) { tapped(); onChange(next); }
  };
  const onAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') nudge(1);
    if (event.nativeEvent.actionName === 'decrement') nudge(-1);
  };

  return <View testID={testID} style={styles.row}>
    <Pressable testID={testID ? `${testID}-lower` : undefined} accessibilityRole="button" accessibilityLabel={words.lower(stepText)}
      onPress={() => nudge(-1)} style={({ pressed }) => [styles.stepper, { borderColor: colors.track, backgroundColor: colors.key, opacity: pressed ? 0.7 : 1 }]}>
      <ThemedText type="heading" style={{ color: colors.fg }}>−</ThemedText>
    </Pressable>
    <View accessible accessibilityRole="adjustable" accessibilityLabel={`${label}, ${words.limitPerMonth}`}
      accessibilityValue={{ text: `${currency} ${valueText}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={onAction}
      style={styles.dial} {...pan.panHandlers}>
      <Svg width={SIZE} height={SIZE} viewBox="0 0 200 200">
        <Circle cx={100} cy={100} r={RADIUS} fill="none" stroke={colors.track} strokeWidth={STROKE} />
        {share > 0 ? <Circle cx={100} cy={100} r={RADIUS} fill="none" stroke={colors.arc} strokeWidth={STROKE}
          strokeLinecap="round" strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          strokeDashoffset={CIRCUMFERENCE * (1 - share)} transform="rotate(-90 100 100)" /> : null}
      </Svg>
      <View pointerEvents="none" style={styles.center}>
        <ThemedText type="meta" style={{ color: colors.fg2 }}>{`${currencyDisplayLabel(currency)} · ${words.limitPerMonth}`}</ThemedText>
        <ThemedText tabular style={[styles.value, { color: colors.fg }]}>{valueText}</ThemedText>
      </View>
    </View>
    <Pressable testID={testID ? `${testID}-raise` : undefined} accessibilityRole="button" accessibilityLabel={words.raise(stepText)}
      onPress={() => nudge(1)} style={({ pressed }) => [styles.stepper, { borderColor: colors.track, backgroundColor: colors.key, opacity: pressed ? 0.7 : 1 }]}>
      <ThemedText type="heading" style={{ color: colors.fg }}>+</ThemedText>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, flexWrap: 'wrap' },
  dial: { width: SIZE, height: SIZE },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  value: { fontFamily: Fonts.sansSemi, fontVariant: ['tabular-nums'], fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  stepper: { width: 58, height: 58, borderRadius: 29, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
