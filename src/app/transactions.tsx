import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  InteractionManager,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ThemedText } from '@/components/themed-text';
import { EntryDetailSheet, type EntryDetailMode } from '@/components/entry-detail-sheet';
import { SwipeRow, type SwipeAction } from '@/components/swipe-row';
import { TransactionRow } from '@/components/transaction-row';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Chip } from '@/components/ui/controls';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { TransactionFilterSheet } from '@/components/transaction-filter-sheet';
import { Icon } from '@/components/ui/icon';
import { ScreenScaffold, useScreenContentInsets } from '@/components/ui/screen-scaffold';
import { TextField } from '@/components/ui/text-field';
import { Fonts, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { CATEGORIES } from '@/lib/categories';
import { formatAED, formatAmount, friendlyDate, monthKey, toISODate } from '@/lib/format';
import { periodLabel, periodRange } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import {
  accountDisplayName,
  corroboratingTransferIdsForState,
  internalTransferIdsForState,
  isTransfer as isLedgerTransfer,
  isUnassignedIncome,
  liveAccountIds,
  UNASSIGNED_INCOME_ACCOUNT_ID,
  UNASSIGNED_TRANSACTION_ACCOUNT_ID,
} from '@/lib/ledger';
import { createTransactionFilterIndex, projectTransactionFilter, type TransactionFilters as Filters } from '@/lib/transaction-filter';
import { TRANSACTION_SOURCE_KINDS, transactionSource, type TransactionSourceKind } from '@/lib/transaction-source';
import { transactionsWords } from '@/lib/transactions-copy';
import { getTransferActivity } from '@/lib/transfer-activity';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { isTransferCandidate, reconcileTransfers, transferOwnership } from '@/lib/transfer-reconciliation';
import { useStoreActions, useStoreSelector } from '@/lib/store';
import { historyStatusOnly } from '@/lib/store-selection';
import type { Account, CategoryId, Transaction } from '@/lib/types';
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
  maxFils: null,
  sources: new Set<TransactionSourceKind>(),
  kind: null,
};

type TypeChip = 'all' | 'spending' | 'income' | 'transfers' | 'review';
const TYPE_CHIPS: readonly TypeChip[] = ['all', 'spending', 'income', 'transfers', 'review'];
const chipOf = (filters: Filters): TypeChip => filters.kind === 'transfers' ? 'transfers'
  : filters.kind === 'review' ? 'review'
    : filters.type === 'expense' ? 'spending' : filters.type === 'income' ? 'income' : 'all';
/** One chip is one filter: direction chips set `type`, the others set `kind`. */
const withChip = (filters: Filters, chip: TypeChip): Filters => ({
  ...filters,
  type: chip === 'spending' ? 'expense' : chip === 'income' ? 'income' : null,
  kind: chip === 'transfers' ? 'transfers' : chip === 'review' ? 'review' : null,
});

interface DaySection {
  title: string;
  totalFils: number;
  data: Transaction[];
}

const transactionKey = (transaction: Transaction) => transaction.id;

/**
 * Rows the Transfers screen owns, and transfer legs still waiting for their
 * other side, found by a full transfer reconciliation (100–300 ms on a phone
 * at 15k rows). Remembered per ledger so reopening the screen is instant; once
 * the screen is showing, a ledger change recomputes after interactions settle
 * and keeps the previous answer meanwhile, instead of freezing the list on
 * every edit, capture or history-import page.
 */
type TransferScope = { separateTransferIds: ReadonlySet<string>; pendingTransferIds: ReadonlySet<string> };
let transferScopeCache: { transactions: Transaction[]; accounts: Account[]; scope: TransferScope } | null = null;

function computeTransferScope(transactions: Transaction[], accounts: Account[]): TransferScope {
  if (transferScopeCache?.transactions === transactions && transferScopeCache.accounts === accounts) {
    return transferScopeCache.scope;
  }
  const reconciliation = reconcileTransfers(transactions, accounts);
  const scope: TransferScope = {
    separateTransferIds: new Set(getTransferActivity(transactions, accounts, reconciliation)
      .map(item => item.transaction.id)),
    pendingTransferIds: reconciliation.pendingIds,
  };
  transferScopeCache = { transactions, accounts, scope };
  return scope;
}

