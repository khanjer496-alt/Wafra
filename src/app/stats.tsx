/**
 * Stats — the six questions a month of spending actually raises.
 *
 * Every written insight in the app ends with a chevron, and this is where most
 * of them point. Before this screen existed they pointed at `/stats`, which did
 * not exist, so tapping an observation landed the user on expo-router's
 * "Unmatched Route" page.
 *
 * The maths was all here already, in `@/lib/analytics`, unit-tested and unused:
 * a merchant leaderboard, month-on-month category movers, a weekday pattern, a
 * per-category trend and a net-worth curve. The app was showing one unlabelled
 * bar chart on Flow and a single delta figure on Wallet. This screen surfaces
 * the rest, in the order the questions get asked:
 *
 *   where do I stand · what is the shape of the month · who takes the money ·
 *   what changed · how is that category moving · when do I spend
 *
 * No cards. Sections are separated by space and 1px rules, figures are mono,
 * and the only colour beyond ink is meaning: accent for in, clay for out.
 */
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CategoryAvatar } from '@/components/ui/category-avatar';
import { HistoryStrip, PairedBars, TrendCurve, type MonthPair } from '@/components/ui/charts';
import { Chip } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Row, Section, SectionHeader } from '@/components/ui/layout';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Money } from '@/components/ui/money';
import { PeriodPill } from '@/components/ui/period-pill';
import { ProgressBar } from '@/components/ui/progress-bar';
import { RichSentence } from '@/components/ui/rich-sentence';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  categoryMovers,
  categoryTrend,
  dayOfWeekSpend,
  netWorthSeries,
  topMerchants,
} from '@/lib/analytics';
import { getCategory } from '@/lib/categories';
import { formatAED, monthKey, monthLabel, shiftMonthKey } from '@/lib/format';
import { summarizeMonth } from '@/lib/insights';
import { periodLabel } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import type { CategoryId } from '@/lib/types';

/** Sunday-first, matching `dayOfWeekSpend`'s buckets and the UAE week. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** Enough to see a pattern, few enough to fit without scrolling sideways. */
const TREND_MONTHS = 6;
const MERCHANT_ROWS = 6;
const TREND_CATEGORIES = 4;

