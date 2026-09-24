import { spendingTrendsCopy as copy } from '@/lib/reference-copy';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { CategoryAvatar } from '@/components/ui/category-avatar';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Money } from '@/components/ui/money';
import { GrowBar } from '@/components/ui/grow-bar';
import { Icon } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/hooks/use-language';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { categoryLabel } from '@/lib/categories';
import { formatAED, ledgerWholeMajor, monthLabel, weekdayShort } from '@/lib/format';
import { tapped } from '@/lib/haptics';
import {
  displayNumberConventions,
  formatMinorUnits,
  type LedgerMoneySpec,
  wholeMajorUnits,
} from '@/lib/ledger-money';
import type { CategoryMover, ComparableSpend, MerchantStat } from '@/lib/analytics';
import type { CategoryId } from '@/lib/types';

/**
 * Compact axis label — 12.4k, 1.2M — for the peak reference on the trends
 * chart. Whole major units at the ledger's own exponent (AED /100, JPY /1,
 * KWD /1000), with the device's decimal mark ("1,2k" on a German phone).
 */
function shortAmount(fils: number, spec: LedgerMoneySpec | null): string {
  const value = spec ? wholeMajorUnits(fils, spec) : ledgerWholeMajor(fils);
  const abs = Math.abs(value);
  const decimal = displayNumberConventions().decimal;
  const fixed = (n: number, digits: number) => n.toFixed(digits).replace('.', decimal);
  if (abs >= 1_000_000) return `${fixed(value / 1_000_000, abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${fixed(value / 1_000, abs >= 10_000 ? 0 : 1)}k`;
  return `${value}`;
}

export type MonthFlow = { key: string; incomeFils: number; expenseFils: number };
type Props = {
  months: readonly MonthFlow[];
  selectedKey: string;
  merchants: readonly MerchantStat[];
  movers: readonly CategoryMover[];
  weekdays: readonly number[];
  periodLabel: string;
  comparisonLabel: string | null;
  /** Everyday spending in both comparable windows; null when there is nothing to compare. */
  comparison?: ComparableSpend | null;
  /** Short names for the two sides, e.g. "Sep 2026" and "Aug 2026". */
  currentName?: string;
  previousName?: string | null;
  /** The current period is still running, so the comparison stops at the same day. */
  partial?: boolean;
  /** Changes smaller than this are "about the same", matching the rows' noise floor. */
  noiseFloorFils?: number;
  onMonth: (key: string) => void;
  onMerchant: (name: string) => void;
  onCategory: (id: CategoryId) => void;
};


