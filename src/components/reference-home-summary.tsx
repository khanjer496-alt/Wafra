import { homeSummaryCopy as copy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { BandFigure, figureEms } from '@/components/ui/band/band-figure';
import { StatTile, statTileColors } from '@/components/ui/band/stat-tile';
import { WeekTiles } from '@/components/ui/band/week-tiles';
import { Fonts, type BandPalette, type Colors } from '@/constants/theme';
import { formatMinorUnits, formatMoneyText, type LedgerMoneySpec } from '@/lib/ledger-money';
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
  onBudgets?: () => void;
  /** Capture appears stopped: Left in budgets may be too high until it resumes. */
  captureStopped?: boolean;
  /** The screen's band palette; the sheet's controls take its card surface. */
  band?: BandPalette;
  /** Place the period summary directly on Home's ink band. */
  onBand?: boolean;
  /** Extra inset when a financial block is placed in a sheet card. */
  figureInset?: number;
  /** Name the average/budget period when its overview is hidden or farther down. */
  showPeriodContext?: boolean;
};

type BandProps = Props & {
  /** The Home band's palette (design language E: ink). */
  band: BandPalette;
  /** The person's pattern, drawn at the head of the band. */
  pattern?: React.ReactNode;
  /** Ordered editable content; the toolbar remains reachable. */
  sections?: React.ReactNode;
};

/** Today | Left in budgets as band tiles, then the last seven days as bars. Amounts are the shared ledger figures. */
function TodayTiles({ p, today, part = 'both' }: { p: BandProps; today: HomeToday; part?: 'today' | 'week' | 'both' }) {
  const w = copy[p.language === 'ar' ? 'ar' : 'en'];
  const { width, fontScale } = useWindowDimensions();
  const currency = p.moneySpec.currency;
  // Spoken amounts keep the ISO code; visible text follows the same symbol and
  // placement as the band figures ("$75" beside "$15 a day", never "USD 15").
  const money = (fils: number) => `${currency} ${formatMinorUnits(Math.round(Math.abs(fils)), p.moneySpec)}`;
  const shown = (fils: number) => formatMoneyText(Math.round(Math.abs(fils)), p.moneySpec);
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
    ? [`${shown(budget.perDayFils)} ${w.perDay}`, budget.overCount > 0 ? w.budgetsOver(budget.overCount) : w.daysLeft(budget.daysLeft), p.showPeriodContext ? p.periodLabel : null].filter(Boolean).join(' · ')
    : `${p.showPeriodContext ? `${p.periodLabel} · ` : ''}${w.overDays(average?.days ?? 0)}, ${w.excludingFixed}`;
  const rightWarning = budget !== null && budget.overCount > 0;
  const caveat = budget !== null && p.captureStopped === true;
  const accent = statTileColors(p.band, 'accent');
  // Full Arabic weekday names only where seven really fit: a column is about
  // 44pt on a 390pt phone, narrower than الخميس in Noto Kufi. Otherwise the
  // initials, with full names always spoken.
  const fullWeekdays = p.language === 'ar' && !p.largeText && width / Math.max(fontScale, 1) >= 430;
  const weekSpoken = `${w.weekTotal} ${money(today.weekFils)}. ` +
    today.week.map(day => `${w.weekdayFull(day.weekday)} ${money(day.fils)}`).join(', ');
  return <View style={styles.todayBlock} testID={part === 'week' ? 'home-week-block' : 'home-today'}>
    {part !== 'week' ? <View style={[styles.tiles, p.largeText && styles.stack]}>
      <StatTile palette={p.band} tone="band" label={w.today} meta={countLabel} onPress={p.onToday} testID="home-today-total"
        accessibilityLabel={`${w.today}, ${money(today.todayFils)}. ${countLabel}`} accessibilityHint={w.opensActivity}
        style={p.largeText && styles.tileStacked}>
        {/* A new capture rolls only the digits that changed; static under Reduce Motion or a screen reader. */}
        <BandFigure fils={today.todayFils} moneySpec={p.moneySpec} palette={p.band} size="medium" rolling fitInset={(p.largeText ? 28 : 200) + (p.figureInset ?? 0)} />
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
        onPress={budget ? p.onBudgets : undefined} accessibilityHint={budget ? w.opensBudgets : undefined}
        meta={rightMeta} metaTone={rightWarning ? 'strong' : 'normal'}
        accessibilityLabel={[`${rightLabel}, ${money(rightFils)}. ${rightMeta}`, caveat ? w.mayBeHigh : null].filter(Boolean).join('. ')}
        style={p.largeText && styles.tileStacked}>
        <BandFigure fils={rightFils} moneySpec={p.moneySpec} palette={p.band} size="medium" color={accent.fg}
          secondaryColor={accent.fgSecondary} fitInset={(p.largeText ? 28 : 200) + (p.figureInset ?? 0)} />
        {caveat ? <ThemedText type="smallBold" style={{ color: accent.fg }} testID="home-left-caveat">{w.mayBeHigh}</ThemedText> : null}
      </StatTile> : null}
    </View> : null}
    {part !== 'today' ? <><View style={styles.weekHead}>
      <ThemedText type="smallBold" style={{ color: p.band.onBand }}>{w.thisWeek}</ThemedText>
      <ThemedText type="meta" style={{ color: p.band.onBandSecondary }}>{shown(today.weekFils)}</ThemedText>
    </View>
    <WeekTiles testID="home-week" palette={p.band} moneySpec={p.moneySpec} height={70} accessibilityLabel={weekSpoken}
      days={today.week.map(day => ({ key: day.dateISO, label: fullWeekdays ? w.weekdayFull(day.weekday) : w.weekday(day.weekday),
        spokenLabel: w.weekdayFull(day.weekday), fils: day.fils, today: day.today }))} /></> : null}
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
      accessibilityLabel={copy[p.language === 'ar' ? 'ar' : 'en'].founderUnlock}
      hitSlop={8}
      onPress={p.onFounderUnlock}
      style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}>
      {p.pattern}
    </Pressable>
  ) : p.pattern;
  return <View style={styles.band} testID="home-band">
    <View style={styles.header}>
      <View style={[styles.patternSlot, styles.headerPatternSlot]}>{pattern}</View>
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
    {p.sections !== undefined ? p.sections : <>
      <ReferenceHomeGreeting {...p} pattern={undefined} />
      <ReferenceHomeSummary {...p} onBand />
      {p.today ? <TodayTiles p={p} today={p.today} /> : null}
    </>}
  </View>;
}