function useTransferScope(
  transactions: Transaction[], accounts: Account[], importing: boolean,
): TransferScope {
  const [scope, setScope] = useState(() => computeTransferScope(transactions, accounts));
  useEffect(() => {
    // A running history import replaces its page within moments; the page
    // that ends the run (complete, paused or failed) triggers the recompute.
    if (importing) return;
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) setScope(computeTransferScope(transactions, accounts));
    });
    return () => { cancelled = true; task.cancel(); };
  }, [transactions, accounts, importing]);
  return scope;
}

export default function TransactionsScreen() {
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  const { width, fontScale } = useWindowDimensions();
  // Give the search field the full width before its placeholder gets clipped.
  const narrowSearch = width / Math.max(fontScale, 1) < 360;
  const language = useLanguage();
  const transferWords = transferActivityCopy(language);
  const words = transactionsWords(language);
  const tr = useCallback((key: StringKey) => t(key, language), [language]);
  const trf = useCallback(
    (key: StringKey, vars: Record<string, string | number>) => tf(key, vars, language),
    [language],
  );
  const router = useRouter();
  // Only what the list reads; scan timestamps and import progress no longer
  // re-render a 20k-row screen.
  const state = useStoreSelector(({ state: s }) => ({
    transactions: s.transactions, accounts: s.accounts, monthStartDay: s.monthStartDay,
    transferInternalIds: s.transferInternalIds, transferNormalizationVersion: s.transferNormalizationVersion,
    historyImport: historyStatusOnly(s.historyImport), ledgerMoney: s.ledgerMoney,
  }));
  const { deleteTransaction } = useStoreActions();
  const { period } = usePeriod();
  const {
    source,
    type: typeParam,
    category: categoryParam,
    merchant: merchantParam,
    q: queryParam,
    account: accountParam,
  } = useLocalSearchParams<{
    source?: string;
    type?: string;
    category?: string;
    merchant?: string;
    q?: string;
    /** `/transactions?account=<id>` from an account: that account, all time. */
    account?: string;
  }>();
  const accountFromLink = typeof accountParam === 'string' && accountParam.trim() ? accountParam.trim() : null;
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
    datePreset: source === 'sms' || accountFromLink ? 'all' : 'selected',
    accountId: accountFromLink,
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
  // Rows auto-added from an unverified bank-alert format, still unchecked.
  // `?source=auto-added` (Review's link) opens the list already scoped.
  const [autoAddedOnly, setAutoAddedOnly] = useState(source === 'auto-added');
  const autoAddedCount = useMemo(() => state.transactions.reduce((n, tx) => (tx.bestEffort ? n + 1 : n), 0),
    [state.transactions]);
  const autoAddedActive = autoAddedOnly && autoAddedCount > 0;
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [entryMode, setEntryMode] = useState<EntryDetailMode>('read');
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  // A later account link (same screen, new param) scopes to that account.
  useEffect(() => {
    if (!accountFromLink) return;
    setFilters((current) => current.accountId === accountFromLink ? current
      : { ...current, accountId: accountFromLink, datePreset: 'all' });
  }, [accountFromLink]);
  const pendingFilterFrame = useRef<number | null>(null);
  const listInsets = useScreenContentInsets({ hasFooter: false });

  useEffect(() => () => {
    if (pendingFilterFrame.current !== null) cancelAnimationFrame(pendingFilterFrame.current);
  }, []);

  const todayISO = toISODate(new Date());
  const currentKey = monthKey(new Date());

  const activeFilterCount =
    (filters.type || filters.kind ? 1 : 0) +
    (filters.maxFils ? 1 : 0) +
    (filters.sources && filters.sources.size > 0 ? 1 : 0) +
    (filters.accountId ? 1 : 0) +
    (filters.categories.size > 0 ? 1 : 0) +
    (filters.datePreset !== 'selected' ? 1 : 0) +
    (filters.minFils ? 1 : 0) +
    (merchantFilter ? 1 : 0) +
    (smsOnly ? 1 : 0) +
    (autoAddedActive ? 1 : 0);

  const appliedFilters = useDeferredValue(filters);
  // Search also matches the account a row belongs to.
  const accountNames = useMemo(() => new Map(state.accounts.map((account) => [account.id,
    [account.name, account.bankName].filter(Boolean).join(' ')] as const)), [state.accounts]);
  const filterIndex = useMemo(() => createTransactionFilterIndex(state.transactions, language, accountNames),
    // monthKey follows the current stored salary-day boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.transactions, language, state.monthStartDay, accountNames]);
  const hasUnassignedIncome = useMemo(() => state.transactions.some(tx => tx.accountId === UNASSIGNED_INCOME_ACCOUNT_ID), [state.transactions]);
  // Only the sources this ledger actually has, in display order.
  const sourceKinds = useMemo(() => {
    const present = new Set<TransactionSourceKind>();
    for (const tx of state.transactions) present.add(transactionSource(tx));
    return TRANSACTION_SOURCE_KINDS.filter((kind) => present.has(kind));
  }, [state.transactions]);
  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  // Both legs of a move between the user's own accounts, so the arriving one
  // is not painted as income it never was.
  const internal = internalTransferIdsForState(state);
  const corroborating = corroboratingTransferIdsForState(state);
  // Rows the Transfers screen owns and pending transfer legs, from one full
  // reconciliation that is cached per ledger and refreshed after interactions.
  const { separateTransferIds, pendingTransferIds } = useTransferScope(state.transactions, state.accounts,
    state.historyImport?.status === 'running');
  // The Transfers and Needs review chips, from the predicates the rows and
  // the review screens already use: one pass over the ledger.
  const { transferIds, reviewIds } = useMemo(() => {
    const transfers = new Set<string>();
    const review = new Set<string>();
    for (const row of state.transactions) {
      if (isLedgerTransfer(row) || internal.has(row.id) || separateTransferIds.has(row.id) || isTransferCandidate(row)) transfers.add(row.id);
      if (row.bestEffort || pendingTransferIds.has(row.id) ||
        isUnassignedIncome(row) || row.accountId === UNASSIGNED_TRANSACTION_ACCOUNT_ID) review.add(row.id);
    }
    return { transferIds: transfers, reviewIds: review };
  }, [state.transactions, internal, separateTransferIds, pendingTransferIds]);

  const accountById = useMemo(
    () => new Map(state.accounts.map((a) => [a.id, a] as const)),
    [state.accounts],
  );
  // Rows keep one stable action builder; the router object itself may not be stable.
  const routerRef = useRef(router);
  routerRef.current = router;
  const accountLabelFor = (id: string) => {
    const account = accountById.get(id);
    return account ? accountDisplayName(account) : tr('incomeAccountReview');
  };
  // One stable handler for the whole list. An inline `() => setEditing(item)`
  // is a new function per row per render, which defeats TransactionRow's memo
  // and re-renders every visible row on each keystroke in the search field.
  const openEntry = useCallback((tx: Transaction) => {
    Keyboard.dismiss();
    setEntryMode('read');
    setEditing(tx);
  }, []);
  /**
   * Row actions, by swipe or by the screen reader's actions menu. None acts
   * silently: Category and Transfer open the entry sheet in that state (a
   * transfer still unresolved opens its review), Delete asks first.
   */
  const rowActions = useCallback((tx: Transaction) => {
    const confirmedTransfer = isLedgerTransfer(tx) || internal.has(tx.id) || transferOwnership(tx) === 'own';
    const candidate = isTransferCandidate(tx);
    const actions: SwipeAction[] = [];
    if (!confirmedTransfer && !candidate) {
      actions.push({ name: 'category', label: words.category, icon: 'receipt',
        onPress: () => { Keyboard.dismiss(); setEntryMode('category'); setEditing(tx); } });
    }
    if (!confirmedTransfer) {
      actions.push({ name: 'transfer', label: words.transfer, icon: 'repeat',
        onPress: () => {
          Keyboard.dismiss();
          if (candidate) routerRef.current.push({ pathname: '/review-transfers', params: { transactionId: tx.id } });
          else { setEntryMode('transfer'); setEditing(tx); }
        } });
    }
    actions.push({ name: 'delete', label: words.delete, icon: 'trash', destructive: true,
      onPress: () => { Keyboard.dismiss(); setDeleting(tx); } });
    return actions;
  }, [internal, words]);
  // One stable action set per row object, so a search keystroke does not hand
  // every visible TransactionRow new props and defeat its memo.
  const rowActionCache = useMemo(() => new WeakMap<Transaction, {
    actions: SwipeAction[];
    spoken: { name: string; label: string }[];
    onAction: (name: string) => void;
  }>(),
  // A new action builder (new transfer scope or language) starts a new cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [rowActions]);
  const actionsFor = useCallback((tx: Transaction) => {
    let entry = rowActionCache.get(tx);
    if (!entry) {
      const actions = rowActions(tx);
      entry = { actions, spoken: actions.map(({ name, label }) => ({ name, label })),
        onAction: (name) => actions.find((action) => action.name === name)?.onPress() };
      rowActionCache.set(tx, entry);
    }
    return entry;
  }, [rowActionCache, rowActions]);
  const renderRow = useCallback(
    ({ item, index }: { item: Transaction; index: number }) => {
      const { actions, spoken, onAction } = actionsFor(item);
      return (
        <View
          style={index > 0 ? [styles.rowDivider, { borderTopColor: theme.cardBorder }] : undefined}>
          <SwipeRow actions={actions} testID={`transaction-swipe-${item.id}`}>
            <View style={{ backgroundColor: theme.background }}>
              <TransactionRow
                transaction={item}
                account={accountById.get(item.accountId)}
                onPress={openEntry}
                internal={internal.has(item.id)}
                accessibilityActions={spoken}
                onAccessibilityAction={onAction}
              />
            </View>
          </SwipeRow>
        </View>
      );
    },
    [accountById, openEntry, theme.cardBorder, theme.background, internal, actionsFor],
  );

  const filterOptions = useMemo(() => ({ query: appliedQuery, merchant: merchantFilter, smsOnly,
    bestEffortOnly: autoAddedActive, currentKey, period,
    live: liveAccounts, internal, corroborating, separateTransferIds, transferIds, reviewIds,
    amountExponent: state.ledgerMoney?.exponent ?? 2 }),
  [appliedQuery, merchantFilter, smsOnly, autoAddedActive, currentKey, period, liveAccounts, internal, corroborating,
    separateTransferIds, transferIds, reviewIds, state.ledgerMoney?.exponent]);
  const projection = useMemo(() => projectTransactionFilter(filterIndex, appliedFilters, filterOptions),
    [filterIndex, appliedFilters, filterOptions]);
  const { filtered, totalShown, excluded, separatedTransfers } = projection;
  const transferContributes = separatedTransfers.incomeFils > 0 || separatedTransfers.expenseFils > 0;
  // A single ordinary row already displays its amount. Keep a separate total
  // only when it conveys different information (for example a transfer excluded
  // from totals or a category filter showing part of a split purchase).
  const singleRow = filtered.length === 1 ? filtered[0] : null;
  const showResultTotal = transferContributes || filtered.length > 1 ||
    (singleRow !== null && Math.abs(totalShown) !== singleRow.amountFils);
  const resultsPending = appliedFilters !== filters || appliedQuery !== query;
  const sections = useMemo<DaySection[]>(() => appliedFilters.sort === 'largest'
    ? [{ title: tr('largestFirst'), totalFils: totalShown, data: filtered }]
    : projection.days.map(day => ({ title: friendlyDate(day.date, todayISO), totalFils: day.totalFils, data: day.data })),
  [projection, appliedFilters.sort, filtered, todayISO, totalShown, tr]);

  const clearFilters = useCallback(() => {
    setMerchantFilter(null);
    setSmsOnly(false);
    setAutoAddedOnly(false);
    setFilters({ ...DEFAULT_FILTERS, categories: new Set() });
  }, []);

  const applyFilters = useCallback((nextFilters: Filters, resetScope: boolean) => {
    // Closing an Android Modal and projecting a 10k+ row ledger in the same
    // press made the date-filter button feel as if it had not registered. Let
    // the sheet disappear and Android present that frame first. The exact
    // projection the sheet just previewed is cached by the filter index, so in
    // the common case the next render reuses it without another ledger walk.
    setSheetVisible(false);
    const commit = () => {
      pendingFilterFrame.current = null;
      if (resetScope) { setMerchantFilter(null); setSmsOnly(false); setAutoAddedOnly(false); }
      setFilters(nextFilters);
    };
    if (Platform.OS !== 'android') { commit(); return; }
    if (pendingFilterFrame.current !== null) cancelAnimationFrame(pendingFilterFrame.current);
    pendingFilterFrame.current = requestAnimationFrame(commit);
  }, []);

  // At the accessibility text sizes the search field, filter button and
  // transfers link fill most of a phone screen on their own. Pinned above the
  // list they left the results a 44pt strip to scroll in, so there they
  // scroll away with the list as its first cell.
  const searchControls = (
    <View style={[styles.searchContainer, largeText && styles.searchContainerInList]} accessibilityState={{ busy: resultsPending }}>
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
          {/* At the accessibility text sizes the chips wrap onto lines rather
              than scrolling most of them off screen sideways. */}
          {largeText ? <View style={[styles.typeChips, styles.typeChipsWrap]}
            accessibilityLabel={words.types} testID="transactions-type-chips">
            {TYPE_CHIPS.map((chip) => <View key={chip} testID={`transactions-chip-${chip}`}>
              <Chip label={words[chip]} active={chipOf(filters) === chip}
                onPress={() => setFilters((current) => withChip(current, chip))} />
            </View>)}
          </View> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeChips}
            accessibilityLabel={words.types} testID="transactions-type-chips">
            {TYPE_CHIPS.map((chip) => <View key={chip} testID={`transactions-chip-${chip}`}>
              <Chip label={words[chip]} active={chipOf(filters) === chip}
                onPress={() => setFilters((current) => withChip(current, chip))} />
            </View>)}
          </ScrollView>}
          {filters.accountId ? <View style={styles.chipRow}>
            <Pressable testID="transactions-account-filter" accessibilityRole="button"
              accessibilityLabel={`${tr('clearFilter')}: ${words.accountFilter(accountLabelFor(filters.accountId))}`}
              onPress={() => setFilters((current) => ({ ...current, accountId: null }))}
              style={[styles.merchantChip, { backgroundColor: `${theme.primary}1c` }]}>
              <ThemedText type="small" style={{ color: theme.primary, fontFamily: Fonts.sansSemi }}>
                {words.accountFilter(accountLabelFor(filters.accountId))}
              </ThemedText>
              <Icon name="close" size={13} color={theme.primary} />
            </Pressable>
          </View> : null}
          <Pressable accessibilityRole="button" onPress={() => router.push('/transfers')}
            style={styles.transferLink} testID="transactions-transfers-link">
            <Icon name="repeat" size={17} color={theme.primary} />
            <ThemedText type="linkPrimary" themeColor="primary">{transferWords.viewAll}</ThemedText>
            <Icon name="chevron-right" size={16} color={theme.primary} />
          </Pressable>
          {resultsPending && <ThemedText type="meta" accessibilityLiveRegion="polite">{tr('filterUpdating')}</ThemedText>}
        </View>
  );
  const scrollingSearchControls = largeText ? searchControls : null;

  const transactionResults = useMemo(() => (
        <GestureHandlerRootView style={styles.gestureRoot}>
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
              {scrollingSearchControls}


              {/* The restrictions that came from the link that opened this screen.
              Both are removable here, which is the only thing that explains an
              otherwise inexplicably short list. */}
              {(merchantFilter || smsOnly || autoAddedCount > 0) && (
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
                  {autoAddedCount > 0 && (autoAddedActive ? (
                    <Pressable
                      testID="auto-added-filter-active"
                      accessibilityRole="button"
                      accessibilityLabel={`${tr('clearFilter')}: ${tr('autoAddedFilter')}`}
                      onPress={() => setAutoAddedOnly(false)}
                      style={[styles.merchantChip, { backgroundColor: `${theme.primary}1c` }]}>
                      <ThemedText type="small" style={{ color: theme.primary, fontFamily: Fonts.sansSemi }}>
                        {tr('autoAddedFilter')}
                      </ThemedText>
                      <Icon name="close" size={13} color={theme.primary} />
                    </Pressable>
                  ) : (
                    <Pressable
                      testID="auto-added-filter"
                      accessibilityRole="button"
                      accessibilityLabel={trf('autoAddedCount', { count: autoAddedCount })}
                      onPress={() => setAutoAddedOnly(true)}
                      style={[styles.merchantChip, { borderWidth: 1, borderColor: theme.warning }]}>
                      <ThemedText type="small" style={{ color: theme.warning, fontFamily: Fonts.sansSemi }}>
                        {trf('autoAddedCount', { count: autoAddedCount })}
                      </ThemedText>
                    </Pressable>
                  ))}
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
                <ThemedText type="small" themeColor="textSecondary">
                  {transferContributes ? transferWords.netIncluding : tr('transactionNetTotal')}
                </ThemedText>
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
                  <ThemedText type="small" style={{ color: theme.primary, fontFamily: Fonts.sansSemi }}>
                    {tr('clearFilter')}
                  </ThemedText>
                </Pressable>
              )}
            </View>}
              {separatedTransfers.count > 0 && <View testID="transactions-separated-transfers" style={styles.transferNotice}>
                <ThemedText type="meta" themeColor="textSecondary">{transferWords.separated(separatedTransfers.count)}</ThemedText>
                <ThemedText type="meta" themeColor="textSecondary">{transferWords.reviewNote}</ThemedText>
                {transferContributes && <>
                  <View style={styles.summaryValue}>
                    <ThemedText type="meta" themeColor="textSecondary">{transferWords.transferIncome}</ThemedText>
                    <ThemedText type="meta" tabular>{formatAED(separatedTransfers.incomeFils, { decimals: true })}</ThemedText>
                  </View>
                  <View style={styles.summaryValue}>
                    <ThemedText type="meta" themeColor="textSecondary">{transferWords.transferSpending}</ThemedText>
                    <ThemedText type="meta" tabular>{formatAED(separatedTransfers.expenseFils, { decimals: true })}</ThemedText>
                  </View>
                  <ThemedText type="meta" themeColor="textSecondary">{transferWords.countsNote}</ThemedText>
                </>}
              </View>}
              {(excluded.transfers > 0 || excluded.movements > 0 || excluded.hidden > 0) && (
                <ThemedText testID="transactions-exclusions" type="meta" themeColor="textSecondary">
              {excluded.transfers > 0
                ? `${trf('transfersExcluded', {
                    count: excluded.transfers,
                    s: excluded.transfers === 1 ? '' : 's',
                  })}`
                : ''}
              {excluded.movements > 0
                ? `${excluded.transfers > 0 ? ' · ' : ''}${trf('movementsExcluded', {
                    count: excluded.movements,
                    s: excluded.movements === 1 ? '' : 's',
                  })}`
                : ''}
              {excluded.hidden > 0
                ? `${excluded.transfers > 0 || excluded.movements > 0 ? ' · ' : ''}${trf('hiddenAccountsExcluded', { count: excluded.hidden })}`
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
                <Icon name={separatedTransfers.count > 0 ? 'repeat' : 'search'} size={24} color={theme.textSecondary} strokeWidth={1.7} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {separatedTransfers.count > 0 ? transferWords.separated(separatedTransfers.count) : tr('nothingMatches')}
              </ThemedText>
            </View>
          }
        />
        </GestureHandlerRootView>
  ), [sections, listInsets, largeText, merchantFilter, smsOnly, autoAddedCount, autoAddedActive, theme, tr, trf, filtered.length,
    filters.datePreset, period, activeFilterCount, totalShown, showResultTotal, excluded, clearFilters, renderRow,
    separatedTransfers, transferContributes, transferWords, scrollingSearchControls]);

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
        {largeText ? null : searchControls}
        {transactionResults}
      </ScreenScaffold>

      {sheetVisible && <TransactionFilterSheet initialFilters={filters} resetFilters={DEFAULT_FILTERS}
        accounts={state.accounts} hasUnassignedIncome={hasUnassignedIncome} index={filterIndex} options={filterOptions}
        sourceKinds={sourceKinds}
        onClose={() => setSheetVisible(false)} onApply={applyFilters} />}

      <EntryDetailSheet transaction={editing} initialMode={entryMode} onClose={() => { setEditing(null); setEntryMode('read'); }} />
      {deleting ? <ConfirmSheet
        visible
        onClose={() => setDeleting(null)}
        question={tr('deleteThisEntry')}
        body={`${deleting.title} · ${formatAmount(deleting.amountFils)}`}
        confirmLabel={tr('delete')}
        destructive
        onConfirm={() => deleteTransaction(deleting.id)}
      /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  transferNotice: { gap: Spacing.one },
  transferLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, alignSelf: 'flex-start' },
  // Screen sections have a gap; virtualized header/row/footer cells must not.
  listContent: { gap: 0 },
  searchContainer: { paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two, gap: Spacing.one },
  // The list content already carries the screen padding.
  searchContainerInList: { paddingHorizontal: 0 },
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
  compactTransferNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap' },
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
  },
  typeChips: { gap: Spacing.two, paddingVertical: Spacing.one },
  typeChipsWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  gestureRoot: { flex: 1 },
});
