import { useRouter } from 'expo-router';
import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';

import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Money } from '@/components/ui/money';
import { PeriodPill } from '@/components/ui/period-pill';
import { ScreenScaffold, useScreenContentInsets } from '@/components/ui/screen-scaffold';
import { SectionHeader } from '@/components/ui/section-header';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { categoryLabel, getCategory } from '@/lib/categories';
import { formatAED, shortDate } from '@/lib/format';
import { formatOriginalCurrency } from '@/lib/fx';
import { summarizeForeignActivity, type CurrencyActivity } from '@/lib/fx-summary';
import { internalTransferIds, liveAccountIds } from '@/lib/ledger';
import { ledgerCurrencyCode } from '@/lib/markets';
import { t, tf } from '@/lib/i18n';
import { inPeriod } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import type { Transaction } from '@/lib/types';

const CURRENCY_FLAGS: Record<string, string> = {
  AED: '🇦🇪',
  USD: '🇺🇸',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  INR: '🇮🇳',
  SAR: '🇸🇦',
  QAR: '🇶🇦',
  THB: '🇹🇭',
  CNY: '🇨🇳',
  AZN: '🇦🇿',
  GEL: '🇬🇪',
  JOD: '🇯🇴',
  VND: '🇻🇳',
};

const INITIAL_CURRENCY_ROWS = 5;
const transactionKey = (transaction: Transaction) => transaction.id;

