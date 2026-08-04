/**
 * Stats — the four questions no other screen answers.
 *
 * Every written insight in the app ends with a chevron, and this is where most
 * of them point. It opens on the material that exists nowhere else:
 *
 *   who takes the money · what changed · how is that category moving ·
 *   when does it go
 *
 * It used to open on two charts it did not own. Section 1 was the same
 * `TrendCurve` over the same six months that Wallet draws above the fold, under
 * the same "+58,473 since Feb" figure. Section 2 was the same `PairedBars` that
 * Flow draws — and the "ALL STATS" link that brought you here hung off the
 * header of that very chart, so tapping it landed you on a pixel-identical copy
 * of the thing you had just tapped. Two full screens of scrolling before a
 * single new fact.
 *
 * So they are gone, not moved down. A chart belongs to the screen whose
 * question it answers: net worth is the one figure Wallet exists to show, and
 * the shape of the month is what Flow is for. Repeating either here would only
 * teach the user that this screen is a longer version of a screen they have
 * already read. What is left is a pair of links at the foot, naming where those
 * two charts live — an index entry, not a second rendering.
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
import { HistoryStrip } from '@/components/ui/charts';
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
  topMerchants,
  trendShape,
} from '@/lib/analytics';
import { getCategory } from '@/lib/categories';
import { formatAED, monthKey, monthLabel } from '@/lib/format';
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

  // The category trend is a monthly window and it ends where the report ends;
  // a year or a custom range falls back to the calendar month rather than
  // pretending otherwise.
  const key = period.mode === 'month' ? period.key : monthKey(now);

  const [periodOpen, setPeriodOpen] = useState(false);
  const [trendCategory, setTrendCategory] = useState<CategoryId | null>(null);

  const summary = useMemo(
    () => summarizeMonth(state.transactions, period),
    [state.transactions, period],
  );

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

  /** The categories worth offering a trend for: this period's biggest. */
  const trendChoices = useMemo(
    () => summary.byCategory.slice(0, TREND_CATEGORIES).map((c) => c.category),
    [summary],
  );
  const shownCategory =
    trendCategory && trendChoices.includes(trendCategory) ? trendCategory : trendChoices[0];

  const trend = useMemo(
    () =>
      shownCategory
        ? categoryTrend(state.transactions, shownCategory, TREND_MONTHS, key)
        : [],
    [state.transactions, shownCategory, key],
  );

  const merchantMax = merchants[0]?.totalFils ?? 0;
  const weekdayTotal = weekdays.reduce((a, b) => a + b, 0);
  const heaviestDay = weekdays.indexOf(Math.max(...weekdays));

  const shape = useMemo(() => trendShape(trend), [trend]);
  const trendMonth = trend.length > 0 ? monthLabel(trend[trend.length - 1].key, true) : '';

  /**
   * The sentence under the category strip.
   *
   * Every branch has to say something the chart does not already say by being
   * six bars tall. The flat case is the one that used to break it: rent is the
   * same figure six times, and "AED 5,500 a month on average, AED 5,500 in the
   * latest" printed one number twice and called it an observation.
   */
  const trendSentence = (() => {
    const avg = formatAED(shape.averageFils, { decimals: false });
    const latest = formatAED(shape.latestFils, { decimals: false });
    const pct = Math.round(Math.abs(shape.latestVsAverage) * 100);
    if (shape.flat) {
      return `${avg} every month for ${TREND_MONTHS} months — it hasn't moved.`;
    }
    if (pct < 5) {
      return `${avg} a month on average, and ${trendMonth} lands right on it.`;
    }
    const direction = shape.latestVsAverage > 0 ? 'above' : 'below';
    const extreme = shape.latestIsHighest
      ? ', the highest of the six'
      : shape.latestIsLowest
        ? ', the lowest of the six'
        : '';
    return `${avg} a month on average. ${trendMonth} came to ${latest} — ${pct}% ${direction}${extreme}.`;
  })();

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

          {/* ── Merchants ─────────────────────────────────────────────── */}
          {merchants.length > 0 && (
            <Section index={0} style={styles.section}>
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
            <Section index={1} style={styles.section}>
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
          {shownCategory && shape.maxFils > 0 && (
            <Section index={2} style={styles.section}>
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
              <RichSentence text={trendSentence} color={theme.textSecondary} size={12} />
            </Section>
          )}

          {/* ── Weekday rhythm ────────────────────────────────────────── */}
          {weekdayTotal > 0 && (
            <Section index={3} style={styles.section}>
              <SectionHeader title="When it goes" />
              {/* Said before the chart, not after it. `dayOfWeekSpend` drops
                  fixed commitments, and a reader who is not told that will
                  wonder where the rent went. */}
              <ThemedText type="meta" themeColor="textSecondary" style={styles.caption}>
                Day-to-day spending only. Rent and other fixed commitments land on whichever
                weekday the standing order falls on, which is a calendar, not a habit.
              </ThemedText>
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
                text={`${WEEKDAYS_FULL[heaviestDay]} is your heaviest day — ${formatAED(weekdays[heaviestDay], { decimals: false })} of the ${formatAED(weekdayTotal, { decimals: false })} you chose to spend in ${periodLabel(period)}.`}
                color={theme.textSecondary}
                size={12}
              />
            </Section>
          )}

          {/* ── Where the other two charts live ───────────────────────── */}
          {/* An index entry, not a second rendering. Both of these used to be
              drawn again at the top of this screen, identical to the originals
              down to the figure above them. */}
          <Section index={4} style={styles.section}>
            <SectionHeader title="Also worth a look" />
            <Row
              accessibilityLabel="Net worth over six months, on Wallet"
              onPress={() => router.push('/wallet')}>
              <Icon name="wallet" size={19} color={theme.textSecondary} />
              <View style={styles.rowText}>
                <ThemedText type="small">Net worth</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {TREND_MONTHS} months of balance, on Wallet
                </ThemedText>
              </View>
              <Icon name="chevron-right" size={16} color={theme.textTertiary} />
            </Row>
            <Row
              last
              accessibilityLabel="In versus out over six months, on Flow"
              onPress={() => router.push('/flow')}>
              <Icon name="chart" size={19} color={theme.textSecondary} />
              <View style={styles.rowText}>
                <ThemedText type="small">In vs out</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {TREND_MONTHS} months of earning and spending, on Flow
                </ThemedText>
              </View>
              <Icon name="chevron-right" size={16} color={theme.textTertiary} />
            </Row>
          </Section>
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
