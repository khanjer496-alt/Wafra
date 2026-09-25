import { homeSummaryCopy as copy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { BandFigure } from '@/components/ui/band/band-figure';
import { StatTile, statTileColors } from '@/components/ui/band/stat-tile';
import { WeekTiles } from '@/components/ui/band/week-tiles';
import { Fonts, type BandPalette, type Colors } from '@/constants/theme';
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
  /** The recap trigger, owned by the calling screen; sits among the band's actions. */
  brandMark?: React.ReactNode;
  /** Internal builds only: tapping the pattern grants durable Founder Pro. */
  onFounderUnlock?: () => void;
  /** Today, the last seven days and budget pace. */
  today?: HomeToday;
  onToday?: () => void;
  /** Android keeps Add as a floating button; the band then shows no "+". */
  hideHeaderAdd?: boolean;
  /** Android's band "Ask" chip, opening Ask Wafra. */
  onAsk?: () => void;
  /**
   * With no budget and no spending average yet, the Left-in-budgets tile shows
   * "—" and a Set a budget action instead of disappearing. Only offered for
   * the running month, where budgets apply.
   */
  onSetBudget?: () => void;
  /** Capture appears stopped: Left in budgets may be too high until it resumes. */
  captureStopped?: boolean;
};

type BandProps = Props & {
  /** The Home band's palette (design language E: ink). */
  band: BandPalette;
  /** The person's pattern, drawn at the head of the band. */
  pattern?: React.ReactNode;
};

