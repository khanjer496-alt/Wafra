import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GrowBar } from '@/components/ui/grow-bar';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney, useMoneyLocaleKey } from '@/hooks/use-ledger-money';
import { formatAmount } from '@/lib/format';
import { formatMinorUnits, type LedgerMoneySpec } from '@/lib/ledger-money';

export interface WeekTileDay {
  key: string;
  /** Short visible label ("Fri", or an initial). */
  label: string;
  /** Full spoken label ("Friday"). */
  spokenLabel: string;
  fils: number;
  today: boolean;
}

/** Longest value drawn above a bar ("12,345"); longer ones are only spoken. */
const MAX_VALUE_CHARS = 6;

const valueText = (fils: number, spec: LedgerMoneySpec | null, _localeKey: string) => spec
  ? formatMinorUnits(Math.round(Math.abs(fils)), spec, { decimals: false })
  : formatAmount(Math.abs(fils), { decimals: false });

/**
 * Seven (or any number of) day bars drawn from real figures: height from the
 * day's value against the busiest day, the value above each bar in whole
 * currency units, today in the mint accent and every other day in the band's
 * own mark tone. Bars grow from the baseline 50ms apart on first appearance
 * (static under Reduce Motion). At the accessibility text sizes the numbers
 * above the bars step aside — the spoken label always carries every day.
 */
export function WeekTiles({ days, palette, moneySpec, height = 70, accessibilityLabel, testID }: {
  days: readonly WeekTileDay[];
  palette: BandPalette;
  moneySpec?: LedgerMoneySpec;
  /** Tallest bar, in points. */
  height?: number;
  /** The whole week spoken ("This week, AED 1,000. Saturday AED 142, …"). */
  accessibilityLabel: string;
  testID?: string;
}) {
  const contextMoney = useLedgerMoney();
  const localeKey = useMoneyLocaleKey();
  const large = useLargeTextLayout();
  const spec = moneySpec ?? contextMoney;
  const max = Math.max(1, ...days.map((day) => day.fils));
  // A figure is never cut into a misleading "12,3…": native shrinks it to fit
  // (down to 60%); a figure too long for a bar column is left to the spoken
  // label rather than drawn clipped.
  const shown = (fils: number) => {
    if (fils <= 0) return '';
    const value = valueText(fils, spec, localeKey);
    return value.length <= MAX_VALUE_CHARS ? value : '';
  };
  return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={styles.row}>
    {days.map((day, index) => {
      const size = day.fils > 0 ? Math.max(6, Math.round((day.fils / max) * height)) : 3;
      return <View key={day.key} style={styles.day}>
        {!large ? <ThemedText type="nano" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
          style={[styles.value, { color: day.today ? palette.onBand : palette.onBandSecondary }]}>
          {shown(day.fils)}
        </ThemedText> : null}
        <View style={[styles.track, { height }]}>
          <GrowBar axis="height" delay={index * 50} size={size}
            style={[styles.bar, { backgroundColor: day.today ? palette.accent : palette.bandMark }]} />
        </View>
        <ThemedText type="meta" numberOfLines={1}
          style={[styles.label, day.today && styles.today, { color: day.today ? palette.onBand : palette.onBandSecondary }]}>
          {day.label}
        </ThemedText>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  day: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 },
  value: { textTransform: 'none', letterSpacing: 0 },
  track: { width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 8 },
  label: { textAlign: 'center' },
  today: { fontFamily: Fonts.sansSemi },
});
