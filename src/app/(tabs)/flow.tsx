/** Spending owns categories, their limits, transactions and the former Stats insights. */
import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { TransactionRow } from '@/components/transaction-row';
import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { MerchantSpendingLink } from '@/components/merchant-spending-link';
import { LimitSheet } from '@/components/limit-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { SpendingOverview, spendingCopy, type CategoryFilter } from '@/components/spending/spending-overview';
import { SpendingTrends } from '@/components/spending/spending-trends';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { CategoryAvatar } from '@/components/ui/category-avatar';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { TextField } from '@/components/ui/text-field';
import { usePullToRefresh } from '@/hooks/use-auto-import';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { categoryMovers, categoryTrend, dayOfWeekSpend, topMerchants } from '@/lib/analytics';
import { assistantCopy } from '@/lib/assistant-copy';
import { categoryLabel } from '@/lib/categories';
import { formatAED, formatCompactAED, monthKey, monthLabel, shiftMonthKey } from '@/lib/format';
import { summarizeForeignActivity } from '@/lib/fx-summary';
import { summarizeMonth } from '@/lib/insights';
import { internalTransferIds, isIncome, isSpending, liveAccountIds } from '@/lib/ledger';
import { ledgerCurrencyCode } from '@/lib/markets';
import { comparablePreviousPeriod, inPeriod, periodLabel } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { spendingCategoryRows } from '@/lib/reference-presentation';
import { useStore } from '@/lib/store';
import { t, tf } from '@/lib/i18n';
import { merchantSpendingHref } from '@/lib/merchant-spending';
import type { CategoryId, Transaction } from '@/lib/types';

type ViewMode = 'categories' | 'activity' | 'trends';
const validView = (value: unknown): value is ViewMode => ['categories', 'activity', 'trends'].includes(String(value));
// This ScrollView is a preview. The full ledger is virtualized in Transactions.
const ACTIVITY_PREVIEW_LIMIT = 8;
const shortMonthLabel = (key: string) => monthLabel(key, true).replace(/\s+\d{4}$/, '');

