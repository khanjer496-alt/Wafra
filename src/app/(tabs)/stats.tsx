/**
 * Insights (stats) v3 — rebuilt from scratch as composed sections.
 *
 * Order: period navigator → donut + drill → stat band → movers → merchants →
 * weekday pattern → net-worth trend → cashflow trend → insight feed.
 * Every figure follows the app-wide reporting period; the 6-month trends stay
 * anchored to the selected month (or the current month in year/range/all).
 */
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Svg, { Polyline } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';

import { InsightCard } from '@/components/insight-card';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BarChart } from '@/components/ui/bar-chart';
import { DonutChart } from '@/components/ui/donut-chart';
import { Icon } from '@/components/ui/icon';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';
import {
  categoryMovers,
  categoryTrend,
  dayOfWeekSpend,
  netWorthSeries,
  topMerchants,
} from '@/lib/analytics';
import { getCategory } from '@/lib/categories';
import {
  daysInMonth,
  formatAED,
  formatCompactAED,
  monthKey,
  monthLabel,
  shiftMonthKey,
} from '@/lib/format';
import { buildInsights, summarizeMonth } from '@/lib/insights';
import {
  elapsedDays as periodElapsedDays,
  isCurrentMonth,
  periodLabel,
  previousPeriod,
} from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import type { CategoryId } from '@/lib/types';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_FULL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

function MerchantLine({
  title,
  category,
  count,
  totalFils,
  onPress,
}: {
  title: string;
  category: CategoryId;
  count: number;
  totalFils: number;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.merchantRow}>
      <MerchantAvatar title={title} category={category} size={34} />
      <ThemedText type="small" style={styles.merchantName} numberOfLines={1}>
        {title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {count}x
      </ThemedText>
      <ThemedText type="smallBold" tabular style={styles.merchantAmount}>
        {formatAED(totalFils, { decimals: false })}
      </ThemedText>
      {onPress && <Icon name="chevron-right" size={14} color="#8a9a93" />}
    </Pressable>
  );
}

