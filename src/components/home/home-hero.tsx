/**
 * Home v3's hero on the ink band: "Spent in <Month>" as the band's one big
 * figure, a small chip with the trend against the same days of last month,
 * the month's spending as a thin line, and In · Net under it. Every amount
 * comes from the shared projections (summarizeMonth, home-hero.ts); nothing
 * here adds money up.
 *
 * - Tap the card: it opens in place to the month's category coins (Spending's
 *   ShareBar) and closes on a second tap.
 * - Swipe it sideways (or the chevron, or the increment/decrement actions):
 *   the card turns over (rotateY) to last month and back. Local to Home; the
 *   app's period does not change.
 * - The line draws itself once and the trend arrow flips into place, on one
 *   native-driven clock, after Home can be seen.
 * - It leans a few degrees with the phone when this build has the motion
 *   sensor (use-device-tilt.ts).
 *
 * Reduce Motion or a screen reader: everything in place, turns are instant,
 * no tilt. Decorative drawings are hidden from assistive tech; the card
 * speaks "Spent in October, AED 1,234.00, up 12% versus the same days of
 * September. In AED …. Net …".
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { HomeSparkline } from '@/components/home/home-sparkline';
import { ThemedText } from '@/components/themed-text';
import { BandFigure } from '@/components/ui/band/band-figure';
import { ShareBar } from '@/components/ui/band/share-bar';
import { COIN_RISE_CURVE, coinTrack, nativeDriver, useCoinClock, useCoinRun, type CoinCurve, type CoinNode, type CoinRun } from '@/components/ui/coins/coin-motion';
import { Icon } from '@/components/ui/icon';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useAppActive } from '@/hooks/use-app-active';
import { useCategoryCatalog } from '@/hooks/use-category-catalog';
import { useDeviceTilt } from '@/hooks/use-device-tilt';
import { useLanguage } from '@/hooks/use-language';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { CATEGORY_REST, categoryColors } from '@/lib/category-colors';
import { homeCopy } from '@/lib/home-copy';
import type { HeroMonthSeries } from '@/lib/home-hero';
import { isRTL } from '@/lib/i18n';
import type { MonthSummary } from '@/lib/insights';
import { formatMinorUnits, formatMoneyText, type LedgerMoneySpec } from '@/lib/ledger-money';
import { spendingCategoryRows, spendingShare, spendingShareLabel } from '@/lib/reference-presentation';
import type { Budget } from '@/lib/types';

export interface HeroMonth {
  key: string;
  /** "October" (with its year when it is not this year's). */
  name: string;
  /** The month its trend compares against, named the same way. */
  comparedName: string;
  /** The month's summarizeMonth: Spent, In and the categories. */
  summary: MonthSummary;
  series: HeroMonthSeries;
}

type Face = 'current' | 'previous';

/** The card's inner padding; the figure fits the band less this on each side. */
const PAD = 16;
const BAND_GUTTER = 20;
/** The line opens over this long, easing out. */
const LINE_MS = 650;
/** The trend arrow flips in once the line is most of the way across. */
const ARROW_AT = 380;
/** A sideways drag past this turns the card. */
const SWIPE_DISTANCE = 48;
/** Half a turn each way (edge-on in the middle, where the face changes). */
const HALF_TURN_MS = 150;

/** An ease-out from 0 to 1 over `ms`, as a coin-clock curve (sampled, thinned by eye). */
function easeOutCurve(ms: number): CoinCurve {
  const steps = 10;
  const times: number[] = [];
  const values: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    times.push(Math.round(t * ms));
    values.push(1 - (1 - t) ** 3);
  }
  return { times, values, restMs: ms };
}
const LINE_CURVE = easeOutCurve(LINE_MS);