export default function FlowScreen() {
  const theme = useTheme(); const language = useLanguage(); const router = useRouter();
  const params = useLocalSearchParams<{ view?: string }>();
  const { state } = useStore(); const { period, setPeriod } = usePeriod();
  const { refreshing, onRefresh } = usePullToRefresh();
  const w = spendingCopy[language === 'ar' ? 'ar' : 'en'];
  const [view, setView] = useState<ViewMode>(validView(params.view) ? params.view : 'categories');
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const appliedQuery = useDeferredValue(query);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [limitFor, setLimitFor] = useState<CategoryId | 'new' | null>(null);
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [entry, setEntry] = useState<Transaction | null>(null);
  useEffect(() => { if (validView(params.view)) setView(params.view); }, [params.view]);
  useEffect(() => { setFilter('all'); }, [period]);

  const live = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = useMemo(() => internalTransferIds(state.transactions, state.accounts), [state.transactions, state.accounts]);
  const summary = useMemo(() => summarizeMonth(state.transactions, period, live, internal), [state.transactions, period, live, internal]);
  const foreign = useMemo(() => view === 'categories'
    ? summarizeForeignActivity(
        state.transactions,
        (tx) => live.has(tx.accountId) && !internal.has(tx.id) && inPeriod(tx.date, period),
        ledgerCurrencyCode(),
      )
    : null,
    [view, state.transactions, period, live, internal]);
  const rows = useMemo(() => spendingCategoryRows(summary, state.budgets, period.mode === 'month'), [summary, state.budgets, period.mode]);
  const accountById = useMemo(() => new Map(state.accounts.map((a) => [a.id, a])), [state.accounts]);
  const key = period.mode === 'month' ? period.key : monthKey(new Date());
  const selectedCategory = category === null ? null : rows.find((r) => r.category === category) ?? null;
  // The former Stats category history remains available in the relevant category detail.
  const categoryHistory = useMemo(() => category ? categoryTrend(state.transactions, category, 6, key, live, internal) : [],
    [category, state.transactions, key, live, internal]);
  const categoryHistoryMax = Math.max(1, ...categoryHistory.map((month) => month.fils));
  const categorySpentFils = selectedCategory?.spentFils ?? 0;
  const categorySharePercent = summary.expenseFils > 0
    ? Math.round(categorySpentFils / summary.expenseFils * 100)
    : 0;
  const categoryHistoryAverage = categoryHistory.length > 0
    ? Math.round(categoryHistory.reduce((total, month) => total + month.fils, 0) / categoryHistory.length)
    : 0;
  const categoryPreviousMonth = period.mode === 'month' && categoryHistory.length > 1
    ? categoryHistory[categoryHistory.length - 2]
    : null;
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
  const sortedActivity = useMemo(() => view !== 'activity' ? [] : state.transactions
    // Store order is already newest-first; filtering preserves that order.
    .filter((tx) => isSpending(tx, live, internal) && inPeriod(tx.date, period)),
    [view, state.transactions, live, internal, period]);
  const activity = useMemo(() => {
    const needle = appliedQuery.trim().toLocaleLowerCase();
    return !needle ? sortedActivity : sortedActivity.filter((tx) =>
      `${tx.title} ${accountById.get(tx.accountId)?.name ?? ''}`.toLocaleLowerCase().includes(needle));
  }, [sortedActivity, appliedQuery, accountById]);
  const analysis = useMemo(() => {
    if (view !== 'trends') return null;
    const keys = Array.from({ length: 6 }, (_, i) => shiftMonthKey(key, i - 5));
    const buckets = new Map(keys.map((key) => [key, { key, incomeFils: 0, expenseFils: 0 }]));
    for (const tx of state.transactions) {
      const bucket = buckets.get(monthKey(tx.date)); if (!bucket) continue;
      if (isIncome(tx, live, internal)) bucket.incomeFils += tx.amountFils;
      else if (isSpending(tx, live, internal)) bucket.expenseFils += tx.amountFils;
    }
    const comparable = comparablePreviousPeriod(period, new Date(), state.transactions);
    return { months: [...buckets.values()],
      merchants: topMerchants(state.transactions, period, 8, live, internal),
      movers: categoryMovers(state.transactions, period, 5, live, internal),
      weekdays: dayOfWeekSpend(state.transactions, period, live, internal),
      comparisonLabel: comparable ? periodLabel(comparable) : null };
  }, [view, key, state.transactions, period, live, internal]);

  const flowHeader: ScreenHeaderProps = { title: t('tabFlow'), actions: [{ icon: 'search', label: w.search, onPress: () => setView('activity') }] };

  return <>
    <ScreenScaffold tabbed headerMode="inline" testID="reference-spending-screen"
      header={flowHeader}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}>
      <SegmentedControl value={view} onChange={setView} label={t('tabFlow')} segments={[
        { value: 'categories', label: w.categories }, { value: 'activity', label: w.activity }, { value: 'trends', label: w.trends },
      ]} />
      {view === 'categories' && <SpendingOverview periodLabel={periodLabel(period)} totalFils={summary.expenseFils}
        rows={rows} monthScoped={period.mode === 'month'} filter={filter} onFilter={setFilter}
        onPeriod={() => setPeriodOpen(true)} onCategory={setCategory} onNewLimit={() => setLimitFor('new')}
        assistantSlot={<View testID="spending-ask-wafra" style={styles.assistantAction}>
          <Button label={assistantCopy.explain} variant="ghost" icon="spark"
            onPress={() => router.push({ pathname: '/assistant', params: { question: assistantCopy.spendingChangedQuestion } })} />
        </View>} />}
      {view === 'categories' && <MerchantSpendingLink />}
      {view === 'categories' && foreign && foreign.transactions.length > 0 && (
        <Pressable
          testID="foreign-spending-entry"
          accessibilityRole="button"
          accessibilityLabel={`${t('foreignSpending')}. ${formatAED(foreign.totalLocalFils)}`}
          onPress={() => router.push('/currency')}
          style={[styles.foreignEntry, { borderColor: theme.cardBorder }]}>
          <View style={styles.foreignCopy}>
            <ThemedText type="smallBold">{t('foreignSpending')}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">
              {tf('foreignActivityCaption', {
                count: foreign.transactions.length,
                s: foreign.transactions.length === 1 ? '' : 's',
                currencies: foreign.groups.length,
                ending: foreign.groups.length === 1 ? 'y' : 'ies',
              })}
            </ThemedText>
          </View>
          <ThemedText type="smallBold" tabular>{formatAED(foreign.totalLocalFils)}</ThemedText>
          <Icon name="chevron-right" size={16} color={theme.textSecondary} />
        </Pressable>
      )}
      {view === 'activity' && <View style={styles.activity} testID="spending-activity">
        <Button label={periodLabel(period)} variant="ghost" icon="calendar" onPress={() => setPeriodOpen(true)} />
        <TextField label={w.search} placeholder={w.searchHint} value={query} onChangeText={setQuery} autoCorrect={false} />
        <View style={[styles.group, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          {activity.slice(0, ACTIVITY_PREVIEW_LIMIT).map((tx) => <TransactionRow key={tx.id} transaction={tx}
            account={accountById.get(tx.accountId)} onPress={setEntry} internal={internal.has(tx.id)} />)}
          {activity.length === 0 && <ThemedText type="meta" themeColor="textSecondary" style={styles.empty}>{w.noResults}</ThemedText>}
        </View>
        <Button label={w.allActivity} variant="outline" onPress={() => router.push(`/transactions?type=expense${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`)} />
      </View>}
      {view === 'trends' && analysis && <>
        <View style={styles.trendsToolbar}>
          <Button label={periodLabel(period)} variant="ghost" icon="calendar" inline style={styles.trendsToolbarButton}
            onPress={() => setPeriodOpen(true)} />
          <View testID="spending-ask-wafra" style={styles.trendsToolbarAction}>
            <Button label={assistantCopy.explain} variant="ghost" icon="spark" inline style={styles.trendsToolbarButton}
              onPress={() => router.push({ pathname: '/assistant', params: { question: assistantCopy.spendingChangedQuestion } })} />
          </View>
        </View>
        <SpendingTrends {...analysis} selectedKey={key} periodLabel={periodLabel(period)}
          onMonth={(key) => setPeriod({ mode: 'month', key })}
          onMerchant={(merchant) => router.push(merchantSpendingHref(merchant))}
          onCategory={setCategory} />
      </>}
    </ScreenScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
    <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} />
    <BottomSheet
      visible={category !== null}
      onClose={() => setCategory(null)}
      title={category ? categoryLabel(category, language) : ''}
      subtitle={periodLabel(period)}
      closeVariant="plain"
      headerLeading={category ? (
        <View style={[styles.categoryHeaderIcon, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <CategoryAvatar category={category} size={32} />
        </View>
      ) : undefined}>
      {category && <View style={styles.categoryDetail}>
        <View style={styles.categoryHero}>
          <Money fils={categorySpentFils} type="amount" />
          <View style={styles.categoryHeroMeta}>
            <ThemedText type="meta" themeColor="textSecondary">
              {categorySharePercent}% {w.share}
            </ThemedText>
            {categoryMonthDeltaPercent != null && categoryPreviousMonth ? (
              <ThemedText type="meta" themeColor="textSecondary">
                {categoryMonthDeltaPercent > 0 ? '↑ ' : categoryMonthDeltaPercent < 0 ? '↓ ' : ''}
                {Math.abs(categoryMonthDeltaPercent)}% {w.vs} {shortMonthLabel(categoryPreviousMonth.key)}
              </ThemedText>
            ) : null}
          </View>
          <View style={[styles.categoryLimitPill, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
            <ThemedText type="meta" themeColor="textSecondary">
              {selectedCategory?.limitFils != null
                ? `${formatAED(selectedCategory.limitFils)} · ${t('monthlyLimit')}`
                : w.noLimit}
            </ThemedText>
          </View>
        </View>
        <View style={styles.categoryHistory} testID="category-history">
          <View style={styles.categoryHistoryHeader}>
            <ThemedText type="smallBold">{w.lastSixMonths}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">
              {w.average} {formatAED(categoryHistoryAverage)}
            </ThemedText>
          </View>
          <View style={styles.categoryBars}>
            {categoryHistory.map((month) => {
              const selected = month.key === key;
              const barHeight = month.fils <= 0 ? 3 : Math.max(8, Math.round(month.fils / categoryHistoryMax * 72));
              return <Pressable key={month.key} accessibilityRole="button"
                accessibilityLabel={`${monthLabel(month.key)}. ${formatAED(month.fils)}`}
                accessibilityState={{ selected }}
                onPress={() => setPeriod({ mode: 'month', key: month.key })}
                style={({ pressed }) => [styles.categoryBarColumn, { opacity: pressed ? 0.72 : 1 }]}>
                <View style={styles.categoryBarPlot}>
                  <View style={styles.categoryBarValueSlot}>
                    {selected ? <ThemedText type="micro" tabular>{formatCompactAED(month.fils)}</ThemedText> : null}
                  </View>
                  <View style={[styles.categoryBar, {
                    height: barHeight,
                    backgroundColor: theme.primary,
                    opacity: selected ? 1 : 0.34,
                  }]} />
                </View>
                <ThemedText type="micro" themeColor={selected ? 'text' : 'textSecondary'}>
                  {shortMonthLabel(month.key)}
                </ThemedText>
              </Pressable>;
            })}
          </View>
        </View>
        <View testID="category-ask-wafra" style={[styles.categoryInsight, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <View style={styles.categoryInsightCopy}>
            <Icon name="spark" size={16} color={theme.primary} />
            <ThemedText type="meta" style={styles.categoryInsightText}>{categoryInsight}</ThemedText>
          </View>
          <Button label={w.askWafra} variant="ghost" onPress={() => {
            const question = assistantCopy.categoryChangedQuestion(categoryLabel(category, 'en'));
            setCategory(null);
            router.push({ pathname: '/assistant', params: { question } });
          }} style={styles.categoryAskButton} />
        </View>
        <Button label={w.details} onPress={() => { const id = category; setCategory(null); router.push(`/transactions?type=expense&category=${id}`); }} />
        {period.mode === 'month' && <Button label={selectedCategory?.limitFils != null ? w.manage : w.setLimit} variant="ghost"
          style={styles.categorySecondaryAction}
          onPress={() => { setLimitFor(category); setCategory(null); }} />}
      </View>}
    </BottomSheet>
    <LimitSheet category={limitFor === 'new' ? null : limitFor} open={limitFor !== null} monthKey={key} onClose={() => setLimitFor(null)} />
  </>;
}
const styles = StyleSheet.create({
  assistantAction: { alignSelf: 'flex-start', maxWidth: '100%' },
  trendsToolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  trendsToolbarAction: { flex: 1, minWidth: 150 },
  trendsToolbarButton: { minHeight: 44 },
  foreignEntry: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  foreignCopy: { flex: 1, minWidth: 0, gap: 2 },
  activity: { gap: 16 }, group: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 0 },
  empty: { paddingVertical: 24 },
  categoryHeaderIcon: { width: 40, height: 40, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  categoryDetail: { gap: 14 },
  categoryHero: { gap: 8, paddingTop: 2 },
  categoryHeroMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  categoryLimitPill: { alignSelf: 'flex-start', minHeight: 30, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', paddingHorizontal: 10 },
  categoryHistory: { gap: 8, paddingTop: 2 },
  categoryHistoryHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  categoryBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  categoryBarColumn: { flex: 1, minHeight: 122, alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  categoryBarPlot: { height: 98, alignItems: 'center', justifyContent: 'flex-end' },
  categoryBarValueSlot: { height: 20, alignItems: 'center', justifyContent: 'center' },
  categoryBar: { width: 24, borderTopLeftRadius: 7, borderTopRightRadius: 7, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  categoryInsight: { gap: 4, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10 },
  categoryInsightCopy: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  categoryInsightText: { flex: 1, minWidth: 0 },
  categoryAskButton: { alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 0, paddingVertical: 6 },
  categorySecondaryAction: { alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 2, paddingVertical: 6 },
});
