/**
 * Flow — where the month's money went, and whether that is within the limits
 * you set.
 *
 * This is the merge of the old Insights and Budgets tabs. They were two views
 * of one question: Insights showed the split by category and Budgets showed the
 * same categories against a number — so a limit was always one tab away from
 * the spending it governs, and the app carried two ways of ranking the same
 * list. Here the six-month comparison establishes the shape first, composition
 * explains the selected month, and limits follow the spending they govern.
 */
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { InsightCard } from '@/components/insight-card';
import { LimitSheet } from '@/components/limit-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { rampColor } from '@/components/ui/data-viz';
import { Icon } from '@/components/ui/icon';
import { PeriodPill, SectionHeader } from '@/components/ui/period-pill';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Money } from '@/components/ui/money';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { DataViz, MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLanguage } from '@/hooks/use-language';
import { usePullToRefresh } from '@/hooks/use-auto-import';
import { useScreenEntering } from '@/hooks/use-screen-entering';
import { useTheme } from '@/hooks/use-theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { categoryLabel, getCategory } from '@/lib/categories';
import {
  formatAED,
  formatAmount,
  formatCompactAED,
  monthKey,
  monthLabel,
  shiftMonthKey,
} from '@/lib/format';
import { internalTransferIds, isIncome, isSpending, liveAccountIds } from '@/lib/ledger';
import { buildInsights, composition, summarizeMonth } from '@/lib/insights';
import { daysInPeriod, elapsedDays, isCurrentMonth } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import type { CategoryId } from '@/lib/types';
import { alignEnd, t, tf } from '@/lib/i18n';

/** Beyond five slices the ramp stops being readable, so the tail is pooled. */
const MAX_SLICES = 5;