export function HomeHero({ band, moneySpec, language, largeText, current, previous, onWantPrevious, budgets,
  warning, hold }: {
  band: BandPalette;
  moneySpec: LedgerMoneySpec;
  language: string;
  largeText: boolean;
  current: HeroMonth;
  /** Last month, computed only once the person asks for it (onWantPrevious). */
  previous: HeroMonth | null;
  onWantPrevious: () => void;
  budgets: readonly Budget[];
  /** This month's spending is over last month's pace: the chip wears the warning colour. */
  warning: boolean;
  /** Home cannot be seen yet (splash, App Lock, background): motion waits. */
  hold: boolean;
}) {
  const words = homeCopy(language);
  const { width } = useWindowDimensions();
  const motion = useMotionPreference();
  const active = useAppActive();
  const live = motion.ready && active && !hold;
  const still = motion.reducedMotion;
  const rtl = isRTL();
  const [face, setFace] = useState<Face>('current');
  const [expanded, setExpanded] = useState(false);
  // A turn asked for before last month was computed waits for it.
  const [pending, setPending] = useState<Face | null>(null);
  // Another month chosen for the app (Spending's period) starts the card on its front again.
  useEffect(() => { setFace('current'); setPending(null); }, [current.key]);
  const front = !(face === 'previous' && previous);
  const month = front ? current : previous!;
  const otherName = front ? previous?.name ?? current.comparedName : current.name;

  // ── The first reveal: the line opens, then the arrow flips in. ──
  const clock = useCoinClock();
  const revealed = useRef(false);
  const hasLine = current.series.cumulative.length > 0;
  const reveal = useMemo((): { line: CoinNode; arrow: CoinNode; run: CoinRun | null; held: boolean } => {
    if (still || revealed.current) return { line: new Animated.Value(1), arrow: new Animated.Value(1), run: null, held: false };
    if (!live) return { line: new Animated.Value(0), arrow: new Animated.Value(0), run: null, held: true };
    const run = clock.reserve(Math.max(LINE_MS, ARROW_AT + COIN_RISE_CURVE.restMs));
    return {
      line: coinTrack(clock.value, run.base, 1, hasLine ? [{ at: 0, from: 0, to: 1, curve: LINE_CURVE }] : []),
      arrow: coinTrack(clock.value, run.base, 1, [{ at: hasLine ? ARROW_AT : 0, from: 0, to: 1, curve: COIN_RISE_CURVE }]),
      run, held: false,
    };
    // `revealed` is read when the motion state changes, never as a trigger.
  }, [clock, live, still, hasLine]);
  useEffect(() => { if (!reveal.held) revealed.current = true; }, [reveal]);
  useCoinRun(clock, reveal.run, live);
  // Last month's face is drawn in place: only the first reveal moves.
  const staticDone = useMemo(() => new Animated.Value(1), []);

  // ── The turn between months. ──
  const turn = useMemo(() => new Animated.Value(0), []);
  const turning = useRef(false);
  const towardPrevious = rtl ? -1 : 1;
  const runTurn = (to: Face) => {
    if (turning.current) return;
    const sign = to === 'previous' ? towardPrevious : -towardPrevious;
    if (still || !live) {
      turn.setValue(0);
      setFace(to);
      return;
    }
    turning.current = true;
    Animated.timing(turn, { toValue: sign, duration: HALF_TURN_MS, easing: Easing.in(Easing.quad), useNativeDriver: nativeDriver })
      .start(() => {
        setFace(to);
        turn.setValue(-sign);
        Animated.timing(turn, { toValue: 0, duration: HALF_TURN_MS + 40, easing: Easing.out(Easing.quad), useNativeDriver: nativeDriver })
          .start(() => { turning.current = false; });
      });
  };
  const show = (to: Face) => {
    if (to === face) return;
    if (to === 'previous' && !previous) {
      onWantPrevious();
      setPending('previous');
      return;
    }
    runTurn(to);
  };
  useEffect(() => {
    if (pending === 'previous' && previous) {
      setPending(null);
      runTurn('previous');
    }
    // runTurn reads the latest refs; only the arrival of last month starts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, previous]);
  // The pan handlers are made once; they read the latest values through this.
  const latest = useRef({ face, show, still, live, width });
  latest.current = { face, show, still, live, width };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    onPanResponderGrant: () => { if (latest.current.face === 'current') onWantPrevious(); },
    onPanResponderMove: (_event, gesture) => {
      const { still: reduced, live: moving, width: wide } = latest.current;
      if (reduced || !moving || turning.current) return;
      turn.setValue(Math.max(-0.3, Math.min(0.3, gesture.dx / Math.max(1, wide))));
    },
    onPanResponderRelease: (_event, gesture) => {
      const { face: shown, show: go } = latest.current;
      const toward = gesture.dx * towardPrevious;
      if (Math.abs(gesture.dx) >= SWIPE_DISTANCE && toward > 0 && shown === 'current') { go('previous'); return; }
      if (Math.abs(gesture.dx) >= SWIPE_DISTANCE && toward < 0 && shown === 'previous') { go('current'); return; }
      if (!turning.current) Animated.spring(turn, { toValue: 0, useNativeDriver: nativeDriver, overshootClamping: true }).start();
    },
    onPanResponderTerminate: () => {
      if (!turning.current) turn.setValue(0);
    },
    onPanResponderTerminationRequest: () => false,
  }), [turn, towardPrevious, onWantPrevious]);

  // ── The lean with the phone, and the turn, on one transform. ──
  const tilt = useDeviceTilt(hold);
  const cardMotion = useMemo(() => ({
    transform: [
      { perspective: 900 },
      { rotateX: tilt.x.interpolate({ inputRange: [-90, 90], outputRange: ['-90deg', '90deg'] }) },
      { rotateY: Animated.add(turn.interpolate({ inputRange: [-1, 1], outputRange: [-90, 90] }), tilt.y)
        .interpolate({ inputRange: [-180, 180], outputRange: ['-180deg', '180deg'] }) },
    ],
  }), [tilt, turn]);

  // ── The categories, opened in place. ──
  const opening = useMemo(() => new Animated.Value(0), []);
  const [categoriesShown, setCategoriesShown] = useState(false);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) setCategoriesShown(true);
    if (still || !live) {
      opening.setValue(next ? 1 : 0);
      if (!next) setCategoriesShown(false);
      return;
    }
    Animated.timing(opening, { toValue: next ? 1 : 0, duration: next ? 240 : 160, easing: Easing.out(Easing.quad),
      useNativeDriver: nativeDriver }).start(({ finished }) => { if (finished && !next) setCategoriesShown(false); });
  };
  const openPaint = useMemo(() => ({
    opacity: opening,
    transform: [
      { translateY: opening.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) },
      { scaleY: opening.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
    ],
  }), [opening]);

  // ── Words and figures. ──
  const trend = month.series.trend;
  const spent = month.summary.expenseFils;
  const income = month.summary.incomeFils;
  const net = income - spent;
  // The sign sits with the digits ("AED −12.00"), as the month line speaks it.
  const spoken = (fils: number, signed = false) => `${moneySpec.currency} ${signed && fils < 0 ? '−' : ''}${formatMinorUnits(Math.abs(Math.round(fils)), moneySpec, { decimals: true })}`;
  const shown = (fils: number) => formatMoneyText(Math.abs(Math.round(fils)), moneySpec, { decimals: true });
  const previousName = trend ? month.comparedName : null;
  const trendSpoken = trend && previousName ? words.spokenTrend(trend.direction, trend.percent, previousName, trend.partial) : null;
  const label = words.spentIn(month.name);
  const heroSpoken = words.spokenHero(`${label}${words.comma} ${spoken(spent)}`, trendSpoken, spoken(income), spoken(net, true));
  const innerWidth = Math.max(1, width - BAND_GUTTER * 2 - PAD * 2);
  const chipWarning = front && warning;
  const trendColor = trend?.direction === 'down' ? band.accentOnBand : band.onBand;

  // Kept from the earlier Home: browser suites wait on reference-home-summary
  // and read home-spending-total / home-income-summary / home-net-summary.
  return <Animated.View testID="reference-home-summary" {...pan.panHandlers} style={[styles.card, { backgroundColor: band.tile }, cardMotion]}>
    <View style={styles.head}>
      <ThemedText type="smallBold" testID="home-hero-label" importantForAccessibility="no" accessibilityElementsHidden
        style={[styles.grow, { color: band.onBandSecondary }]}>{label}</ThemedText>
      {front
        ? <Pressable testID="home-hero-previous" accessibilityRole="button" accessibilityLabel={words.showMonth(otherName ?? words.previousMonth)}
            hitSlop={4} onPress={() => show('previous')} style={({ pressed }) => [styles.chevron, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="chevron-left" size={18} color={band.onBandSecondary} />
          </Pressable>
        : <Pressable testID="home-hero-current" accessibilityRole="button" accessibilityLabel={words.backTo(current.name)}
            hitSlop={4} onPress={() => show('current')} style={({ pressed }) => [styles.chevron, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="chevron-right" size={18} color={band.onBandSecondary} />
          </Pressable>}
    </View>
    <Pressable testID="home-hero-card" accessibilityRole="button" accessibilityLabel={heroSpoken}
      accessibilityHint={expanded ? words.heroHintExpanded : words.heroHintCollapsed}
      accessibilityState={{ expanded }} aria-expanded={expanded}
      // Named actions, not increment/decrement: those reach VoiceOver only on an
      // adjustable control, and this card is a button (it opens the categories).
      accessibilityActions={front ? [{ name: 'previousMonth', label: words.showMonth(otherName ?? words.previousMonth) }]
        : [{ name: 'currentMonth', label: words.backTo(current.name) }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'previousMonth') show('previous');
        else if (event.nativeEvent.actionName === 'currentMonth') show('current');
      }}
      onPress={toggle} style={styles.body}>
      <BandFigure testID="home-spending-total" fils={spent} moneySpec={moneySpec} palette={band} size="hero" fitInset={PAD * 2} />
      {trend && previousName ? <View style={[styles.trendRow, largeText && styles.stack]}>
        <View testID="home-hero-trend" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
          style={styles.trend}>
          <TrendChip direction={trend.direction} percent={trend.percent} flip={front ? reveal.arrow : staticDone}
            warning={chipWarning} band={band} color={trendColor} live={live && !still} sameLabel={words.aboutSame} />
          <ThemedText type="meta" style={[styles.qualifier, { color: band.onBandSecondary }]}>
            {trend.partial ? words.versusSameDays(previousName) : words.versusMonth(previousName)}
          </ThemedText>
        </View>
      </View> : null}
      {(month.series.cumulative.at(-1) ?? 0) > 0 ? <HomeSparkline testID="home-hero-line" cumulative={month.series.cumulative} monthDays={month.series.monthDays}
        ceiling={trend?.previousFils ?? 0}
        width={innerWidth} color={band.onBandSecondary} dotColor={band.onBand}
        progress={front ? reveal.line : staticDone} /> : null}
      <View testID="home-hero-flow" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
        style={[styles.flow, largeText && styles.stack]}>
        <View style={styles.flowCell}>
          <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{words.inLabel}</ThemedText>
          <ThemedText testID="home-income-summary" accessibilityLabel={`${words.inLabel}${words.comma} ${spoken(income)}`} style={[styles.flowValue, { color: income > 0 ? band.accentOnBand : band.onBand }]}>{shown(income)}</ThemedText>
        </View>
        {largeText ? null : <View style={[styles.dot, { backgroundColor: band.bandMark }]} />}
        <View style={styles.flowCell}>
          <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{words.netLabel}</ThemedText>
          <ThemedText testID="home-net-summary" accessibilityLabel={`${words.netLabel}${words.comma} ${spoken(net, true)}`} style={[styles.flowValue, { color: net > 0 ? band.accentOnBand : band.onBand }]}>
            {`${net < 0 ? '−' : net > 0 ? '+' : ''}${shown(net)}`}</ThemedText>
        </View>
      </View>
    </Pressable>
    {categoriesShown ? <Animated.View testID="home-hero-categories" style={[styles.categories, openPaint]}>
      <HeroCategories summary={month.summary} budgets={budgets} band={band} moneySpec={moneySpec}
        label={words.byCategory} empty={front ? words.noSpendingYet : words.noSpendingIn(month.name)} />
    </Animated.View> : null}
  </Animated.View>;
}

/**
 * The trend as a chip: an arrow that flips into place (rotateX on the hero's
 * clock) and the whole-number percentage. Over last month's pace it wears
 * the warning colours; a change while Home is open crossfades on the native
 * driver, and lands at once under Reduce Motion.
 */
function TrendChip({ direction, percent, flip, warning, band, color, live, sameLabel }: {
  direction: 'up' | 'down' | 'same';
  percent: number;
  flip: CoinNode;
  warning: boolean;
  band: BandPalette;
  color: string;
  live: boolean;
  sameLabel: string;
}) {
  const shiftRef = useRef<Animated.Value | null>(null);
  if (!shiftRef.current) shiftRef.current = new Animated.Value(warning ? 1 : 0);
  const shift = shiftRef.current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; shift.setValue(warning ? 1 : 0); return; }
    if (!live) { shift.setValue(warning ? 1 : 0); return; }
    const run = Animated.timing(shift, { toValue: warning ? 1 : 0, duration: 320, useNativeDriver: nativeDriver });
    run.start();
    return () => run.stop();
  }, [warning, live, shift]);
  const arrow = useMemo(() => ({
    transform: [{ perspective: 300 }, { rotateX: flip.interpolate({ inputRange: [0, 1], outputRange: ['90deg', '0deg'] }) }],
  }), [flip]);
  const content = (ink: string) => <>
    {direction === 'same' ? null : <Animated.View style={arrow}>
      <Icon name={direction === 'up' ? 'arrow-up' : 'arrow-down'} size={14} color={ink} strokeWidth={2.4} />
    </Animated.View>}
    <ThemedText type="smallBold" style={[styles.chipText, { color: ink }]}>
      {direction === 'same' ? sameLabel : `${Math.abs(percent)}%`}</ThemedText>
  </>;
  return <View style={styles.chipFrame}>
    <Animated.View style={[styles.chip, { backgroundColor: band.band, opacity: shift.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
      {content(color)}
    </Animated.View>
    <Animated.View testID="home-hero-trend-warning" style={[styles.chip, styles.chipOver, { backgroundColor: band.statusNearSoft, opacity: shift }]}>
      {content(band.statusNear)}
    </Animated.View>
  </View>;
}

/** The month's categories as Spending's coin row, with its legend; plain words when nothing was spent. */
function HeroCategories({ summary, budgets, band, moneySpec, label, empty }: {
  summary: MonthSummary;
  budgets: readonly Budget[];
  band: BandPalette;
  moneySpec: LedgerMoneySpec;
  label: string;
  empty: string;
}) {
  const { categoryLabel } = useCategoryCatalog();
  const language = useLanguage();
  const rows = useMemo(() => spendingCategoryRows(summary, budgets, true), [summary, budgets]);
  const colors = useMemo(() => categoryColors(rows.map((row) => row.category)), [rows]);
  if (!rows.some((row) => row.spentFils > 0)) {
    return <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{empty}</ThemedText>;
  }
  return <ShareBar testID="home-hero-share-bar" palette={band} label={label}
    formatShare={(value) => spendingShareLabel(spendingShare(value, summary.expenseFils), language)}
    formatValue={(fils) => `${moneySpec.currency} ${formatMinorUnits(Math.round(fils), moneySpec)}`}
    restColor={CATEGORY_REST} segments={rows.map((row) => ({
      key: row.category, label: categoryLabel(row.category, language), value: row.spentFils, color: colors.get(row.category),
    }))} />;
}

const styles = StyleSheet.create({
  card: { borderRadius: 24, paddingHorizontal: PAD, paddingTop: 6, paddingBottom: 14, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  grow: { flex: 1, minWidth: 0 },
  chevron: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginEnd: -10 },
  body: { gap: 8 },
  trendRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 28 },
  trend: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
  qualifier: { flexShrink: 1 },
  chipFrame: { minHeight: 26 },
  chip: { minHeight: 26, borderRadius: 13, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 3 },
  chipOver: { position: 'absolute', top: 0, start: 0, end: 0, bottom: 0 },
  chipText: { fontVariant: ['tabular-nums'], writingDirection: 'ltr' },
  flow: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 },
  flowCell: { gap: 1, flexShrink: 1 },
  flowValue: { fontFamily: Fonts.sansSemi, fontSize: 16, lineHeight: 21, fontVariant: ['tabular-nums'], writingDirection: 'ltr' },
  dot: { width: 4, height: 4, borderRadius: 2, marginBottom: 9 },
  categories: { paddingTop: 12 },
});
