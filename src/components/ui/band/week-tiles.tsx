import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GrowBar } from '@/components/ui/grow-bar';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney, useMoneyLocaleKey } from '@/hooks/use-ledger-money';
import { formatAmount, shortDate } from '@/lib/format';
import { ledgerCurrencyDisplay } from '@/lib/markets';
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

const valueText = (fils: number, spec: LedgerMoneySpec | null, _localeKey: string) => spec
  ? formatMinorUnits(Math.round(fils), spec)
  : formatAmount(fils);

/**
 * Real daily values with exact amounts and currency always visible. Compact
 * columns are retained where all labels fit; larger text or long figures use
 * labelled horizontal bars with one shared scale and amounts above each bar.
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
  const { fontScale } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(0);
  const max = Math.max(1, ...days.map((day) => day.fils));
  const values = days.map(day => valueText(day.fils, spec, localeKey));
  const columnWidth = (availableWidth - Math.max(0, days.length - 1) * 7) / Math.max(1, days.length);
  // A conservative fit check avoids shrinking exact figures into tiny text.
  // onLayout uses this component's width, including split-screen / card insets.
  const horizontal = large || values.some(value => value.length * 7 * fontScale > columnWidth);
  const dateLabel = (day: WeekTileDay) => /^\d{4}-\d{2}-\d{2}$/.test(day.key) ? shortDate(day.key) : '';
  const first = days[0]; const last = days.at(-1);
  return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}
    onLayout={event => setAvailableWidth(event.nativeEvent.layout.width)} style={styles.root}>
    <View style={styles.heading}>
      <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{spec?.currency ?? ledgerCurrencyDisplay()}</ThemedText>
      {first && last && dateLabel(first) && dateLabel(last) ? <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>
        {dateLabel(first)} — {dateLabel(last)}
      </ThemedText> : null}
    </View>
    <View style={horizontal ? styles.details : styles.row}>
      {days.map((day, index) => {
        const color = day.today ? palette.onBand : palette.onBandSecondary;
        // Zero has no filled bar; all non-zero values share the same scale.
        const ratio = Math.max(0, day.fils) / max;
        return horizontal ? <View key={day.key} style={styles.detail} testID={`week-value-${day.key}`}>
          <View style={[styles.heading, large && styles.stacked]}>
            <ThemedText type="meta" style={[day.today && styles.today, { color }]}>
              {day.spokenLabel}{dateLabel(day) ? ` · ${dateLabel(day)}` : ''}
            </ThemedText>
            <ThemedText type="meta" tabular style={[styles.value, { color }]}>{values[index]}</ThemedText>
          </View>
          <View style={[styles.horizontalTrack, { backgroundColor: palette.tile }]}>
            <GrowBar axis="width" delay={index * 50} size={ratio * 100}
              style={[styles.horizontalBar, { backgroundColor: day.today ? palette.accent : palette.bandMark }]} />
          </View>
        </View> : <View key={day.key} style={styles.day} testID={`week-value-${day.key}`}>
          <ThemedText type="nano" tabular style={[styles.value, { color }]}>{values[index]}</ThemedText>
          <View style={[styles.track, { height }]}>
            <GrowBar axis="height" delay={index * 50} size={ratio * height}
              style={[styles.bar, { backgroundColor: day.today ? palette.accent : palette.bandMark }]} />
          </View>
          <ThemedText type="meta" style={[styles.label, day.today && styles.today, { color }]}>{day.label}</ThemedText>
        </View>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 },
  stacked: { flexDirection: 'column', alignItems: 'flex-start' },
  details: { gap: 12 },
  detail: { gap: 5 },
  horizontalTrack: { width: '100%', height: 8, borderRadius: 4 },
  horizontalBar: { height: 8, borderRadius: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  day: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 },
  value: { textTransform: 'none', letterSpacing: 0, writingDirection: 'ltr', flexShrink: 1 },
  track: { width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 8 },
  label: { textAlign: 'center' },
  today: { fontFamily: Fonts.sansSemi },
});