export default function StatsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state } = useStore();
  const { period } = usePeriod();
  const now = useMemo(() => new Date(), []);

  const [periodOpen, setPeriodOpen] = useState(false);
  const [curveWidth, setCurveWidth] = useState(0);
  const [trendCategory, setTrendCategory] = useState<CategoryId | null>(null);

  // Limits, trends and net worth are monthly things; a year or a custom range
  // falls back to the current month rather than pretending otherwise.
  const key = period.mode === 'month' ? period.key : monthKey(now);

  const summary = useMemo(
    () => summarizeMonth(state.transactions, period),
    [state.transactions, period],
  );

  const worth = useMemo(() => netWorthSeries(state, TREND_MONTHS), [state]);
  const merchants = useMemo(
    () => topMerchants(state.transactions, period, MERCHANT_ROWS),
    [state.transactions, period],
  );
  const movers = useMemo(
    () => categoryMovers(state.transactions, period),
    [state.transactions, period],
  );
  const weekdays = useMemo(
    () => dayOfWeekSpend(state.transactions, period),
    [state.transactions, period],
  );

  /** In and out for the six months ending at the selected one. */
  const inOut = useMemo<MonthPair[]>(() => {
    const months: MonthPair[] = [];
    for (let i = TREND_MONTHS - 1; i >= 0; i--) {
      const k = shiftMonthKey(key, -i);
      const s = summarizeMonth(state.transactions, k);
      months.push({
        label: monthLabel(k, true).split(' ')[0],
        inFils: s.incomeFils,
        outFils: s.expenseFils,
        current: k === key,
      });
    }
    return months;
  }, [state.transactions, key]);

  /** The categories worth offering a trend for: this period's biggest. */
  const trendChoices = useMemo(
    () => summary.byCategory.slice(0, TREND_CATEGORIES).map((c) => c.category),
    [summary],
  );
  const shownCategory =
    trendCategory && trendChoices.includes(trendCategory) ? trendCategory : trendChoices[0];

  const trend = useMemo(
    () =>
      shownCategory ? categoryTrend(state.transactions, shownCategory, TREND_MONTHS) : [],
    [state.transactions, shownCategory],
  );

  const worthDelta = worth.length > 1 ? worth[worth.length - 1].fils - worth[0].fils : 0;
  const worthUp = worthDelta >= 0;
  const merchantMax = merchants[0]?.totalFils ?? 0;
  const weekdayTotal = weekdays.reduce((a, b) => a + b, 0);
  const heaviestDay = weekdays.indexOf(Math.max(...weekdays));
  const trendTotal = trend.reduce((s, m) => s + m.fils, 0);

  const empty = summary.expenseFils === 0 && summary.incomeFils === 0;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={10}
              onPress={() => router.back()}>
              <Icon name="chevron-left" size={20} color={theme.text} />
            </Pressable>
            <ThemedText type="title">Stats</ThemedText>
          </View>
          <PeriodPill onPress={() => setPeriodOpen(true)} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {empty ? (
            <View style={[styles.emptyBlock, { borderColor: theme.cardBorderStrong }]}>
              <ThemedText type="small">Nothing to measure in {periodLabel(period)}</ThemedText>
              <ThemedText type="meta" themeColor="textTertiary" style={styles.emptyBody}>
                Stats reads the ledger you already have. Import a month of bank messages, or pick
                another period, and every section below fills itself in.
              </ThemedText>
            </View>
          ) : null}

          {/* ── Net worth ─────────────────────────────────────────────── */}
          {worth.length > 1 && (
            <Section index={0} style={styles.section}>
              <SectionHeader title={`Net worth · ${TREND_MONTHS} months`} />
              {/* Sentence case, not a second row of tracked caps: one caps
                  label per section is a hierarchy, two is noise. */}
              <ThemedText type="meta" themeColor="textSecondary" style={styles.caption}>
                {worthUp ? 'Up' : 'Down'} since {monthLabel(worth[0].key, true)}
              </ThemedText>
              <Money
                fils={worthDelta}
                type="amount"
                sign="auto"
                color={worthUp ? theme.income : theme.expense}
                style={styles.figure}
              />
              <View onLayout={(e) => setCurveWidth(e.nativeEvent.layout.width)}>
                {curveWidth > 0 && <TrendCurve points={worth} width={curveWidth} />}
              </View>
              <View style={styles.axis}>
                {worth.map((p, i) => (
                  <ThemedText
                    key={p.key}
                    type="nano"
                    themeColor={i === worth.length - 1 ? 'text' : 'textTertiary'}>
                    {monthLabel(p.key, true).split(' ')[0]}
                  </ThemedText>
                ))}
              </View>
            </Section>
          )}

          {/* ── In vs out ─────────────────────────────────────────────── */}
          <Section index={1} style={styles.section}>
            <SectionHeader title={`In vs out · ${TREND_MONTHS} months`} />
            <PairedBars months={inOut} />
          </Section>

          {/* ── Merchants ─────────────────────────────────────────────── */}
          {merchants.length > 0 && (
            <Section index={2} style={styles.section}>
              <SectionHeader title="Where it goes" />
              {merchants.map((m, i) => (
                <Row
                  key={m.title + i}
                  last={i === merchants.length - 1}
                  accessibilityLabel={`${m.title}, ${formatAED(m.totalFils, { decimals: false })}`}
                  onPress={() =>
                    router.push(`/transactions?merchant=${encodeURIComponent(m.title)}`)
                  }>
                  <MerchantAvatar title={m.title} category={m.category} />
                  <View style={styles.rowText}>
                    <ThemedText type="small" numberOfLines={1}>
                      {m.title}
                    </ThemedText>
                    {/* The bar is the comparison; the figure is the fact. A
                        leaderboard of bare numbers makes you do the ranking. */}
                    <ProgressBar
                      ratio={merchantMax > 0 ? m.totalFils / merchantMax : 0}
                      color={theme.primary}
                      height={4}
                    />
                  </View>
                  <View style={styles.rowFigure}>
                    <Money fils={m.totalFils} type="smallBold" prefix={false} />
                    <ThemedText type="meta" themeColor="textTertiary" tabular>
                      {m.count}×
                    </ThemedText>
                  </View>
                </Row>
              ))}
            </Section>
          )}

          {/* ── Movers ────────────────────────────────────────────────── */}
          {movers.length > 0 && (
            <Section index={3} style={styles.section}>
              <SectionHeader title="What changed" />
              <ThemedText type="meta" themeColor="textSecondary" style={styles.caption}>
                Against the period before this one.
              </ThemedText>
              {movers.map((m, i) => {
                const up = m.deltaFils > 0;
                const tone = up ? theme.expense : theme.income;
                return (
                  <Row
                    key={m.category}
                    last={i === movers.length - 1}
                    accessibilityLabel={`${getCategory(m.category).label}, ${up ? 'up' : 'down'}`}
                    onPress={() => router.push(`/transactions?category=${m.category}`)}>
                    <CategoryAvatar category={m.category} />
                    <View style={styles.rowText}>
                      <ThemedText type="small">{getCategory(m.category).label}</ThemedText>
                      <ThemedText type="meta" themeColor="textTertiary" tabular>
                        {formatAED(m.previousFils, { decimals: false })} →{' '}
                        {formatAED(m.currentFils, { decimals: false })}
                      </ThemedText>
                    </View>
                    <View style={styles.delta}>
                      <Icon
                        name={up ? 'arrow-up-right' : 'arrow-down-right'}
                        size={15}
                        color={tone}
                      />
                      <Money
                        fils={Math.abs(m.deltaFils)}
                        type="smallBold"
                        prefix={false}
                        color={tone}
                      />
                    </View>
                  </Row>
                );
              })}
            </Section>
          )}

          {/* ── One category over time ────────────────────────────────── */}
          {shownCategory && trendTotal > 0 && (
            <Section index={4} style={styles.section}>
              <SectionHeader title={`${getCategory(shownCategory).label} · ${TREND_MONTHS} months`} />
              <View style={styles.chips}>
                {trendChoices.map((c) => (
                  <Chip
                    key={c}
                    label={getCategory(c).label}
                    active={c === shownCategory}
                    onPress={() => setTrendCategory(c)}
                  />
                ))}
              </View>
              <View style={styles.strip}>
                <HistoryStrip
                  height={64}
                  months={trend.map((m, i) => ({
                    label: monthLabel(m.key, true).split(' ')[0],
                    fils: m.fils,
                    current: i === trend.length - 1,
                  }))}
                />
              </View>
              <RichSentence
                text={`${formatAED(Math.round(trendTotal / TREND_MONTHS), { decimals: false })} a month on average, ${formatAED(trend[trend.length - 1].fils, { decimals: false })} in the latest.`}
                color={theme.textSecondary}
                size={12}
              />
            </Section>
          )}

          {/* ── Weekday rhythm ────────────────────────────────────────── */}
          {weekdayTotal > 0 && (
            <Section index={5} style={styles.section}>
              <SectionHeader title="When it goes" />
              <View style={styles.strip}>
                <HistoryStrip
                  height={64}
                  months={weekdays.map((fils, i) => ({
                    label: WEEKDAYS[i],
                    fils,
                    current: i === heaviestDay,
                  }))}
                />
              </View>
              <RichSentence
                text={`${WEEKDAYS_FULL[heaviestDay]} is your heaviest day — ${formatAED(weekdays[heaviestDay], { decimals: false })} of the ${formatAED(weekdayTotal, { decimals: false })} that left in ${periodLabel(period)}.`}
                color={theme.textSecondary}
                size={12}
              />
            </Section>
          )}
        </ScrollView>
      </SafeAreaView>

      <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three - 4 },
  content: { paddingHorizontal: ScreenPadding, paddingBottom: Spacing.six },

  section: { marginBottom: Spacing.five },
  caption: { marginBottom: Spacing.two },
  figure: { marginBottom: Spacing.three },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.two },

  rowText: { flex: 1, gap: 5 },
  rowFigure: { alignItems: 'flex-end', gap: 1 },
  delta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  strip: { marginTop: Spacing.three, marginBottom: Spacing.two + 2 },

  emptyBlock: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.sheet,
    padding: Spacing.four,
    gap: Spacing.two,
    marginBottom: Spacing.five,
  },
  emptyBody: { maxWidth: 320 },
});
