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
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InsightCard } from '@/components/insight-card';
import { LimitSheet } from '@/components/limit-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PeriodPill, SectionHeader } from '@/components/ui/period-pill';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { getCategory, rampColor } from '@/lib/categories';
import { daysInMonth, formatAED, formatAmount, monthKey, monthLabel, shiftMonthKey } from '@/lib/format';
import { buildInsights, spentInMonthForCategory, summarizeMonth } from '@/lib/insights';
import { isCurrentMonth } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import type { CategoryId } from '@/lib/types';

/** Beyond five slices the ramp stops being readable, so the tail is pooled. */
const MAX_SLICES = 5;

export default function FlowScreen() {
  const theme = useTheme();
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

  const summary = useMemo(
    () => summarizeMonth(state.transactions, period),
    [state.transactions, period],
  );

  const insights = useMemo(
    () => buildInsights(state.transactions, state.budgets, period, now, state.notSubscriptions),
    [state.transactions, state.budgets, period, now, state.notSubscriptions],
  );

  /** Top five categories plus an "everything else" slice. */
  const slices = useMemo(() => {
    const head = summary.byCategory.slice(0, MAX_SLICES).map((c, i) => ({
      key: c.category as string,
      label: getCategory(c.category).label,
      totalFils: c.totalFils,
      share: c.share,
      color: rampColor(i, dark),
    }));
    const tail = summary.byCategory.slice(MAX_SLICES);
    if (tail.length > 0) {
      const totalFils = tail.reduce((s, c) => s + c.totalFils, 0);
      head.push({
        key: 'rest',
        label: `${tail.length} more`,
        totalFils,
        share: summary.expenseFils > 0 ? totalFils / summary.expenseFils : 0,
        color: dark ? '#2A2620' : '#D9D3C6',
      });
    }
    return head;
  }, [summary, dark]);

  const limits = useMemo(
    () =>
      state.budgets
        .map((b) => ({
          budget: b,
          spent: spentInMonthForCategory(state.transactions, key, b.category),
        }))
        .sort((a, b) => b.spent / b.budget.limitFils - a.spent / a.budget.limitFils),
    [state.budgets, state.transactions, key],
  );

  const totalLimit = limits.reduce((s, r) => s + r.budget.limitFils, 0);
  // Only the categories that actually have a limit. Comparing the whole
  // month's spending against a partial set of limits produced sentences like
  // "out 11,375 of 5,400 in limits", which reads as a catastrophic overrun
  // when the truth is that rent simply has no limit set.
  const limitedSpend = limits.reduce((s, r) => s + r.spent, 0);
  const monthShare = live ? Math.min(1, now.getDate() / daysInMonth(key)) : 1;
  const daysLeft = live ? Math.max(0, daysInMonth(key) - now.getDate()) : 0;

  /** In and out for the six months ending at the selected one. */
  const trend = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const k = shiftMonthKey(key, -i);
      const s = summarizeMonth(state.transactions, k);
      months.push({
        key: k,
        label: monthLabel(k, true).split(' ')[0],
        income: s.incomeFils,
        expense: s.expenseFils,
      });
    }
    return months;
  }, [state.transactions, key]);

  const trendMax = Math.max(1, ...trend.flatMap((m) => [m.income, m.expense]));

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="title">Flow</ThemedText>
            <PeriodPill onPress={() => setPeriodOpen(true)} />
          </View>

          <ThemedText type="meta" themeColor="textSecondary" style={styles.subtitle}>
            Out{' '}
            <ThemedText type="meta" tabular>
              {formatAED(summary.expenseFils, { decimals: false })}
            </ThemedText>
            {totalLimit > 0 ? (
              <>
                {' · '}
                <ThemedText type="meta" tabular>
                  {formatAmount(limitedSpend, { decimals: false })}
                </ThemedText>
                {' of '}
                <ThemedText type="meta" tabular>
                  {formatAmount(totalLimit, { decimals: false })}
                </ThemedText>
                {' in limits'}
              </>
            ) : null}
            {live ? ` · ${Math.round(monthShare * 100)}% of the month gone` : ''}
          </ThemedText>

          {/* ── Composition ── */}
          {slices.length > 0 ? (
            <Animated.View entering={FadeInDown.duration(320)} style={styles.section}>
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
                      marginLeft: i === 0 ? 0 : 1,
                    }}
                  />
                ))}
              </View>

              <View style={styles.compRows}>
                {slices.map((s, i) => (
                  <View
                    key={s.key}
                    style={[
                      styles.compRow,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
                    ]}>
                    <View style={[styles.swatch, { backgroundColor: s.color }]} />
                    <ThemedText type="small" style={styles.compLabel} numberOfLines={1}>
                      {s.label}
                    </ThemedText>
                    <ThemedText type="meta" themeColor="textTertiary" tabular>
                      {Math.round(s.share * 100)}%
                    </ThemedText>
                    <ThemedText type="smallBold" tabular style={styles.compFigure}>
                      {formatAmount(s.totalFils, { decimals: false })}
                    </ThemedText>
                  </View>
                ))}
              </View>
            </Animated.View>
          ) : (
            <ThemedText type="default" themeColor="textSecondary" style={styles.section}>
              Nothing has gone out in this period yet.
            </ThemedText>
          )}

          {/* ── Limits ── */}
          <Animated.View entering={FadeInDown.delay(40).duration(320)} style={styles.section}>
            <SectionHeader
              title="Limits"
              right={limits.length > 0 ? 'NEW LIMIT' : undefined}
              onPressRight={limits.length > 0 ? () => setLimitFor('new') : undefined}
            />

            {limits.length === 0 ? (
              <Pressable
                onPress={() => setLimitFor('new')}
                style={[styles.emptyLimits, { borderColor: theme.cardBorderStrong }]}>
                <ThemedText type="small">Set a limit on a category</ThemedText>
                <ThemedText type="meta" themeColor="textSecondary" style={styles.emptyBody}>
                  Wafra already knows what you spend. Give one category a number and it will tell
                  you whether you are on pace, not just what you have left.
                </ThemedText>
              </Pressable>
            ) : (
              limits.map(({ budget, spent }, i) => {
                const ratio = budget.limitFils > 0 ? spent / budget.limitFils : 0;
                const over = ratio >= 1;
                const nearly = !over && ratio >= 0.85;
                const health = over ? theme.expense : nearly ? theme.warning : theme.text;
                const barColor = over ? theme.expense : nearly ? theme.warning : theme.primary;
                // Spending faster than the month is running is a warning even
                // when there is money left — "ahead" would read as praise.
                const fast = !over && ratio > monthShare + 0.1;

                return (
                  <Pressable
                    key={budget.category}
                    onPress={() => setLimitFor(budget.category)}
                    style={[
                      styles.limit,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
                    ]}>
                    <View style={styles.limitTop}>
                      <ThemedText type="small">{getCategory(budget.category).label}</ThemedText>
                      <ThemedText type="smallBold" tabular style={{ color: health }}>
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

                    <ThemedText type="meta" themeColor="textTertiary">
                      {over
                        ? `Over by ${formatAED(spent - budget.limitFils, { decimals: false })}`
                        : `${formatAED(budget.limitFils - spent, { decimals: false })} left`}
                      {live && daysLeft > 0 ? ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}
                      {fast ? ' · faster than the month' : ''}
                    </ThemedText>
                  </Pressable>
                );
              })
            )}
          </Animated.View>

          {/* ── In vs out ── */}
          <Animated.View entering={FadeInDown.delay(80).duration(320)} style={styles.section}>
            <SectionHeader title="In vs out · 6 months" />
            <View style={styles.trend}>
              {trend.map((m) => {
                const current = m.key === key;
                return (
                  <View key={m.key} style={styles.trendCol}>
                    <View style={styles.trendBars}>
                      <View
                        style={[
                          styles.trendBar,
                          {
                            height: `${Math.max(2, (m.income / trendMax) * 100)}%`,
                            backgroundColor: theme.primary,
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.trendBar,
                          {
                            height: `${Math.max(2, (m.expense / trendMax) * 100)}%`,
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
            <Animated.View entering={FadeInDown.delay(120).duration(320)} style={styles.section}>
              <SectionHeader title="Worth knowing" />
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
  subtitle: { marginTop: Spacing.two },
  section: { marginTop: Spacing.five },

  compBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  compRows: { marginTop: Spacing.three },
  compRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingVertical: 11,
  },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  compLabel: { flex: 1 },
  compFigure: { minWidth: 62, textAlign: 'right' },

  emptyLimits: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.sheet,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  emptyBody: { maxWidth: 320 },
  limit: { paddingVertical: Spacing.three, gap: Spacing.two },
  limitTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  limitTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },

  trend: { flexDirection: 'row', gap: Spacing.two, height: 118 + 18 },
  trendCol: { flex: 1, gap: Spacing.two },
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
  trendLabel: { textAlign: 'center' },

  insights: { gap: Spacing.two },
});
