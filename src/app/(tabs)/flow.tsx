/** Spending owns categories, their limits, transactions and the former Stats insights. */
import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CaptureRefreshControl } from '@/components/capture-refresh-control';
import { ThemedText } from '@/components/themed-text';
import { TransactionRow } from '@/components/transaction-row';
import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { MerchantSpendingLink } from '@/components/merchant-spending-link';
import { LimitSheet } from '@/components/limit-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { SpendingOverview, spendingCopy, type CategoryFilter } from '@/components/spending/spending-overview';
import { SpendingTrends } from '@/components/spending/spending-trends';
import { SpendingCalendar } from '@/components/spending/spending-calendar';
import { SpendingCategoriesBand, SpendingCompareBand } from '@/components/spending/spending-band';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { BandSegmented } from '@/components/ui/band/band-segmented';
import { EButton } from '@/components/ui/band/e-button';
import { GlyphTile } from '@/components/ui/band/glyph-tile';
import { LimitStatusBar } from '@/components/ui/band/status-bar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { TextField } from '@/components/ui/text-field';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { categoryMovers, categoryTrend, comparableSpend, dailySpendForMonth, dayOfWeekSpend, topMerchants } from '@/lib/analytics';
import { assistantCopy } from '@/lib/assistant-copy';
import { everydayBandCopy } from '@/lib/everyday-band-copy';
import { categoryLabel, isFixedCommitment } from '@/lib/categories';
import { formatAED, formatCompactAED, ledgerTypicalMinor, monthEndISO, monthKey, monthLabel, monthStartISO, shiftMonthKey } from '@/lib/format';
import { summarizeForeignActivity } from '@/lib/fx-summary';
import { tapped } from '@/lib/haptics';
import { summarizeMonth } from '@/lib/insights';
import { internalTransferIdsForState, isIncome, isSpending, liveAccountIds } from '@/lib/ledger';
import { ledgerCurrencyCode } from '@/lib/markets';
import { comparablePreviousPeriod, inPeriod, isCurrentMonth, periodLabel, previousPeriod } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { periodDayProgress } from '@/lib/period-pace';
import { spendingTrendsCopy } from '@/lib/reference-copy';
import { spendingCategoryRows } from '@/lib/reference-presentation';
import { useStoreSelector } from '@/lib/store';
import { historyStatusOnly } from '@/lib/store-selection';
import { t, tf } from '@/lib/i18n';
import { merchantSpendingHref } from '@/lib/merchant-spending';
import type { CategoryId, Transaction } from '@/lib/types';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { isTransferCandidate } from '@/lib/transfer-reconciliation';

type ViewMode = 'categories' | 'compare' | 'calendar';
/**
 * Calendar replaced Activity (it always held the calendar and the filtered
 * list) and Compare replaced Trends. Old `view` links keep working.
 */
const VIEW_ALIASES: Record<string, ViewMode> = {
  categories: 'categories', compare: 'compare', calendar: 'calendar', activity: 'calendar', trends: 'compare',
};
const viewFromParam = (value: unknown): ViewMode | null => VIEW_ALIASES[String(value)] ?? null;
// This ScrollView is a preview. The full ledger is virtualized in Transactions.
const ACTIVITY_PREVIEW_LIMIT = 8;
const shortMonthLabel = (key: string) => monthLabel(key, true).replace(/\s+\d{4}$/, '');

