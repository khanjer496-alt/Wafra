/**
 * Flow — where the month's money went, and whether that is within the limits
 * you set.
 *
 * This is the merge of the old Insights and Budgets tabs. They were two views
 * of one question: Insights showed the split by category and Budgets showed the
 * same categories against a number — so a limit was always one tab away from
 * the spending it governs, and the app carried two ways of ranking the same
 * list. Here the composition comes first, the limits sit directly under it, and
 * the trend that explains both closes the screen.
 */
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InsightCard } from '@/components/insight-card';
import { LimitSheet } from '@/components/limit-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Icon, type IconName } from '@/components/ui/icon';
import { PeriodPill, SectionHeader } from '@/components/ui/period-pill';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLanguage } from '@/hooks/use-language';
import { useScreenEntering } from '@/hooks/use-screen-entering';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { categoryLabel, getCategory, onRampColor, rampColor } from '@/lib/categories';
import {
  formatAED,
  formatAmount,
  formatCompactAED,
  monthKey,
  monthLabel,
  shiftMonthKey,
} from '@/lib/format';
import { internalTransferIds, liveAccountIds } from '@/lib/ledger';
import { buildInsights, composition, spentInMonthForCategory, summarizeMonth } from '@/lib/insights';
import { daysInPeriod, elapsedDays, isCurrentMonth } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import type { CategoryId } from '@/lib/types';
import { alignEnd, t, tf } from '@/lib/i18n';

/** Beyond five slices the ramp stops being readable, so the tail is pooled. */
const MAX_SLICES = 5;