/** Today | Left in budgets as band tiles, then the last seven days as bars. Amounts are the shared ledger figures. */
function TodayTiles({ p, today }: { p: BandProps; today: HomeToday }) {
  const w = copy[p.language === 'ar' ? 'ar' : 'en'];
  const { width, fontScale } = useWindowDimensions();
  const currency = p.moneySpec.currency;
  const money = (fils: number) => `${currency} ${formatMinorUnits(Math.round(Math.abs(fils)), p.moneySpec)}`;
  const countLabel = today.todayCount === 0 ? w.noPaymentsToday
    : `${today.todayCount} ${today.todayCount === 1 ? w.payment : w.payments}`;
  const budget = today.budget;
  // Never a second copy of the period total shown further down.
  const average = today.average;
  // First day: nothing to pace against yet. Say so and offer the budget,
  // rather than hiding the tile or printing a daily average of zero.
  const offerBudget = budget === null && p.onSetBudget !== undefined && (average === null || average.fils === 0);
  const showRight = offerBudget || budget !== null || average !== null;
  const rightLabel = budget || offerBudget ? w.leftToSpend : w.dailyAverage;
  const rightFils = budget ? budget.leftFils : average?.fils ?? 0;
  const rightMeta = budget
    ? [`${money(budget.perDayFils)} ${w.perDay}`, budget.overCount > 0 ? w.budgetsOver(budget.overCount) : w.daysLeft(budget.daysLeft)].join(' · ')
    : `${w.overDays(average?.days ?? 0)}, ${w.excludingFixed}`;
  const rightWarning = budget !== null && budget.overCount > 0;
  const caveat = budget !== null && p.captureStopped === true;
  const accent = statTileColors(p.band, 'accent');
  // Full Arabic weekday names when seven fit at this width and text size;
  // otherwise the initials, with full names always spoken.
  const fullWeekdays = p.language === 'ar' && !p.largeText && width / Math.max(fontScale, 1) >= 370;
  const weekSpoken = `${w.weekTotal} ${money(today.weekFils)}. ` +
    today.week.map(day => `${w.weekdayFull(day.weekday)} ${money(day.fils)}`).join(', ');
  return <View style={styles.todayBlock} testID="home-today">
    <View style={[styles.tiles, p.largeText && styles.stack]}>
      <StatTile palette={p.band} tone="band" label={w.today} meta={countLabel} onPress={p.onToday} testID="home-today-total"
        accessibilityLabel={`${w.today}, ${money(today.todayFils)}. ${countLabel}`} accessibilityHint={w.opensActivity}
        style={p.largeText && styles.tileStacked}>
        {/* A new capture rolls only the digits that changed; static under Reduce Motion or a screen reader. */}
        <BandFigure fils={today.todayFils} moneySpec={p.moneySpec} palette={p.band} size="large" rolling fitInset={p.largeText ? 28 : 200} />
      </StatTile>
      {offerBudget ? <StatTile palette={p.band} tone="accent" label={w.leftToSpend} testID="home-left-to-spend"
        style={p.largeText && styles.tileStacked}>
        <View accessible accessibilityRole="text" accessibilityLabel={`${w.leftToSpend}. ${w.setBudgetBody}`} style={styles.offer}>
          <ThemedText type="heading" style={{ color: accent.fg }}>—</ThemedText>
          <ThemedText type="meta" style={{ color: accent.fgSecondary }}>{w.setBudgetBody}</ThemedText>
        </View>
        <Pressable testID="home-set-budget" accessibilityRole="button" accessibilityLabel={w.setBudget} onPress={p.onSetBudget}
          hitSlop={4} style={({ pressed }) => [styles.inlineAction, { opacity: pressed ? 0.65 : 1 }]}>
          <ThemedText type="smallBold" style={[styles.underline, { color: accent.fg }]}>{w.setBudget}</ThemedText>
        </Pressable>
      </StatTile> : showRight ? <StatTile palette={p.band} tone="accent" label={rightLabel} testID="home-left-to-spend"
        meta={rightMeta} metaTone={rightWarning ? 'strong' : 'normal'}
        accessibilityLabel={[`${rightLabel}, ${money(rightFils)}. ${rightMeta}`, caveat ? w.mayBeHigh : null].filter(Boolean).join('. ')}
        style={p.largeText && styles.tileStacked}>
        <BandFigure fils={rightFils} moneySpec={p.moneySpec} palette={p.band} size="large" color={accent.fg}
          secondaryColor={accent.fgSecondary} fitInset={p.largeText ? 28 : 200} />
        {caveat ? <ThemedText type="smallBold" style={{ color: accent.fg }} testID="home-left-caveat">{w.mayBeHigh}</ThemedText> : null}
      </StatTile> : null}
    </View>
    <View style={styles.weekHead}>
      <ThemedText type="smallBold" style={{ color: p.band.onBand }}>{w.thisWeek}</ThemedText>
      <ThemedText type="meta" style={{ color: p.band.onBandSecondary }}>{money(today.weekFils)}</ThemedText>
    </View>
    <WeekTiles testID="home-week" palette={p.band} moneySpec={p.moneySpec} height={70} accessibilityLabel={weekSpoken}
      days={today.week.map(day => ({ key: day.dateISO, label: fullWeekdays ? w.weekdayFull(day.weekday) : w.weekday(day.weekday),
        spokenLabel: w.weekdayFull(day.weekday), fils: day.fils, today: day.today }))} />
  </View>;
}

/**
 * Home's band (design language E, ink): the person's pattern with the
 * band's actions, the greeting, Today and Left in budgets as tiles, then the
 * last seven days. The sheet under it holds everything else.
 */
