import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { LedgerCurrencySheet } from '@/components/ledger-currency-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { BAND_GUTTER, BandScaffold, useBandBottomInset } from '@/components/ui/band-scaffold';
import { BandFigure } from '@/components/ui/band/band-figure';
import { statTileColors } from '@/components/ui/band/stat-tile';
import { Icon } from '@/components/ui/icon';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { SectionHeader } from '@/components/ui/section-header';
import { TextField } from '@/components/ui/text-field';
import { Fonts, Radius, Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { categoryLabel, getCategory } from '@/lib/categories';
import { detailsWords } from '@/lib/details-copy';
import { everydayBandCopy } from '@/lib/everyday-band-copy';
import { formatAED, shortDate } from '@/lib/format';
import { formatOriginalCurrency, originalMoneyOf } from '@/lib/fx';
import { fxRowSource, summarizeForeignActivity, type CurrencyActivity } from '@/lib/fx-summary';
import { internalTransferIdsForState, liveAccountIds } from '@/lib/ledger';
import { ledgerStateHasMoney } from '@/lib/ledger-money';
import { ledgerCurrencyCode } from '@/lib/markets';
import { alignEnd, t, tf } from '@/lib/i18n';

import { inPeriod, periodLabel } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { spendingDetailsCopy } from '@/lib/spending-details-copy';
import { useStore } from '@/lib/store';
import type { Transaction } from '@/lib/types';

const INITIAL_CURRENCY_ROWS = 5;
const transactionKey = (transaction: Transaction) => transaction.id;

/** Whole-number share of the converted total a currency holds. */
const shareOf = (group: CurrencyActivity, totalLocalFils: number) => totalLocalFils > 0
  ? Math.round((group.localFils / totalLocalFils) * 100) : 0;

/**
 * One currency on the clay band: a tile in the band's own tone with the code,
 * the original total in that currency, and its share and payment count. It
 * filters the list below; the selected tile takes the band's selected pill.
 */
function CurrencyTile({ group, percent, selected, onPress, palette, language }: {
  group: CurrencyActivity; percent: number; selected: boolean; onPress: (currency: string) => void;
  palette: BandPalette; language: 'en' | 'ar';
}) {
  const d = detailsWords(language);
  const words = spendingDetailsCopy(language);
  const colors = statTileColors(palette, 'band');
  const fg = selected ? palette.onSelected : colors.fg;
  const fg2 = selected ? palette.onSelected : colors.fgSecondary;
  const original = formatOriginalCurrency(group.originalMinor, group.currency, language, group.originalExponent);
  const payments = d.payments(group.count);
  return <Pressable testID={`currency-tile-${group.currency}`} accessibilityRole="button" accessibilityState={{ selected }}
    accessibilityLabel={words.tileSpoken(group.currency, original, formatAED(group.localFils, { decimals: true }), percent, payments)}
    onPress={() => onPress(group.currency)}
    style={({ pressed }) => [styles.tile, { backgroundColor: selected ? palette.selected : colors.bg, opacity: pressed ? 0.85 : 1 }]}>
    <ThemedText style={[styles.tileCode, { color: fg }]}>{group.currency}</ThemedText>
    <ThemedText type="smallBold" tabular style={{ color: fg }}>{original}</ThemedText>
    <ThemedText type="meta" style={{ color: fg2 }}>{words.tileMeta(percent, payments)}</ThemedText>
  </Pressable>;
}

/**
 * Foreign activity in design language E, a Spending detail on the clay band:
 * the converted total with its payment and currency count, then one tile per
 * currency that filters the list. The sheet holds the charges (the original
 * amount and how it was converted on each row), the ledger-currency row and
 * one qualified line about the rate sources. At the accessibility sizes the
 * figure and the currencies move onto the sheet as rows and scroll with it.
 */
export default function CurrencyScreen() {
  const band = useBand('spending');
  const language = useLanguage();
  const lang = language === 'ar' ? 'ar' : 'en';
  const largeText = useLargeTextLayout();
  const { state, setLedgerMoney } = useStore();
  const { period } = usePeriod();
  const d = detailsWords(language);
  const words = spendingDetailsCopy(language);
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  // The ledger currency is fixed once money is recorded (the store refuses a
  // change); the row then explains instead of opening a picker it would ignore.
  const ledgerLocked = ledgerStateHasMoney(state);
  const listBottom = useBandBottomInset();
  const [periodOpen, setPeriodOpen] = useState(false);
  const [entry, setEntry] = useState<Transaction | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [showAllCurrencies, setShowAllCurrencies] = useState(false);

  const ledgerCurrency = ledgerCurrencyCode();
  const live = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = internalTransferIdsForState(state);
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
  const caption = d.currency.caption(chargeCount, summary.groups.length);
  // One qualified line about how the ledger amounts were converted, from the
  // per-row rate source (bank figure, dated reference rate or approximation).
  const footer = d.currency.footer(summary);
  const onBand = !largeText;

  const toggleCurrency = useCallback((currency: string) => {
    setSelectedCurrency((current) => current === currency ? null : currency);
  }, []);

  // The currencies as sheet rows, at the accessibility sizes only (the band
  // carries them as tiles otherwise).
  const currencyRow = useCallback((group: CurrencyActivity, index: number, count: number) => {
    const selected = selectedCurrency === group.currency;
    const percent = shareOf(group, summary.totalLocalFils);
    const fillWidth = `${Math.max(2, Math.min(100, percent))}%` as `${number}%`;
    const original = formatOriginalCurrency(group.originalMinor, group.currency, lang, group.originalExponent);
    const meta = d.currency.meta(original, group.count);
    return (
      <Pressable
        key={group.currency}
        testID={`currency-row-${group.currency}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${group.currency}. ${formatAED(group.localFils, { decimals: true })}. ${percent}%. ${meta}`}
        onPress={() => toggleCurrency(group.currency)}
        android_ripple={{ color: band.card }}
        style={({ pressed }) => [
          styles.currencyRow,
          {
            borderTopColor: band.rule,
            borderBottomColor: band.rule,
            ...(index === count - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth } : null),
            ...(selected || pressed ? { backgroundColor: band.card } : null),
          },
        ]}>
        <View style={styles.currencyContent}>
          <View style={styles.currencyTitleRow}>
            <ThemedText type="smallBold" tabular style={{ color: selected ? band.tint : band.text }}>
              {group.currency}
            </ThemedText>
            <ThemedText type="meta" tabular style={{ color: band.textSecondary }}>{percent}%</ThemedText>
          </View>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{meta}</ThemedText>
          <View style={[styles.currencyTrack, { backgroundColor: band.rule }]}>
            <View style={[styles.currencyFill, { backgroundColor: band.tint, width: fillWidth }]} />
          </View>
        </View>
        <ThemedText type="smallBold" tabular style={[styles.currencyLocalAmount, { color: band.text }]}>
          {formatAED(group.localFils, { decimals: true })}
        </ThemedText>
      </Pressable>
    );
  }, [d, lang, selectedCurrency, summary.totalLocalFils, band, toggleCurrency]);

  const renderTransaction = useCallback(({ item, index }: { item: Transaction; index: number }) => {
    const account = accountById.get(item.accountId);
    const bank = account?.bankName || account?.name;
    const accountCaption = bank
      ? `${bank}${account?.last4 && !bank.includes(account.last4) ? ` ·${account.last4}` : ''}`
      : undefined;
    const category = categoryLabel(getCategory(item.category), lang);
    const originalMoney = originalMoneyOf(item);
    const original = originalMoney
      ? formatOriginalCurrency(originalMoney.minorUnits, originalMoney.currency, lang, originalMoney.exponent)
      : '';
    const rate = words.rate[fxRowSource(item)];
    const local = formatAED(item.amountFils, { decimals: true });
    return (
      <Pressable
        accessibilityRole="button"
        testID="currency-transaction-row"
        accessibilityLabel={[item.title, category, shortDate(item.date), accountCaption, original, rate, local]
          .filter(Boolean).join(', ')}
        onPress={() => setEntry(item)}
        android_ripple={{ color: band.card }}
        style={({ pressed }) => [
          styles.transactionRow,
          index > 0 ? { borderTopColor: band.rule, borderTopWidth: StyleSheet.hairlineWidth } : undefined,
          pressed ? { backgroundColor: band.card } : undefined,
          largeText && styles.transactionRowLarge,
        ]}>
        <MerchantAvatar title={item.title} category={item.category} size={40} />
        <View style={styles.transactionCopy}>
          <ThemedText type="smallBold" style={{ color: band.text }}>{item.title}</ThemedText>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{rate}</ThemedText>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>
            {[category, shortDate(item.date), accountCaption].filter(Boolean).join(' · ')}
          </ThemedText>
        </View>
        {/* The amount the charge was made in leads; the ledger amount it became sits under it. */}
        <View style={[styles.transactionAmounts, largeText && styles.transactionAmountsLarge]}>
          <ThemedText type="smallBold" tabular testID="currency-row-original"
            style={[{ color: band.text }, !largeText && { textAlign: alignEnd() }]}>{original || local}</ThemedText>
          {original ? <ThemedText type="meta" tabular testID="currency-row-local"
            style={[{ color: band.textSecondary }, !largeText && { textAlign: alignEnd() }]}>{local}</ThemedText> : null}
        </View>
      </Pressable>
    );
  }, [accountById, lang, largeText, band, words]);

  const figure = (colors?: { color: string; secondaryColor: string }) => <BandFigure testID="currency-total"
    palette={band} label={`${t('foreignConvertedTotal', language)} · ${periodLabel(period)}`}
    fils={summary.totalLocalFils} decimals qualifier={caption} size={onBand ? 'hero' : 'large'} {...colors} />;

  const bandContent = onBand ? <View style={styles.band}>
    {figure()}
    {summary.groups.length > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false}
      accessibilityLabel={t('currencyBreakdown', language)} testID="currency-tiles"
      style={styles.tilesScroll} contentContainerStyle={styles.tiles}>
      {summary.groups.map((group) => <CurrencyTile key={group.currency} group={group} palette={band} language={lang}
        percent={shareOf(group, summary.totalLocalFils)} selected={selectedCurrency === group.currency} onPress={toggleCurrency} />)}
    </ScrollView> : null}
  </View> : undefined;

  const listHeader = (
    <View style={styles.headerContent}>
      {onBand ? null : figure({ color: band.text, secondaryColor: band.textSecondary })}
      {summary.transactions.length > 0 ? (
        <>
          {onBand ? null : <View style={styles.section}>
            <SectionHeader title={t('currencyBreakdown', language)} />
            {visibleGroups.map((group, index) => currencyRow(group, index, visibleGroups.length))}
            {summary.groups.length > INITIAL_CURRENCY_ROWS ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showAllCurrencies }}
                onPress={() => setShowAllCurrencies((current) => !current)}
                style={styles.currencyDisclosure}>
                <ThemedText type="smallBold" style={{ color: band.tint }}>
                  {showAllCurrencies
                    ? t('foreignShowFewerCurrencies', language)
                    : tf('foreignSeeAllCurrencies', { count: summary.groups.length }, language)}
                </ThemedText>
                <Icon
                  name={showAllCurrencies ? 'arrow-up' : 'arrow-down'}
                  size={16}
                  color={band.tint}
                />
              </Pressable>
            ) : null}
          </View>}

          <View style={styles.section}>
            <SectionHeader title={t('foreignRecent', language)} value={String(visibleTransactions.length)} />
            {selectedGroup ? (
              <Pressable
                testID="currency-filter"
                accessibilityRole="button"
                accessibilityLabel={`${t('clearFilter', language)}: ${selectedGroup.currency}`}
                onPress={() => setSelectedCurrency(null)}
                style={[styles.activeFilter, { backgroundColor: band.card, borderColor: band.rule }]}>
                <ThemedText type="small" style={{ color: band.text }}>
                  {d.currency.filter(selectedGroup.currency, selectedGroup.count)}
                </ThemedText>
                <Icon name="close" size={14} color={band.text} />
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
                leading={<Icon name="search" size={17} color={band.textSecondary} />}
              />
            ) : null}
          </View>
        </>
      ) : (
        <View style={[styles.empty, { borderColor: band.rule, backgroundColor: band.card }]}>
          <View style={[styles.emptyIcon, { backgroundColor: band.glyphGround }]}>
            <Icon name="plane" size={22} color={band.text} />
          </View>
          <ThemedText type="small" style={{ color: band.textSecondary }}>
            {t('noForeignActivity', language)}
          </ThemedText>
        </View>
      )}
    </View>
  );

  const listFooter = (
    <View style={styles.footerContent}>
      <Pressable
        testID="currency-ledger-row"
        accessibilityRole={ledgerLocked ? undefined : 'button'}
        accessibilityLabel={`${d.currency.ledgerTitle}: ${ledgerCurrency}. ${ledgerLocked ? t('ledgerCurrencyPermanentHint', language) : d.currency.ledgerBody(ledgerCurrency)}`}
        disabled={ledgerLocked}
        onPress={() => setCurrencySheetOpen(true)}
        style={({ pressed }) => [styles.ledgerRow, { borderColor: band.rule, backgroundColor: band.card },
          pressed && !ledgerLocked ? { opacity: 0.8 } : undefined]}>
        <View style={styles.ledgerCopy}>
          <ThemedText type="smallBold" style={{ color: band.text }}>{d.currency.ledgerTitle}</ThemedText>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>
            {ledgerLocked ? t('ledgerCurrencyPermanentHint', language) : d.currency.ledgerBody(ledgerCurrency)}
          </ThemedText>
        </View>
        <ThemedText type="smallBold" tabular style={{ color: band.text }}>{ledgerCurrency}</ThemedText>
        <Icon name={ledgerLocked ? 'lock' : 'chevron-right'} size={ledgerLocked ? 13 : 16} color={band.textSecondary} />
      </Pressable>
      {footer && visibleTransactions.length > 0 ? (
        <ThemedText testID="currency-fx-footer" type="meta" style={{ color: band.textSecondary }}>
          {footer}
        </ThemedText>
      ) : null}
    </View>
  );

  return (
    <>
      <BandScaffold
        band="spending"
        scroll={false}
        testID="currency-screen"
        contentStyle={styles.sheetContent}
        nav={{
          back: true,
          title: t('foreignSpending', language),
          actions: [{ icon: 'calendar', label: everydayBandCopy(language).choosePeriod(periodLabel(period)),
            onPress: () => setPeriodOpen(true), testID: 'currency-period' }],
        }}
        bandContent={bandContent}>
        <FlatList
          data={visibleTransactions}
          keyExtractor={transactionKey}
          renderItem={renderTransaction}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={summary.transactions.length > 0 ? (
            <View style={styles.noMatches}>
              <ThemedText type="small" style={{ color: band.textSecondary }}>
                {t('nothingMatches', language)}
              </ThemedText>
            </View>
          ) : null}
          ListFooterComponent={listFooter}
          contentContainerStyle={[styles.listContent, { paddingBottom: listBottom }]}
          scrollIndicatorInsets={{ top: 0, bottom: listBottom }}
          contentInsetAdjustmentBehavior="never"
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={32}
          windowSize={9}
          removeClippedSubviews={Platform.OS === 'android'}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      </BandScaffold>

      <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
      <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} />
      <LedgerCurrencySheet
        visible={currencySheetOpen && !ledgerLocked}
        value={state.ledgerMoney?.currency ?? null}
        onClose={() => setCurrencySheetOpen(false)}
        onSelect={(currency) => { setLedgerMoney(currency); setCurrencySheetOpen(false); }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  band: { gap: 16 },
  // The tiles run to the screen edges while the first one lines up with the band's text.
  tilesScroll: { marginHorizontal: -BAND_GUTTER },
  tiles: { gap: 10, paddingHorizontal: BAND_GUTTER },
  tile: { minWidth: 132, maxWidth: 220, borderRadius: 22, padding: 14, gap: 2 },
  tileCode: { fontFamily: Fonts.sansSemi, fontSize: 26, lineHeight: 32, letterSpacing: -0.6 },
  // The sheet holds the list edge to edge; header, rows and footer carry the gutter.
  sheetContent: { paddingHorizontal: 0, paddingTop: Spacing.two },
  listContent: { gap: 0, paddingHorizontal: BAND_GUTTER },
  headerContent: { gap: Spacing.four, paddingBottom: Spacing.two },
  section: { gap: 0 },
  currencyRow: {
    minHeight: 76,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    marginHorizontal: -Spacing.one,
  },
  currencyContent: { flex: 1, minWidth: 120, gap: 4 },
  currencyTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  currencyTrack: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  currencyFill: { height: 3, borderRadius: 2 },
  // Its own line under the currency (this list only shows at the accessibility sizes).
  currencyLocalAmount: { flexBasis: '100%', textAlign: 'auto' },
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
    borderWidth: 1,
    marginBottom: Spacing.two,
  },
  transactionRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
  },
  transactionRowLarge: { flexWrap: 'wrap', alignItems: 'flex-start' },
  transactionCopy: { flex: 1, minWidth: 130, gap: 2 },
  transactionAmounts: { flexShrink: 0, alignItems: 'flex-end', gap: 2 },
  transactionAmountsLarge: { width: '100%', alignItems: 'flex-start', paddingStart: 52 },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
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
  footerContent: { gap: Spacing.three, paddingTop: Spacing.four, paddingBottom: Spacing.two },
  ledgerRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 18,
  },
  ledgerCopy: { flex: 1, minWidth: 130, gap: 2 },
});
