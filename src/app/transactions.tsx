import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { TransactionRow } from '@/components/transaction-row';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { TransactionFilterSheet } from '@/components/transaction-filter-sheet';
import { Icon } from '@/components/ui/icon';
import { ScreenScaffold, useScreenContentInsets } from '@/components/ui/screen-scaffold';
import { TextField } from '@/components/ui/text-field';
import { Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { CATEGORIES } from '@/lib/categories';
import { formatAED, friendlyDate, monthKey, toISODate } from '@/lib/format';
import { periodLabel, periodRange } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { internalTransferIds, liveAccountIds, UNASSIGNED_INCOME_ACCOUNT_ID } from '@/lib/ledger';
import { createTransactionFilterIndex, projectTransactionFilter, type TransactionFilters as Filters } from '@/lib/transaction-filter';
import { useStore } from '@/lib/store';
import type { CategoryId, Transaction } from '@/lib/types';
import { t, tf, type StringKey } from '@/lib/i18n';

const DEFAULT_FILTERS: Filters = {
  type: null,
  accountId: null,
  categories: new Set(),
  datePreset: 'selected', // follow the app-wide reporting period by default
  dateFrom: null,
  dateTo: null,
  minFils: null,
  sort: 'newest',
};

interface DaySection {
  title: string;
  totalFils: number;
  data: Transaction[];
}

const transactionKey = (transaction: Transaction) => transaction.id;

export default function TransactionsScreen() {
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  const { width, fontScale } = useWindowDimensions();
  // Give the search field the full width before its placeholder gets clipped.
  const narrowSearch = width / Math.max(fontScale, 1) < 360;
  const language = useLanguage();
  const tr = useCallback((key: StringKey) => t(key, language), [language]);
  const trf = useCallback(
    (key: StringKey, vars: Record<string, string | number>) => tf(key, vars, language),
    [language],
  );
  const router = useRouter();
  const { state } = useStore();
  const { period } = usePeriod();
  const {
    source,
    type: typeParam,
    category: categoryParam,
    merchant: merchantParam,
    q: queryParam,
  } = useLocalSearchParams<{
    source?: string;
    type?: string;
    category?: string;
    merchant?: string;
    q?: string;
  }>();
  // One category, or several — Flow's pooled "N more" slice hands over every
  // category behind it, so the drill-down covers exactly what the row totalled.
  const deepCategories = (categoryParam ?? '')
    .split(',')
    .map((c) => CATEGORIES.find((x) => x.id === c.trim())?.id)
    .filter((c): c is CategoryId => !!c);

  const [query, setQuery] = useState(typeof queryParam === 'string' ? queryParam : '');
  useEffect(() => { if (typeof queryParam === 'string') setQuery(queryParam); }, [queryParam]);
  /**
   * The field updates on every keystroke; the FILTER lags it by a beat.
   *
   * Every character was re-running the predicate over the entire ledger and
   * rebuilding every section, so typing a merchant name did that work once per
   * letter. 140ms is under the threshold where a search feels like it is
   * thinking, and it collapses a nine-letter word into one pass.
   */
  const [appliedQuery, setAppliedQuery] = useState(query);
  useEffect(() => {
    const id = setTimeout(() => setAppliedQuery(query), 140);
    return () => clearTimeout(id);
  }, [query]);
  // Insights merchant rows deep-link here scoped to that exact merchant.
  const [merchantFilter, setMerchantFilter] = useState<string | null>(
    typeof merchantParam === 'string' && merchantParam.trim() ? merchantParam.trim() : null,
  );
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    // Insights category drill-down deep-links here pre-filtered
    categories: new Set<CategoryId>(deepCategories),
    // Reviewing an SMS import must show everything even if the app is scoped
    // to a past period: the point of that list is "what just arrived".
    //
    // A drill-down is the opposite. It comes from a row that reads
    // "Groceries · 16% · 1,774" or "Talabat · 640" FOR THE SELECTED PERIOD,
    // and landing on all-time rows shows a list that cannot add up to the
    // figure that was tapped — the whole class of bug this app keeps fixing.
    // The category path was corrected first; the merchant path was left
    // all-time and disagreed exactly the same way, by a factor of five on a
    // busy merchant.
    datePreset: source === 'sms' ? 'all' : 'selected',
    // Home's In/Out figures deep-link here pre-filtered by type.
    //
    // A category or merchant drill-down carries no type, and both of the rows
    // that produce one are SPENDING-only (insights.ts counts categories under
    // isSpending; analytics.ts's topMerchants likewise). Left unscoped, a
    // refund filed under `groceries` was listed and netted off, so a Flow row
    // of 1,774 opened a header of −1,574.
    type:
      typeParam === 'income' || typeParam === 'expense'
        ? typeParam
        // A merchant profile can explicitly request both spending and credits.
        // Legacy category/merchant links remain spending-only unless requested.
        : typeParam === 'all' ? null : deepCategories.length > 0 || merchantParam
          ? 'expense'
          : null,
  }));
  /**
   * The import toast's "Review" arrives as `?source=sms`, and a route param is
   * not something "Clear all filters" can reset. It used to be read straight
   * out of the URL inside the predicate, so the badge counted zero filters, the
   * Clear button could not clear it, and every non-SMS row stayed hidden with
   * nothing on screen saying why. Held as state, it is an ordinary filter:
   * counted, shown as a chip, and clearable like the rest.
   */
  const [smsOnly, setSmsOnly] = useState(source === 'sms');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const listInsets = useScreenContentInsets({ hasFooter: false });

  const todayISO = toISODate(new Date());
  const currentKey = monthKey(new Date());

  const activeFilterCount =
    (filters.type ? 1 : 0) +
    (filters.accountId ? 1 : 0) +
    (filters.categories.size > 0 ? 1 : 0) +
    (filters.datePreset !== 'selected' ? 1 : 0) +
    (filters.minFils ? 1 : 0) +
    (merchantFilter ? 1 : 0) +
    (smsOnly ? 1 : 0);

  const appliedFilters = useDeferredValue(filters);
  const filterIndex = useMemo(() => createTransactionFilterIndex(state.transactions, language),
    // monthKey follows the current stored salary-day boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.transactions, language, state.monthStartDay]);
  const hasUnassignedIncome = useMemo(() => state.transactions.some(tx => tx.accountId === UNASSIGNED_INCOME_ACCOUNT_ID), [state.transactions]);
  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  // Both legs of a move between the user's own accounts, so the arriving one
  // is not painted as income it never was.
  const internal = useMemo(
    () => internalTransferIds(state.transactions, state.accounts),
    [state.transactions, state.accounts],
  );

  const accountById = useMemo(
    () => new Map(state.accounts.map((a) => [a.id, a] as const)),
    [state.accounts],
  );
  // One stable handler for the whole list. An inline `() => setEditing(item)`
  // is a new function per row per render, which defeats TransactionRow's memo
  // and re-renders every visible row on each keystroke in the search field.
  const openEntry = useCallback((tx: Transaction) => {
    Keyboard.dismiss();
    setEditing(tx);
  }, []);
  const renderRow = useCallback(
    ({ item, index }: { item: Transaction; index: number }) => (
      <View
        style={index > 0 ? [styles.rowDivider, { borderTopColor: theme.cardBorder }] : undefined}>
        <TransactionRow
          transaction={item}
          account={accountById.get(item.accountId)}
          onPress={openEntry}
          internal={internal.has(item.id)}
        />
      </View>
    ),
    [accountById, openEntry, theme.cardBorder, internal],
  );

  const filterOptions = useMemo(() => ({ query: appliedQuery, merchant: merchantFilter, smsOnly, currentKey, period,
    live: liveAccounts, internal }), [appliedQuery, merchantFilter, smsOnly, currentKey, period, liveAccounts, internal]);
  const projection = useMemo(() => projectTransactionFilter(filterIndex, appliedFilters, filterOptions),
    [filterIndex, appliedFilters, filterOptions]);
  const { filtered, totalShown, excluded } = projection;
  // A single ordinary row already displays its amount. Keep a separate total
  // only when it conveys different information (for example a transfer excluded
  // from totals or a category filter showing part of a split purchase).
  const singleRow = filtered.length === 1 ? filtered[0] : null;
  const showResultTotal = filtered.length > 1 ||
    (singleRow !== null && Math.abs(totalShown) !== singleRow.amountFils);
  const resultsPending = appliedFilters !== filters || appliedQuery !== query;
  const sections = useMemo<DaySection[]>(() => appliedFilters.sort === 'largest'
    ? [{ title: tr('largestFirst'), totalFils: totalShown, data: filtered }]
    : projection.days.map(day => ({ title: friendlyDate(day.date, todayISO), totalFils: day.totalFils, data: day.data })),
  [projection, appliedFilters.sort, filtered, todayISO, totalShown, tr]);

  const clearFilters = useCallback(() => {
    setMerchantFilter(null);
    setSmsOnly(false);
    setFilters({ ...DEFAULT_FILTERS, categories: new Set() });
  }, []);

  const transactionResults = useMemo(() => (
        <SectionList
          sections={sections}
          keyExtractor={transactionKey}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={[listInsets.contentContainerStyle, styles.listContent]}
          contentInset={listInsets.contentInset}
          scrollIndicatorInsets={listInsets.scrollIndicatorInsets}
          contentInsetAdjustmentBehavior="automatic"
          ListHeaderComponent={(
            <View style={styles.controls}>


              {/* The restrictions that came from the link that opened this screen.
              Both are removable here, which is the only thing that explains an
              otherwise inexplicably short list. */}
              {(merchantFilter || smsOnly) && (
                <View style={styles.chipRow}>
                  {merchantFilter && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${tr('clearFilter')}: ${merchantFilter}`}
                      onPress={() => setMerchantFilter(null)}
                      style={[styles.merchantChip, { backgroundColor: `${theme.primary}1c` }]}>
                      <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>
                        {merchantFilter}
                      </ThemedText>
                      <Icon name="close" size={13} color={theme.primary} />
                    </Pressable>
                  )}
                  {smsOnly && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${tr('clearFilter')}: ${tr('smsImportsOnly')}`}
                      onPress={() => setSmsOnly(false)}
                      style={[styles.merchantChip, { backgroundColor: `${theme.primary}1c` }]}>
                      <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>
                        {tr('smsImportsOnly')}
                      </ThemedText>
                      <Icon name="close" size={13} color={theme.primary} />
                    </Pressable>
                  )}
                </View>
              )}

              <View testID="transactions-summary" style={styles.summaryRow}>
            {/* Full-width metadata; money and exclusions have their own lines. */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.summaryText}>
              {trf('transactionsCount', {
                count: filtered.length,
                s: filtered.length === 1 ? '' : 's',
              })}
              {filters.datePreset === 'selected' && period.mode !== 'all'
                ? // The dates too, when the month is not a calendar month. A
                  // salary month called "Jun 2026" is 25 Jun – 24 Jul, so
                  // every row under that heading is dated JULY. A user read
                  // that screen and concluded their July payments had gone
                  // missing; they were right there, correctly filed.
                  ` · ${periodLabel(period)}${periodRange(period) ? ` (${periodRange(period)})` : ''}`
                : ''}
              {activeFilterCount > 0
                ? ` · ${trf('activeFiltersCount', {
                    count: activeFilterCount,
                    s: activeFilterCount === 1 ? '' : 's',
                  })}`
                : ''}

            </ThemedText>
            {(showResultTotal || activeFilterCount > 0) && <View style={styles.summaryRight}>
              {showResultTotal && <View testID="transactions-net-total" style={[styles.summaryValue, largeText && styles.summaryValueLarge]}>
                <ThemedText type="small" themeColor="textSecondary">{tr('transactionNetTotal')}</ThemedText>
              <ThemedText
                type="smallBold"
                tabular
                style={{ color: totalShown >= 0 ? theme.income : theme.text }}>
                {totalShown >= 0 ? '+' : '−'}
                {formatAED(Math.abs(totalShown), { decimals: false })}
              </ThemedText>
              </View>}
              {activeFilterCount > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr('clearAllFilters')}
                  hitSlop={8}
                  onPress={clearFilters}>
                  <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>
                    {tr('clearFilter')}
                  </ThemedText>
                </Pressable>
              )}
            </View>}
              {(excluded.transfers > 0 || excluded.hidden > 0) && (
                <ThemedText testID="transactions-exclusions" type="meta" themeColor="textSecondary">
              {excluded.transfers > 0
                ? `${trf('transfersExcluded', {
                    count: excluded.transfers,
                    s: excluded.transfers === 1 ? '' : 's',
                  })}`
                : ''}
              {excluded.hidden > 0
                ? `${excluded.transfers > 0 ? ' · ' : ''}${trf('hiddenAccountsExcluded', { count: excluded.hidden })}`
                : ''}
                </ThemedText>
              )}
              </View>
            </View>
          )}
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={32}
          windowSize={9}
          removeClippedSubviews={Platform.OS === 'android'}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHeader, largeText && styles.sectionHeaderLarge]}>
              <ThemedText type="micro" themeColor="textSecondary">
                {section.title}
              </ThemedText>
              {sections.length > 1 && section.data.length > 1 && <View testID="transaction-day-total"
                style={[styles.summaryValue, largeText && styles.summaryValueLarge]}>
                <ThemedText type="meta" themeColor="textSecondary">{tr('transactionDayTotal')}</ThemedText>
              <ThemedText
                type="small"
                tabular
                style={{ color: section.totalFils >= 0 ? theme.income : theme.textSecondary }}>
                {section.totalFils >= 0 ? '+' : '−'}
                {formatAED(Math.abs(section.totalFils), { decimals: false })}
              </ThemedText>
              </View>}
            </View>
          )}
          renderItem={renderRow}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
                <Icon name="search" size={24} color={theme.textSecondary} strokeWidth={1.7} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {tr('nothingMatches')}
              </ThemedText>
            </View>
          }
        />
  ), [sections, listInsets, largeText, merchantFilter, smsOnly, theme, tr, trf, filtered.length,
    filters.datePreset, period, activeFilterCount, totalShown, showResultTotal, excluded, clearFilters, renderRow]);

  return (
    <>
      <ScreenScaffold
        scroll={false}
        virtualized
        headerMode="native"
        header={{
          title: tr('transactionsTitle'),
          back: { label: tr('back'), onPress: () => router.back() },
          actions: [{
            label: tr('addTransactionTitle'),
            icon: 'plus',
            onPress: () => router.push('/add-transaction'),
          }],
        }}>
        <View style={styles.searchContainer} accessibilityState={{ busy: resultsPending }}>
              <View testID="transaction-search-toolbar" style={[styles.searchToolbar, largeText && styles.searchToolbarLarge, narrowSearch && styles.searchToolbarLarge]}>
                <View style={largeText || narrowSearch ? styles.searchFieldLarge : styles.searchField}>
                  <TextField
                    label={tr('transactionSearchLabel')}
                    accessibilityLabel={tr('searchMerchants')}
                    value={query}
                    onChangeText={setQuery}
                    inputMode="search"
                    returnKeyType="search"
                    placeholder={tr('transactionSearchPlaceholder')}
                    onSubmitEditing={() => Keyboard.dismiss()}
                    leading={<Icon name="search" size={17} color={theme.textSecondary} />}
                    trailing={query.length > 0 ? (
                      <ActionIconButton
                        icon="close"
                        label={tr('clearSearch')}
                        variant="plain"
                        onPress={() => setQuery('')}
                      />
                    ) : undefined}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr('filtersButton')}
                  accessibilityState={{ selected: activeFilterCount > 0 }}
                  hitSlop={6}
                  onPress={() => { Keyboard.dismiss(); setSheetVisible(true); }}
                  style={({ pressed }) => [
                    styles.filterBtn,
                    (largeText || narrowSearch) && styles.filterBtnStacked,
                    {
                      backgroundColor: activeFilterCount > 0
                        ? theme.primary
                        : theme.backgroundSelected,
                      opacity: pressed ? 0.72 : 1,
                    },
                  ]}>
                  <Icon
                    name="filter"
                    size={17}
                    color={activeFilterCount > 0 ? theme.onPrimary : theme.text}
                  />
                </Pressable>
              </View>
          {resultsPending && <ThemedText type="meta" accessibilityLiveRegion="polite">{tr('filterUpdating')}</ThemedText>}
        </View>
        {transactionResults}
      </ScreenScaffold>

      {sheetVisible && <TransactionFilterSheet initialFilters={filters} resetFilters={DEFAULT_FILTERS}
        accounts={state.accounts} hasUnassignedIncome={hasUnassignedIncome} index={filterIndex} options={filterOptions}
        onClose={() => setSheetVisible(false)} onApply={(nextFilters, resetScope) => {
          if (resetScope) { setMerchantFilter(null); setSmsOnly(false); }
          setFilters(nextFilters);
          setSheetVisible(false);
        }} />}

      <EntryDetailSheet transaction={editing} onClose={() => setEditing(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  // Screen sections have a gap; virtualized header/row/footer cells must not.
  listContent: { gap: 0 },
  searchContainer: { paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two, gap: Spacing.one },
  filterBtnStacked: { alignSelf: 'flex-end' },
  filterBtn: {
    width: 48,
    height: 48,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    gap: Spacing.two,
    paddingBottom: Spacing.one,
  },
  searchToolbar: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  searchToolbarLarge: { flexDirection: 'column', alignItems: 'stretch' },
  searchField: { flex: 1, minWidth: 0 },
  searchFieldLarge: { width: '100%' },
  summaryRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: Spacing.two,
  },
  summaryValue: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, minWidth: 0, flexShrink: 1 },
  summaryValueLarge: { flexDirection: 'column', alignItems: 'flex-start' },
  summaryText: {
    flexShrink: 1,
  },
  merchantChip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: 6,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 1,
    borderRadius: Radius.full,
  },
  summaryRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    minWidth: 0,
  },
  sectionHeaderLarge: { flexDirection: 'column', alignItems: 'flex-start' },
  sectionHeader: {
    flexWrap: 'wrap',
    gap: Spacing.two,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  }
});
