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
 * A column label in whole currency units ("142", "5,525"), as the design
 * draws the week. A day with spending that rounds to nothing reads "<1",
 * never "0" over a visible bar. Exact amounts stay in the chart's spoken
 * label and on Transactions.
 */
export const weekColumnText = (fils: number, spec: LedgerMoneySpec | null): string => {
  const minor = Math.max(0, Math.round(fils));
  if (minor === 0) return '0';
  const scale = 10 ** (spec?.exponent ?? 2);
  // Isolated left-to-right: Android ignores writingDirection, and a bare
  // "<" in an Arabic line would mirror into ">".
  if (minor * 2 < scale) return '\u2066<1\u2069';
  return spec ? formatMinorUnits(minor, spec, { decimals: false }) : formatAmount(Math.round(minor / scale) * scale);
};

/** Mono digits and marks advance 0.6em; charge 0.64 so a label never clips. */
const COLUMN_EM = 0.64;
const COLUMN_FONT = 12;
const COLUMN_LINE = 14;
const COLUMN_GAP = 6;

/**
 * Real daily values as seven columns on one shared scale, labelled in whole
 * units, with the currency and the dates above them. Larger text uses
 * labelled horizontal bars with the exact amounts instead, so nothing has
 * to shrink.
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
  const columns = days.map(day => weekColumnText(day.fils, spec));
  const columnWidth = (availableWidth - Math.max(0, days.length - 1) * 7) / Math.max(1, days.length);
  // onLayout uses this component's width, including split-screen / card insets.
  const horizontal = large;
  // A whole-unit label that is still wider than its column (a seven-figure
  // day) is set smaller rather than clipped or abbreviated.
  const columnFont = (label: string) => columnWidth > 0
    ? Math.min(COLUMN_FONT, columnWidth / (Math.max(1, label.length) * COLUMN_EM)) : COLUMN_FONT;
  const columnScale = (label: string) => Math.max(1, Math.min(fontScale,
    columnWidth / (Math.max(1, label.length) * COLUMN_EM * columnFont(label))));
  // Room above the tallest bar for its label at the size it is drawn.
  const valueRoom = COLUMN_GAP + Math.ceil(COLUMN_LINE * Math.max(1, ...columns.map(columnScale)));
  const longestValue = Math.max(1, ...values.map(value => value.length));
  const amountScale = Math.max(1, Math.min(fontScale, (availableWidth || 280) / (longestValue * 8)));
  const amountWidth = Math.max(64, longestValue * 8 * amountScale);
  const labelWidth = Math.max(32, ...days.map(day => day.label.length * 8 * fontScale));
  const stackedDetails = large || labelWidth + amountWidth + 72 > availableWidth;
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
          <View style={[styles.detailLine, stackedDetails && styles.stacked]}>
            <ThemedText type="meta" style={[styles.shortDay, day.today && styles.today, { color, width: stackedDetails ? undefined : labelWidth }]}>{day.label}</ThemedText>
            <View style={[styles.horizontalTrack, stackedDetails && styles.largeTrack, { backgroundColor: palette.tile }]}>
              <GrowBar axis="width" delay={index * 50} size={ratio * 100}
                style={[styles.horizontalBar, { backgroundColor: day.today ? palette.accent : palette.bandMark }]} />
            </View>
            <ThemedText type="meta" tabular maxFontSizeMultiplier={amountScale} style={[styles.value, styles.detailAmount, { color, width: stackedDetails ? undefined : amountWidth }]}>{values[index]}</ThemedText>
          </View>
        </View> : <View key={day.key} style={[styles.day, { width: columnWidth }]} testID={`week-value-${day.key}`}>
          {/* The figure rides on its own bar, as the design draws the week. */}
          <View style={[styles.track, { height: height + valueRoom }]}>
            <ThemedText type="nano" tabular maxFontSizeMultiplier={columnScale(columns[index]!)}
              style={[styles.value, { color, fontSize: columnFont(columns[index]!), lineHeight: COLUMN_LINE }]}>{columns[index]}</ThemedText>
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
  details: { gap: 9 },
  detailLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shortDay: { minWidth: 32 },
  detailAmount: { minWidth: 64, textAlign: 'right' },
  largeTrack: { flex: undefined, width: '100%' },
  detail: { gap: 5 },
  horizontalTrack: { flex: 1, minWidth: 32, height: 6, borderRadius: 3 },
  horizontalBar: { height: 6, borderRadius: 3 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  // Use the same measured width as the fit check. Native relayout otherwise
  // expanded these flex columns beyond the container and clipped the weekend.
  day: { minWidth: 0, alignItems: 'center', gap: 6 },
  value: { textTransform: 'none', letterSpacing: 0, writingDirection: 'ltr', flexShrink: 1 },
  track: { width: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: COLUMN_GAP },
  bar: { width: '100%', borderRadius: 8 },
  label: { textAlign: 'center' },
  today: { fontFamily: Fonts.sansSemi },
});
