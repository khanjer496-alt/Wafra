/** Spending owns categories, their limits, transactions and the former Stats insights. */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { TransactionRow } from '@/components/transaction-row';
import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { LimitSheet } from '@/components/limit-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { SpendingOverview, spendingCopy, type CategoryFilter } from '@/components/spending/spending-overview';
import { SpendingTrends } from '@/components/spending/spending-trends';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { CategoryAvatar } from '@/components/ui/category-avatar';
import { Button } from '@/components/ui/controls';
import { Money } from '@/components/ui/money';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { TextField } from '@/components/ui/text-field';
import { usePullToRefresh } from '@/hooks/use-auto-import';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { categoryMovers, categoryTrend, dayOfWeekSpend, topMerchants } from '@/lib/analytics';
import { categoryLabel } from '@/lib/categories';
import { formatAED, monthKey, monthLabel, shiftMonthKey } from '@/lib/format';
import { summarizeMonth } from '@/lib/insights';
import { internalTransferIds, isIncome, isSpending, liveAccountIds } from '@/lib/ledger';
import { comparablePreviousPeriod, inPeriod, periodLabel } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { spendingCategoryRows } from '@/lib/reference-presentation';
import { useStore } from '@/lib/store';
import { t } from '@/lib/i18n';
import type { CategoryId, Transaction } from '@/lib/types';

type ViewMode = 'categories' | 'activity' | 'trends';
const validView = (value: unknown): value is ViewMode => ['categories', 'activity', 'trends'].includes(String(value));
const ACTIVITY_PREVIEW_LIMIT = 30;