export default function FlowScreen() {
  const theme = useTheme();
  const enter = useScreenEntering();
  const language = useLanguage();
  const router = useRouter();
  const dark = useColorScheme() === 'dark';
  const clearance = useTabBarClearance();
  const { state } = useStore();
  const { period } = usePeriod();
  const now = useMemo(() => new Date(), []);

  const [periodOpen, setPeriodOpen] = useState(false);
  const [limitFor, setLimitFor] = useState<CategoryId | null | 'new'>(null);

  // Limits are monthly, so they follow the global period only when it IS a
  // month; a year or a custom range falls back to the current month.
  const key = period.mode === 'month' ? period.key : monthKey(now);
  const live = isCurrentMonth(period, now);

  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  // Both halves of a move between the user's own accounts. Without this the
  // arriving half reads exactly like being paid.
  const internal = useMemo(
    () => internalTransferIds(state.transactions, liveAccounts),
    [state.transactions, liveAccounts],
  );

  const summary = useMemo(
    () => summarizeMonth(state.transactions, period, liveAccounts, internal),
    [state.transactions, period, liveAccounts, internal],
  );

  const insights = useMemo(
    () =>
      buildInsights(
        state.transactions,
        state.budgets,
        period,
        now,
        state.notSubscriptions,
        liveAccounts,
        internal,
      ),
    [state.transactions, state.budgets, period, now, state.notSubscriptions, liveAccounts, internal],
  );

  /**
   * Top five categories plus an "everything else" slice. The split and its
   * total live in `insights.ts` so Home's "Out" cell reports the same figure —
   * they were a dirham apart, one tap from each other.
   */
  const comp = useMemo(() => composition(summary), [summary]);
  const slices = useMemo(
    () =>
      comp.slices.map((c, i) => ({
        ...c,
        label: c.category
          ? categoryLabel(c.category, language)
          : tf('moreCategories', { count: summary.byCategory.length - MAX_SLICES }, language),
        icon: (c.category ? getCategory(c.category).icon : 'sliders') as IconName,
        color: c.category ? rampColor(i, dark) : dark ? '#2A2620' : '#D9D3C6',
      })),
    [comp, summary.byCategory.length, dark, language],
  );

  const limits = useMemo(
    () =>
      state.budgets
        .map((b) => ({
          budget: b,
          spent: spentInMonthForCategory(
            state.transactions,
            key,
            b.category,
            liveAccounts,
            internal,
          ),
        }))
        .sort((a, b) => b.spent / b.budget.limitFils - a.spent / a.budget.limitFils),
    [state.budgets, state.transactions, key, liveAccounts, internal],
  );

  const totalLimit = limits.reduce((s, r) => s + r.budget.limitFils, 0);
  // Only the categories that actually have a limit. Comparing the whole
  // month's spending against a partial set of limits produced sentences like
  // "out 11,375 of 5,400 in limits", which reads as a catastrophic overrun
  // when the truth is that rent simply has no limit set.
  const limitedSpend = limits.reduce((s, r) => s + r.spent, 0);
  // How far through the MONEY month we are, not the calendar one. `getDate()`
  // is the calendar day, so with a salary-day start of the 25th, 26 July —
  // day two of a month running 25 Jul to 24 Aug — reported "84% of the month
  // gone" and "5 days left". insights.ts already had this right via
  // elapsedDays, so the same screen was carrying both answers, and the "faster
  // than the month" verdict on every limit was driven off the wrong one.
  const monthDays = live ? Math.max(1, daysInPeriod(period, now)) : 1;
  const elapsed = live ? Math.max(1, elapsedDays(period, now, state.transactions)) : monthDays;
  const monthShare = live ? Math.min(1, elapsed / monthDays) : 1;

  /** In and out for the six months ending at the selected one. */
  const trend = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const k = shiftMonthKey(key, -i);
      const s = summarizeMonth(state.transactions, k, liveAccounts, internal);
      months.push({
        key: k,
        label: monthLabel(k, true).split(' ')[0],
        income: s.incomeFils,
        expense: s.expenseFils,
      });
    }
    return months;
  }, [state.transactions, key, liveAccounts, internal]);

  const trendMax = Math.max(1, ...trend.flatMap((m) => [m.income, m.expense]));
  // What the six months averaged, in minus out. The header figure the chart is
  // there to support: six pairs of bars answer "which month", this answers
  // "and overall?".
  // Over the months that HAVE a ledger. Dividing by six when two of them
  // predate the user's first entry reported an average nobody lived: four
  // months averaging +7.4k came out as "+5k avg".
  const trendMonths = trend.filter((m) => m.income > 0 || m.expense > 0);
  const trendAvg = Math.round(
    trendMonths.reduce((sum, m) => sum + (m.income - m.expense), 0) / (trendMonths.length || 1),
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="title">{t('tabFlow')}</ThemedText>
            <PeriodPill onPress={() => setPeriodOpen(true)} />
          </View>

          <View
            style={[
              styles.summaryRail,
              { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement },
            ]}>
            <View style={styles.summaryCell}>
              <ThemedText type="meta" themeColor="textTertiary">
                {t('totalOut')}
              </ThemedText>
              <ThemedText type="smallBold" tabular numberOfLines={1}>
                {formatAED(comp.totalFils, { decimals: false })}
              </ThemedText>
            </View>
            {totalLimit > 0 && (
              <View style={[styles.summaryCell, styles.summaryDivided, { borderColor: theme.cardBorder }]}>
                <ThemedText type="meta" themeColor="textTertiary">
                  {t('limitedSpend')}
                </ThemedText>
                <ThemedText type="smallBold" tabular numberOfLines={1}>
                  {formatAmount(limitedSpend, { decimals: false })}
                  <ThemedText type="meta" tabular themeColor="textTertiary">
                    {' / '}{formatAmount(totalLimit, { decimals: false })}
                  </ThemedText>
                </ThemedText>
              </View>
            )}
            {live && (
              <View style={[styles.summaryCell, styles.summaryDivided, { borderColor: theme.cardBorder }]}>
                <ThemedText type="meta" themeColor="textTertiary">
                  {t('periodProgress')}
                </ThemedText>
                <ThemedText type="smallBold" tabular numberOfLines={1}>
                  {Math.round(monthShare * 100)}%
                </ThemedText>
              </View>
            )}
          </View>

          {/* ── Composition ── */}
          {slices.length > 0 ? (
            <Animated.View
              entering={enter(FadeInDown.duration(320))}
              style={[
                styles.section,
                styles.surfaceSection,
                { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement },
              ]}>
              <SectionHeader title={t('whereItWent')} />
              {/* One stacked bar rather than a donut: a donut asks you to
                  compare arcs, and nobody can. A bar is read left to right in
                  the order the list beneath it is already sorted. */}
              <View style={[styles.compBar, { backgroundColor: theme.track }]}>
                {slices.map((s, i) => (
                  <View
                    key={s.key}
                    style={{
                      flex: Math.max(0.02, s.share),
                      backgroundColor: s.color,
                      // A hairline of background between segments, so adjacent
                      // steps of one hue still read as two slices.
                      marginStart: i === 0 ? 0 : 1,
                    }}
                  />
                ))}
              </View>

              <View style={styles.compRows}>
                {/* Every row opens the entries behind it, scoped to the period
                    it was read in — the figure on the row and the list it
                    leads to are the same set of money. The pooled slice hands
                    over every category it stands for, so "5 more · 1,849"
                    opens exactly those five. */}
                {slices.map((s, i) => (
                  <Pressable
                    key={s.key}
                    accessibilityRole="button"
                    accessibilityLabel={tf('seeCategoryEntriesA11y', { category: s.label }, language)}
                    onPress={() => router.push(`/transactions?category=${s.categories.join(',')}`)}
                    style={({ pressed }) => [
                      styles.compRow,
                      pressed && { opacity: 0.6 },
                    ]}>
                    {/* The swatch carries the glyph. An 8px dot said only
                        "this row is the third segment"; the same square at 26px
                        with the category's mark says which category that is,
                        and the bar above stays legible because the tint is
                        still exactly the segment's step of the ramp. */}
                    <View style={[styles.compTile, { backgroundColor: s.color }]}>
                      <Icon name={s.icon} size={15} color={onRampColor(s.color)} strokeWidth={1.8} />
                    </View>
                    <ThemedText type="small" style={styles.compLabel} numberOfLines={1}>
                      {s.label}
                    </ThemedText>
                    <ThemedText
                      type="meta"
                      themeColor="textTertiary"
                      tabular
                      style={[styles.compShare, { textAlign: alignEnd() }]}>
                      {Math.round(s.share * 100)}%
                    </ThemedText>
                    <ThemedText type="smallBold" tabular style={[styles.compFigure, { textAlign: alignEnd() }]}>
                      {formatAmount(s.totalFils, { decimals: false })}
                    </ThemedText>
                    <Icon name="chevron-right" size={14} color={theme.textTertiary} />
                  </Pressable>
                ))}
              </View>
            </Animated.View>
          ) : (
            <ThemedText type="default" themeColor="textSecondary" style={styles.section}>
              {t('nothingOutYet')}
            </ThemedText>
          )}

          {/* ── Limits ── */}
          <Animated.View entering={enter(FadeInDown.delay(40).duration(320))} style={styles.section}>
            <SectionHeader
              title={t('limitsHeader')}
              right={limits.length > 0 ? t('newLimit') : undefined}
              onPressRight={limits.length > 0 ? () => setLimitFor('new') : undefined}
            />

            {limits.length === 0 ? (
              <Pressable
                onPress={() => setLimitFor('new')}
                style={[styles.emptyLimits, { borderColor: theme.cardBorderStrong }]}>
                <ThemedText type="small">{t('setLimitCategory')}</ThemedText>
                <ThemedText type="meta" themeColor="textSecondary" style={styles.emptyBody}>
                  {t('setLimitBody')}
                </ThemedText>
              </Pressable>
            ) : (
              limits.map(({ budget, spent }) => {
                const ratio = budget.limitFils > 0 ? spent / budget.limitFils : 0;
                const over = ratio >= 1;
                const nearly = !over && ratio >= 0.85;
                // Ink for the figure, graphic for the bar — see Colors in
                // constants/theme.ts for why the two differ in light mode.
                const health = over ? theme.expense : nearly ? theme.warning : theme.text;
                const barColor = over
                  ? theme.expenseGraphic
                  : nearly
                    ? theme.warningGraphic
                    : theme.primary;
                // Spending faster than the month is running is a warning even
                // when there is money left — "ahead" would read as praise.
                const fast = !over && ratio > monthShare + 0.1;

                return (
                  <Pressable
                    key={budget.category}
                    accessibilityRole="button"
                    accessibilityLabel={tf('categoryLimit', {
                      category: categoryLabel(budget.category, language),
                    }, language)}
                    onPress={() => setLimitFor(budget.category)}
                    style={styles.limit}>
                    <View style={styles.limitTop}>
                      <ThemedText type="small" numberOfLines={1} style={styles.limitLabel}>
                        {categoryLabel(budget.category, language)}
                      </ThemedText>
                      <ThemedText type="smallBold" tabular style={[styles.limitFigure, { color: health }]}>
                        {formatAmount(spent, { decimals: false })}
                        <ThemedText type="meta" themeColor="textTertiary" tabular>
                          {'  / '}
                          {formatAmount(budget.limitFils, { decimals: false })}
                        </ThemedText>
                      </ThemedText>
                    </View>

                    {/* Health, never category identity: painting this bar in a
                        category hue made Shopping at 70% render red while
                        Groceries at 99% rendered amber. */}
                    <View style={[styles.limitTrack, { backgroundColor: theme.track }]}>
                      <View
                        style={{
                          width: `${Math.max(2, Math.min(100, ratio * 100))}%`,
                          height: '100%',
                          backgroundColor: barColor,
                          borderRadius: 3,
                        }}
                      />
                    </View>

                    <View style={styles.limitStatus}>
                      <ThemedText type="meta" themeColor="textTertiary">
                        {over
                          ? tf('overByAmount', { amount: formatAED(spent - budget.limitFils, { decimals: false }) }, language)
                          : tf('amountLeft', { amount: formatAED(budget.limitFils - spent, { decimals: false }) }, language)}
                      </ThemedText>
                      {fast && (
                        <View style={[styles.paceBadge, { backgroundColor: `${theme.warning}18` }]}>
                          <ThemedText type="nano" style={{ color: theme.warning }}>
                            {t('fasterThanMonth')}
                          </ThemedText>
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              })
            )}
          </Animated.View>

          {/* ── In vs out ── */}
          <Animated.View
            entering={enter(FadeInDown.delay(80).duration(320))}
            style={[
              styles.section,
              styles.surfaceSection,
              { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement },
            ]}>
            <SectionHeader
              title={t('inVsOut6')}
              right={`${trendAvg >= 0 ? '+' : '−'}${formatCompactAED(trendAvg)} ${t('averageSuffix')}`}
            />
            <View style={styles.trend}>
              {trend.map((m) => {
                const current = m.key === key;
                const empty = m.income === 0 && m.expense === 0;
                return (
                  <View key={m.key} style={styles.trendCol}>
                    {/* A bar you cannot read a number off is a shape, not a
                        figure. A 14px bar cannot carry its own label without
                        colliding with its neighbour, so the pair is written
                        once above the column — in first, out second, each in
                        its bar's colour, which is what ties number to bar. */}
                    <View style={styles.trendValues}>
                      {empty ? (
                        // Nothing was recorded that month. Two 2%-floor stubs
                        // labelled "0 0" claim a month of perfect balance;
                        // a dash says there is no answer, which is the truth.
                        <ThemedText type="nano" tabular themeColor="textTertiary" style={styles.trendValue}>
                          —
                        </ThemedText>
                      ) : (
                        <>
                      <ThemedText type="nano" tabular style={[styles.trendValue, { color: theme.primary }]}>
                        {formatCompactAED(m.income)}
                      </ThemedText>
                      <ThemedText
                        type="nano"
                        tabular
                        style={[
                          styles.trendValue,
                          // Tied to its own bar, as the in figure is. Leaving
                          // it textTertiary made it the same grey as the month
                          // label below, so on the current column a red bar
                          // sat under a grey number and only half the pair
                          // was legible as a pair.
                          { color: current ? theme.expense : dark ? '#8A7E76' : '#9B8C84' },
                        ]}>
                        {formatCompactAED(m.expense)}
                      </ThemedText>
                      </>
                      )}
                    </View>
                    <View style={styles.trendBars}>
                      <View
                        style={[
                          styles.trendBar,
                          {
                            height: `${empty ? 0 : Math.max(2, (m.income / trendMax) * 100)}%`,
                            backgroundColor: theme.primary,
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.trendBar,
                          {
                            height: `${empty ? 0 : Math.max(2, (m.expense / trendMax) * 100)}%`,
                            backgroundColor: current
                              ? theme.expense
                              : dark
                                ? '#4A3A34'
                                : '#DCC9C2',
                          },
                        ]}
                      />
                    </View>
                    <ThemedText
                      type="nano"
                      themeColor={current ? 'text' : 'textTertiary'}
                      style={styles.trendLabel}>
                      {m.label}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          </Animated.View>

          {/* ── What that adds up to ── */}
          {insights.length > 0 && (
            <Animated.View entering={enter(FadeInDown.delay(120).duration(320))} style={styles.section}>
              <SectionHeader title={t('worthKnowing')} />
              <View style={styles.insights}>
                {insights.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </View>
            </Animated.View>
          )}
        </ScrollView>
      </SafeAreaView>

      <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
      <LimitSheet
        category={limitFor === 'new' ? null : limitFor}
        open={limitFor !== null}
        monthKey={key}
        onClose={() => setLimitFor(null)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { paddingHorizontal: ScreenPadding, paddingTop: Spacing.three },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  summaryRail: {
    flexDirection: 'row',
    marginTop: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    paddingHorizontal: Spacing.three,
  },
  summaryCell: { flex: 1, minWidth: 0, gap: 3, paddingVertical: Spacing.two + 2 },
  summaryDivided: { borderStartWidth: StyleSheet.hairlineWidth, paddingStart: Spacing.three },
  section: { marginTop: Spacing.five },
  surfaceSection: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.bottomSheet,
    padding: Spacing.three,
  },

  compBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  compRows: { marginTop: Spacing.two, gap: 2 },
  compRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingVertical: 9,
  },
  compTile: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compLabel: { flex: 1 },
  compShare: { width: 38 },
  compFigure: { width: 72 },

  emptyLimits: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.sheet,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  emptyBody: { maxWidth: 320 },
  limit: { paddingVertical: Spacing.two + 2, gap: Spacing.two },
  limitTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  limitLabel: { flex: 1, minWidth: 0 },
  limitFigure: { flexShrink: 0 },
  limitTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  limitStatus: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  paceBadge: {
    flexShrink: 0,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
  },

  // The extra 16 at the top is headroom for the value sitting above the
  // tallest bar, which would otherwise be clipped by the row.
  // 118 of bars, plus a line for the figures above and the month below.
  trend: { flexDirection: 'row', gap: Spacing.two, height: 118 + 18 + 14, marginTop: Spacing.three },
  trendCol: { flex: 1, gap: Spacing.one },
  trendBars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 3,
  },
  trendBar: {
    flex: 1,
    maxWidth: 14,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  trendValues: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  // `nano` is 10.5px with 1.05 of tracking and a caps transform — right for a
  // section label, far too wide here: at column width it truncated "13.5k" to
  // "1…". These three overrides are the whole reason the style exists.
  trendValue: {
    fontSize: 8.5,
    lineHeight: 12,
    letterSpacing: 0,
    textTransform: 'none',
  },
  trendLabel: { textAlign: 'center' },

  insights: { gap: Spacing.two },
});
