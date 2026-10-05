import { homeSummaryCopy as copy } from '@/lib/reference-copy';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { BandFigure, figureEms } from '@/components/ui/band/band-figure';
import { ghostTone, type CoinTone } from '@/components/ui/coins/coin-disc';
import { COIN_RISE, COIN_STAGGER, nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { CoinStack } from '@/components/ui/coins/coin-stack';
import { StatTile, statTileColors } from '@/components/ui/band/stat-tile';
import { WeekTiles } from '@/components/ui/band/week-tiles';
import { CoinColors, Fonts, type BandPalette, type Colors } from '@/constants/theme';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { filledCoins, shareOf } from '@/lib/coin-math';
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

/** Coins in Left in budgets' stack, their width, and the gap before the figure. */
const LEFT_COINS = 8;
const LEFT_COIN_WIDTH = 22;
const LEFT_COIN_GAP = 8;
/** Today's coins: one per payment today, at most this many; the figure and count say the rest. */
const TODAY_COINS = 6;
const TODAY_COIN_WIDTH = 18;
/** The daily average's columns: one per day it divides by, for a window of up to a month. */
const AVERAGE_MAX_DAYS = 31;
/** Coins in the biggest day's column; the others are drawn against it. */
const AVERAGE_COLUMN_COINS = 5;
/**
 * Money in and spent as two stacks of this many coins, scaled to the larger:
 * small enough that each stack and its name fit the month line's 40pt header.
 */
const FLOW_COINS = 6;
const FLOW_COIN_WIDTH = 12;
/** The gold coin, from the theme: one object, so memoised columns keep their props. */
const GOLD_TONE: CoinTone = { face: CoinColors.face, side: CoinColors.side, rim: CoinColors.rim };

/** Coins in Today's stack: one per payment today, never more than there were, capped. */
export function todayCoinCount(payments: number): number {
  return Number.isFinite(payments) ? Math.max(0, Math.min(TODAY_COINS, Math.floor(payments))) : 0;
}

/**
 * Coins in each day's column of the daily average, against the biggest day:
 * that day fills its column, a day with any spending shows at least one coin,
 * and a day with none shows none.
 */
export function averageColumnCoins(days: readonly number[], total = AVERAGE_COLUMN_COINS): number[] {
  const largest = days.reduce((max, fils) => Math.max(max, fils), 0);
  return days.map((fils) => filledCoins(shareOf(Math.max(0, fils), largest), total));
}

/** Coins of money in and of spending, each against the larger of the two; null when neither moved. */
export function flowStackCoins(incomeFils: number, expenseFils: number, total = FLOW_COINS): { income: number; spent: number } | null {
  const income = Math.max(0, incomeFils);
  const spent = Math.max(0, expenseFils);
  const larger = Math.max(income, spent);
  if (!(larger > 0)) return null;
  return { income: filledCoins(shareOf(income, larger), total), spent: filledCoins(shareOf(spent, larger), total) };
}

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
  // The budget as a stack of coins beside its figure: gold for the share of
  // the total still left, the spent places as empty slots in the tile's own
  // tone. Only a real budget has a stack; Larger Text leaves the figure the
  // whole tile instead.
  const coins = budget !== null && budget.limitFils > 0 && !p.largeText
    ? filledCoins(shareOf(budget.leftFils, budget.limitFils), LEFT_COINS) : null;
  const coinRoom = coins === null ? 0 : LEFT_COIN_WIDTH + LEFT_COIN_GAP;
  // Today: a coin per payment, standing at the tile's bottom end beside its
  // count, dropping in as each one is captured. No payments, no coins; Larger
  // Text leaves the figure the tile.
  const todayCoins = p.largeText ? 0 : todayCoinCount(today.todayCount);
  const todayTile = statTileColors(p.band, 'band');
  // The room a tile leaves its figure, as BandFigure's inset: half the band
  // less the 10pt gap and the tile's 14pt padding each side (stacked under
  // Larger Text, the whole band less the padding), less anything beside it.
  const tileInset = (beside: number) => (p.largeText ? 28 + (p.figureInset ?? 0)
    : Math.ceil(width / 2 + 9 + (p.figureInset ?? 0) / 2)) + beside;
  // The daily average with no budget: a column per day it divides by, each
  // as tall as that day's everyday spending against the biggest day. Only
  // for a window of up to a month, where a column per day still fits.
  const averageDays = budget === null && !offerBudget && average !== null && !p.largeText && today.averageDays
    && today.averageDays.length === average.days && average.days <= AVERAGE_MAX_DAYS
    && today.averageDays.some((fils) => fils > 0) ? today.averageDays : null;
  // The tile's inner width: half the band less the gap, its padding and any sheet inset.
  const averageRow = Math.max(48, (width - 40 - 10 - (p.figureInset ?? 0)) / 2 - 28);
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
        <BandFigure fils={today.todayFils} moneySpec={p.moneySpec} palette={p.band} size="medium" rolling inlineCurrency
          fitInset={tileInset(0)} />
        {todayCoins > 0 ? <CoinStack testID="home-today-coins" total={todayCoins} filled={todayCoins} width={TODAY_COIN_WIDTH}
          ghost={ghostTone(todayTile.bg, todayTile.fg)} style={styles.todayCoins} /> : null}
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
        <View style={{ paddingEnd: coinRoom }}>
          <BandFigure fils={rightFils} moneySpec={p.moneySpec} palette={p.band} size="medium" color={accent.fg}
            secondaryColor={accent.fgSecondary} inlineCurrency fitInset={tileInset(coinRoom)} />
          {coins === null ? null : <CoinStack testID="home-left-coins" total={LEFT_COINS} filled={coins} width={LEFT_COIN_WIDTH}
            ghost={ghostTone(accent.bg, accent.fg)} style={styles.coinStack} />}
        </View>
        {averageDays ? <AverageColumns testID="home-average-columns" days={averageDays} rowWidth={averageRow}
          surface={accent.bg} ink={accent.fg} /> : null}
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
 * The daily average's days as a row of coin columns seen a little from above,
 * oldest at the start (the right in Arabic). Each column is that day's
 * everyday spending against the biggest day; a day with none is one empty
 * coin. They rise from the baseline one after another once; columns that
 * arrive later (a new day, another period) stand in place. Decorative: the
 * tile writes and speaks the average.
 */
const AverageColumns = React.memo(function AverageColumns({ days, rowWidth, surface, ink, testID }: {
  days: readonly number[];
  rowWidth: number;
  /** The tile's colour and its text colour, for an empty day's coin. */
  surface: string;
  ink: string;
  testID?: string;
}) {
  const motion = useMotionPreference();
  const ghost = useMemo(() => ghostTone(surface, ink), [surface, ink]);
  const revealed = useRef(false);
  useEffect(() => { if (motion.ready) revealed.current = true; });
  const coins = useMemo(() => averageColumnCoins(days), [days]);
  const count = coins.length;
  const gap = count > 15 ? 1 : 3;
  const width = Math.max(3, Math.min(12, Math.floor((rowWidth - gap * (count - 1)) / count)));
  const face = Math.max(2, Math.round(width * 0.36));
  const edge = Math.max(2, Math.round(width * 0.24));
  // A month of columns starts within about a second, not two.
  const stagger = Math.min(COIN_STAGGER, Math.floor(900 / Math.max(1, count)));
  return <View testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    style={[styles.columns, { gap, height: face + AVERAGE_COLUMN_COINS * edge }]}>
    {coins.map((filled, index) => <CoinColumn key={index} coins={filled} width={width} face={face} edge={edge}
      tone={filled > 0 ? GOLD_TONE : ghost} delay={index * stagger} appear={!revealed.current}
      ready={motion.ready} reducedMotion={motion.reducedMotion} testID={testID ? `${testID}-day-${index}` : undefined} />)}
  </View>;
});

/** One day's column: a cylinder of `coins` coins (one empty coin for none) that rises from the baseline once. */
const CoinColumn = React.memo(function CoinColumn({ coins, width, face, edge, tone, delay, appear, ready, reducedMotion, testID }: {
  coins: number;
  width: number;
  face: number;
  edge: number;
  tone: CoinTone;
  delay: number;
  /** False for a column that arrives after the row's first reveal: it stands in place. */
  appear: boolean;
  ready: boolean;
  reducedMotion: boolean;
  testID?: string;
}) {
  const level = Math.max(1, coins);
  const tall = face + level * edge;
  const rise = useAnimatedNumber(reducedMotion || !appear ? 1 : 0);
  const shown = useRef(reducedMotion || !appear);
  // Read when the rise starts: a re-render must not restart a column on its way.
  const wait = useRef(delay);
  wait.current = delay;
  useEffect(() => {
    if (reducedMotion) {
      shown.current = true;
      rise.setValue(1);
      return;
    }
    // Hold still until the screen-reader state is known (see use-reduced-motion).
    if (!ready || shown.current) return;
    shown.current = true;
    const run = Animated.sequence([
      Animated.delay(wait.current),
      Animated.spring(rise, { toValue: 1, ...COIN_RISE, useNativeDriver: nativeDriver }),
    ]);
    run.start();
    // The rise runs once: interrupted, the column lands where it belongs.
    return () => {
      run.stop();
      rise.setValue(1);
    };
  }, [ready, reducedMotion, rise]);
  // Built once per height: from below the baseline (clipped by the row) up to its place.
  const paint = useMemo(() => ({
    transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [tall + 2, 0] }) }],
  }), [rise, tall]);
  const lined = width >= 6;
  const ellipse = (top: number) => ({
    position: 'absolute' as const, start: 0, top: top + face / 2 - width / 2, width, height: width,
    borderRadius: width / 2, transform: [{ scaleY: face / width }],
  });
  const rim = lined ? { borderWidth: 1, borderColor: tone.rim } : null;
  return <Animated.View testID={testID} style={[{ width, height: tall }, paint]}>
    {/* The bottom coin's lower edge, the side of the column, the lines between coins, then the top face. */}
    <View style={[ellipse(level * edge), { backgroundColor: tone.side }, rim]} />
    <View style={[styles.columnSide, { top: face / 2, height: level * edge, backgroundColor: tone.side },
      lined && { borderStartWidth: 1, borderEndWidth: 1, borderColor: tone.rim }]} />
    {lined ? Array.from({ length: level - 1 }, (_, line) => <View key={line}
      style={[styles.columnLine, { top: face / 2 + (line + 1) * edge, backgroundColor: tone.rim }]} />) : null}
    <View style={[ellipse(0), { backgroundColor: tone.face }, rim]} />
  </Animated.View>;
});

