import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GrowBar } from '@/components/ui/grow-bar';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { detailsWords } from '@/lib/details-copy';
import { formatAED, monthLabel } from '@/lib/format';
import { merchantMonthlySeries } from '@/lib/merchant-insights';
import type { Period } from '@/lib/period';
import type { Transaction } from '@/lib/types';

const BAR_HEIGHT = 64;

const shortMonth = (key: string) => monthLabel(key, true).split(' ')[0] ?? key;

/**
 * Whole-month bars for one merchant, for the merchant page. A month with no
 * activity is drawn as an empty baseline rather than left out, and months
 * before the ledger's first entry are never in the series
 * (merchantMonthlySeries), so an empty bar always means a real zero.
 */
export function MerchantMonthBars({ transactions, merchant, period, live, internal, kind, monthStartDay }: {
  transactions: readonly Transaction[];
  merchant: string;
  period: Period;
  live: Set<string>;
  internal: Set<string>;
  kind: 'expense' | 'income';
  /** monthKey reads the active salary-day setting; a change must recompute. */
  monthStartDay?: number;
}) {
  const theme = useTheme(); const language = useLanguage();
  const d = detailsWords(language);
  const months = useMemo(() => merchantMonthlySeries(transactions, merchant, period, live, internal, kind),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, merchant, period, live, internal, kind, monthStartDay]);
  if (months.length === 0) return null;
  const max = Math.max(1, ...months.map(month => month.fils));
  const labelEvery = months.length <= 6;
  const color = kind === 'income' ? theme.income : theme.primary;
  return <View style={styles.section} testID="merchant-month-by-month">
    <ThemedText type="smallBold">{d.merchant.monthByMonth}</ThemedText>
    <View testID="merchant-month-bars" style={styles.bars}>
      {months.map((month, index) => {
        const showLabel = labelEvery || index === 0 || index === months.length - 1;
        return <View key={month.key} style={styles.column} accessible accessibilityRole="image"
          accessibilityLabel={d.merchant.month(monthLabel(month.key), formatAED(month.fils), month.count)}>
          <View style={styles.track}>
            {month.fils > 0
              ? <GrowBar axis="height" size={Math.max(4, (month.fils / max) * BAR_HEIGHT)} delay={index * 30}
                  style={[styles.bar, { backgroundColor: month.selected ? color : theme.track }]} />
              : <View style={[styles.empty, { backgroundColor: theme.cardBorder }]} />}
          </View>
          <ThemedText type="nano" numberOfLines={1} themeColor={month.selected ? 'text' : 'textTertiary'}>
            {showLabel ? shortMonth(month.key) : ' '}
          </ThemedText>
        </View>;
      })}
    </View>
    <ThemedText type="meta" themeColor="textTertiary">{d.merchant.seriesNote}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  column: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 },
  track: { height: BAR_HEIGHT, alignSelf: 'stretch', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '70%', maxWidth: 22, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  empty: { width: '70%', maxWidth: 22, height: 2, borderRadius: 1 },
});