export default function StatsScreen() {
  const theme = useTheme();
  const tabBarClearance = useTabBarClearance();
  const router = useRouter();
  const { state } = useStore();
  const now = useMemo(() => new Date(), []);
  const currentKey = monthKey(now);
  const { period, setPeriod } = usePeriod();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drillCategory, setDrillCategory] = useState<CategoryId | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const monthMode = period.mode === 'month';
  const key = monthMode ? period.key : currentKey; // anchors the 6-month trend window
  const live = isCurrentMonth(period, now);
  const prev = previousPeriod(period);

  /* ── Derived data ── */
  const summary = useMemo(() => summarizeMonth(state.transactions, period), [state.transactions, period]);
  const insights = useMemo(
    () => buildInsights(state.transactions, state.budgets, period, now, state.notSubscriptions),
    [state.transactions, state.budgets, period, now, state.notSubscriptions],
  );
  const merchants = useMemo(() => topMerchants(state.transactions, period).slice(0, 5), [state.transactions, period]);
  const movers = useMemo(() => categoryMovers(state.transactions, period).slice(0, 3), [state.transactions, period]);
  const weekSpend = useMemo(() => dayOfWeekSpend(state.transactions, period), [state.transactions, period]);
  const netWorth = useMemo(() => netWorthSeries(state), [state]);
  const drillTrend = useMemo(
    () => (drillCategory ? categoryTrend(state.transactions, drillCategory) : []),
    [state.transactions, drillCategory],
  );
  const trend = useMemo(() => {
    const months: { label: string; income: number; expense: number; key: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const k = shiftMonthKey(currentKey, -i);
      const s = summarizeMonth(state.transactions, k);
      months.push({
        key: k,
        label: monthLabel(k, true).split(' ')[0],
        income: s.incomeFils,
        expense: s.expenseFils,
      });
    }
    return months;
  }, [state.transactions, currentKey]);

  const highlightIndex = monthMode ? trend.findIndex((m) => m.key === key) : -1;
  const coveredDays = Math.max(1, periodElapsedDays(period, now, state.transactions));
  const dailyAvg = Math.round(summary.expenseFils / coveredDays);
  const projected = live ? dailyAvg * daysInMonth(key) : summary.expenseFils;
  const savings = summary.incomeFils - summary.expenseFils;
  const weekMax = Math.max(1, ...weekSpend);
  const segments = summary.byCategory.map((c) => ({
    value: c.totalFils,
    color: getCategory(c.category).color,
  }));

  // Net-worth sparkline geometry
  const nwWidth = 320;
  const nwHeight = 56;
  const nwMin = Math.min(...netWorth.map((p) => p.fils));
  const nwMax = Math.max(...netWorth.map((p) => p.fils));
  const nwRange = Math.max(1, nwMax - nwMin);
  const nwPoints = netWorth
    .map((p, i) => {
      const x = (i / Math.max(1, netWorth.length - 1)) * nwWidth;
      const y = nwHeight - 6 - ((p.fils - nwMin) / nwRange) * (nwHeight - 12);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
          {/* Period navigator: chevrons step months, the title opens the full picker */}
          <View style={styles.monthNav}>
            <Pressable
              disabled={!monthMode}
              onPress={() => {
                setPeriod({ mode: 'month', key: shiftMonthKey(key, -1) });
                setDrillCategory(null);
              }}
              style={[
                styles.navBtn,
                { backgroundColor: theme.backgroundSelected, opacity: monthMode ? 1 : 0.35 },
              ]}>
              <Icon name="chevron-left" size={18} color={theme.text} />
            </Pressable>
            <Pressable style={styles.monthTitleWrap} onPress={() => setSheetOpen(true)}>
              <View style={styles.monthTitleRow}>
                <ThemedText type="heading">
                  {monthMode ? monthLabel(key) : periodLabel(period)}
                </ThemedText>
                <Icon name="chevron-down" size={14} color={theme.textSecondary} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {t('tapToChangePeriod')}
              </ThemedText>
            </Pressable>
            <Pressable
              disabled={!monthMode || live}
              onPress={() => {
                setPeriod({ mode: 'month', key: shiftMonthKey(key, 1) });
                setDrillCategory(null);
              }}
              style={[
                styles.navBtn,
                { backgroundColor: theme.backgroundSelected, opacity: monthMode && !live ? 1 : 0.35 },
              ]}>
              <Icon name="chevron-right" size={18} color={theme.text} />
            </Pressable>
          </View>

          {/* Donut + tappable legend (ring segments drill too) */}
          <Animated.View entering={FadeInDown.duration(350)} style={styles.donutBlock}>
            <DonutChart
              segments={segments}
              trackColor={theme.track}
              onPressSegment={(i) => {
                const cat = summary.byCategory[i]?.category ?? null;
                setDrillCategory(drillCategory === cat ? null : cat);
              }}>
              <ThemedText type="micro" themeColor="textSecondary">
                Spent
              </ThemedText>
              <ThemedText type="subtitle" tabular>
                {formatAED(summary.expenseFils, { decimals: false })}
              </ThemedText>
            </DonutChart>

            <View style={styles.legend}>
              {summary.byCategory.slice(0, 6).map((c) => {
                const meta = getCategory(c.category);
                const active = drillCategory === c.category;
                return (
                  <Pressable
                    key={c.category}
                    onPress={() => setDrillCategory(active ? null : c.category)}
                    style={[
                      styles.legendRow,
                      active && { backgroundColor: theme.backgroundSelected, borderRadius: Radius.sm },
                    ]}>
                    <View style={[styles.legendDot, { backgroundColor: meta.color }]} />
                    <ThemedText type="small" style={styles.legendLabel} numberOfLines={1}>
                      {meta.label}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" tabular>
                      {Math.round(c.share * 100)}%
                    </ThemedText>
                    <ThemedText type="smallBold" tabular style={styles.legendAmount}>
                      {formatAED(c.totalFils, { decimals: false })}
                    </ThemedText>
                    <Icon
                      name="chevron-right"
                      size={13}
                      color={active ? theme.primary : theme.textSecondary}
                    />
                  </Pressable>
                );
              })}
              {summary.byCategory.length === 0 && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                  No expenses recorded in this period.
                </ThemedText>
              )}
            </View>
          </Animated.View>

          {/* Category drill-down */}
          {drillCategory && (
            <Animated.View entering={FadeInDown.duration(300)} style={styles.drill}>
              <View style={styles.sectionTitleRow}>
                <View style={styles.titleWithIcon}>
                  <Icon
                    name={getCategory(drillCategory).icon}
                    size={15}
                    color={getCategory(drillCategory).color}
                  />
                  <ThemedText type="smallBold">
                    {getCategory(drillCategory).label} · 6 months
                  </ThemedText>
                </View>
                <Pressable onPress={() => setDrillCategory(null)}>
                  <Icon name="close" size={16} color={theme.textSecondary} />
                </Pressable>
              </View>
              <BarChart
                height={80}
                groups={drillTrend.map((m) => ({
                  label: monthLabel(m.key, true).split(' ')[0],
                  values: [{ value: m.fils, color: getCategory(drillCategory).color }],
                }))}
                valueFormatter={formatCompactAED}
                onPressGroup={(gi) => {
                  const k = drillTrend[gi]?.key;
                  if (k) setPeriod({ mode: 'month', key: k });
                }}
              />
              {topMerchants(
                state.transactions.filter((t) => t.category === drillCategory),
                period,
                3,
              ).map((m) => (
                <MerchantLine
                  key={m.title}
                  {...m}
                  category={drillCategory}
                  onPress={() =>
                    router.push({ pathname: '/transactions', params: { merchant: m.title } })
                  }
                />
              ))}
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/transactions', params: { category: drillCategory } })
                }
                style={styles.drillAllRow}>
                <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>
                  {t('seeAllCategoryTx')}
                </ThemedText>
                <Icon name="chevron-right" size={14} color={theme.primary} />
              </Pressable>
            </Animated.View>
          )}

          {/* Inline stat band */}
          <Animated.View
            entering={FadeInDown.delay(60).duration(350)}
            style={[styles.statBand, { borderColor: theme.cardBorder }]}>
            <View style={styles.statItem}>
              <ThemedText type="micro" themeColor="textSecondary">Daily avg</ThemedText>
              <ThemedText type="smallBold" tabular>
                {formatAED(dailyAvg, { decimals: false })}
              </ThemedText>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.cardBorder }]} />
            <View style={styles.statItem}>
              <ThemedText type="micro" themeColor="textSecondary">
                {live ? t('projected') : t('spentLabel')}
              </ThemedText>
              <ThemedText type="smallBold" tabular>
                {formatAED(projected, { decimals: false })}
              </ThemedText>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.cardBorder }]} />
            <View style={styles.statItem}>
              <ThemedText type="micro" themeColor="textSecondary">Net saved</ThemedText>
              <ThemedText
                type="smallBold"
                tabular
                style={{ color: savings >= 0 ? theme.income : theme.expense }}>
                {formatAED(savings, { decimals: false })}
              </ThemedText>
            </View>
          </Animated.View>

          {/* Biggest movers */}
          {movers.length > 0 && (
            <Animated.View entering={FadeInDown.delay(100).duration(350)} style={styles.sectionBlock}>
              <ThemedText type="smallBold">
                {t('biggestChangesVs')} {prev ? periodLabel(prev) : '—'}
              </ThemedText>
              {movers.map((m) => {
                const meta = getCategory(m.category);
                const up = m.deltaFils > 0;
                return (
                  <Pressable
                    key={m.category}
                    onPress={() =>
                      router.push({ pathname: '/transactions', params: { category: m.category } })
                    }
                    style={styles.moverRow}>
                    <View style={styles.titleWithIcon}>
                      <Icon name={meta.icon} size={14} color={meta.color} />
                      <ThemedText type="small">{meta.label}</ThemedText>
                    </View>
                    <ThemedText
                      type="smallBold"
                      tabular
                      style={{ color: up ? theme.expense : theme.income }}>
                      {up ? '▲' : '▼'} {formatAED(Math.abs(m.deltaFils), { decimals: false })}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </Animated.View>
          )}

          {/* Top merchants */}
          {merchants.length > 0 && (
            <Animated.View entering={FadeInDown.delay(140).duration(350)} style={styles.sectionBlock}>
              <ThemedText type="smallBold">{t('whereMoneyWent')}</ThemedText>
              {merchants.map((m) => (
                <MerchantLine
                  key={m.title}
                  {...m}
                  onPress={() =>
                    router.push({ pathname: '/transactions', params: { merchant: m.title } })
                  }
                />
              ))}
            </Animated.View>
          )}

          {/* Day-of-week pattern (tap a bar for the exact amount) */}
          <Animated.View entering={FadeInDown.delay(180).duration(350)} style={styles.sectionBlock}>
            <View style={styles.sectionTitleRow}>
              <ThemedText type="smallBold">{t('spendingByWeekday')}</ThemedText>
              {selectedDay !== null && (
                <ThemedText type="smallBold" tabular style={{ color: theme.primary }}>
                  {DAY_FULL[selectedDay]} · {formatAED(weekSpend[selectedDay], { decimals: false })}
                </ThemedText>
              )}
            </View>
            <View style={styles.weekRow}>
              {weekSpend.map((v, i) => (
                <Pressable
                  key={i}
                  onPress={() => setSelectedDay(selectedDay === i ? null : i)}
                  style={styles.weekCol}>
                  <ThemedText
                    type="micro"
                    tabular
                    themeColor="textSecondary"
                    style={[
                      styles.weekValue,
                      { opacity: selectedDay === null || selectedDay === i ? 1 : 0.4 },
                    ]}>
                    {v > 0 ? formatCompactAED(v) : ''}
                  </ThemedText>
                  <View style={[styles.weekTrack, { backgroundColor: theme.track }]}>
                    <View
                      style={[
                        styles.weekFill,
                        {
                          height: `${Math.max(4, (v / weekMax) * 100)}%`,
                          backgroundColor: i === 5 || i === 6 ? theme.gold : theme.primary,
                          opacity: selectedDay === null || selectedDay === i ? 1 : 0.4,
                        },
                      ]}
                    />
                  </View>
                  <ThemedText type="micro" themeColor={selectedDay === i ? 'text' : 'textSecondary'}>
                    {DAY_LABELS[i]}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </Animated.View>

          {/* Net worth trend */}
          <Animated.View entering={FadeInDown.delay(220).duration(350)} style={styles.sectionBlock}>
            <View style={styles.sectionTitleRow}>
              <ThemedText type="smallBold">{t('netWorth6mo')}</ThemedText>
              <ThemedText type="smallBold" tabular style={{ color: theme.primary }}>
                {formatAED(netWorth[netWorth.length - 1]?.fils ?? 0, { decimals: false })}
              </ThemedText>
            </View>
            <View style={styles.sparkWrap}>
              <Svg width="100%" height={nwHeight} viewBox={`0 0 ${nwWidth} ${nwHeight}`}>
                <Polyline
                  points={nwPoints}
                  fill="none"
                  stroke={theme.primary}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <View style={styles.sparkLabels}>
                <ThemedText type="micro" themeColor="textSecondary" tabular>
                  {monthLabel(netWorth[0]?.key ?? key, true)} ·{' '}
                  {formatCompactAED(netWorth[0]?.fils ?? 0)}
                </ThemedText>
                <ThemedText type="micro" themeColor="textSecondary" tabular>
                  {monthLabel(netWorth[netWorth.length - 1]?.key ?? key, true)} ·{' '}
                  {formatCompactAED(netWorth[netWorth.length - 1]?.fils ?? 0)}
                </ThemedText>
              </View>
            </View>
          </Animated.View>

          {/* Income vs expense trend */}
          <Animated.View entering={FadeInDown.delay(260).duration(350)} style={styles.sectionBlock}>
            <View style={styles.sectionTitleRow}>
              <ThemedText type="smallBold">{t('cashflow6mo')}</ThemedText>
              <View style={styles.trendLegend}>
                <View style={[styles.legendDot, { backgroundColor: theme.income }]} />
                <ThemedText type="micro" themeColor="textSecondary">In</ThemedText>
                <View style={[styles.legendDot, { backgroundColor: theme.expense }]} />
                <ThemedText type="micro" themeColor="textSecondary">Out</ThemedText>
              </View>
            </View>
            <BarChart
              groups={trend.map((m) => ({
                label: m.label,
                values: [
                  { value: m.income, color: theme.income },
                  { value: m.expense, color: theme.expense },
                ],
              }))}
              valueFormatter={formatCompactAED}
              highlightIndex={highlightIndex >= 0 ? highlightIndex : undefined}
              onPressGroup={(gi) => {
                setPeriod({ mode: 'month', key: trend[gi].key });
                setDrillCategory(null);
              }}
            />
            <ThemedText type="micro" themeColor="textSecondary">
              {t('tapMonthToOpen')}
            </ThemedText>
          </Animated.View>

          {/* Insight feed */}
          <Animated.View entering={FadeInDown.delay(300).duration(350)} style={styles.sectionBlock}>
            <View style={styles.sectionTitleRow}>
              <View style={styles.titleWithIcon}>
                <Icon name="spark" size={17} color={theme.gold} />
                <ThemedText type="smallBold">{t('whatNumbersSay')}</ThemedText>
              </View>
            </View>
            <View style={styles.insightList}>
              {insights.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
              {insights.length === 0 && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                  Add transactions and analysis will appear here.
                </ThemedText>
              )}
            </View>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
      <PeriodSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.four,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthTitleWrap: {
    alignItems: 'center',
  },
  monthTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  navBtn: {
    width: 38,
    height: 38,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutBlock: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  legend: {
    alignSelf: 'stretch',
    gap: 2,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.one,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  legendLabel: {
    flex: 1,
  },
  legendAmount: {
    minWidth: 86,
    textAlign: 'right',
  },
  drill: {
    gap: Spacing.two,
    paddingLeft: Spacing.two,
  },
  drillAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.one,
  },
  statBand: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two + 2,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
  },
  sectionBlock: {
    gap: Spacing.two,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  moverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.one + 1,
  },
  merchantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one + 1,
  },
  merchantName: {
    flex: 1,
  },
  merchantAmount: {
    minWidth: 80,
    textAlign: 'right',
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  weekCol: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
  },
  weekTrack: {
    width: 14,
    height: 64,
    borderRadius: 7,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  weekValue: {
    fontSize: 9,
    lineHeight: 12,
  },
  weekFill: {
    width: '100%',
    borderRadius: 7,
  },
  sparkWrap: {
    gap: Spacing.one,
  },
  sparkLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  trendLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
  },
  insightList: {
    gap: Spacing.two,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: Spacing.three,
  },
});