export default function CurrencyScreen() {
  const theme = useTheme();
  const language = useLanguage();
  const largeText = useLargeTextLayout();
  const router = useRouter();
  const { state } = useStore();
  const { period } = usePeriod();
  const listInsets = useScreenContentInsets({ hasFooter: false });
  const [periodOpen, setPeriodOpen] = useState(false);
  const [entry, setEntry] = useState<Transaction | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [showAllCurrencies, setShowAllCurrencies] = useState(false);

  const ledgerCurrency = ledgerCurrencyCode();
  const live = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = useMemo(
    () => internalTransferIds(state.transactions, state.accounts),
    [state.transactions, state.accounts],
  );
  const summary = useMemo(
    () =>
      summarizeForeignActivity(
        state.transactions,
        (transaction) =>
          live.has(transaction.accountId) &&
          !internal.has(transaction.id) &&
          inPeriod(transaction.date, period),
        ledgerCurrency,
      ),
    [state.transactions, period, ledgerCurrency, live, internal],
  );
  const accountById = useMemo(
    () => new Map(state.accounts.map((account) => [account.id, account] as const)),
    [state.accounts],
  );
  const chargeCount = summary.transactions.length;
  const showSearch = chargeCount >= 12;
  const normalizedQuery = showSearch ? deferredQuery.trim().toLowerCase() : '';
  const selectedGroup = selectedCurrency
    ? summary.groups.find((group) => group.currency === selectedCurrency) ?? null
    : null;
  const visibleGroups = showAllCurrencies
    ? summary.groups
    : summary.groups.slice(0, INITIAL_CURRENCY_ROWS);
  const visibleTransactions = useMemo(() => summary.transactions.filter((transaction) => {
    if (selectedCurrency && transaction.originalCurrency?.toUpperCase() !== selectedCurrency) return false;
    if (!normalizedQuery) return true;
    const account = accountById.get(transaction.accountId);
    return [transaction.title, transaction.originalCurrency, account?.bankName, account?.name]
      .some((value) => value?.toLowerCase().includes(normalizedQuery));
  }), [summary.transactions, selectedCurrency, normalizedQuery, accountById]);
  const caption = tf(
    'foreignActivityCaption',
    {
      count: chargeCount,
      s: chargeCount === 1 ? '' : 's',
      currencies: summary.groups.length,
      ending: summary.groups.length === 1 ? 'y' : 'ies',
    },
    language,
  );

  const currencyHeader: ScreenHeaderProps = {
    title: t('foreignSpending', language),
    back: { label: t('back', language), onPress: () => router.back() },
  };

  const toggleCurrency = useCallback((currency: string) => {
    setSelectedCurrency((current) => current === currency ? null : currency);
  }, []);

  const currencyRow = useCallback((group: CurrencyActivity, index: number, count: number) => {
    const selected = selectedCurrency === group.currency;
    const percent = summary.totalLocalFils > 0
      ? Math.round((group.localFils / summary.totalLocalFils) * 100)
      : 0;
    const fillWidth = `${Math.max(2, Math.min(100, percent))}%` as `${number}%`;
    const original = formatOriginalCurrency(group.originalMinor, group.currency, language);
    const meta = tf(
      'foreignCurrencyOriginalSummary',
      { amount: original, count: group.count, s: group.count === 1 ? '' : 's' },
      language,
    );
    return (
      <Pressable
        key={group.currency}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${group.currency}. ${formatAED(group.localFils, { decimals: true })}. ${percent}%. ${meta}`}
        onPress={() => toggleCurrency(group.currency)}
        android_ripple={{ color: theme.backgroundSelected }}
        style={({ pressed }) => [
          styles.currencyRow,
          {
            borderTopColor: theme.cardBorder,
            borderBottomColor: theme.cardBorder,
            ...(index === count - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth } : null),
            ...(selected ? { backgroundColor: theme.backgroundSelected } : null),
            ...(pressed && !selected ? { backgroundColor: theme.backgroundSelected } : null),
          },
          largeText && styles.currencyRowLarge,
        ]}>
        <View style={styles.flagWrap}>
          <ThemedText style={styles.flag}>{CURRENCY_FLAGS[group.currency] ?? '🌐'}</ThemedText>
        </View>
        <View style={styles.currencyContent}>
          <View style={styles.currencyTitleRow}>
            <ThemedText type="smallBold" tabular style={selected ? { color: theme.primary } : undefined}>
              {group.currency}
            </ThemedText>
            <ThemedText type="meta" themeColor="textSecondary" tabular>{percent}%</ThemedText>
          </View>
          <ThemedText type="meta" themeColor="textSecondary">{meta}</ThemedText>
          <View style={[styles.currencyTrack, { backgroundColor: theme.track }]}>
            <View style={[styles.currencyFill, { backgroundColor: theme.primary, width: fillWidth }]} />
          </View>
        </View>
        <ThemedText type="smallBold" tabular style={styles.currencyLocalAmount}>
          {formatAED(group.localFils, { decimals: true })}
        </ThemedText>
      </Pressable>
    );
  }, [language, largeText, selectedCurrency, summary.totalLocalFils, theme, toggleCurrency]);

  const renderTransaction = useCallback(({ item, index }: { item: Transaction; index: number }) => {
    const account = accountById.get(item.accountId);
    const bank = account?.bankName || account?.name;
    const accountCaption = bank
      ? `${bank}${account?.last4 && !bank.includes(account.last4) ? ` ·${account.last4}` : ''}`
      : undefined;
    const category = categoryLabel(getCategory(item.category), language);
    const original = formatOriginalCurrency(
      item.originalAmountMinor!,
      item.originalCurrency!,
      language,
    );
    const local = formatAED(item.amountFils, { decimals: true });
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[item.title, category, shortDate(item.date), accountCaption, original, local]
          .filter(Boolean).join(', ')}
        onPress={() => setEntry(item)}
        android_ripple={{ color: theme.backgroundSelected }}
        style={({ pressed }) => [
          styles.transactionRow,
          index > 0 ? { borderTopColor: theme.cardBorder, borderTopWidth: StyleSheet.hairlineWidth } : undefined,
          pressed ? { backgroundColor: theme.backgroundSelected } : undefined,
          largeText && styles.transactionRowLarge,
        ]}>
        <MerchantAvatar title={item.title} category={item.category} size={36} />
        <View style={styles.transactionCopy}>
          <ThemedText type="smallBold">{item.title}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary">
            {[category, shortDate(item.date)].join(' · ')}
          </ThemedText>
          {accountCaption ? (
            <ThemedText type="meta" themeColor="textTertiary">{accountCaption}</ThemedText>
          ) : null}
        </View>
        <View style={[styles.transactionAmounts, largeText && styles.transactionAmountsLarge]}>
          <ThemedText type="smallBold" tabular>{original}</ThemedText>
          <ThemedText type="meta" themeColor="textTertiary" tabular>{local}</ThemedText>
        </View>
      </Pressable>
    );
  }, [accountById, language, largeText, theme]);

  const listHeader = (
    <View style={styles.headerContent}>
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <ThemedText type="micro" themeColor="textTertiary">
            {t('foreignConvertedTotal', language)}
          </ThemedText>
          <PeriodPill onPress={() => setPeriodOpen(true)} />
        </View>
        <Money fils={summary.totalLocalFils} type="display" decimals />
        <ThemedText type="small" themeColor="textSecondary">{caption}</ThemedText>
        <ThemedText type="meta" themeColor="textTertiary">
          {t('foreignOriginalsKept', language)}
        </ThemedText>
      </View>

      {summary.transactions.length > 0 ? (
        <>
          <View style={styles.section}>
            <SectionHeader title={t('currencyBreakdown', language)} />
            {visibleGroups.map((group, index) => currencyRow(group, index, visibleGroups.length))}
            {summary.groups.length > INITIAL_CURRENCY_ROWS ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showAllCurrencies }}
                onPress={() => setShowAllCurrencies((current) => !current)}
                style={styles.currencyDisclosure}>
                <ThemedText type="linkPrimary">
                  {showAllCurrencies
                    ? t('foreignShowFewerCurrencies', language)
                    : tf('foreignSeeAllCurrencies', { count: summary.groups.length }, language)}
                </ThemedText>
                <Icon
                  name={showAllCurrencies ? 'arrow-up' : 'arrow-down'}
                  size={16}
                  color={theme.primary}
                />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.section}>
            <SectionHeader title={t('foreignRecent', language)} value={String(visibleTransactions.length)} />
            {selectedGroup ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('clearFilter', language)}: ${selectedGroup.currency}`}
                onPress={() => setSelectedCurrency(null)}
                style={[styles.activeFilter, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="small" style={{ color: theme.primary }}>
                  {tf(
                    'foreignCurrencyFilter',
                    {
                      currency: selectedGroup.currency,
                      count: selectedGroup.count,
                      s: selectedGroup.count === 1 ? '' : 's',
                    },
                    language,
                  )}
                </ThemedText>
                <Icon name="close" size={14} color={theme.primary} />
              </Pressable>
            ) : null}
            {showSearch ? (
              <TextField
                label={t('searchForeignSpending', language)}
                value={query}
                onChangeText={setQuery}
                inputMode="search"
                returnKeyType="search"
                placeholder={t('searchForeignSpending', language)}
                autoCorrect={false}
                leading={<Icon name="search" size={17} color={theme.textSecondary} />}
              />
            ) : null}
          </View>
        </>
      ) : (
        <View style={[styles.empty, { borderColor: theme.cardBorder }]}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
            <Icon name="plane" size={22} color={theme.textSecondary} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {t('noForeignActivity', language)}
          </ThemedText>
        </View>
      )}
    </View>
  );

  return (
    <>
      <ScreenScaffold
        scroll={false}
        virtualized
        headerMode="native"
        header={currencyHeader}>
        <FlatList
          data={visibleTransactions}
          keyExtractor={transactionKey}
          renderItem={renderTransaction}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={summary.transactions.length > 0 ? (
            <View style={styles.noMatches}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('nothingMatches', language)}
              </ThemedText>
            </View>
          ) : null}
          contentContainerStyle={[listInsets.contentContainerStyle, styles.listContent]}
          contentInset={listInsets.contentInset}
          scrollIndicatorInsets={listInsets.scrollIndicatorInsets}
          contentInsetAdjustmentBehavior="automatic"
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={32}
          windowSize={9}
          removeClippedSubviews={Platform.OS === 'android'}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      </ScreenScaffold>

      <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
      <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  listContent: { gap: 0 },
  headerContent: { gap: Spacing.five },
  hero: { gap: Spacing.two, paddingBottom: Spacing.two },
  heroTop: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    flexWrap: 'wrap',
  },
  section: { gap: 0 },
  currencyRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    marginHorizontal: -Spacing.one,
  },
  currencyRowLarge: { flexWrap: 'wrap', alignItems: 'flex-start' },
  flagWrap: { width: 28, alignItems: 'center', justifyContent: 'center' },
  flag: { fontSize: 18, lineHeight: 24 },
  currencyContent: { flex: 1, minWidth: 120, gap: 4 },
  currencyTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  currencyTrack: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  currencyFill: { height: 3, borderRadius: 2 },
  currencyLocalAmount: { flexShrink: 0, textAlign: 'right' },
  currencyDisclosure: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  activeFilter: {
    minHeight: 44,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.full,
    marginBottom: Spacing.two,
  },
  transactionRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 9,
  },
  transactionRowLarge: { flexWrap: 'wrap' },
  transactionCopy: { flex: 1, minWidth: 130, gap: 2 },
  transactionAmounts: { flexShrink: 0, alignItems: 'flex-end', gap: 2 },
  transactionAmountsLarge: { width: '100%', alignItems: 'flex-start', paddingStart: 46 },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.five,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noMatches: { alignItems: 'center', paddingVertical: Spacing.five },
});
