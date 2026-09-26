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

const BAR_HEIGHT = 90;

const shortMonth = (key: string) => monthLabel(key, true).split(' ')[0] ?? key;

/**
 * Whole-month bars for one merchant, set on the merchant page's clay band. A
 * month with no activity is drawn as an empty baseline rather than left out,
 * and months before the ledger's first entry are never in the series
 * (merchantMonthlySeries), so an empty bar always means a real zero. The
 * selected period's months are the near-cream bars, the others the band's
 * mark tone; bars grow from the baseline 50ms apart (still under Reduce
 * Motion, via GrowBar).
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
  const labelEvery = months.length <= 6;
  return <View style={styles.section} testID="merchant-month-by-month">
    <ThemedText type="smallBold" style={{ color: palette.onBand }}>{d.merchant.monthByMonth}</ThemedText>
    <View testID="merchant-month-bars" style={styles.bars}>
      {months.map((month, index) => {
        const showLabel = labelEvery || index === 0 || index === months.length - 1;
        return <View key={month.key} style={styles.column} accessible accessibilityRole="image"
          accessibilityLabel={d.merchant.month(monthLabel(month.key), formatAED(month.fils), month.count)}>
          <View style={styles.track}>
            {month.fils > 0
              ? <GrowBar axis="height" size={Math.max(4, (month.fils / max) * BAR_HEIGHT)} delay={index * 50}
                  style={[styles.bar, { backgroundColor: month.selected ? palette.onBand : palette.bandMark }]} />
              : <View style={[styles.empty, { backgroundColor: palette.bandRule }]} />}
          </View>
          <ThemedText type="meta" numberOfLines={1}
            style={[styles.label, { color: month.selected ? palette.onBand : palette.onBandSecondary }]}>
            {showLabel ? shortMonth(month.key) : ' '}
          </ThemedText>
        </View>;
      })}
    </View>
    <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{d.merchant.seriesNote}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  column: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 },
  track: { height: BAR_HEIGHT, alignSelf: 'stretch', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '100%', maxWidth: 44, borderRadius: 8 },
  empty: { width: '100%', maxWidth: 44, height: 3, borderRadius: 2 },
  label: { textAlign: 'center' },
});