/** The useful Stats content now belongs inside Spending, not another destination. */
export function SpendingTrends(p: Props) {
  const theme = useTheme(); const lang = useLanguage(); const large = useLargeTextLayout();
  const moneySpec = useLedgerMoney();
  const moneyLabel = (fils: number) => moneySpec
    ? `${moneySpec.currency} ${formatMinorUnits(Math.round(fils), moneySpec)}` : formatAED(fils);
  const { width, fontScale } = useWindowDimensions();
  // Six labels must fit at the actual width and text size. When they cannot,
  // every month remains available in a wrapping detail list, not hidden.
  const showAllTrendLabels = !large && (Math.min(width, 800) - 146) / 6 >= (lang === 'ar' ? 58 : 32) * fontScale;
  const w = copy[lang === 'ar' ? 'ar' : 'en']; const [patterns, setPatterns] = useState(false);
  const max = Math.max(1, ...p.months.flatMap((m) => [m.incomeFils, m.expenseFils]));
  const selected = p.months.find((m) => m.key === p.selectedKey);
  const latest = p.months.at(-1);
  const canReturnToLatest = !!latest && latest.key !== p.selectedKey;
  const hasActivity = (month: MonthFlow) => month.incomeFils !== 0 || month.expenseFils !== 0;
  const monthDescription = (month: MonthFlow) => hasActivity(month)
    ? `${monthLabel(month.key)}. ${w.income}: ${moneyLabel(month.incomeFils)}. ${w.spending}: ${moneyLabel(month.expenseFils)}`
    : `${monthLabel(month.key)}. ${w.noData}`;
  const monthFigures = (month: MonthFlow) => hasActivity(month) ? (
    <View style={styles.monthFigures}>
      <View style={styles.monthFigure}><ThemedText type="meta">{w.income}</ThemedText><Money fils={month.incomeFils} type="meta" /></View>
      <View style={styles.monthFigure}><ThemedText type="meta">{w.spending}</ThemedText><Money fils={month.expenseFils} type="meta" /></View>
    </View>
  ) : <ThemedText type="meta" themeColor="textSecondary">— {w.noData}</ThemedText>;
  const weekdayMax = Math.max(1, ...p.weekdays);
  // Selected-month net & delta let a Trends viewer read "is this month up or
  // down and by how much" in the same look as the bars. Compare with the
  // immediately previous month in the same six-month window, so a selection at
  // the far left has no comparison and the chip stays hidden rather than
  // showing an implausible +100%.
  const selectedIndex = p.months.findIndex((m) => m.key === p.selectedKey);
  const previous = selectedIndex > 0 ? p.months[selectedIndex - 1] : null;
  const previousExpense = previous?.expenseFils ?? 0;
  const deltaFils = selected && previous ? selected.expenseFils - previousExpense : 0;
  const deltaPct = selected && previous && previousExpense > 0
    ? Math.round((deltaFils / previousExpense) * 100) : null;
  return <View style={styles.root} testID="spending-trends">
    <View style={[styles.panel, { backgroundColor: 'transparent', borderColor: theme.cardBorder }]}>
      <ThemedText type="heading">{w.cashflow}</ThemedText>
      <ThemedText type="meta" themeColor="textSecondary">{w.sixMonths} · {p.months[0] ? monthLabel(p.months[0].key, true) : ''} — {p.months.at(-1) ? monthLabel(p.months.at(-1)!.key, true) : ''}</ThemedText>
      <View style={styles.chartWrap}>
        <View style={styles.axis} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ThemedText type="nano" themeColor="textTertiary" style={styles.axisLabel}>{shortAmount(max, moneySpec)}</ThemedText>
          <ThemedText type="nano" themeColor="textTertiary" style={styles.axisLabel}>{shortAmount(max / 2, moneySpec)}</ThemedText>
          <ThemedText type="nano" themeColor="textTertiary" style={styles.axisLabel}>0</ThemedText>
        </View>
        <View style={styles.chartBody}>
          <View style={styles.grid} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
            <View style={[styles.gridline, { backgroundColor: theme.cardBorder }]} />
            <View style={[styles.gridline, { backgroundColor: theme.cardBorder, opacity: 0.6 }]} />
            <View style={[styles.gridline, { backgroundColor: theme.cardBorderStrong }]} />
          </View>
          <View style={styles.chart}>
            {p.months.map((month) => {
              const isSelected = month.key === p.selectedKey;
              const inH = Math.max(month.incomeFils > 0 ? 3 : 0, month.incomeFils / max * 100);
              const outH = Math.max(month.expenseFils > 0 ? 3 : 0, month.expenseFils / max * 100);
              return <Pressable key={month.key} accessibilityRole="button"
                testID={`cashflow-month-${month.key}`}
                aria-selected={isSelected}
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={monthDescription(month)}
                onPress={() => { if (!isSelected) { tapped(); p.onMonth(month.key); } }}
                hitSlop={{ top: 5, bottom: 5, left: 0, right: 0 }}
                pressRetentionOffset={{ top: 18, bottom: 18, left: 8, right: 8 }}
                style={({ pressed }) => [styles.column, {
                  backgroundColor: pressed && !isSelected ? theme.backgroundSelected : 'transparent',
                  opacity: pressed ? 0.94 : 1,
                }]}>
                <View style={[styles.barPair, isSelected && { backgroundColor: theme.backgroundSelected, borderRadius: 6 }]}>
                  <View style={[styles.bar, styles.barIn, { height: `${inH}%`, backgroundColor: theme.primary, opacity: isSelected || month.incomeFils === 0 ? 1 : 0.85 }]} />
                  <View style={[styles.bar, styles.barOut, { height: `${outH}%`, backgroundColor: theme.expenseGraphic, opacity: isSelected || month.expenseFils === 0 ? 1 : 0.7 }]} />
                </View>
                {showAllTrendLabels && <View style={styles.monthLabel}>
                  <ThemedText type="nano" themeColor={isSelected ? 'text' : 'textTertiary'}>{monthLabel(month.key, true).split(' ')[0]}</ThemedText>
                  <View style={[styles.nowTick, { backgroundColor: isSelected ? theme.text : 'transparent' }]} />
                </View>}
              </Pressable>;
            })}
          </View>
        </View>
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: theme.primary }]} /><ThemedText type="meta">{w.income}</ThemedText></View>
        <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: theme.expenseGraphic }]} /><ThemedText type="meta">{w.spending}</ThemedText></View>
      </View>
      {selected && <View style={[styles.selected, { backgroundColor: theme.backgroundSelected, borderColor: theme.cardBorder }]} accessibilityLiveRegion="polite">
        <View style={styles.selectedHead}>
          <ThemedText type="smallBold">{monthLabel(selected.key)}</ThemedText>
          <View style={styles.selectedHeadActions}>
            {canReturnToLatest && latest ? <Pressable
              accessibilityRole="button"
              accessibilityLabel={w.latest}
              onPress={() => { tapped(); p.onMonth(latest.key); }}
              hitSlop={6}
              style={({ pressed }) => [styles.latestButton, {
                borderColor: theme.cardBorder,
                backgroundColor: pressed ? theme.background : 'transparent',
              }]}>
              <ThemedText type="meta" style={{ color: theme.primary }}>{w.latest}</ThemedText>
            </Pressable> : null}
            {deltaPct !== null && <View style={[styles.deltaChip, {
              backgroundColor: theme.background,
              borderColor: deltaFils > 0 ? theme.expenseSoftBorder : theme.primaryBorder,
            }]}>
              <Icon name={deltaFils > 0 ? 'arrow-up' : 'arrow-down'} size={12}
                color={deltaFils > 0 ? theme.expenseGraphic : theme.primary} />
              <ThemedText type="meta" tabular themeColor={deltaFils > 0 ? 'expense' : 'income'}>
                {Math.abs(deltaPct)}% {deltaFils > 0 ? w.more : w.fewer}
              </ThemedText>
            </View>}
          </View>
        </View>
        {monthFigures(selected)}
        <View style={styles.selectedNetRow}>
          <ThemedText type="nano" themeColor="textTertiary">{w.net}</ThemedText>
          <Money fils={selected.incomeFils - selected.expenseFils} type="smallBold" sign="auto"
            color={selected.incomeFils - selected.expenseFils < 0 ? theme.expense : theme.income} />
        </View>
      </View>}
      {!showAllTrendLabels && <View style={styles.monthDetails} testID="cashflow-month-details">
        {p.months.map((month) => <Pressable key={month.key} testID={`cashflow-detail-${month.key}`}
          accessibilityRole="button" accessibilityLabel={monthDescription(month)}
          aria-selected={month.key === p.selectedKey}
          accessibilityState={{ selected: month.key === p.selectedKey }}
          onPress={() => { if (month.key !== p.selectedKey) { tapped(); p.onMonth(month.key); } }}
          pressRetentionOffset={12}
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
      <View style={[styles.group, { borderColor: theme.cardBorder, backgroundColor: 'transparent' }]}>
        {p.merchants.map((m) => <Pressable key={m.title} accessibilityRole="button"
          accessibilityLabel={`${m.title}, ${moneyLabel(m.totalFils)}, ${m.count} ${w.records}`}
          onPress={() => p.onMerchant(m.title)} style={({ pressed }) => [styles.row, styles.rule,
            { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
          <MerchantAvatar title={m.title} category={m.category} size={36} />
          <View style={styles.grow}><ThemedText type="smallBold">{m.title}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">{m.count} {w.records}</ThemedText></View>
          <Money fils={m.totalFils} type="smallBold" />
        </Pressable>)}
        {p.merchants.length === 0 && <ThemedText type="meta" themeColor="textSecondary" style={styles.empty}>{w.noMerchants}</ThemedText>}
      </View>
    </View>

    <View style={styles.section} testID="spending-compare">
      <ThemedText type="heading">{w.change}</ThemedText>
      {p.comparison && p.comparisonLabel ? (() => {
        const c = p.comparison;
        const other = p.previousName ?? p.comparisonLabel;
        const same = Math.abs(c.deltaFils) < Math.max(p.noiseFloorFils ?? 1, c.previousFils * 0.02);
        const when = p.partial ? ` ${w.byThisDay}` : '';
        const lead = same ? `${w.spentSame} ${other}${when}.`
          : `${w.youSpent} ${moneyLabel(Math.abs(c.deltaFils))} ${c.deltaFils < 0 ? w.spentLess : w.spentMore} ${other}${when}.`;
        return <View accessible accessibilityRole="text" accessibilityLabel={`${lead} ${w.fixedLeftOut}`} style={styles.compareLead}>
          <ThemedText type="subtitle" themeColor={same ? 'text' : c.deltaFils < 0 ? 'income' : 'expense'}>{lead}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary">{w.fixedLeftOut}</ThemedText>
        </View>;
      })() : <ThemedText type="meta" themeColor="textSecondary">{p.comparisonLabel ? `${w.vs} ${p.comparisonLabel}` : w.missingComparison}</ThemedText>}
      {([['more', p.movers.filter((m) => m.deltaFils > 0)], ['less', p.movers.filter((m) => m.deltaFils < 0)]] as const).map(([kind, list]) =>
        list.length === 0 ? null : <View key={kind} style={styles.compareGroup}>
          <ThemedText type="smallBold" themeColor={kind === 'more' ? 'expense' : 'income'}>{kind === 'more' ? w.spendingMore : w.spendingLess}</ThemedText>
          {list.map((m) => {
            const scale = Math.max(1, m.currentFils, m.previousFils);
            return <Pressable key={m.category} accessibilityRole="button" onPress={() => p.onCategory(m.category)}
              accessibilityLabel={`${categoryLabel(m.category, lang)}. ${p.periodLabel} ${moneyLabel(m.currentFils)}. ${p.comparisonLabel ?? ''} ${moneyLabel(m.previousFils)}. ${m.deltaFils > 0 ? w.more : w.fewer} ${moneyLabel(Math.abs(m.deltaFils))}`}
              style={({ pressed }) => [styles.compareRow, styles.rule, { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
              <View style={styles.compareTop}>
                <CategoryAvatar category={m.category} size={28} />
                <ThemedText type="smallBold" style={styles.grow}>{categoryLabel(m.category, lang)}</ThemedText>
                <ThemedText type="smallBold" tabular themeColor={m.deltaFils > 0 ? 'expense' : 'income'}>
                  {m.deltaFils > 0 ? '+' : '−'}{moneyLabel(Math.abs(m.deltaFils))}</ThemedText>
              </View>
              {([[p.currentName ?? p.periodLabel, m.currentFils, theme.text], [p.previousName ?? p.comparisonLabel ?? '', m.previousFils, theme.controlBorder]] as const).map(([label, fils, color], index) =>
                <View key={index} style={styles.compareBarRow}>
                  <ThemedText type="micro" themeColor="textSecondary" style={styles.compareBarLabel} numberOfLines={1}>{label}</ThemedText>
                  <View style={styles.compareTrack}><GrowBar axis="width" delay={index * 60} size={fils / scale * 100}
                    style={{ height: 8, borderRadius: 4, backgroundColor: color }} /></View>
                  <View style={styles.compareAmount}><Money fils={fils} type="meta" prefix={false} /></View>
                </View>)}
            </Pressable>;
          })}
        </View>)}
      {p.movers.length === 0 && <ThemedText type="meta" themeColor="textSecondary" style={styles.empty}>{w.noChange}</ThemedText>}
    </View>

    <Pressable accessibilityRole="button" accessibilityState={{ expanded: patterns }} onPress={() => setPatterns(!patterns)} style={styles.disclosure}>
      <ThemedText type="smallBold">{w.patterns}</ThemedText><Icon name={patterns ? 'chevron-down' : 'chevron-right'} size={18} color={theme.textSecondary} />
    </Pressable>
    {patterns && <View style={[styles.panel, { borderColor: theme.cardBorder, backgroundColor: 'transparent' }]}>
      {p.weekdays.map((fils, day) => <View key={day} style={styles.weekday} accessible accessibilityLabel={`${weekdayShort(day)}, ${moneyLabel(fils)}`}>
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
  root: { gap: 18 }, panel: { paddingVertical: 8, gap: 10 },
  chartWrap: { flexDirection: 'row', gap: 8, marginTop: 4, alignItems: 'flex-start' },
  axis: { width: 34, height: 148, justifyContent: 'space-between', alignItems: 'flex-end' },
  axisLabel: { textAlign: 'right' },
  chartBody: { flex: 1, minWidth: 0, position: 'relative' },
  grid: { position: 'absolute', left: 0, right: 0, top: 0, height: 148, justifyContent: 'space-between' },
  gridline: { height: StyleSheet.hairlineWidth },
  chart: { flexDirection: 'row', gap: 4 },
  column: { flex: 1, minWidth: 0, gap: 6, borderRadius: 8 },
  barPair: { height: 148, alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'center', gap: 3, paddingHorizontal: 3, paddingBottom: 2 },
  bar: { width: '36%' },
  barIn: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barOut: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  monthLabel: { alignItems: 'center', gap: 2 },
  nowTick: { width: 12, height: 2, borderRadius: 1 },
  month: { textAlign: 'center', fontSize: 12, lineHeight: 18 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  selected: { paddingVertical: 10, paddingHorizontal: 12, gap: 8, borderWidth: 1, borderRadius: 12 },
  selectedHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  selectedHeadActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 6 },
  latestButton: { minHeight: 30, minWidth: 54, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  selectedNetRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  deltaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  section: { gap: 8 }, group: { overflow: 'hidden', },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 13 }, rule: { borderTopWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1, minWidth: 100, gap: 4 }, change: { alignItems: 'flex-end', gap: 4 },
  compareLead: { gap: 4, paddingVertical: 6 },
  compareGroup: { gap: 2, paddingTop: 10 },
  compareRow: { paddingVertical: 12, gap: 6 },
  compareTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  compareBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  compareBarLabel: { width: 72 },
  compareTrack: { flex: 1, minWidth: 40 },
  // Fixed width so both bars in a row share one pixel scale, whatever the amounts.
  compareAmount: { width: 88, alignItems: 'flex-end' },
  empty: { paddingVertical: 20 }, disclosure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48 },
  weekday: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, weekdayName: { width: 42 }, weekdayTrack: { flex: 1, minWidth: 40, height: 6, borderRadius: 3 },
});
