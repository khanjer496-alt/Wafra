import React, { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GrowBar } from '@/components/ui/grow-bar';
import { MaxContentWidth, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { detailsWords } from '@/lib/details-copy';
import { formatAED, formatAmount, monthLabel } from '@/lib/format';
import { merchantMonthlySeries } from '@/lib/merchant-insights';
import type { Period } from '@/lib/period';
import type { Transaction } from '@/lib/types';

/** Tallest column in the chart, in points. */
const COLUMN_HEIGHT = 64;
/** At most this many columns share one line; a longer series wraps onto more lines. */
const COLUMNS_PER_LINE = 6;
const COLUMN_GAP = 6;
/** The band's side gutters (BAND_GUTTER on each side), inside its MaxContentWidth column. */
const BAND_GUTTERS = 40;
/** Generous advance of one 13pt Geist Mono glyph, so a column never clips its value. */
const GLYPH_WIDTH = 13 * 0.64;

/** "Sep 2026" without its year, for a column label. */
function columnMonth(key: string): string {
  return monthLabel(key, true).replace(/\s*\d{4}$/, '');
}

/**
 * Whole-month bars for one merchant, set on the merchant page's clay band. A
 * month with no activity is drawn as an empty baseline rather than left out,
 * and months before the ledger's first entry are never in the series
 * (merchantMonthlySeries), so an empty bar always means a real zero. The
 * selected period's months are the near-cream bars, the others the band's
 * mark tone. Months sit side by side as columns (up to six a line), each with
 * its exact amount above (the currency is on the total above the chart) and
 * the month under it. At an accessibility text size, or when an amount is too
 * long for its column, every month takes a full-width row with its amount and
 * currency instead, so no figure is ever cut. Each month is spoken whole.
 */
export function MerchantMonthBars({ transactions, merchant, period, live, internal, kind, monthStartDay, palette }: {
  transactions: readonly Transaction[];
  merchant: string;
  period: Period;
  live: Set<string>;
  internal: Set<string>;
  kind: 'expense' | 'income';
  /** monthKey reads the active salary-day setting; a change must recompute. */
  monthStartDay?: number;
  /** The band the bars sit on. */
  palette: BandPalette;
}) {
  const language = useLanguage();
  const d = detailsWords(language);
  const months = useMemo(() => merchantMonthlySeries(transactions, merchant, period, live, internal, kind),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, merchant, period, live, internal, kind, monthStartDay]);
  const large = useLargeTextLayout();
  const { width, fontScale } = useWindowDimensions();
  if (months.length === 0) return null;
  const max = Math.max(1, ...months.map(month => month.fils));
  const perLine = Math.min(COLUMNS_PER_LINE, months.length);
  const lineCount = Math.ceil(months.length / perLine);
  // Balance the lines (ten months: two lines of five) on one shared width.
  const columns = Math.ceil(months.length / lineCount);
  const columnWidth = (Math.min(width, MaxContentWidth) - BAND_GUTTERS - COLUMN_GAP * (COLUMNS_PER_LINE - 1)) / COLUMNS_PER_LINE;
  const glyph = GLYPH_WIDTH * Math.max(1, fontScale);
  const values = months.map(month => formatAmount(month.fils));
  // Both the amount and the month name (a full Arabic name) must fit their column.
  const fitsColumn = values.every(value => value.length * glyph <= columnWidth)
    && months.every(month => columnMonth(month.key).length * glyph <= columnWidth);
  const spoken = (month: typeof months[number]) => d.merchant.month(monthLabel(month.key), formatAED(month.fils), month.count);
  const heading = <ThemedText type="smallBold" style={{ color: palette.onBand }}>{d.merchant.monthByMonth}</ThemedText>;
  const note = <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{d.merchant.seriesNote}</ThemedText>;

  if (!large && fitsColumn) {
    const lines = Array.from({ length: lineCount }, (_, line) => months.slice(line * columns, line * columns + columns));
    return <View style={styles.section} testID="merchant-month-by-month">
      {heading}
      <View testID="merchant-month-bars" style={styles.lines}>
        {lines.map((line, lineIndex) => <View key={line[0]?.key ?? lineIndex} style={styles.columns}>
          {line.map((month, offset) => {
            const index = lineIndex * columns + offset;
            const bar = month.selected ? palette.onBand : palette.bandMark;
            return <View key={month.key} style={styles.cell} accessible accessibilityRole="image"
              accessibilityLabel={spoken(month)}>
              <ThemedText type="meta" tabular style={[styles.value, { color: month.fils > 0 ? palette.onBand : palette.onBandSecondary }]}>
                {values[index]}
              </ThemedText>
              <View style={styles.well}>
                {month.fils > 0
                  ? <GrowBar axis="height" size={Math.max(4, month.fils / max * COLUMN_HEIGHT)} delay={index * 50}
                      style={[styles.columnBar, { backgroundColor: bar }]} />
                  : <View style={[styles.baseline, { backgroundColor: palette.bandRule }]} />}
              </View>
              <ThemedText type="meta" style={{ color: month.selected ? palette.onBand : palette.onBandSecondary }}>
                {columnMonth(month.key)}
              </ThemedText>
            </View>;
          })}
          {/* Keep a short last line on the same column width as the first. */}
          {Array.from({ length: columns - line.length }, (_, pad) => <View key={`pad-${pad}`} style={styles.cell} />)}
        </View>)}
      </View>
      {note}
    </View>;
  }

  return <View style={styles.section} testID="merchant-month-by-month">
    {heading}
    <View testID="merchant-month-bars" style={styles.bars}>
      {months.map((month, index) => {
        return <View key={month.key} style={styles.column} accessible accessibilityRole="image"
          accessibilityLabel={spoken(month)}>
          <View style={styles.heading}>
            <ThemedText type="meta" style={{ color: month.selected ? palette.onBand : palette.onBandSecondary }}>
              {monthLabel(month.key)}
            </ThemedText>
            <ThemedText type="meta" tabular maxFontSizeMultiplier={1.5} style={[styles.value, { color: palette.onBand }]}>
              {formatAED(month.fils)}
            </ThemedText>
          </View>
          <View style={styles.track}>
            {month.fils > 0
              ? <GrowBar axis="width" size={month.fils / max * 100} delay={index * 50}
                  style={[styles.bar, { backgroundColor: month.selected ? palette.onBand : palette.bandMark }]} />
              : <View style={[styles.empty, { backgroundColor: palette.bandRule }]} />}
          </View>
        </View>;
      })}
    </View>
    {note}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  bars: { gap: 14 },
  column: { gap: 6 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 },
  value: { writingDirection: 'ltr', flexShrink: 1 },
  track: { width: '100%', height: 8 },
  bar: { height: 8, borderRadius: 4 },
  empty: { width: '100%', height: 1 },
  lines: { gap: 12 },
  columns: { flexDirection: 'row', gap: COLUMN_GAP, alignItems: 'flex-end' },
  cell: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4 },
  well: { height: COLUMN_HEIGHT, width: '100%', justifyContent: 'flex-end' },
  columnBar: { width: '100%', borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  baseline: { height: 2, width: '100%', borderRadius: 1 },
});
