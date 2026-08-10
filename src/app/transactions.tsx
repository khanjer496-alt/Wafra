import { useLocalSearchParams, useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { TransactionRow } from '@/components/transaction-row';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Icon } from '@/components/ui/icon';
import { CategoryChips } from '@/components/ui/category-chips';
import { Button, Chip } from '@/components/ui/controls';
import { Fonts, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { categoryLabel, CATEGORIES, EXPENSE_CATEGORIES, getCategory } from '@/lib/categories';
import { formatAED, friendlyDate, monthKey, shiftMonthKey, shortDate, toISODate } from '@/lib/format';
import { inPeriod, periodLabel, periodRange } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { countsInTotals, internalTransferIds, liveAccountIds } from '@/lib/ledger';
import { amountInCategories, touchesCategories } from '@/lib/splits';
import { tapped } from '@/lib/haptics';
import { useStore } from '@/lib/store';
import type { CategoryId, Transaction, TransactionType } from '@/lib/types';
import { t, tf, type StringKey } from '@/lib/i18n';

type DatePreset = 'selected' | 'all' | 'month' | 'lastMonth' | '3months' | 'custom';
type SortMode = 'newest' | 'oldest' | 'largest';

interface Filters {
  type: TransactionType | null;
  accountId: string | null;
  categories: Set<CategoryId>;
  datePreset: DatePreset;
  /** Inclusive ISO bounds, used only when datePreset is 'custom'. */
  dateFrom: string | null;
  dateTo: string | null;
  minFils: number | null;
  sort: SortMode;
}

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
  } = useLocalSearchParams<{
    source?: string;
    type?: string;
    category?: string;
    merchant?: string;
  }>();
  // One category, or several — Flow's pooled "N more" slice hands over every
  // category behind it, so the drill-down covers exactly what the row totalled.
  const deepCategories = (categoryParam ?? '')
    .split(',')
    .map((c) => CATEGORIES.find((x) => x.id === c.trim())?.id)
    .filter((c): c is CategoryId => !!c);

  const [query, setQuery] = useState('');
  /**
   * The field updates on every keystroke; the FILTER lags it by a beat.
   *
   * Every character was re-running the predicate over the entire ledger and
   * rebuilding every section, so typing a merchant name did that work once per
   * letter. 140ms is under the threshold where a search feels like it is
   * thinking, and it collapses a nine-letter word into one pass.
   */
  const [appliedQuery, setAppliedQuery] = useState('');
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
        : deepCategories.length > 0 || merchantParam
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
  /** Which end of the custom range is currently open in the native picker. */
  const [picking, setPicking] = useState<'dateFrom' | 'dateTo' | null>(null);
  /**
   * What is typed into the range boxes on web, where there is no picker.
   *
   * `@react-native-community/datetimepicker` has no web implementation — it
   * warns and renders null — so tapping From or To set `picking` and produced
   * nothing at all, and "Date range" was the one preset that could not be
   * used. Kept separate from `filters` so a half-typed date does not
   * repeatedly re-filter the ledger; the bound moves only once the text is a
   * whole ISO date.
   */
  const [rangeDraft, setRangeDraft] = useState({ dateFrom: '', dateTo: '' });
  const [editing, setEditing] = useState<Transaction | null>(null);

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

  const filtered = useMemo(() => {
    const q = appliedQuery.trim().toLowerCase();
    const lastKey = shiftMonthKey(currentKey, -1);
    const threeKey = shiftMonthKey(currentKey, -2);
    const merchantKey = merchantFilter?.toLowerCase();
    let list = state.transactions.filter((t) => {
      if (smsOnly && t.source !== 'sms') return false;
      if (merchantKey && t.title.trim().toLowerCase() !== merchantKey) return false;
      if (filters.type && t.type !== filters.type) return false;
      if (filters.accountId && t.accountId !== filters.accountId) return false;
      // Every PART of a split row, not just its headline category. Testing
      // `t.category` dropped the AED 100 groceries share of a mostly-dining
      // charge out of the groceries drill-down entirely, while Flow's slice —
      // which reads allocations — had counted it.
      if (filters.categories.size > 0 && !touchesCategories(t, filters.categories)) return false;
      if (filters.minFils && t.amountFils < filters.minFils) return false;
      const k = monthKey(t.date);
      if (filters.datePreset === 'selected' && !inPeriod(t.date, period)) return false;
      if (filters.datePreset === 'month' && k !== currentKey) return false;
      if (filters.datePreset === 'lastMonth' && k !== lastKey) return false;
      // Bounded at BOTH ends. Only the older one was checked, so a bill dated
      // next month was listed — and totalled — under "Last 3 months".
      if (filters.datePreset === '3months' && (k < threeKey || k > currentKey)) return false;
      // Inclusive on both ends: someone asking for 1-31 Jan means to see the
      // 31st. ISO dates compare correctly as strings, so no parsing needed.
      if (filters.datePreset === 'custom') {
        if (filters.dateFrom && t.date < filters.dateFrom) return false;
        if (filters.dateTo && t.date > filters.dateTo) return false;
      }
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        getCategory(t.category).label.toLowerCase().includes(q) ||
        categoryLabel(t.category, language).toLowerCase().includes(q)
      );
    });
    if (filters.sort === 'largest') {
      list = [...list].sort((a, b) => b.amountFils - a.amountFils);
    } else if (filters.sort === 'oldest') {
      // Sorted, not reversed. The store orders by `date` alone (store.tsx,
      // sortTxs), so reversing put the day's rows in reverse IMPORT order —
      // a coffee at 08:00 below a dinner at 21:00 under "Oldest first". Sort
      // by the alert timestamp where there is one, which is the only thing
      // that knows the order within a day.
      list = [...list].sort(
        (a, b) =>
          (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
          (a.ts ?? Date.parse(`${a.date}T12:00:00Z`)) -
            (b.ts ?? Date.parse(`${b.date}T12:00:00Z`)),
      );
    }
    return list;
  }, [
    state.transactions,
    appliedQuery,
    filters,
    smsOnly,
    merchantFilter,
    currentKey,
    period,
    language,
  ]);

  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  // Both legs of a move between the user's own accounts, so the arriving one
  // is not painted as income it never was.
  const internal = useMemo(
    () => internalTransferIds(state.transactions, liveAccounts),
    [state.transactions, liveAccounts],
  );

  const accountById = useMemo(
    () => new Map(state.accounts.map((a) => [a.id, a] as const)),
    [state.accounts],
  );
  // One stable handler for the whole list. An inline `() => setEditing(item)`
  // is a new function per row per render, which defeats TransactionRow's memo
  // and re-renders every visible row on each keystroke in the search field.
  const openEntry = useCallback((tx: Transaction) => setEditing(tx), []);
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

  /**
   * A row that moves money in or out of the user's world, as opposed to
   * around inside it.
   *
   * `isTransfer` alone is not enough and this screen learned that the hard
   * way: only the LEAVING side of an own-account move carries the flag, so
   * the arriving side — worded by the bank exactly like being paid — was
   * added to the total while its twin was skipped. Moving AED 20,000 between
   * two of your own accounts read as AED 20,000 earned.
   *
   * Asked of ledger.ts rather than spelled out here, which is the point of
   * that file. The local spelling was missing the live-account check every
   * other total in the app applies, so archiving a card removed its AED 4,000
   * from Home's "Out" and left it in the header of the screen Home links to:
   * tap 12,000, land on −16,000.
   */
  const counts = useCallback(
    (t: Transaction) => countsInTotals(t, liveAccounts, internal),
    [liveAccounts, internal],
  );

  /**
   * What one row adds to the total above it — signed, and scoped to the
   * category filter when there is one.
   *
   * The scoping is the second half of the split fix. A AED 500 charge split
   * 400 groceries / 100 dining belongs in the groceries list, but only its
   * 400 belongs in the groceries TOTAL; adding the whole 500 put the header
   * AED 100 above the Flow row that was tapped to get here.
   */
  const contribution = useCallback(
    (t: Transaction) => {
      if (!counts(t)) return 0;
      const fils =
        filters.categories.size > 0 ? amountInCategories(t, filters.categories) : t.amountFils;
      return t.type === 'expense' ? -fils : fils;
    },
    [counts, filters.categories],
  );

  const totalShown = useMemo(
    () => filtered.reduce((s, t) => s + contribution(t), 0),
    [filtered, contribution],
  );

  // Transfers are listed — they are real records and the user wants to find
  // them — but they are money moving between your own accounts, so they do
  // not count toward a total. The two were silently disagreeing: Home's
  // "In AED 25,000" links here, a AED 3,000 card payment is an income-side
  // transfer, and the header read 25,000 above rows summing to 28,000. The
  // rule is stated now rather than left for the user to work out.
  //
  // Rows on a hidden account are the same shape of exception and get their own
  // half of the caption: they stay listed, because searching for an old charge
  // should still find it, but they are out of every other total in the app and
  // so are out of this one.
  const excluded = useMemo(() => {
    let transfers = 0;
    let hidden = 0;
    for (const t of filtered) {
      if (counts(t)) continue;
      if (liveAccounts.has(t.accountId)) transfers += 1;
      else hidden += 1;
    }
    return { transfers, hidden };
  }, [filtered, counts, liveAccounts]);

  const sections = useMemo<DaySection[]>(() => {
    if (filters.sort === 'largest') {
      return [{ title: tr('largestFirst'), totalFils: totalShown, data: filtered }];
    }
    const byDay = new Map<string, Transaction[]>();
    for (const t of filtered) {
      const list = byDay.get(t.date) ?? [];
      list.push(t);
      byDay.set(t.date, list);
    }
    return [...byDay.entries()].map(([date, data]) => ({
      title: friendlyDate(date, todayISO),
      totalFils: data.reduce((s, t) => s + contribution(t), 0),
      data,
    }));
  }, [filtered, filters.sort, todayISO, totalShown, contribution, tr]);

  const toggleCategory = (id: CategoryId) => {
    setFilters((current) => {
      const next = new Set(current.categories);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, categories: next };
    });
  };

  const clearFilters = () => {
    setMerchantFilter(null);
    // Including the one that arrived as a route param. "Clear all" that leaves
    // a restriction in place is worse than no button.
    setSmsOnly(false);
    setRangeDraft({ dateFrom: '', dateTo: '' });
    setFilters({ ...DEFAULT_FILTERS, categories: new Set() });
  };

  const presetLabel: Record<DatePreset, string> = {
    selected: period.mode === 'all' ? tr('selectedPeriod') : periodLabel(period),
    all: tr('allTime'),
    month: tr('thisMonth'),
    lastMonth: tr('lastMonth'),
    '3months': tr('lastThreeMonths'),
    custom: tr('dateRange'),
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('back')}
            hitSlop={6}
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: theme.backgroundSelected }]}>
            <Icon name="chevron-left" size={18} color={theme.text} />
          </Pressable>
          <ThemedText type="heading" accessibilityRole="header" style={styles.headerTitle}>
            {tr('transactionsTitle')}
          </ThemedText>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('addCashEntry')}
              hitSlop={6}
              onPress={() => {
                tapped();
                router.push('/add-transaction');
              }}
              style={[styles.backBtn, { backgroundColor: theme.backgroundElement }]}>
              <Icon name="plus" size={17} color={theme.textSecondary} />
            </Pressable>
            {/* Filters, and it has to LOOK like filters. This button wore the
                `chart` glyph — pixel-for-pixel the Flow tab's own icon — so the
                one control on the screen that opens a filter sheet advertised
                Stats instead. A funnel, not `sliders`: that one already means
                Settings from Home and from Wallet, and one glyph cannot mean
                two things. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('filtersButton')}
              accessibilityState={{ selected: activeFilterCount > 0 }}
              hitSlop={6}
              onPress={() => setSheetVisible(true)}
              style={[
                styles.backBtn,
                { backgroundColor: activeFilterCount > 0 ? theme.primary : theme.backgroundSelected },
              ]}>
              <Icon
                name="filter"
                size={17}
                color={activeFilterCount > 0 ? theme.onPrimary : theme.text}
              />
            </Pressable>
          </View>
        </View>

        <View style={styles.controls}>
          <View
            style={[
              styles.searchBox,
              { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder },
            ]}>
            <Icon name="search" size={17} color={theme.textSecondary} />
            <TextInput
              accessibilityLabel={tr('searchMerchants')}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              placeholder={tr('searchMerchants')}
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.searchInput,
                { color: theme.text, textAlign: language === 'ar' ? 'right' : 'left' },
              ]}
            />
            {query.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr('clearSearch')}
                hitSlop={12}
                onPress={() => setQuery('')}>
                <Icon name="close" size={16} color={theme.textSecondary} />
              </Pressable>
            )}
          </View>

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
                  <ThemedText type="small" style={{ color: theme.primary, fontFamily: Fonts.sansSemi }}>
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
                  <ThemedText type="small" style={{ color: theme.primary, fontFamily: Fonts.sansSemi }}>
                    {tr('smsImportsOnly')}
                  </ThemedText>
                  <Icon name="close" size={13} color={theme.primary} />
                </Pressable>
              )}
            </View>
          )}

          <View style={styles.summaryRow}>
            {/* Takes the space that is left, and no more. Without a flex
                constraint this line expanded to whatever it needed, wrapped
                to two lines, and shoved the total clean off the right edge of
                the screen — the user saw "+A" and nothing else. */}
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
              {excluded.transfers > 0
                ? ` · ${trf('transfersExcluded', {
                    count: excluded.transfers,
                    s: excluded.transfers === 1 ? '' : 's',
                  })}`
                : ''}
              {excluded.hidden > 0
                ? ` · ${trf('hiddenAccountsExcluded', { count: excluded.hidden })}`
                : ''}
            </ThemedText>
            <View style={styles.summaryRight}>
              <ThemedText
                type="smallBold"
                tabular
                style={{ color: totalShown >= 0 ? theme.income : theme.text }}>
                {totalShown >= 0 ? '+' : '−'}
                {formatAED(Math.abs(totalShown), { decimals: false })}
              </ThemedText>
              {activeFilterCount > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr('clearAllFilters')}
                  hitSlop={8}
                  onPress={clearFilters}>
                  <ThemedText type="small" style={{ color: theme.primary, fontFamily: Fonts.sansSemi }}>
                    {tr('clearFilter')}
                  </ThemedText>
                </Pressable>
              )}
            </View>
          </View>
        </View>

        <SectionList
          sections={sections}
          keyExtractor={transactionKey}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={32}
          windowSize={9}
          removeClippedSubviews={Platform.OS === 'android'}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <ThemedText type="micro" themeColor="textSecondary">
                {section.title}
              </ThemedText>
              <ThemedText
                type="small"
                tabular
                style={{ color: section.totalFils >= 0 ? theme.income : theme.textSecondary }}>
                {section.totalFils >= 0 ? '+' : '−'}
                {formatAED(Math.abs(section.totalFils), { decimals: false })}
              </ThemedText>
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
      </SafeAreaView>

      {/* Filter sheet */}
      <BottomSheet
        visible={sheetVisible}
        title={tr('filtersTitle')}
        onClose={() => setSheetVisible(false)}>
        <View style={styles.filterGroup}>
          <ThemedText type="micro" themeColor="textSecondary">
            {tr('typeFilter')}
          </ThemedText>
          <View style={styles.chipRow}>
            {([null, 'expense', 'income'] as (TransactionType | null)[]).map((type) => {
              const label =
                type === null
                  ? tr('allWord')
                  : type === 'expense'
                    ? `− ${tr('expenseLabel')}`
                    : `+ ${tr('incomeLabel')}`;
              return (
                <Chip
                  key={String(type)}
                  label={label}
                  active={filters.type === type}
                  onPress={() => setFilters((current) => ({ ...current, type }))}
                />
              );
            })}
          </View>
        </View>

        <View style={styles.filterGroup}>
          <ThemedText type="micro" themeColor="textSecondary">
            {tr('periodFilter')}
          </ThemedText>
          <View style={styles.chipRow}>
            {(Object.keys(presetLabel) as DatePreset[]).map((preset) => (
              <Chip
                key={preset}
                label={presetLabel[preset]}
                active={filters.datePreset === preset}
                onPress={() =>
                  setFilters((current) => ({ ...current, datePreset: preset }))
                }
              />
            ))}
          </View>

          {filters.datePreset === 'custom' && (
            <View style={styles.rangeRow}>
              {(['dateFrom', 'dateTo'] as const).map((field) => {
                const label = field === 'dateFrom' ? tr('fromLabel') : tr('toLabel');
                return (
                  <View key={field} style={styles.rangeColumn}>
                    <ThemedText type="micro" themeColor="textSecondary">
                      {label}
                    </ThemedText>
                    {Platform.OS === 'web' ? (
                      // Typed, because there is no picker to open here. The
                      // bound only moves on a complete ISO date, so the list
                      // is not re-filtered against "2026-0".
                      <TextInput
                        accessibilityLabel={`${label}: ${
                          filters[field] ? shortDate(filters[field]!) : tr('anyLabel')
                        }`}
                        value={rangeDraft[field]}
                        onChangeText={(text) => {
                          setRangeDraft((current) => ({ ...current, [field]: text }));
                          const iso = text.trim();
                          const whole = /^\d{4}-\d{2}-\d{2}$/.test(iso);
                          if (whole || iso === '') {
                            setFilters((current) => ({ ...current, [field]: whole ? iso : null }));
                          }
                        }}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={theme.textSecondary}
                        inputMode="numeric"
                        style={[
                          styles.rangeInput,
                          styles.rangeTextInput,
                          { backgroundColor: theme.backgroundSelected, color: theme.text },
                        ]}
                      />
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${label}: ${
                          filters[field] ? shortDate(filters[field]!) : tr('anyLabel')
                        }`}
                        onPress={() => setPicking(field)}
                        style={[styles.rangeInput, { backgroundColor: theme.backgroundSelected }]}>
                        <ThemedText
                          type="small"
                          themeColor={filters[field] ? 'text' : 'textSecondary'}>
                          {filters[field] ? shortDate(filters[field]!) : tr('anyLabel')}
                        </ThemedText>
                      </Pressable>
                    )}
                  </View>
                );
              })}
              {filters.dateFrom || filters.dateTo ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr('clearFilter')}
                  onPress={() => {
                    setRangeDraft({ dateFrom: '', dateTo: '' });
                    setFilters((current) => ({
                      ...current,
                      dateFrom: null,
                      dateTo: null,
                    }));
                  }}
                  style={styles.rangeClear}
                  hitSlop={8}>
                  <ThemedText type="small" style={{ color: theme.primary }}>
                    {tr('clearFilter')}
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          )}
          {/* Never mounted on web: the package has no web build, so this
              renders null after a console warning. The typed fields above are
              the web path. */}
          {picking !== null && Platform.OS !== 'web' && (
            <DateTimePicker
              mode="date"
              display="calendar"
              value={filters[picking] ? new Date(`${filters[picking]}T12:00:00`) : new Date()}
              minimumDate={
                picking === 'dateTo' && filters.dateFrom
                  ? new Date(`${filters.dateFrom}T12:00:00`)
                  : undefined
              }
              maximumDate={
                picking === 'dateFrom' && filters.dateTo
                  ? new Date(`${filters.dateTo}T12:00:00`)
                  : new Date()
              }
              onChange={(event, picked) => {
                const field = picking;
                setPicking(null);
                if (event.type !== 'set' || !picked || !field) return;
                setFilters((current) => ({ ...current, [field]: toISODate(picked) }));
              }}
            />
          )}
        </View>

        <View style={styles.filterGroup}>
          <ThemedText type="micro" themeColor="textSecondary">
            {tr('accountFilter')}
          </ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRowScroll}>
            <Chip
              label={tr('allWord')}
              active={!filters.accountId}
              onPress={() => setFilters((current) => ({ ...current, accountId: null }))}
            />
            {state.accounts.map((account) => (
              <Chip
                key={account.id}
                label={account.name}
                active={filters.accountId === account.id}
                onPress={() =>
                  setFilters((current) => ({
                    ...current,
                    accountId: current.accountId === account.id ? null : account.id,
                  }))
                }
              />
            ))}
          </ScrollView>
        </View>

        <View style={styles.filterGroup}>
          <ThemedText type="micro" themeColor="textSecondary">
            {tr('categoriesFilter')}
          </ThemedText>
          <CategoryChips
            categories={EXPENSE_CATEGORIES}
            selected={filters.categories}
            onToggle={toggleCategory}
            layout="wrap"
          />
        </View>

        <View style={styles.filterGroup}>
          <ThemedText type="micro" themeColor="textSecondary">
            {tr('minimumAmountFilter')}
          </ThemedText>
          <View style={styles.chipRow}>
            {[null, 10000, 50000, 100000].map((value) => (
              <Chip
                key={String(value)}
                label={value === null ? tr('anyLabel') : `${value / 100}+`}
                active={filters.minFils === value}
                onPress={() =>
                  setFilters((current) => ({ ...current, minFils: value }))
                }
              />
            ))}
          </View>
        </View>

        <View style={styles.filterGroup}>
          <ThemedText type="micro" themeColor="textSecondary">
            {tr('sortFilter')}
          </ThemedText>
          <View style={styles.chipRow}>
            {(['newest', 'oldest', 'largest'] as SortMode[]).map((sort) => (
              <Chip
                key={sort}
                label={
                  sort === 'newest'
                    ? tr('newest')
                    : sort === 'oldest'
                      ? tr('oldest')
                      : tr('largest')
                }
                active={filters.sort === sort}
                onPress={() => setFilters((current) => ({ ...current, sort }))}
              />
            ))}
          </View>
        </View>

        <View style={styles.sheetActions}>
          <Button inline variant="outline" label={tr('reset')} onPress={clearFilters} />
          <Button
            inline
            label={trf('showResults', {
              count: filtered.length,
              s: filtered.length === 1 ? '' : 's',
            })}
            onPress={() => setSheetVisible(false)}
          />
        </View>
      </BottomSheet>

      <EntryDetailSheet transaction={editing} onClose={() => setEditing(null)} />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerTitle: { flex: 1 },
  headerActions: { flexDirection: 'row', gap: Spacing.one },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    paddingVertical: Spacing.two + 4,
    fontSize: 14,
    fontFamily: Fonts.sansMedium,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
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
    // The figure is the point of the row; it never gives up space.
    flexShrink: 0,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
  },
  sectionHeader: {
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
  filterGroup: {
    gap: Spacing.two,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.two,
  },
  rangeColumn: {
    flex: 1,
    gap: Spacing.one,
  },
  rangeInput: {
    minHeight: 44,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two + 2,
    justifyContent: 'center',
  },
  rangeTextInput: {
    fontSize: 14,
    fontFamily: Fonts.sansMedium,
  },
  rangeClear: {
    minHeight: 44,
    justifyContent: 'flex-end',
    paddingBottom: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chipRowScroll: {
    gap: Spacing.two,
    paddingBottom: Spacing.one,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
});
