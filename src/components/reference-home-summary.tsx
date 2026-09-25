import { homeSummaryCopy as copy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { WafraMark } from '@/components/wafra-logo';
import { Money } from '@/components/ui/money';
import { RollingMoney } from '@/components/ui/rolling-money';
import { GrowBar } from '@/components/ui/grow-bar';
import type { Colors } from '@/constants/theme';
import { formatMinorUnits, type LedgerMoneySpec } from '@/lib/ledger-money';
import type { HomeToday } from '@/lib/home-today';

type Props = {
  theme: typeof Colors.light;
  language: string;
  largeText: boolean;
  greeting: string;
  dateLabel: string;
  periodLabel: string;
  incomeFils: number;
  expenseFils: number;
  netFils: number;
  moneySpec: LedgerMoneySpec;
  onPeriod: () => void;
  onAdd: () => void;
  onSettings: () => void;
  onIncome: () => void;
  onSpending: () => void;
  /** Optional replacement for the standalone W mark, owned by the calling screen. */
  brandMark?: React.ReactNode;
  /** Internal builds only: tapping the Wafra wordmark grants durable Founder Pro. */
  onFounderUnlock?: () => void;
  /** Today, this week and budget pace. Omitted: the period figures lead, as before. */
  today?: HomeToday;
  onToday?: () => void;
  /** Android keeps Add as a floating button; the header then shows no "+". */
  hideHeaderAdd?: boolean;
  /** Android's header "Ask" chip, opening Ask Wafra. */
  onAsk?: () => void;
  /**
   * With no budget and no spending average yet, the Left-to-spend cell shows
   * "—" and a Set a budget action instead of disappearing. Only offered for
   * the running month, where budgets apply.
   */
  onSetBudget?: () => void;
  /** Capture appears stopped: Left to spend may be too high until it resumes. */
  captureStopped?: boolean;
  /** Rendered above Today (the capture-stopped notice). */
  leadNotice?: React.ReactNode;
  /** Rendered between Today | Left to spend and the week (the transfer notice). */
  todayNotice?: React.ReactNode;
};

/** Today | Left in budgets, then seven days of spending. Amounts are the shared ledger figures. */
function TodayBlock({ p, today }: { p: Props; today: HomeToday }) {
  const w = copy[p.language === 'ar' ? 'ar' : 'en'];
  const { width, fontScale } = useWindowDimensions();
  const currency = p.moneySpec.currency;
  const money = (fils: number) => `${currency} ${formatMinorUnits(Math.round(Math.abs(fils)), p.moneySpec)}`;
  const countLabel = today.todayCount === 0 ? w.noPaymentsToday
    : `${today.todayCount} ${today.todayCount === 1 ? w.payment : w.payments}`;
  const budget = today.budget;
  // Never a second copy of the period total shown just below.
  const average = today.average;
  // First day: nothing to pace against yet. Say so and offer the budget,
  // rather than hiding the cell or printing a daily average of zero.
  const offerBudget = budget === null && p.onSetBudget !== undefined && (average === null || average.fils === 0);
  const showRight = offerBudget || budget !== null || average !== null;
  const rightLabel = budget || offerBudget ? w.leftToSpend : w.dailyAverage;
  const rightFils = budget ? budget.leftFils : average?.fils ?? 0;
  const rightMeta = budget
    ? [`${money(budget.perDayFils)} ${w.perDay}`, budget.overCount > 0 ? w.budgetsOver(budget.overCount) : w.daysLeft(budget.daysLeft)].join(' · ')
    : `${w.overDays(average?.days ?? 0)}, ${w.excludingFixed}`;
  const rightWarning = budget !== null && budget.overCount > 0;
  const caveat = budget !== null && p.captureStopped === true;
  const max = Math.max(1, ...today.week.map(day => day.fils));
  // Full Arabic weekday names when seven fit at this width and text size;
  // otherwise the initials, with full names always spoken.
  const fullWeekdays = p.language === 'ar' && !p.largeText && width / Math.max(fontScale, 1) >= 370;
  const weekSpoken = `${w.weekTotal} ${money(today.weekFils)}. ` +
    today.week.map(day => `${w.weekdayFull(day.weekday)} ${money(day.fils)}`).join(', ');
  const pairCellEnd = [styles.pairCell, !p.largeText && { borderStartWidth: StyleSheet.hairlineWidth, borderColor: p.theme.cardBorder, paddingStart: 16 },
    p.largeText && styles.metricStacked];
  return <View style={styles.todayBlock} testID="home-today">
    {p.leadNotice}
    <View style={[styles.pair, { borderColor: p.theme.cardBorder }, p.largeText && styles.stack]}>
      <Pressable accessibilityRole="button" onPress={p.onToday} testID="home-today-total"
        accessibilityLabel={`${w.today}, ${money(today.todayFils)}. ${countLabel}`} accessibilityHint={w.opensActivity}
        style={[styles.pairCell, p.largeText && styles.metricStacked]}>
        <ThemedText type="small" themeColor="textSecondary">{w.today}</ThemedText>
        {/* A new capture rolls only the digits that changed; static under Reduce Motion or a screen reader. */}
        <RollingMoney fils={today.todayFils} moneySpec={p.moneySpec} type="heading" />
        <ThemedText type="meta" themeColor="textSecondary">{countLabel}</ThemedText>
      </Pressable>
      {offerBudget ? <View testID="home-left-to-spend" style={pairCellEnd}>
        <View accessible accessibilityRole="text" accessibilityLabel={`${w.leftToSpend}. ${w.setBudgetBody}`} style={styles.offer}>
          <ThemedText type="small" themeColor="textSecondary">{w.leftToSpend}</ThemedText>
          <ThemedText type="heading" themeColor="textSecondary">—</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary">{w.setBudgetBody}</ThemedText>
        </View>
        <Pressable testID="home-set-budget" accessibilityRole="button" accessibilityLabel={w.setBudget} onPress={p.onSetBudget}
          hitSlop={4} style={({ pressed }) => [styles.inlineAction, { opacity: pressed ? 0.65 : 1 }]}>
          <ThemedText type="smallBold" themeColor="primary">{w.setBudget}</ThemedText>
        </Pressable>
      </View> : showRight ? <View accessible accessibilityRole="text" testID="home-left-to-spend"
        accessibilityLabel={[`${rightLabel}, ${money(rightFils)}. ${rightMeta}`, caveat ? w.mayBeHigh : null].filter(Boolean).join('. ')}
        style={pairCellEnd}>
        <ThemedText type="small" themeColor="textSecondary">{rightLabel}</ThemedText>
        <Money fils={rightFils} moneySpec={p.moneySpec} type="heading" />
        <ThemedText type="meta" themeColor={rightWarning ? 'warning' : 'textSecondary'}>{rightMeta}</ThemedText>
        {caveat ? <ThemedText type="meta" themeColor="warning" testID="home-left-caveat">{w.mayBeHigh}</ThemedText> : null}
      </View> : null}
    </View>
    {p.todayNotice}
    <View style={styles.weekHead}>
      <ThemedText type="smallBold" style={styles.weekTitle}>{w.thisWeek}</ThemedText>
      <Money fils={today.weekFils} moneySpec={p.moneySpec} type="meta" color={p.theme.textSecondary} />
    </View>
    <View style={styles.week} accessible accessibilityRole="image" accessibilityLabel={weekSpoken} testID="home-week">
      {today.week.map((day, index) => <View key={day.dateISO} style={styles.weekDay}>
        <View style={styles.barTrack}>
          <GrowBar axis="height" delay={index * 60}
            size={day.fils > 0 ? Math.max(4, Math.round((day.fils / max) * 72)) : 2}
            style={[styles.bar, { backgroundColor: day.today ? p.theme.primary : p.theme.controlBorder }]} />
        </View>
        <ThemedText type={fullWeekdays ? 'nano' : 'micro'} numberOfLines={1} themeColor={day.today ? 'primary' : 'textSecondary'}>
          {fullWeekdays ? w.weekdayFull(day.weekday) : w.weekday(day.weekday)}</ThemedText>
      </View>)}
    </View>
  </View>;
}

/** One period, three reconciled figures. Account balances belong in Accounts. */
export function ReferenceHomeSummary(p: Props) {
  const w = copy[p.language === 'ar' ? 'ar' : 'en'];
  const netSign = p.netFils < 0 ? '−' : p.netFils > 0 ? '+' : '';
  const netColor = p.netFils < 0 ? p.theme.expense : p.netFils > 0 ? p.theme.income : p.theme.text;
  const currency = p.moneySpec.currency;
  const wordmark = <>
    {p.brandMark ?? <WafraMark size={28} />}
    <ThemedText type="title">Wafra</ThemedText>
  </>;
  return <View style={styles.root} testID="reference-home-summary">
    <View style={styles.header}>
      {p.onFounderUnlock && !p.brandMark ? (
        <Pressable
          testID="founder-unlock-logo"
          accessibilityRole="button"
          accessibilityLabel="Unlock Founder Pro"
          hitSlop={8}
          onPress={p.onFounderUnlock}
          style={({ pressed }) => [styles.wordmark, { opacity: pressed ? 0.65 : 1 }]}>
          {wordmark}
        </Pressable>
      ) : (
        <View style={styles.wordmark}>{wordmark}</View>
      )}
      {p.onAsk ? <Pressable testID="home-ask-chip" accessibilityRole="button" accessibilityLabel={w.ask} accessibilityHint={w.askHint}
        onPress={p.onAsk}
        style={({ pressed }) => [styles.askChip, { borderColor: p.theme.cardBorder, backgroundColor: pressed ? p.theme.backgroundSelected : 'transparent' }]}>
        <Icon name="spark" size={16} color={p.theme.primary} />
        <ThemedText type="smallBold">{w.ask}</ThemedText>
      </Pressable> : null}
      {p.hideHeaderAdd ? null : <Pressable accessibilityRole="button" accessibilityLabel={w.add} onPress={p.onAdd}
        style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.65 : 1 }]}>
        <Icon name="plus" size={22} color={p.theme.primary} />
      </Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel={w.settings} onPress={p.onSettings}
        style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.65 : 1 }]}>
        <Icon name="sliders" size={21} color={p.theme.text} />
      </Pressable>
    </View>

    <View style={styles.dateLine}>
      <ThemedText type="meta" themeColor="textSecondary">{p.greeting}</ThemedText>
      <ThemedText type="meta" themeColor="textTertiary">{p.dateLabel}</ThemedText>
    </View>
    {p.today ? <TodayBlock p={p} today={p.today} /> : <>{p.leadNotice}{p.todayNotice}</>}
    <View style={styles.summary} testID="journal-summary">
      <View style={styles.summaryTop}>
        <ThemedText type="small" themeColor="textSecondary">{w.moneyOut}</ThemedText>
        <Pressable accessibilityRole="button" accessibilityLabel={p.periodLabel} onPress={p.onPeriod}
          style={[styles.period, { backgroundColor: p.theme.backgroundSelected }]}>
          <ThemedText type="meta">{p.periodLabel}</ThemedText>
          <Icon name="chevron-down" size={14} color={p.theme.textSecondary} />
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={p.onSpending} testID="home-spending-total"
        accessibilityLabel={`${w.moneyOut}, ${currency} ${formatMinorUnits(Math.round(p.expenseFils), p.moneySpec)}. ${w.viewSpending}`}
        style={styles.spending}>
        <Money fils={p.expenseFils} moneySpec={p.moneySpec} type={p.today ? 'title' : 'display'} />
        <View style={styles.link}><ThemedText type="meta" style={{ color: p.theme.primary }}>{w.viewSpending}</ThemedText>
          <Icon name="arrow-up-right" size={16} color={p.theme.primary} /></View>
      </Pressable>
      <View style={[styles.metrics, { borderColor: p.theme.cardBorder }, p.largeText && styles.stack]}>
      <Pressable accessibilityRole="button" onPress={p.onIncome} testID="home-income-summary"
        accessibilityLabel={`${w.moneyIn}, ${currency} ${formatMinorUnits(Math.round(p.incomeFils), p.moneySpec)}`}
        style={[styles.metric, p.largeText && styles.metricStacked]}>
        <View style={styles.link}><Icon name="arrow-down-right" size={16} color={p.theme.income} />
          <ThemedText type="small" themeColor="textSecondary">{w.moneyIn}</ThemedText></View>
        <Money fils={p.incomeFils} moneySpec={p.moneySpec} type="smallBold" color={p.theme.income} />
      </Pressable>
      <View testID="home-net-summary" accessible accessibilityRole="text"
        accessibilityLabel={`${w.netLabel}, ${currency} ${netSign}${formatMinorUnits(Math.round(Math.abs(p.netFils)), p.moneySpec)}`}
        style={[styles.metric, p.largeText && styles.metricStacked]}>
        <ThemedText type="small" themeColor="textSecondary">{w.netLabel}</ThemedText>
        <Money fils={p.netFils} moneySpec={p.moneySpec} type="smallBold" sign={p.netFils === 0 ? 'none' : 'auto'} color={netColor} />
      </View>
      </View>
      {p.incomeFils === 0 && <ThemedText type="meta" themeColor="textSecondary" testID="home-no-income-note">
        {w.noIncome}</ThemedText>}
      <ThemedText type="meta" themeColor="textSecondary">{w.cashflowNote}</ThemedText>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 8 }, grow: { flex: 1, minWidth: 0, gap: 4 },
  wordmark: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14 },
  dateLine: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAction: { minWidth: 48, minHeight: 48, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  askChip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14,
    borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  summary: { gap: 6 },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  period: { minHeight: 44, paddingHorizontal: 12, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 6 },
  spending: { minHeight: 76, justifyContent: 'center', alignItems: 'flex-start', gap: 6, paddingBottom: 8 },
  todayBlock: { gap: 10, paddingBottom: 10 },
  pair: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12, gap: 16 },
  pairCell: { flex: 1, minWidth: 0, minHeight: 48, gap: 4 },
  offer: { gap: 4 },
  inlineAction: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  weekHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 6 },
  weekTitle: { fontSize: 17, lineHeight: 24 },
  week: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  weekDay: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 },
  barTrack: { height: 72, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 6 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: StyleSheet.hairlineWidth, gap: 16, paddingVertical: 8 },
  metric: { flexGrow: 1, flexShrink: 1, flexBasis: '42%', minWidth: 120, minHeight: 48, gap: 6 },
  metricStacked: { flexBasis: 'auto', alignSelf: 'stretch' },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
});
