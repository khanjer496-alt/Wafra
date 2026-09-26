import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GrowBar } from '@/components/ui/grow-bar';
import type { BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { detailsWords } from '@/lib/details-copy';
import { formatAED, monthLabel } from '@/lib/format';
import { merchantMonthlySeries } from '@/lib/merchant-insights';
import type { Period } from '@/lib/period';
import type { Transaction } from '@/lib/types';

/**
 * Whole-month bars for one merchant, set on the merchant page's clay band. A
 * month with no activity is drawn as an empty baseline rather than left out,
 * and months before the ledger's first entry are never in the series
 * (merchantMonthlySeries), so an empty bar always means a real zero. The
 * selected period's months are the near-cream bars, the others the band's
 * mark tone. Every month has its exact amount and currency above a shared
 * full-width track; long labels wrap without hiding figures.
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
  if (months.length === 0) return null;
  const max = Math.max(1, ...months.map(month => month.fils));
  return <View style={styles.section} testID="merchant-month-by-month">
    <ThemedText type="smallBold" style={{ color: palette.onBand }}>{d.merchant.monthByMonth}</ThemedText>
    <View testID="merchant-month-bars" style={styles.bars}>
      {months.map((month, index) => {
        return <View key={month.key} style={styles.column} accessible accessibilityRole="image"
          accessibilityLabel={d.merchant.month(monthLabel(month.key), formatAED(month.fils), month.count)}>
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
    <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{d.merchant.seriesNote}</ThemedText>
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
});