export default function FlowScreen() {
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  const enter = useScreenEntering();
  const language = useLanguage();
  const router = useRouter();
  const dark = useColorScheme() === 'dark';
  const dataViz = DataViz[dark ? 'dark' : 'light'];
  const { width: screenWidth, fontScale } = useWindowDimensions();
  const { state } = useStore();
  // Every tab that shows money the inbox produces can now go and refresh it.
  const { refreshing, onRefresh } = usePullToRefresh();
  const { period } = usePeriod();
  const now = useMemo(() => new Date(), []);

  // Five-character compact figures (for example 13.5k) need more width than
  // one of six columns can provide on a narrow screen at large Dynamic Type.
  // Keep figures beside the bars only while a conservative monospace estimate
  // fits. Otherwise the bars stay comparable and a wrapping detail list below
  // carries the readable values without shrinking or clipping them.
  const trendColumnWidth =
    (Math.min(screenWidth, MaxContentWidth) - ScreenPadding * 2 - Spacing.two * 5) / 6;
  const showTrendValues = trendColumnWidth >= 38 * fontScale;
  // Arabic month names need more space than compact figures. On narrow or
  // larger-text layouts, label the range ends below the bars instead of
  // breaking six names mid-word. Every month keeps its complete a11y summary.
  const showAllTrendLabels = trendColumnWidth >= (language === 'ar' ? 52 : 28) * fontScale;

  const [periodOpen, setPeriodOpen] = useState(false);
  const [limitFor, setLimitFor] = useState<CategoryId | null | 'new'>(null);

  // Limits are monthly, so they follow the global period only when it IS a
  // month; a year or a custom range falls back to the current month.
  const key = period.mode === 'month' ? period.key : monthKey(now);
  // Whether the limits below are measuring the period the rest of the screen
  // is about. When they are not, they say which month they ARE measuring and
  // they leave the summary rail — see `monthScoped` at both use sites.
  const monthScoped = period.mode === 'month';
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
        // The pooled remainder is not a category and gets no glyph — see the
        // row below for why that is the honest answer rather than a gap.
        icon: c.category ? getCategory(c.category).icon : null,
        color: c.category ? rampColor(i, dark) : dataViz.neutral,
      })),
    [comp, summary.byCategory.length, dark, language, dataViz.neutral],
  );

  /**
   * The month the limits are measured over, summarised ONCE.
   *
   * When the selected period is a month, `key === period.key` and this is
   * `summary` itself — the same rows, the same predicates, the same period, so
   * the per-category totals are identical by construction. This screen used to
   * call `spentInMonthForCategory` once per budget instead, and each of those
   * is a full walk of the ledger allocating an `Allocation[]` per row for a
   * number `summarizeMonth` had already accumulated thirty lines above.
   * insights.ts deleted exactly this pattern for exactly this reason: "at
   * 10,000 rows and eight budgets that redundant work was most of the time
   * buildInsights took."
   *
   * In a year/range/all view the limits fall back to the current month, which
   * `summary` does not cover — so that month is summarised, once, rather than
   * once per budget.
   */
  const limitBasis = useMemo(
    () =>
      monthScoped
        ? summary
        : summarizeMonth(state.transactions, key, liveAccounts, internal),
    [monthScoped, summary, state.transactions, key, liveAccounts, internal],
  );

  const limits = useMemo(() => {
    const spentByCategory = new Map(
      limitBasis.byCategory.map((c) => [c.category, c.totalFils] as const),
    );
    return state.budgets
      .map((b) => ({ budget: b, spent: spentByCategory.get(b.category) ?? 0 }))
      .sort((a, b) => b.spent / b.budget.limitFils - a.spent / a.budget.limitFils);
  }, [state.budgets, limitBasis]);

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

  /**
   * In and out for the six months ending at the selected one, in ONE pass.
   *
   * Six calls to `summarizeMonth` is six full walks of the ledger, and five
   * sixths of each is spent on rows belonging to one of the other five months.
   * A month key is what `summarizeMonth` matches on anyway — `inPeriod` for a
   * month period is `monthKey(t.date) === key` — so asking which of the six a
   * row falls in is the same question asked once instead of six times, over
   * the same `isIncome`/`isSpending` predicates.
   */
  const trend = useMemo(() => {
    const keys: string[] = [];
    for (let i = 5; i >= 0; i--) keys.push(shiftMonthKey(key, -i));
    const slot = new Map(keys.map((k, i) => [k, i] as const));
    const totals = keys.map(() => ({ income: 0, expense: 0 }));
    for (const tx of state.transactions) {
      const i = slot.get(monthKey(tx.date));
      if (i === undefined) continue;
      if (isIncome(tx, liveAccounts, internal)) totals[i].income += tx.amountFils;
      else if (isSpending(tx, liveAccounts, internal)) totals[i].expense += tx.amountFils;
    }
    return keys.map((k, i) => ({
      key: k,
      label: monthLabel(k, true).split(' ')[0],
      income: totals[i].income,
      expense: totals[i].expense,
    }));
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
  const monthCashflowLabel = (month: (typeof trend)[number]) =>
    month.income === 0 && month.expense === 0
      ? tf('monthCashflowNoDataA11y', { month: month.label }, language)
      : tf('monthCashflowA11y', {
          month: month.label,
          income: formatAED(month.income, { decimals: false }),
          spending: formatAED(month.expense, { decimals: false }),
        }, language);
  const selectedTrendMonth = trend.find((month) => month.key === key) ?? trend[trend.length - 1];
  const compositionA11yLabel = slices
    .map((slice) => tf('compositionPercent', {
      label: slice.label,
      percent: Math.round(slice.share * 100),
    }, language))
    .join('. ');
  const flowHeader: ScreenHeaderProps = {
    title: t('tabFlow'),
    leading: <PeriodPill onPress={() => setPeriodOpen(true)} />,
    actions: [{ label: t('statsTitle'), onPress: () => router.push('/stats') }],
  };

  return (
    <>
      <ScreenScaffold
        tabbed
        headerMode="inline"
        header={flowHeader}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
        }
        scrollProps={{ showsVerticalScrollIndicator: false }}>

          <View
            style={[
              styles.summaryRail,
              largeText && styles.summaryRailLarge,
              { borderColor: theme.cardBorder, backgroundColor: 'transparent' },
            ]}>
            <View style={[styles.summaryCell, styles.summaryPrimary]}>
              <ThemedText type="meta" themeColor="textTertiary">
                {t('totalOut')}
              </ThemedText>
              <View accessible accessibilityLabel={formatAED(comp.totalFils, { decimals: false })}>
                <Money fils={comp.totalFils} type="amount" style={styles.totalAmount} />
              </View>
            </View>
            {/* Only while the limits and "Total spent" describe the same span.
                Limits are monthly; the period pill is not, and this cell was
                printed unqualified beside a period-scoped total whatever the
                pill said. On "This year" the rail read `Total spent AED 210,000`
                next to `With limits 1,177 / 1,800` — August's spending under a
                2026 heading, two figures a reader is invited to compare and
                cannot. Out of the rail in those views; the section below still
                shows the limits, under the month it is actually measuring. */}
            {totalLimit > 0 && monthScoped && (
              <View style={[styles.summaryCell, styles.summaryPaired, styles.summaryDivided, largeText && styles.summaryDividedLarge, { borderColor: theme.cardBorder }]}>
                <ThemedText type="meta" themeColor="textTertiary">
                  {t('limitedSpend')}
                </ThemedText>
                <ThemedText type="smallBold" tabular numberOfLines={largeText ? undefined : 1}>
                  {formatAmount(limitedSpend, { decimals: false })}
                  <ThemedText type="meta" tabular themeColor="textTertiary">
                    {' / '}{formatAmount(totalLimit, { decimals: false })}
                  </ThemedText>
                </ThemedText>
              </View>
            )}
            {live && (
              <View style={[styles.summaryCell, styles.summaryProgress, styles.summaryDivided, { borderColor: theme.cardBorder }]}>
                <View style={styles.progressCaption}>
                  <ThemedText type="meta" themeColor="textSecondary" style={styles.progressLabel}>
                    {t('periodProgress')}
                  </ThemedText>
                  <ThemedText type="smallBold" tabular>
                    {Math.round(monthShare * 100)}%
                  </ThemedText>
                </View>
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <ProgressBar ratio={monthShare} color={theme.primary} height={4} />
                </View>
              </View>
            )}
          </View>

          {/* ── Composition ── */}
          {slices.length > 0 ? (
            // No card. theme.ts: "grouping is done with 1px dividers, not
            // cards. A card only earns its border when the whole thing is
            // tappable or dismissible." This section is neither — each ROW is
            // tappable — and boxing it put a bordered, filled panel directly
            // under the bordered summary rail above, so the screen opened on
            // two nested frames before a single figure.
            <Animated.View entering={enter(FadeInDown.duration(320))} style={styles.section}>
              <SectionHeader title={t('whereItWent')} />
              {/* One stacked bar rather than a donut: a donut asks you to
                  compare arcs, and nobody can. A bar is read left to right in
                  the order the list beneath it is already sorted. */}
              <View
                accessible
                accessibilityRole="image"
                accessibilityLabel={compositionA11yLabel}
                style={[styles.compBar, { backgroundColor: theme.track }]}>
                {slices.map((s, i) => (
                  <View
                    key={s.key}
                    accessible={false}
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
                    accessibilityValue={{ text: `${formatAED(s.totalFils)}, ${Math.round(s.share * 100)}%` }}
                    onPress={() => router.push(`/transactions?category=${s.categories.join(',')}`)}
                    style={({ pressed }) => [
                      styles.compRow,
                      // A hairline, not a gap: this is the divider grouping the
                      // theme file asks for, and it is what lets the card
                      // around this whole section go away.
                      i > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: theme.cardBorder,
                      },
                      pressed && { opacity: 0.6 },
                    ]}>
                    {/* The swatch keys the row to the bar; the glyph says
                        what the row IS.
                        
                        Both, deliberately, and neither in the other's colour.
                        This was a 26px filled glyph tile once and that was
                        wrong — five saturated avatars competed with the single
                        stacked bar they are meant to key into — so it became
                        an 8px swatch, which fixed the competition and left the
                        rows identified by their word alone.
                        
                        Drawing the glyph in the ramp colour instead would have
                        been one mark rather than two, and it is the first
                        thing to try. It cannot work here: the ramp descends to
                        lightnesses at 2.0-2.8:1 against the page, which is why
                        the swatch carries a border — the FILL is identity, the
                        EDGE is visibility. A stroked glyph has no edge to
                        borrow, so the tail categories would have been drawn in
                        a colour that is not reliably visible, and the last two
                        rows would simply have looked empty.
                        
                        So the glyph takes a readable ink and adds no colour to
                        the row. It competes with nothing, because the thing
                        that competed was saturation, not presence. */}
                    <View
                      style={[
                        styles.swatch,
                        { backgroundColor: s.color, borderColor: theme.textTertiary },
                      ]}
                    />
                    <View style={styles.glyph}>
                      {/* The pooled row stands for several categories at once,
                          so no single glyph is true of it. It keeps its swatch
                          and leaves this box empty rather than borrowing a
                          meaning it does not have — the box still reserves the
                          width, so the labels stay on one x. */}
                      {s.icon && <Icon name={s.icon} size={15} color={theme.textSecondary} />}
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
            {/* The month is named whenever it is not the period the rest of
                the screen is about, so "AED 623 left" cannot be read as the
                year's remaining allowance. Composed from the existing label
                rather than a new phrase, so it needs no new translation and
                stays true in Arabic. */}
            <SectionHeader
              title={
                monthScoped ? t('limitsHeader') : `${t('limitsHeader')} · ${monthLabel(key, true)}`
              }
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
                    accessibilityValue={{ text: `${formatAED(spent)} / ${formatAED(budget.limitFils)}` }}
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
                          width: `${ratio <= 0 ? 0 : Math.max(2, Math.min(100, ratio * 100))}%`,
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

          {/* ── Income vs spending ── */}
          {/* Uncarded for the same reason as the composition below: nothing
              here is tappable or dismissible, so the border is decoration. */}
          <Animated.View
            entering={enter(FadeInDown.delay(80).duration(320))}
            style={styles.section}>
            <SectionHeader
              title={t('inVsOut6')}
              right={`${trendAvg >= 0 ? '+' : '−'}${formatCompactAED(trendAvg)} ${t('averageSuffix')}`}
            />
            <View
              style={[
                styles.trend,
                showTrendValues ? styles.trendWithValues : styles.trendWithoutValues,
              ]}>
              {trend.map((m) => {
                const current = m.key === key;
                const empty = m.income === 0 && m.expense === 0;
                return (
                  <View
                    key={m.key}
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={monthCashflowLabel(m)}
                    accessibilityState={{ selected: current }}
                    style={[styles.trendCol, current && { backgroundColor: theme.backgroundSelected }]}>
                    {showTrendValues && <View style={styles.trendValues}>
                      {empty ? (
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
                              { color: current ? theme.expense : dataViz.axis },
                            ]}>
                            {formatCompactAED(m.expense)}
                          </ThemedText>
                        </>
                      )}
                    </View>}
                    <View style={styles.trendBars}>
                      <View
                        style={[
                          styles.trendBar,
                          {
                            height: `${m.income <= 0 ? 0 : Math.max(2, (m.income / trendMax) * 100)}%`,
                            backgroundColor: theme.primary,
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.trendBar,
                          {
                            height: `${m.expense <= 0 ? 0 : Math.max(2, (m.expense / trendMax) * 100)}%`,
                            backgroundColor: current ? theme.expense : dataViz.expenseSoft,
                          },
                        ]}
                      />
                    </View>
                    {showAllTrendLabels && <ThemedText
                      type="nano"
                      themeColor={current ? 'text' : 'textTertiary'}
                      style={styles.trendLabel}>
                      {m.label}
                    </ThemedText>}
                  </View>
                );
              })}
            </View>
            {!showAllTrendLabels && (
              <View
                style={styles.trendSparseAxis}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants">
                <ThemedText
                  type="nano"
                  themeColor="textTertiary"
                  style={[styles.trendEndpointLabel, { textAlign: language === 'ar' ? 'right' : 'left' }]}>
                  {trend[0]?.label}
                </ThemedText>
                <ThemedText
                  type="nano"
                  style={[styles.trendEndpointLabel, { textAlign: language === 'ar' ? 'left' : 'right' }]}>
                  {trend[trend.length - 1]?.label}
                </ThemedText>
              </View>
            )}
            {selectedTrendMonth ? (
              <ThemedText
                type="meta"
                themeColor="textSecondary"
                accessibilityLiveRegion="polite"
                style={styles.selectedTrendSummary}>
                {monthCashflowLabel(selectedTrendMonth)}
              </ThemedText>
            ) : null}
            {!showTrendValues && (
              <View style={styles.trendDetails}>
                {trend.map((m) => (
                  <View
                    key={m.key}
                    accessible
                    accessibilityLabel={m.income === 0 && m.expense === 0
                      ? tf('monthCashflowNoDataA11y', { month: m.label }, language)
                      : tf('monthCashflowA11y', {
                          month: m.label,
                          income: formatAED(m.income, { decimals: false }),
                          spending: formatAED(m.expense, { decimals: false }),
                        }, language)}
                    accessibilityState={{ selected: m.key === key }}
                    style={[styles.trendDetailRow, { borderBottomColor: theme.cardBorder }]}>
                    <ThemedText type="smallBold" style={styles.trendDetailMonth}>
                      {m.label}
                    </ThemedText>
                    {m.income === 0 && m.expense === 0 ? (
                      <ThemedText type="default" themeColor="textTertiary" style={styles.trendDetailEmpty}>
                        —
                      </ThemedText>
                    ) : (
                      <>
                        <ThemedText
                          type="default"
                          style={[styles.trendDetailFigure, { color: theme.primary }]}>
                          {t('incomeLabel')}{' '}
                          <ThemedText type="default" tabular style={{ color: theme.primary }}>
                            {formatCompactAED(m.income)}
                          </ThemedText>
                        </ThemedText>
                        <ThemedText
                          type="default"
                          style={[
                            styles.trendDetailFigure,
                            { color: m.key === key ? theme.expense : theme.textSecondary },
                          ]}>
                          {t('spentLabel')}{' '}
                          <ThemedText
                            type="default"
                            tabular
                            style={{ color: m.key === key ? theme.expense : theme.textSecondary }}>
                            {formatCompactAED(m.expense)}
                          </ThemedText>
                        </ThemedText>
                      </>
                    )}
                  </View>
                ))}
              </View>
            )}
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
      </ScreenScaffold>

      <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
      <LimitSheet
        category={limitFor === 'new' ? null : limitFor}
        open={limitFor !== null}
        monthKey={key}
        onClose={() => setLimitFor(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  summaryRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  summaryRailLarge: { flexDirection: 'column' },
  // Full-width totals and wrapping facts preserve amounts at larger text sizes.
  summaryCell: { minWidth: 0, gap: 3, paddingVertical: Spacing.two + 2 },
  summaryPrimary: { flexBasis: '100%', flexGrow: 1 },
  totalAmount: { flexWrap: 'wrap' },
  summaryPaired: { flex: 1.35 },
  summaryProgress: { flex: 1, minWidth: 140, gap: Spacing.two },
  progressCaption: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  progressLabel: { flex: 1, minWidth: 0 },
  summaryDivided: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three },
  summaryDividedLarge: {
    borderStartWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingStart: 0,
  },
  section: { marginTop: Spacing.five },

  compBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  // No `gap` here: the rows are separated by their own hairline, and a gap on
  // top of that leaves the divider floating between two bands of air.
  compRows: { marginTop: Spacing.three },
  compRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingVertical: 11,
  },
  // The FILL matches this row's segment in the bar above — that link is the
  // swatch's whole job — but the ramp descends into lightnesses that sit at
  // 2.0-2.8:1 against the page, so the faint tail steps were invisible on their
  // own. The ramp cannot be lifted to fix it: forcing five descending steps all
  // above 3:1 collapses the last three into the same colour, and five
  // categories then look like three. So the EDGE carries visibility and the
  // fill carries identity.
  swatch: { width: 8, height: 8, borderRadius: 2, borderWidth: StyleSheet.hairlineWidth },
  // Fixed box so the labels start at one x whether the row drew a 15px glyph
  // or the 8px pooled swatch. Without it the list steps sideways on the last
  // row, which reads as a rendering fault rather than a different kind of row.
  glyph: { width: 18, alignItems: 'center', justifyContent: 'center' },
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

  trend: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  trendWithValues: { height: 118 + 28 + 14 },
  trendWithoutValues: { height: 118 + 14 },
  trendCol: { flex: 1, gap: Spacing.one, borderRadius: Radius.tile, paddingVertical: Spacing.two },
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
    minHeight: 28,
    alignItems: 'stretch',
  },
  // `nano` is a compact caps label with tracking — right for a section label,
  // far too wide here. Each value receives the full column width so a readable
  // 11px figure does not regress to the former clipped "1…" rendering.
  trendValue: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0,
    textTransform: 'none',
    textAlign: 'center',
  },
  trendLabel: { textAlign: 'center' },
  trendSparseAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  trendEndpointLabel: { maxWidth: '45%', flexShrink: 1 },
  selectedTrendSummary: { marginTop: Spacing.two },
  trendDetails: { marginTop: Spacing.two },
  trendDetailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trendDetailMonth: { flexBasis: '100%' },
  trendDetailFigure: { flexGrow: 1, flexBasis: 112 },
  trendDetailEmpty: { flexBasis: '100%' },

  insights: { gap: Spacing.two },
});