export default function FlowScreen() {
  const theme = useTheme(); const language = useLanguage(); const router = useRouter();
  const params = useLocalSearchParams<{ view?: string }>();
  const { state } = useStore(); const { period, setPeriod } = usePeriod();
  const { refreshing, onRefresh } = usePullToRefresh();
  const w = spendingCopy[language === 'ar' ? 'ar' : 'en'];
  const [view, setView] = useState<ViewMode>(validView(params.view) ? params.view : 'categories');
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [periodOpen, setPeriodOpen] = useState(false);
  const [limitFor, setLimitFor] = useState<CategoryId | 'new' | null>(null);
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [entry, setEntry] = useState<Transaction | null>(null);
  useEffect(() => { if (validView(params.view)) setView(params.view); }, [params.view]);
  useEffect(() => { setFilter('all'); }, [period]);

  const live = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = useMemo(() => internalTransferIds(state.transactions, live), [state.transactions, live]);
  const summary = useMemo(() => summarizeMonth(state.transactions, period, live, internal), [state.transactions, period, live, internal]);
  const rows = useMemo(() => spendingCategoryRows(summary, state.budgets, period.mode === 'month'), [summary, state.budgets, period.mode]);
  const accountById = useMemo(() => new Map(state.accounts.map((a) => [a.id, a])), [state.accounts]);
  const key = period.mode === 'month' ? period.key : monthKey(new Date());
  const selectedCategory = category === null ? null : rows.find((r) => r.category === category) ?? null;
  // The former Stats category history remains available in the relevant category detail.
  const categoryHistory = useMemo(() => category ? categoryTrend(state.transactions, category, 6, key, live, internal) : [],
    [category, state.transactions, key, live, internal]);
  const categoryHistoryMax = Math.max(1, ...categoryHistory.map((month) => month.fils));

  // Detailed analysis and activity sorting run only in the view that needs them.
  const sortedActivity = useMemo(() => view !== 'activity' ? [] : state.transactions
    .filter((tx) => isSpending(tx, live, internal) && inPeriod(tx.date, period))
    .sort((a, b) => b.date.localeCompare(a.date)), [view, state.transactions, live, internal, period]);
  const activity = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return !needle ? sortedActivity : sortedActivity.filter((tx) =>
      `${tx.title} ${accountById.get(tx.accountId)?.name ?? ''}`.toLocaleLowerCase().includes(needle));
  }, [sortedActivity, query, accountById]);
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
        onPeriod={() => setPeriodOpen(true)} onCategory={setCategory} onNewLimit={() => setLimitFor('new')} />}
      {view === 'activity' && <View style={styles.activity} testID="spending-activity">
        <Button label={periodLabel(period)} variant="ghost" icon="calendar" onPress={() => setPeriodOpen(true)} />
        <TextField label={w.search} placeholder={w.searchHint} value={query} onChangeText={setQuery} autoCorrect={false} />
        <View style={[styles.group, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          {activity.slice(0, ACTIVITY_PREVIEW_LIMIT).map((tx) => <TransactionRow key={tx.id} transaction={tx}
            account={accountById.get(tx.accountId)} onPress={() => setEntry(tx)} />)}
          {activity.length === 0 && <ThemedText type="meta" themeColor="textSecondary" style={styles.empty}>{w.noResults}</ThemedText>}
        </View>
        <Button label={w.allActivity} variant="outline" onPress={() => router.push(`/transactions?type=expense${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`)} />
      </View>}
      {view === 'trends' && analysis && <>
        <Button label={periodLabel(period)} variant="ghost" icon="calendar" onPress={() => setPeriodOpen(true)} />
        <SpendingTrends {...analysis} selectedKey={key} periodLabel={periodLabel(period)}
          onMonth={(key) => setPeriod({ mode: 'month', key })}
          onMerchant={(merchant) => router.push(`/transactions?type=expense&merchant=${encodeURIComponent(merchant)}`)}
          onCategory={setCategory} />
      </>}
    </ScreenScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
    <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} />
    <BottomSheet visible={category !== null} onClose={() => setCategory(null)} title={category ? categoryLabel(category, language) : ''}>
      {category && <View style={styles.categoryDetail}>
        <CategoryAvatar category={category} size={56} />
        <ThemedText type="meta" themeColor="textSecondary">{periodLabel(period)}</ThemedText>
        <Money fils={selectedCategory?.spentFils ?? 0} type="amount" />
        <ThemedText type="meta" themeColor="textSecondary">{selectedCategory?.limitFils != null
          ? `${w.withLimits}: ${formatAED(selectedCategory.limitFils)}` : w.noLimit}</ThemedText>
        <View style={styles.categoryHistory} testID="category-history">
          <ThemedText type="smallBold">{t('refCategoryHistory')}</ThemedText>
          <View style={styles.categoryBars}>
            {categoryHistory.map((month) => <Pressable key={month.key} accessibilityRole="button"
              accessibilityLabel={`${monthLabel(month.key)}. ${formatAED(month.fils)}`}
              onPress={() => setPeriod({ mode: 'month', key: month.key })}
              style={styles.categoryBarColumn}>
              <View style={{ width: '65%', height: `${month.fils / categoryHistoryMax * 100}%`, borderRadius: 5, backgroundColor: theme.primary, opacity: month.key === key ? 1 : 0.45 }} />
            </Pressable>)}
          </View>
          <ThemedText type="meta" themeColor="textSecondary">{categoryHistory[0] ? monthLabel(categoryHistory[0].key, true) : ''} — {monthLabel(key, true)}</ThemedText>
        </View>
        <Button label={w.details} onPress={() => { const id = category; setCategory(null); router.push(`/transactions?type=expense&category=${id}`); }} />
        {period.mode === 'month' && <Button label={selectedCategory?.limitFils != null ? w.manage : w.setLimit} variant="outline"
          onPress={() => { setLimitFor(category); setCategory(null); }} />}
      </View>}
    </BottomSheet>
    <LimitSheet category={limitFor === 'new' ? null : limitFor} open={limitFor !== null} monthKey={key} onClose={() => setLimitFor(null)} />
  </>;
}
const styles = StyleSheet.create({
  activity: { gap: 16 }, group: { borderRadius: 18, borderWidth: 1, paddingHorizontal: 12, overflow: 'hidden' },
  empty: { paddingVertical: 24 }, categoryDetail: { gap: 16 },
  categoryHistory: { gap: 10 }, categoryBars: { height: 90, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  categoryBarColumn: { height: '100%', flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'flex-end' },
});