/** Independent Home blocks retain the same live figures wherever placed. */
export function ReferenceHomeGreeting(p: BandProps) {
  return <View style={styles.greeting}>
    {p.pattern ? <View style={styles.patternSlot}>{p.pattern}</View> : null}
    <ThemedText type="title" accessibilityRole="header" style={[styles.greetingText, { color: p.band.onBand }]}>{p.greeting}</ThemedText>
    <ThemedText type="meta" style={{ color: p.band.onBandSecondary }}>{p.dateLabel}</ThemedText>
  </View>;
}
export function ReferenceHomeToday(p: BandProps) {
  return p.today ? <TodayTiles p={p} today={p.today} part="today" /> : null;
}
export function ReferenceHomeWeek(p: BandProps) {
  return p.today ? <TodayTiles p={p} today={p.today} part="week" /> : null;
}

/**
 * Home v2's month line on the band, under the Today tiles: the period (a
 * button that opens the period picker), then Spent · In · Net for it. The
 * same three reconciled figures as the full card, exact and spoken with
 * their currency; each is sized to fit its third of the line, and Larger
 * Text stacks them.
 */
function MonthLine(p: Props & { band: BandPalette }) {
  const w = copy[p.language === 'ar' ? 'ar' : 'en'];
  const { width, fontScale } = useWindowDimensions();
  const band = p.band;
  const currency = p.moneySpec.currency;
  const exact = (fils: number) => formatMinorUnits(Math.round(Math.abs(fils)), p.moneySpec);
  const netSign = p.netFils < 0 ? '−' : p.netFils > 0 ? '+' : '';
  const cells = [
    { id: 'home-spending-total', label: w.lineSpent, value: exact(p.expenseFils), color: band.onBand, onPress: p.onSpending,
      spoken: `${w.moneyOut}, ${currency} ${formatMinorUnits(Math.round(p.expenseFils), p.moneySpec)}. ${w.viewSpending}` },
    { id: 'home-income-summary', label: w.lineIn, value: exact(p.incomeFils), color: band.onBand, onPress: p.onIncome,
      spoken: `${w.moneyIn}, ${currency} ${formatMinorUnits(Math.round(p.incomeFils), p.moneySpec)}` },
    { id: 'home-net-summary', label: w.lineNet, value: `${netSign}${exact(p.netFils)}`,
      color: p.netFils > 0 ? band.accent : band.onBand, onPress: undefined,
      spoken: `${w.netLabel}, ${currency} ${netSign}${exact(p.netFils)}` },
  ];
  // The period heads the strip; each figure takes a third of the row under
  // it, set smaller to fit rather than clipped, and stacks when even 12pt
  // would not fit. `fitted` is the size drawn after the system text scale,
  // so the style size divides it back out.
  const cellWidth = (width - 40 - 24 - 2 * 10) / 3;
  const fitted = Math.min(...cells.map(cell => Math.min(15, cellWidth / Math.max(1, figureEms(cell.value)))));
  const stacked = p.largeText || fitted < 12 || fontScale > 1.3;
  const size = stacked ? 15 : fitted / Math.max(1, fontScale);
  return <View style={styles.root} testID="reference-home-summary">
    <View testID="journal-summary" style={[styles.line, stacked && styles.lineStacked, { backgroundColor: band.tile }]}>
      <View style={styles.lineHeader}>
        <Pressable testID="home-period" accessibilityRole="button" accessibilityLabel={`${w.choosePeriod}, ${p.periodLabel}`}
          onPress={p.onPeriod} hitSlop={6} style={({ pressed }) => [styles.linePeriod, { opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{p.periodLabel}</ThemedText>
          <Icon name="chevron-down" size={14} color={band.onBandSecondary} />
        </Pressable>
        {/* The figures' currency, once for the line; each figure speaks its own. */}
        <ThemedText type="meta" testID="home-line-currency" importantForAccessibility="no" accessibilityElementsHidden
          style={{ color: band.onBandSecondary }}>{currency}</ThemedText>
      </View>
      <View style={[styles.lineCells, stacked && styles.stack]}>
        {cells.map(cell => {
          const body = <>
            <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{cell.label}</ThemedText>
            <ThemedText style={[styles.lineValue, { color: cell.color, fontSize: size, lineHeight: Math.round(size * 1.3) }]}>{cell.value}</ThemedText>
          </>;
          const style = [styles.lineCell, stacked && styles.lineCellStacked];
          return cell.onPress
            ? <Pressable key={cell.id} testID={cell.id} accessibilityRole="button" accessibilityLabel={cell.spoken} onPress={cell.onPress}
                style={({ pressed }) => [...style, { opacity: pressed ? 0.7 : 1 }]}>{body}</Pressable>
            : <View key={cell.id} testID={cell.id} accessible accessibilityRole="text" accessibilityLabel={cell.spoken} style={style}>{body}</View>;
        })}
      </View>
    </View>
    {p.incomeFils === 0 && <ThemedText type="meta" style={{ color: band.onBandSecondary }} testID="home-no-income-note">
      {w.noIncome}</ThemedText>}
  </View>;
}

/** One period, three reconciled figures: the month line on the band, the full card on the sheet. */
export function ReferenceHomeSummary(p: Props) {
  return p.onBand && p.band ? <MonthLine {...p} band={p.band} /> : <SummaryCard {...p} />;
}

/** The full card, where the person placed the overview on the sheet. Account balances belong in Accounts. */
function SummaryCard(p: Props) {
  const w = copy[p.language === 'ar' ? 'ar' : 'en'];
  const { width } = useWindowDimensions();
  const stackMetrics = p.largeText || width - 40 - (p.figureInset ?? 0) < 256;
  const fg = p.onBand && p.band ? p.band.onBand : p.theme.text;
  const secondary = p.onBand && p.band ? p.band.onBandSecondary : p.theme.textSecondary;
  const positive = p.onBand && p.band ? p.band.accent : p.theme.income;
  const rule = p.onBand && p.band ? p.band.bandMark : p.theme.cardBorder;
  const netSign = p.netFils < 0 ? '−' : p.netFils > 0 ? '+' : '';
  const netColor = p.netFils < 0 ? (p.onBand ? fg : p.theme.expense) : p.netFils > 0 ? positive : fg;
  const currency = p.moneySpec.currency;
  return <View style={styles.root} testID="reference-home-summary">
    <View style={styles.summary} testID="journal-summary">
      <View style={styles.summaryTop}>
        <ThemedText type="smallBold" style={[styles.sectionTitle, { color: secondary }]}>{w.totalSpent}</ThemedText>
        <Pressable accessibilityRole="button" accessibilityLabel={p.periodLabel} onPress={p.onPeriod}
          style={[styles.period, { backgroundColor: p.onBand && p.band ? p.band.tile : p.band?.card ?? p.theme.backgroundSelected }]}>
          <ThemedText type="meta" style={{ color: fg }}>{p.periodLabel}</ThemedText>
          <Icon name="chevron-down" size={14} color={secondary} />
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={p.onSpending} testID="home-spending-total"
        accessibilityLabel={`${w.moneyOut}, ${currency} ${formatMinorUnits(Math.round(p.expenseFils), p.moneySpec)}. ${w.viewSpending}`}
        style={styles.spending}>
        {p.band ? <BandFigure fils={p.expenseFils} moneySpec={p.moneySpec} palette={p.band} size="large" color={fg} secondaryColor={secondary} fitInset={p.figureInset ?? 0} /> : <Money fils={p.expenseFils} moneySpec={p.moneySpec} type="title" color={fg} />}
        <View style={styles.link}><ThemedText type="meta" style={{ color: positive }}>{w.viewSpending}</ThemedText>
          <Icon name="arrow-up-right" size={16} color={positive} /></View>
      </Pressable>
      <View style={[styles.metrics, { borderColor: rule }, stackMetrics && styles.stack]}>
      <Pressable accessibilityRole="button" onPress={p.onIncome} testID="home-income-summary"
        accessibilityLabel={`${w.moneyIn}, ${currency} ${formatMinorUnits(Math.round(p.incomeFils), p.moneySpec)}`}
        style={[styles.metric, stackMetrics && styles.metricStacked]}>
        <View style={styles.link}><Icon name="arrow-down-right" size={16} color={positive} />
          <ThemedText type="meta" style={{ color: secondary }}>{w.moneyIn}</ThemedText></View>
        {p.band ? <BandFigure fils={p.incomeFils} moneySpec={p.moneySpec} palette={p.band} size="medium" color={positive} secondaryColor={secondary} fitInset={(stackMetrics ? 0 : 180) + (p.figureInset ?? 0)} /> : <Money fils={p.incomeFils} moneySpec={p.moneySpec} type="smallBold" color={positive} />}
      </Pressable>
      <View testID="home-net-summary" accessible accessibilityRole="text"
        accessibilityLabel={`${w.netLabel}, ${currency} ${netSign}${formatMinorUnits(Math.round(Math.abs(p.netFils)), p.moneySpec)}`}
        style={[styles.metric, stackMetrics && styles.metricStacked]}>
        <ThemedText type="meta" style={{ color: secondary }}>{w.netLabel}</ThemedText>
        {p.band ? <BandFigure fils={p.netFils} moneySpec={p.moneySpec} palette={p.band} size="medium" sign={p.netFils === 0 ? 'none' : 'auto'} color={netColor} secondaryColor={secondary} fitInset={(stackMetrics ? 0 : 180) + (p.figureInset ?? 0)} /> : <Money fils={p.netFils} moneySpec={p.moneySpec} type="smallBold" sign={p.netFils === 0 ? 'none' : 'auto'} color={netColor} />}
      </View>
      </View>
      {p.incomeFils === 0 && <ThemedText type="meta" style={{ color: secondary }} testID="home-no-income-note">
        {w.noIncome}</ThemedText>}
      <ThemedText type="meta" style={{ color: secondary }}>{w.cashflowNote}</ThemedText>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 8 },
  band: { gap: 18 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  patternSlot: { flexShrink: 1, minWidth: 0, paddingTop: 4 },
  headerPatternSlot: { alignSelf: 'center', paddingTop: 0 },
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
  line: { borderRadius: 18, paddingTop: 2, paddingBottom: 10, paddingHorizontal: 12, gap: 2 },
  lineStacked: { gap: 6 },
  lineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  linePeriod: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 4 },
  lineCells: { flexDirection: 'row', gap: 10 },
  lineCell: { flex: 1, flexBasis: 0, minWidth: 0, minHeight: 48, justifyContent: 'center' },
  lineCellStacked: { flexBasis: 'auto', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  lineValue: { fontFamily: Fonts.sansSemi, fontVariant: ['tabular-nums'], letterSpacing: -0.2, writingDirection: 'ltr' },
});