export default function FlowScreen() {
  // Design language E: Spending wears the clay band in both schemes.
  const band = useBand('spending'); const language = useLanguage(); const router = useRouter();
  const largeText = useLargeTextLayout();
  const params = useLocalSearchParams<{ view?: string }>();
  // Only what Spending draws. Import progress changes only the status-only
  // object, and only when the status itself does.
  const state = useStoreSelector(({ state: s }) => ({
    transactions: s.transactions, accounts: s.accounts, budgets: s.budgets,
    transferInternalIds: s.transferInternalIds, transferNormalizationVersion: s.transferNormalizationVersion,
    historyImport: historyStatusOnly(s.historyImport),
    // The foreign-activity summary reads the ledger currency from module state.
    ledgerMoney: s.ledgerMoney, marketId: s.marketId,
  }));
  const { period, setPeriod } = usePeriod();
  const w = spendingCopy[language === 'ar' ? 'ar' : 'en'];
  const words = everydayBandCopy(language);
  const transferWords = transferActivityCopy(language);
  const [view, setView] = useState<ViewMode>(viewFromParam(params.view) ?? 'categories');
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const appliedQuery = useDeferredValue(query);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [limitFor, setLimitFor] = useState<CategoryId | 'new' | null>(null);
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [categoryHistoryEndKey, setCategoryHistoryEndKey] = useState<string | null>(null);
  const [entry, setEntry] = useState<Transaction | null>(null);
  // The Trends chart owns a stable six-month viewport while a user inspects
  // individual months. Without a separate anchor, tapping an older bar makes
  // that month the new end of the window, so the newest month disappears.
  const [trendWindowEndKey, setTrendWindowEndKey] = useState<string | null>(null);
  useEffect(() => {
    const next = viewFromParam(params.view);
    if (!next) return;
    setTrendWindowEndKey(null);
    setView(next);
  }, [params.view]);
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
  useEffect(() => { setFilter('all'); setCalendarDay(null); }, [period]);

  const live = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = internalTransferIdsForState(state);
  const hasTransferSpending = useMemo(() => view === 'calendar' && state.transactions.some(transaction =>
    isTransferCandidate(transaction) && isSpending(transaction, live, internal) && inPeriod(transaction.date, period)),
  [view, state.transactions, live, internal, period]);
  const summary = useMemo(() => summarizeMonth(state.transactions, period, live, internal), [state.transactions, period, live, internal]);
  const foreign = useMemo(() => view === 'categories'
    ? summarizeForeignActivity(
        state.transactions,
        (tx) => live.has(tx.accountId) && !internal.has(tx.id) && inPeriod(tx.date, period),
        ledgerCurrencyCode(),
      )
    : null,
    [view, state.transactions, period, live, internal, state.ledgerMoney, state.marketId]);
  const rows = useMemo(() => spendingCategoryRows(summary, state.budgets, period.mode === 'month'), [summary, state.budgets, period.mode]);
  const accountById = useMemo(() => new Map(state.accounts.map((a) => [a.id, a])), [state.accounts]);
  const key = period.mode === 'month' ? period.key : monthKey(new Date());
  const trendWindowAnchorKey = trendWindowEndKey ?? key;
  const setViewMode = (next: ViewMode) => {
    if (next !== view) setTrendWindowEndKey(null);
    setView(next);
  };
  const openCategory = (id: CategoryId) => {
    // Keep the visible six-month window anchored to the month the user opened.
    // Previously every bar tap moved the window itself, so tapping Aug while
    // viewing May–Oct replaced Oct with older months and made "back to latest"
    // impossible from the chart.
    setCategoryHistoryEndKey(key);
    setCategory(id);
  };
  const closeCategory = () => {
    setCategory(null);
  };
  const selectedCategory = category === null ? null : rows.find((r) => r.category === category) ?? null;
  // The former Stats category history remains available in the relevant category detail.
  const categoryHistoryAnchor = categoryHistoryEndKey ?? key;
  const categoryHistory = useMemo(() => category ? categoryTrend(state.transactions, category, 6, categoryHistoryAnchor, live, internal) : [],
    [category, state.transactions, categoryHistoryAnchor, live, internal]);
  const categoryHistoryMax = Math.max(1, ...categoryHistory.map((month) => month.fils));
  const categorySpentFils = selectedCategory?.spentFils ?? 0;
  const categorySharePercent = summary.expenseFils > 0
    ? Math.round(categorySpentFils / summary.expenseFils * 100)
    : 0;
  const categoryHistoryAverage = categoryHistory.length > 0
    ? Math.round(categoryHistory.reduce((total, month) => total + month.fils, 0) / categoryHistory.length)
    : 0;
  const categorySelectedHistoryIndex = categoryHistory.findIndex((month) => month.key === key);
  const categoryPreviousMonth = period.mode === 'month' && categorySelectedHistoryIndex > 0
    ? categoryHistory[categorySelectedHistoryIndex - 1]
    : null;
  const categoryLatestKey = categoryHistory.at(-1)?.key ?? categoryHistoryAnchor;
  const categoryCanReturnToLatest = period.mode === 'month'
    && key !== categoryLatestKey
    && categoryHistory.some((month) => month.key === key);
  const categoryMonthDeltaPercent = categoryPreviousMonth?.fils
    ? Math.round((categorySpentFils - categoryPreviousMonth.fils) / categoryPreviousMonth.fils * 100)
    : null;
  const categoryAverageDeltaPercent = period.mode === 'month' && categoryHistoryAverage > 0
    ? Math.round((categorySpentFils - categoryHistoryAverage) / categoryHistoryAverage * 100)
    : null;
  const categoryInsight = categoryAverageDeltaPercent == null
    ? `${w.average} ${formatAED(categoryHistoryAverage)}`
    : Math.abs(categoryAverageDeltaPercent) <= 4
      ? w.nearAverage
      : categoryAverageDeltaPercent > 0
        ? w.aboveAverage(categoryAverageDeltaPercent)
        : w.belowAverage(Math.abs(categoryAverageDeltaPercent));

  // Detailed analysis and activity sorting run only in the view that needs them.
  // Store order is newest-first: stop after leaving this period rather than
  // copying years of spending just to paint eight preview rows.
  const sortedActivity = useMemo(() => {
    if (view !== 'calendar') return [];
    const needle = appliedQuery.trim().toLocaleLowerCase();
    const out: Transaction[] = [];
    const unbounded = period.mode === 'all';
    let previousDate: string | null = null;
    let newestFirst = true;
    let seenInPeriod = false;
    for (const tx of state.transactions) {
      if (newestFirst && previousDate !== null && tx.date > previousDate) newestFirst = false;
      previousDate = tx.date;
      const inside = inPeriod(tx.date, period);
      if (!inside) {
        if (seenInPeriod && newestFirst && !unbounded) break;
        continue;
      }
      seenInPeriod = true;
      if (isTransferCandidate(tx) || !isSpending(tx, live, internal)) continue;
      if (calendarDay !== null && tx.date !== calendarDay) continue;
      if (needle) {
        const haystack = `${tx.title} ${accountById.get(tx.accountId)?.name ?? ''}`.toLocaleLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      out.push(tx);
      if (!needle && out.length >= ACTIVITY_PREVIEW_LIMIT) break;
    }
    return out;
  }, [view, state.transactions, live, internal, period, appliedQuery, accountById, calendarDay]);
  const activity = sortedActivity;
  const calendarDays = useMemo(() => view === 'calendar' && period.mode === 'month'
    ? dailySpendForMonth(state.transactions, period.key, live, internal, (transaction) => !isTransferCandidate(transaction)) : [],
  [view, period, state.transactions, live, internal]);
  const todayISO = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const analysis = useMemo(() => {
    if (view !== 'compare') return null;
    const keys = Array.from({ length: 6 }, (_, i) => shiftMonthKey(trendWindowAnchorKey, i - 5));
    const buckets = new Map(keys.map((key) => [key, { key, incomeFils: 0, expenseFils: 0 }]));
    const oldestKey = keys[0]!;
    let previousDate: string | null = null;
    let newestFirst = true;
    for (const tx of state.transactions) {
      if (newestFirst && previousDate !== null && tx.date > previousDate) newestFirst = false;
      previousDate = tx.date;
      const txMonth = monthKey(tx.date);
      if (newestFirst && txMonth < oldestKey) break;
      const bucket = buckets.get(txMonth); if (!bucket) continue;
      if (isIncome(tx, live, internal)) bucket.incomeFils += tx.amountFils;
      else if (isSpending(tx, live, internal)) bucket.expenseFils += tx.amountFils;
    }
    const comparable = comparablePreviousPeriod(period, new Date(), state.transactions);
    return { months: [...buckets.values()],
      merchants: topMerchants(state.transactions, period, 8, live, internal),
      // Fixed costs leave the rows as well as the headline, so the two never disagree.
      movers: categoryMovers(state.transactions, period, 10, live, internal)
        .filter((mover) => !isFixedCommitment(mover.category)).slice(0, 6),
      comparison: comparableSpend(state.transactions, period, live, internal),
      previousName: (() => { const previous = previousPeriod(period); return previous ? periodLabel(previous) : null; })(),
      partial: isCurrentMonth(period, new Date()),
      weekdays: dayOfWeekSpend(state.transactions, period, live, internal),
      comparisonLabel: comparable ? periodLabel(comparable) : null };
  }, [view, trendWindowAnchorKey, state.transactions, period, live, internal]);

  // "Day 12 of 30" only while the selected money month is running. The
  // period's own first/last day (salary-day aware), never the calendar month.
  const pace = period.mode === 'month' && isCurrentMonth(period, new Date())
    ? periodDayProgress(monthStartISO(period.key), monthEndISO(period.key), todayISO) : null;
  const currentPeriodName = periodLabel(period);
  const spentLabel = pace ? words.spentThisMonth : words.spentIn(currentPeriodName);
  const openAssistant = () => router.push({ pathname: '/assistant', params: { question: assistantCopy.spendingChangedQuestion } });
  const selectedDay = calendarDay ? calendarDays.find((day) => day.dateISO === calendarDay) ?? null : null;
  const dayHeading = calendarDay
    ? new Date(`${calendarDay}T12:00:00Z`).toLocaleDateString(language === 'ar' ? 'ar-AE' : 'en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    : words.calendarRecent;
  const trendsWords = spendingTrendsCopy[language === 'ar' ? 'ar' : 'en'];

  const bandContent = <View style={styles.band}>
    <BandSegmented palette={band} label={words.spendingViews} value={view} onChange={setViewMode} testID="spending-views"
      segments={[
        { value: 'categories', label: w.categories, testID: 'spending-view-categories' },
        { value: 'compare', label: w.compare, testID: 'spending-view-compare' },
        { value: 'calendar', label: w.calendar, testID: 'spending-view-calendar' },
      ]} />
    {view === 'categories' && <SpendingCategoriesBand palette={band} label={spentLabel} totalFils={summary.expenseFils}
      paceLabel={pace ? words.dayOf(pace.day, pace.of) : null} rows={rows} />}
    {view === 'compare' && analysis && <SpendingCompareBand palette={band} comparison={analysis.comparison}
      otherName={analysis.previousName ?? analysis.comparisonLabel} partial={analysis.partial} paceDay={pace?.day ?? null}
      noiseFloorFils={ledgerTypicalMinor(50)} />}
    {view === 'calendar' && <SpendingCalendar palette={band} periodLabel={currentPeriodName} days={calendarDays}
      todayISO={todayISO} selected={calendarDay} onSelect={setCalendarDay} />}
  </View>;

  return <>
    <BandScaffold band="spending" tabbed testID="reference-spending-screen" contentStyle={styles.sheet}
      nav={{ title: t('tabFlow'), actions: [
        { icon: 'search', label: w.search, onPress: () => setViewMode('calendar'), testID: 'spending-search' },
        { icon: 'filter', label: words.choosePeriod(currentPeriodName), onPress: () => setPeriodOpen(true), testID: 'spending-period' },
      ] }}
      refreshControl={<CaptureRefreshControl />}
      bandContent={bandContent}>
      {view === 'categories' && <SpendingOverview totalFils={summary.expenseFils}
        rows={rows} monthScoped={period.mode === 'month'} filter={filter} onFilter={setFilter}
        onCategory={openCategory} onNewLimit={() => setLimitFor('new')}
        assistantSlot={<View testID="spending-ask-wafra" style={styles.assistantAction}>
          <EButton palette={band} variant="quiet" icon="spark" label={w.explain} onPress={openAssistant} style={styles.quiet} />
        </View>} />}
      {view === 'categories' && <MerchantSpendingLink />}
      {view === 'categories' && foreign && foreign.transactions.length > 0 && (
        <Pressable
          testID="foreign-spending-entry"
          accessibilityRole="button"
          accessibilityLabel={`${t('foreignSpending')}. ${formatAED(foreign.totalLocalFils)}`}
          onPress={() => router.push('/currency')}
          style={[styles.foreignEntry, largeText && styles.foreignEntryStacked, { borderColor: band.rule }]}>
          <View style={styles.foreignCopy}>
            <ThemedText type="smallBold">{t('foreignSpending')}</ThemedText>
            <ThemedText type="meta" style={{ color: band.textSecondary }}>
              {tf('foreignActivityCaption', {
                count: foreign.transactions.length,
                s: foreign.transactions.length === 1 ? '' : 's',
                currencies: foreign.groups.length,
                ending: foreign.groups.length === 1 ? 'y' : 'ies',
              })}
            </ThemedText>
          </View>
          <ThemedText type="smallBold" tabular style={largeText && styles.foreignAmountStacked}>{formatAED(foreign.totalLocalFils)}</ThemedText>
          {largeText ? null : <Icon name="chevron-right" size={16} color={band.textSecondary} />}
        </Pressable>
      )}
      {view === 'calendar' && <View style={styles.activity} testID="spending-activity">
        <View style={[styles.dayHeading, largeText && styles.stack]}>
          <ThemedText type="smallBold" accessibilityRole="header" style={styles.sectionTitle} testID="spending-day-heading">{dayHeading}</ThemedText>
          {selectedDay ? <View testID="spending-day-total"><Money fils={selectedDay.fils + selectedDay.fixedFils} type="smallBold" /></View> : null}
        </View>
        {calendarDay ? <Pressable accessibilityRole="button" onPress={() => setCalendarDay(null)} style={styles.clearDay}
          testID="spending-day-clear">
          <ThemedText type="meta" style={{ color: band.tint }}>{trendsWords.calendarAll}</ThemedText>
        </Pressable> : null}
        <TextField label={w.search} placeholder={w.searchHint} value={query} onChangeText={setQuery} autoCorrect={false} />
        {hasTransferSpending && <View style={styles.transferNote}>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{transferWords.activityCountsNote}</ThemedText>
          <EButton palette={band} variant="quiet" icon="repeat" label={transferWords.viewAll} onPress={() => router.push('/transfers')} style={styles.quiet} />
        </View>}
        <View style={[styles.group, { borderColor: band.rule }]}>
          {activity.slice(0, ACTIVITY_PREVIEW_LIMIT).map((tx) => <TransactionRow key={tx.id} transaction={tx}
            account={accountById.get(tx.accountId)} onPress={setEntry} internal={internal.has(tx.id)} />)}
          {activity.length === 0 && <ThemedText type="meta" style={[styles.empty, { color: band.textSecondary }]}>{w.noResults}</ThemedText>}
        </View>
        <EButton palette={band} variant="secondary" label={w.allActivity}
          onPress={() => router.push(`/transactions?type=expense${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`)} />
      </View>}
      {view === 'compare' && analysis && <>
        <View testID="spending-ask-wafra" style={styles.assistantAction}>
          <EButton palette={band} variant="quiet" icon="spark" label={w.explain} onPress={openAssistant} style={styles.quiet} />
        </View>
        <SpendingTrends months={analysis.months} merchants={analysis.merchants} movers={analysis.movers}
          weekdays={analysis.weekdays} comparisonLabel={analysis.comparisonLabel} previousName={analysis.previousName}
          selectedKey={key} periodLabel={currentPeriodName} currentName={currentPeriodName}
          onMonth={(monthKey) => {
            if (monthKey === key) return;
            setTrendWindowEndKey((anchor) => anchor ?? trendWindowAnchorKey);
            setPeriod({ mode: 'month', key: monthKey });
          }}
          onMerchant={(merchant) => router.push(merchantSpendingHref(merchant))}
          onCategory={openCategory} />
      </>}
    </BandScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} onApply={() => setTrendWindowEndKey(null)} />
    <EntryDetailSheet transaction={entry} band="spending" onClose={() => setEntry(null)} />
    <BottomSheet
      visible={category !== null}
      onClose={closeCategory}
      palette={band}
      title={category ? categoryLabel(category, language) : ''}
      subtitle={currentPeriodName}
      closeVariant="plain"
      headerLeading={category ? <GlyphTile category={category} palette={band} size={40} /> : undefined}>
      {category && <View style={styles.categoryDetail}>
        <View style={styles.categoryHero}>
          <Money fils={categorySpentFils} type="amount" />
          <View style={styles.categoryHeroMeta}>
            <ThemedText type="meta" style={{ color: band.textSecondary }}>
              {categorySharePercent}% {w.share}
            </ThemedText>
            {categoryMonthDeltaPercent != null && categoryPreviousMonth ? (
              <ThemedText type="meta" style={{ color: band.textSecondary }}>
                {categoryMonthDeltaPercent > 0 ? '↑ ' : categoryMonthDeltaPercent < 0 ? '↓ ' : ''}
                {Math.abs(categoryMonthDeltaPercent)}% {w.vs} {shortMonthLabel(categoryPreviousMonth.key)}
              </ThemedText>
            ) : null}
          </View>
          <View style={[styles.categoryLimitPill, { borderColor: band.rule, backgroundColor: band.card }]}>
            <ThemedText type="meta" style={{ color: band.textSecondary }}>
              {selectedCategory?.limitFils != null
                ? `${formatAED(selectedCategory.limitFils)} · ${t('monthlyLimit')}`
                : w.noLimit}
            </ThemedText>
          </View>
          {selectedCategory?.limitFils != null ? <LimitStatusBar spentMinor={categorySpentFils}
            limitMinor={selectedCategory.limitFils} palette={band} testID="category-limit-bar" /> : null}
        </View>
        <View style={styles.categoryHistory} testID="category-history">
          <View style={[styles.categoryHistoryHeader, largeText && styles.categoryHistoryHeaderStacked]}>
            <ThemedText type="smallBold">{w.lastSixMonths}</ThemedText>
            <View style={[styles.categoryHistoryHeaderRight, largeText && styles.categoryHistoryHeaderStacked]}>
              {categoryCanReturnToLatest ? <Pressable
                accessibilityRole="button"
                accessibilityLabel={w.latest}
                onPress={() => { tapped(); setPeriod({ mode: 'month', key: categoryLatestKey }); }}
                hitSlop={6}
                style={({ pressed }) => [styles.categoryLatestButton, {
                  backgroundColor: pressed ? band.card : 'transparent',
                  borderColor: band.rule,
                }]}>
                <ThemedText type="meta" style={{ color: band.tint }}>{w.latest}</ThemedText>
              </Pressable> : null}
              <ThemedText type="meta" style={[styles.shrinkText, { color: band.textSecondary }]}>
                {w.average} {formatAED(categoryHistoryAverage)}
              </ThemedText>
            </View>
          </View>
          {/* At the accessibility sizes six columns cannot hold a month name
              each, so the same six months become a list: name and exact
              amount, with the bar drawn horizontally underneath. */}
          {largeText ? <View style={styles.categoryHistoryList}>
            {categoryHistory.map((month) => {
              const selected = month.key === key;
              return <Pressable key={month.key} accessibilityRole="button" testID={`category-history-month-${month.key}`}
                accessibilityLabel={`${monthLabel(month.key)}. ${formatAED(month.fils)}`}
                accessibilityState={{ selected }}
                onPress={() => { tapped(); setPeriod({ mode: 'month', key: month.key }); }}
                style={({ pressed }) => [styles.categoryHistoryItem, {
                  backgroundColor: selected ? band.card : pressed ? band.card : 'transparent',
                }]}>
                <ThemedText type={selected ? 'smallBold' : 'small'}>{monthLabel(month.key)}</ThemedText>
                <Money fils={month.fils} type={selected ? 'smallBold' : 'small'} />
                <View style={[styles.categoryHistoryTrack, { backgroundColor: band.rule }]}>
                  <View style={{ height: '100%', borderRadius: 3, backgroundColor: band.tint, opacity: selected ? 1 : 0.5,
                    width: `${month.fils <= 0 ? 0 : Math.max(2, month.fils / categoryHistoryMax * 100)}%` }} />
                </View>
              </Pressable>;
            })}
          </View> : <View style={styles.categoryBars}>
            {categoryHistory.map((month) => {
              const selected = month.key === key;
              const barHeight = month.fils <= 0 ? 3 : Math.max(8, Math.round(month.fils / categoryHistoryMax * 72));
              return <Pressable key={month.key} accessibilityRole="button" testID={`category-history-month-${month.key}`}
                accessibilityLabel={`${monthLabel(month.key)}. ${formatAED(month.fils)}`}
                accessibilityState={{ selected }}
                onPress={() => { tapped(); setPeriod({ mode: 'month', key: month.key }); }}
                hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                pressRetentionOffset={12}
                style={({ pressed }) => [styles.categoryBarColumn, {
                  backgroundColor: selected ? band.card : 'transparent',
                  opacity: pressed ? 0.82 : 1,
                }]}>
                <View style={styles.categoryBarPlot}>
                  <View style={styles.categoryBarValueSlot}>
                    {selected ? <ThemedText type="micro" tabular>{formatCompactAED(month.fils)}</ThemedText> : null}
                  </View>
                  <View style={[styles.categoryBar, {
                    height: barHeight,
                    backgroundColor: selected ? band.tint : band.rule,
                  }]} />
                </View>
                <ThemedText type="micro" style={{ color: selected ? band.text : band.textSecondary }}>
                  {shortMonthLabel(month.key)}
                </ThemedText>
              </Pressable>;
            })}
          </View>}
        </View>
        <View testID="category-ask-wafra" style={[styles.categoryInsight, { backgroundColor: band.card, borderColor: band.rule }]}>
          <View style={styles.categoryInsightCopy}>
            <Icon name="spark" size={16} color={band.tint} />
            <ThemedText type="meta" style={styles.categoryInsightText}>{categoryInsight}</ThemedText>
          </View>
          <Button label={w.askWafra} variant="ghost" onPress={() => {
            const question = assistantCopy.categoryChangedQuestion(categoryLabel(category, 'en'));
            closeCategory();
            router.push({ pathname: '/assistant', params: { question } });
          }} style={styles.categoryAskButton} />
        </View>
        <EButton palette={band} label={w.details} testID="category-details"
          onPress={() => { const id = category; closeCategory(); router.push(`/transactions?type=expense&category=${id}`); }} />
        {period.mode === 'month' && <EButton palette={band} variant="quiet" testID="category-limit"
          label={selectedCategory?.limitFils != null ? w.manage : w.setLimit}
          onPress={() => { setLimitFor(category); closeCategory(); }} />}
      </View>}
    </BottomSheet>
    <LimitSheet category={limitFor === 'new' ? null : limitFor} open={limitFor !== null} monthKey={key} onClose={() => setLimitFor(null)} />
  </>;
}
const styles = StyleSheet.create({
  band: { gap: 18 },
  sheet: { gap: 16 },
  sectionTitle: { fontSize: 17, lineHeight: 24 },
  assistantAction: { alignSelf: 'flex-start', maxWidth: '100%' },
  quiet: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 0, paddingVertical: 6 },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
  foreignEntry: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  foreignCopy: { flex: 1, minWidth: 0, gap: 2 },
  // At the accessibility sizes the total drops under the caption and the
  // disclosure chevron goes, so the caption has the row's full width.
  foreignEntryStacked: { flexWrap: 'wrap' },
  foreignAmountStacked: { flexBasis: '100%' },
  activity: { gap: 14 },
  dayHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  clearDay: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginTop: -8 },
  group: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 0 },
  transferNote: { gap: 4 },
  empty: { paddingVertical: 24 },
  categoryDetail: { gap: 14 },
  categoryHero: { gap: 8, paddingTop: 2 },
  categoryHeroMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  categoryLimitPill: { alignSelf: 'flex-start', minHeight: 30, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', paddingHorizontal: 10 },
  categoryHistory: { gap: 8, paddingTop: 2 },
  categoryHistoryHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  categoryHistoryHeaderRight: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexShrink: 1, minWidth: 0 },
  categoryHistoryHeaderStacked: { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start' },
  shrinkText: { flexShrink: 1 },
  categoryLatestButton: { minHeight: 32, minWidth: 52, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  categoryBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  categoryHistoryList: { gap: 4 },
  categoryHistoryItem: { minHeight: 48, gap: 4, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 8 },
  categoryHistoryTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  categoryBarColumn: { flex: 1, minWidth: 44, minHeight: 128, borderRadius: 10, alignItems: 'center', justifyContent: 'flex-end', gap: 5, paddingHorizontal: 2, paddingVertical: 3 },
  categoryBarPlot: { height: 98, alignItems: 'center', justifyContent: 'flex-end' },
  categoryBarValueSlot: { height: 20, alignItems: 'center', justifyContent: 'center' },
  categoryBar: { width: 24, borderRadius: 7 },
  categoryInsight: { gap: 4, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10 },
  categoryInsightCopy: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  categoryInsightText: { flex: 1, minWidth: 0 },
  categoryAskButton: { alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 0, paddingVertical: 6 },
});