export function ReferenceHomeBand(p: BandProps) {
  const w = copy[p.language === 'ar' ? 'ar' : 'en'];
  const band = p.band;
  const pattern = p.onFounderUnlock && !p.brandMark ? (
    <Pressable
      testID="founder-unlock-logo"
      accessibilityRole="button"
      accessibilityLabel="Unlock Founder Pro"
      hitSlop={8}
      onPress={p.onFounderUnlock}
      style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}>
      {p.pattern}
    </Pressable>
  ) : p.pattern;
  return <View style={styles.band} testID="home-band">
    <View style={styles.header}>
      <View style={styles.patternSlot}>{pattern}</View>
      <View style={styles.actions}>
        {p.brandMark}
        {p.onAsk ? <Pressable testID="home-ask-chip" accessibilityRole="button" accessibilityLabel={w.ask} accessibilityHint={w.askHint}
          onPress={p.onAsk}
          style={({ pressed }) => [styles.askChip, { backgroundColor: band.tile, opacity: pressed ? 0.75 : 1 }]}>
          <Icon name="spark" size={16} color={band.onBand} strokeWidth={2} />
          <ThemedText type="smallBold" style={{ color: band.onBand }}>{w.ask}</ThemedText>
        </Pressable> : null}
        {p.hideHeaderAdd ? null : <Pressable testID="home-add" accessibilityRole="button" accessibilityLabel={w.add} onPress={p.onAdd}
          style={({ pressed }) => [styles.round, { backgroundColor: band.accent, opacity: pressed ? 0.8 : 1 }]}>
          <Icon name="plus" size={22} color={band.onAccent} strokeWidth={2.4} />
        </Pressable>}
        <Pressable testID="home-settings" accessibilityRole="button" accessibilityLabel={w.settings} onPress={p.onSettings}
          style={({ pressed }) => [styles.round, { backgroundColor: band.tile, opacity: pressed ? 0.75 : 1 }]}>
          <Icon name="sliders" size={20} color={band.onBand} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
    <View style={styles.greeting}>
      <ThemedText type="title" accessibilityRole="header" style={[styles.greetingText, { color: band.onBand }]}>{p.greeting}</ThemedText>
      <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{p.dateLabel}</ThemedText>
    </View>
    {p.today ? <TodayTiles p={p} today={p.today} /> : null}
  </View>;
}

/** One period, three reconciled figures, on Home's sheet. Account balances belong in Accounts. */
export function ReferenceHomeSummary(p: Props) {
  const w = copy[p.language === 'ar' ? 'ar' : 'en'];
  const netSign = p.netFils < 0 ? '−' : p.netFils > 0 ? '+' : '';
  const netColor = p.netFils < 0 ? p.theme.expense : p.netFils > 0 ? p.theme.income : p.theme.text;
  const currency = p.moneySpec.currency;
  return <View style={styles.root} testID="reference-home-summary">
    <View style={styles.summary} testID="journal-summary">
      <View style={styles.summaryTop}>
        <ThemedText type="smallBold" style={styles.sectionTitle}>{w.moneyOut}</ThemedText>
        <Pressable accessibilityRole="button" accessibilityLabel={p.periodLabel} onPress={p.onPeriod}
          style={[styles.period, { backgroundColor: p.theme.backgroundSelected }]}>
          <ThemedText type="meta">{p.periodLabel}</ThemedText>
          <Icon name="chevron-down" size={14} color={p.theme.textSecondary} />
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={p.onSpending} testID="home-spending-total"
        accessibilityLabel={`${w.moneyOut}, ${currency} ${formatMinorUnits(Math.round(p.expenseFils), p.moneySpec)}. ${w.viewSpending}`}
        style={styles.spending}>
        <Money fils={p.expenseFils} moneySpec={p.moneySpec} type="title" />
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
  root: { gap: 8 },
  band: { gap: 18 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  patternSlot: { flexShrink: 1, minWidth: 0, paddingTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginStart: 'auto' },
  askChip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 22 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  greeting: { gap: 2 },
  greetingText: { fontFamily: Fonts.sansSemi, fontSize: 32, lineHeight: 36, letterSpacing: -1.1 },
  todayBlock: { gap: 14 },
  tiles: { flexDirection: 'row', gap: 10 },
  tileStacked: { flexBasis: 'auto', flexGrow: 0, alignSelf: 'stretch' },
  offer: { gap: 4 },
  inlineAction: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  underline: { textDecorationLine: 'underline' },
  weekHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 },
  summary: { gap: 6 },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  sectionTitle: { fontSize: 17, lineHeight: 24 },
  period: { minHeight: 44, paddingHorizontal: 12, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 6 },
  spending: { minHeight: 76, justifyContent: 'center', alignItems: 'flex-start', gap: 6, paddingBottom: 8 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: StyleSheet.hairlineWidth, gap: 16, paddingVertical: 8 },
  metric: { flexGrow: 1, flexShrink: 1, flexBasis: '42%', minWidth: 120, minHeight: 48, gap: 6 },
  metricStacked: { flexBasis: 'auto', alignSelf: 'stretch' },
  stack: { flexDirection: 'column', alignItems: 'stretch' },
});