/**
 * Money in and spending for the period as two coin stacks side by side, in
 * the order the figures are written (Spent, then In), each scaled against the
 * larger and named under it with the card's own words: the difference in
 * their heights is the net. Money in of zero is an empty stack. Decorative:
 * the figures beside it are written and spoken.
 */
function FlowStacks({ incomeFils, expenseFils, surface, ink, spent, income, style }: {
  incomeFils: number;
  expenseFils: number;
  /** The surface the stacks stand on and its text colour, for the empty places. */
  surface: string;
  ink: string;
  /** Each stack's name, as the card already writes it, in its figure's colour. */
  spent: { label: string; color: string };
  income: { label: string; color: string };
  style?: StyleProp<ViewStyle>;
}) {
  const coins = flowStackCoins(incomeFils, expenseFils);
  if (coins === null) return null;
  const ghost = ghostTone(surface, ink);
  return <View testID="home-flow-coins" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
    style={[styles.flowCoins, style]}>
    {([['spent', coins.spent, spent], ['in', coins.income, income]] as const).map(([id, filled, name]) =>
      <View key={id} style={styles.flowColumn}>
        <CoinStack testID={`home-flow-coins-${id}`} total={FLOW_COINS} filled={filled} width={FLOW_COIN_WIDTH} ghost={ghost} />
        <ThemedText testID={`home-flow-coins-${id}-label`} maxFontSizeMultiplier={1.2} numberOfLines={1}
          style={[styles.flowLabel, { color: name.color }]}>{name.label}</ThemedText>
      </View>)}
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
      color: p.netFils > 0 ? band.accentOnBand : band.onBand, onPress: undefined,
      spoken: `${w.netLabel}, ${currency} ${netSign}${exact(p.netFils)}` },
  ];
  // The period heads the strip; each figure takes a third of the row under
  // it, set smaller to fit rather than clipped, and stacks when even 12pt
  // would not fit. `fitted` is the size drawn after the system text scale,
  // so the style size divides it back out.
  const lineWidth = width - 40 - 24;
  const cellWidth = (lineWidth - 2 * 10) / 3;
  const ems = Math.max(1, ...cells.map(cell => figureEms(cell.value)));
  const fitted = Math.min(15, cellWidth / ems);
  const stacked = p.largeText || fitted < 12 || fontScale > 1.3;
  // Stacked, each figure has the whole line under its label: the person's
  // text size, unless even that would run past the edge.
  const scale = Math.max(1, fontScale);
  const size = stacked ? Math.min(15, lineWidth / (ems * scale)) : fitted / scale;
  const flowCoins = flowStackCoins(p.incomeFils, p.expenseFils);
  const flowGhost = useMemo(() => ghostTone(band.tile, band.onBand), [band.tile, band.onBand]);
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
          // Spent and In each carry their coin stack beside their own label, so the
          // name is written once and the stacks' heights compare like the figures.
          const filled = flowCoins === null || stacked ? null
            : cell.id === 'home-spending-total' ? flowCoins.spent : cell.id === 'home-income-summary' ? flowCoins.income : null;
          const body = <>
            <View style={styles.cellLabelRow}>
              <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{cell.label}</ThemedText>
              {filled === null ? null : <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <CoinStack testID={cell.id === 'home-spending-total' ? 'home-flow-coins-spent' : 'home-flow-coins-in'}
                  total={FLOW_COINS} filled={filled} width={FLOW_COIN_WIDTH} ghost={flowGhost} />
              </View>}
            </View>
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
  const positive = p.onBand && p.band ? p.band.accentOnBand : p.theme.income;
  const rule = p.onBand && p.band ? p.band.bandMark : p.theme.cardBorder;
  const netSign = p.netFils < 0 ? '−' : p.netFils > 0 ? '+' : '';
  const netColor = p.netFils < 0 ? (p.onBand ? fg : p.theme.expense) : p.netFils > 0 ? positive : fg;
  const currency = p.moneySpec.currency;
  return <View style={styles.root} testID="reference-home-summary">
    <View style={styles.summary} testID="journal-summary">
      <View style={styles.summaryTop}>
        <ThemedText type="smallBold" style={[styles.sectionTitle, { color: secondary }]}>{w.totalSpent}</ThemedText>
        {p.band && !p.largeText ? <FlowStacks incomeFils={p.incomeFils} expenseFils={p.expenseFils} surface={p.band.card} ink={fg}
          spent={{ label: w.lineSpent, color: fg }} income={{ label: w.lineIn, color: positive }}
          style={styles.flowCoinsLine} /> : null}
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
  // The stack sits at the tile's end on the figure's line, rising into the
  // tile's top padding rather than pushing its label below the Today tile's.
  coinStack: { position: 'absolute', end: 0, bottom: 2 },
  // Today's coins stand on the tile's bottom end, beside the payment count, inside its padding.
  todayCoins: { position: 'absolute', end: 14, bottom: 10 },
  // The average's day columns stand on one baseline; anything below it is clipped, so they rise out of it.
  columns: { flexDirection: 'row', alignItems: 'flex-end', overflow: 'hidden', marginTop: 4, marginBottom: 2, pointerEvents: 'none' },
  columnSide: { position: 'absolute', start: 0, end: 0 },
  columnLine: { position: 'absolute', start: 1, end: 1, height: 1, opacity: 0.45 },
  // In and Spent side by side at the end of the line's header, before the currency.
  flowCoins: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, pointerEvents: 'none' },
  flowColumn: { alignItems: 'center', gap: 1 },
  flowLabel: { fontFamily: Fonts.sansSemi, fontSize: 10, lineHeight: 12 },
  flowCoinsLine: { marginStart: 'auto' },
  cellLabelRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
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
  lineCellStacked: { flexBasis: 'auto', alignItems: 'flex-start' },
  lineValue: { fontFamily: Fonts.sansSemi, fontVariant: ['tabular-nums'], letterSpacing: -0.2, writingDirection: 'ltr' },
});
