import { spendingTrendsCopy as copy } from '@/lib/reference-copy';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { CategoryAvatar } from '@/components/ui/category-avatar';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Money } from '@/components/ui/money';
import { Icon } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { categoryLabel } from '@/lib/categories';
import { formatAED, monthLabel, weekdayShort } from '@/lib/format';
import type { CategoryMover, MerchantStat } from '@/lib/analytics';
import type { CategoryId } from '@/lib/types';

export type MonthFlow = { key: string; incomeFils: number; expenseFils: number };
type Props = {
  months: readonly MonthFlow[];
  selectedKey: string;
  merchants: readonly MerchantStat[];
  movers: readonly CategoryMover[];
  weekdays: readonly number[];
  periodLabel: string;
  comparisonLabel: string | null;
  onMonth: (key: string) => void;
  onMerchant: (name: string) => void;
  onCategory: (id: CategoryId) => void;
};


/** The useful Stats content now belongs inside Spending, not another destination. */
export function SpendingTrends(p: Props) {
  const theme = useTheme(); const lang = useLanguage(); const large = useLargeTextLayout();
  const { width, fontScale } = useWindowDimensions();
  // Six labels must fit at the actual width and text size. When they cannot,
  // every month remains available in a wrapping detail list, not hidden.
  const showAllTrendLabels = !large && (Math.min(width, 800) - 104) / 6 >= (lang === 'ar' ? 58 : 32) * fontScale;
  const w = copy[lang === 'ar' ? 'ar' : 'en']; const [patterns, setPatterns] = useState(false);
  const max = Math.max(1, ...p.months.flatMap((m) => [m.incomeFils, m.expenseFils]));
  const selected = p.months.find((m) => m.key === p.selectedKey);
  const hasActivity = (month: MonthFlow) => month.incomeFils !== 0 || month.expenseFils !== 0;
  const monthDescription = (month: MonthFlow) => hasActivity(month)
    ? `${monthLabel(month.key)}. ${w.income}: ${formatAED(month.incomeFils)}. ${w.spending}: ${formatAED(month.expenseFils)}`
    : `${monthLabel(month.key)}. ${w.noData}`;
  const monthFigures = (month: MonthFlow) => hasActivity(month) ? (
    <View style={styles.monthFigures}>
      <View style={styles.monthFigure}><ThemedText type="meta">{w.income}</ThemedText><Money fils={month.incomeFils} type="meta" /></View>
      <View style={styles.monthFigure}><ThemedText type="meta">{w.spending}</ThemedText><Money fils={month.expenseFils} type="meta" /></View>
    </View>
  ) : <ThemedText type="meta" themeColor="textSecondary">— {w.noData}</ThemedText>;
  const weekdayMax = Math.max(1, ...p.weekdays);
  return <View style={styles.root} testID="spending-trends">
    <View style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <ThemedText type="heading">{w.cashflow}</ThemedText>
      <ThemedText type="meta" themeColor="textSecondary">{w.sixMonths} · {p.months[0] ? monthLabel(p.months[0].key, true) : ''} — {p.months.at(-1) ? monthLabel(p.months.at(-1)!.key, true) : ''}</ThemedText>
      <View style={styles.chart}>
        {p.months.map((month) => <Pressable key={month.key} accessibilityRole="button"
          accessibilityState={{ selected: month.key === p.selectedKey }}
          accessibilityLabel={monthDescription(month)}
          onPress={() => p.onMonth(month.key)} style={styles.column}>
          <View style={[styles.barPair, { borderBottomColor: theme.cardBorder }]}>
            <View style={[styles.bar, { height: `${month.incomeFils / max * 100}%`, backgroundColor: theme.primary }]} />
            <View style={[styles.bar, { height: `${month.expenseFils / max * 100}%`, backgroundColor: theme.expenseGraphic, opacity: month.key === p.selectedKey ? 1 : 0.55 }]} />
          </View>
          {showAllTrendLabels && <ThemedText type="meta" themeColor={month.key === p.selectedKey ? 'text' : 'textSecondary'}
            style={styles.month}>{monthLabel(month.key, true).split(' ')[0]}</ThemedText>}
        </Pressable>)}
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: theme.primary }]} /><ThemedText type="meta">{w.income}</ThemedText></View>
        <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: theme.expenseGraphic }]} /><ThemedText type="meta">{w.spending}</ThemedText></View>
      </View>
      {selected && <View style={[styles.selected, { backgroundColor: theme.backgroundSelected }]} accessibilityLiveRegion="polite">
        <ThemedText type="smallBold">{monthLabel(selected.key)}</ThemedText>
        {monthFigures(selected)}
      </View>}
      {!showAllTrendLabels && <View style={styles.monthDetails} testID="cashflow-month-details">
        {p.months.map((month) => <Pressable key={month.key} testID={`cashflow-detail-${month.key}`}
          accessibilityRole="button" accessibilityLabel={monthDescription(month)}
          accessibilityState={{ selected: month.key === p.selectedKey }}
          onPress={() => p.onMonth(month.key)}
          style={[styles.monthDetail, { borderColor: theme.cardBorder }]}>
          <ThemedText type="smallBold">{monthLabel(month.key)}</ThemedText>
          {monthFigures(month)}
        </Pressable>)}
      </View>}
      <ThemedText type="meta" themeColor="textTertiary">{w.partial}</ThemedText>
    </View>

    <View style={styles.section}>
      <ThemedText type="heading">{w.merchants}</ThemedText>
      <ThemedText type="meta" themeColor="textSecondary">{p.periodLabel}</ThemedText>
      <View style={[styles.group, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
        {p.merchants.map((m, index) => <Pressable key={m.title} accessibilityRole="button"
          accessibilityLabel={`${m.title}, ${formatAED(m.totalFils)}, ${m.count} ${w.records}`}
          onPress={() => p.onMerchant(m.title)} style={({ pressed }) => [styles.row, index > 0 && styles.rule,
            { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
          <MerchantAvatar title={m.title} category={m.category} size={36} />
          <View style={styles.grow}><ThemedText type="smallBold">{m.title}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">{m.count} {w.records}</ThemedText></View>
          <Money fils={m.totalFils} type="smallBold" />
        </Pressable>)}
        {p.merchants.length === 0 && <ThemedText type="meta" themeColor="textSecondary" style={styles.empty}>{w.noMerchants}</ThemedText>}
      </View>
    </View>

    <View style={styles.section}>
      <ThemedText type="heading">{w.change}</ThemedText>
      <ThemedText type="meta" themeColor="textSecondary">{p.comparisonLabel ? `${w.vs} ${p.comparisonLabel}` : w.missingComparison}</ThemedText>
      <View style={[styles.group, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
        {p.movers.map((m, index) => <Pressable key={m.category} accessibilityRole="button" onPress={() => p.onCategory(m.category)}
          accessibilityLabel={`${categoryLabel(m.category, lang)}. ${formatAED(m.previousFils)}. ${formatAED(m.currentFils)}`}
          style={[styles.row, index > 0 && styles.rule, { borderColor: theme.cardBorder }]}>
          <CategoryAvatar category={m.category} size={36} />
          <View style={styles.grow}><ThemedText type="smallBold">{categoryLabel(m.category, lang)}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary" tabular>{formatAED(m.previousFils)} → {formatAED(m.currentFils)}</ThemedText></View>
          <View style={styles.change}><ThemedText type="smallBold" tabular themeColor={m.deltaFils > 0 ? 'expense' : 'income'}>{formatAED(Math.abs(m.deltaFils))}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">{m.deltaFils > 0 ? w.more : w.fewer}</ThemedText></View>
        </Pressable>)}
        {p.movers.length === 0 && <ThemedText type="meta" themeColor="textSecondary" style={styles.empty}>{w.noChange}</ThemedText>}
      </View>
    </View>

    <Pressable accessibilityRole="button" accessibilityState={{ expanded: patterns }} onPress={() => setPatterns(!patterns)} style={styles.disclosure}>
      <ThemedText type="smallBold">{w.patterns}</ThemedText><Icon name={patterns ? 'chevron-down' : 'chevron-right'} size={18} color={theme.textSecondary} />
    </Pressable>
    {patterns && <View style={[styles.panel, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
      {p.weekdays.map((fils, day) => <View key={day} style={styles.weekday} accessible accessibilityLabel={`${weekdayShort(day)}, ${formatAED(fils)}`}>
        <ThemedText type="meta" style={styles.weekdayName}>{weekdayShort(day)}</ThemedText>
        <View style={[styles.weekdayTrack, { backgroundColor: theme.track }]}><View style={{ height: 6, borderRadius: 3, width: `${fils / weekdayMax * 100}%`, backgroundColor: theme.primary }} /></View>
        <Money fils={fils} type="meta" />
      </View>)}
      <ThemedText type="meta" themeColor="textSecondary">{w.patternsNote}</ThemedText>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  monthFigures: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  monthFigure: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  monthDetails: { gap: 12 }, monthDetail: { minHeight: 48, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  root: { gap: 24 }, panel: { padding: 18, borderRadius: 20, borderWidth: 1, gap: 12 },
  chart: { flexDirection: 'row', gap: 6, marginTop: 8 }, column: { flex: 1, minWidth: 0, gap: 8, minHeight: 150 },
  barPair: { height: 140, alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'center', gap: 4, borderBottomWidth: 1 },
  bar: { width: '32%', borderTopLeftRadius: 5, borderTopRightRadius: 5 }, month: { textAlign: 'center', fontSize: 12, lineHeight: 18 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 }, selected: { padding: 12, borderRadius: 12, gap: 6 },
  section: { gap: 10 }, group: { borderRadius: 18, borderWidth: 1, overflow: 'hidden', paddingHorizontal: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingVertical: 16 }, rule: { borderTopWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1, minWidth: 100, gap: 4 }, change: { alignItems: 'flex-end', gap: 4 },
  empty: { paddingVertical: 20 }, disclosure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48 },
  weekday: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, weekdayName: { width: 42 }, weekdayTrack: { flex: 1, minWidth: 40, height: 6, borderRadius: 3 },
});
