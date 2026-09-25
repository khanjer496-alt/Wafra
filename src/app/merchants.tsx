import { useRouter } from 'expo-router';
import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { PeriodSheet } from '@/components/period-sheet';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Money } from '@/components/ui/money';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { SkeletonRows } from '@/components/ui/states';
import { ScreenScaffold, useScreenContentInsets } from '@/components/ui/screen-scaffold';
import { TextField } from '@/components/ui/text-field';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { topMerchants } from '@/lib/analytics';
import { categoryLabel } from '@/lib/categories';
import { detailsWords } from '@/lib/details-copy';
import { formatAED } from '@/lib/format';
import { internalTransferIdsForState, liveAccountIds } from '@/lib/ledger';
import { checkedMinorSum } from '@/lib/ledger-money';
import { newMerchantKeys, rankMerchants, type MerchantSort, type RankedMerchant } from '@/lib/merchant-insights';
import { merchantSpendingHref, merchantSpendingKey } from '@/lib/merchant-spending';
import { merchantSpendingCopy } from '@/lib/merchant-spending-copy';
import { periodLabel, periodRange } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';

const rowKey = (row: RankedMerchant) => merchantSpendingKey(row.title);
type DirectoryView = MerchantSort | 'new';

const MerchantRow = React.memo(function MerchantRow({ item, meta, rankLabel, onOpen }: {
  item: RankedMerchant; meta: string; rankLabel: string; onOpen: (title: string) => void;
}) {
  const theme = useTheme();
  // At the accessibility sizes the logo sits above the name (as iOS Settings
  // stacks its icons), so a long name gets the full width.
  const largeText = useLargeTextLayout();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${rankLabel}. ${item.title}. ${formatAED(item.totalFils)}. ${meta}`}
    testID="merchant-spending-row" onPress={() => onOpen(item.title)}
    style={({ pressed }) => [styles.row, largeText && styles.rowStacked, { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
    <ThemedText type="meta" tabular themeColor="textTertiary" style={styles.rank} testID="merchant-rank">
      {String(item.rank).padStart(2, '0')}
    </ThemedText>
    <MerchantAvatar title={item.title} category={item.category} size={40} />
    <View style={[styles.words, largeText && styles.wordsStacked]}>
      <ThemedText type="smallBold" numberOfLines={largeText ? undefined : 2}>{item.title}</ThemedText>
      <ThemedText type="meta" themeColor="textSecondary">{meta}</ThemedText></View>
    <Money fils={item.totalFils} type="smallBold" />
    {largeText ? null : <Icon name="chevron-right" size={17} color={theme.textTertiary} />}
  </Pressable>;
});

export default function MerchantsScreen() {
  const router = useRouter(); const language = useLanguage();
  const { state } = useStore(); const { period, setPeriod } = usePeriod();
  const insets = useScreenContentInsets({ hasFooter: false });
  const w = merchantSpendingCopy[language === 'ar' ? 'ar' : 'en'];
  const d = detailsWords(language);
  const [query, setQuery] = useState(''); const [periodOpen, setPeriodOpen] = useState(false);
  const [view, setView] = useState<DirectoryView>('amount');
  const needle = useDeferredValue(query.trim().toLowerCase());
  const live = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = internalTransferIdsForState(state);
  // One ledger pass, independent of keystrokes and import-progress events.
  const merchants = useMemo(() => topMerchants(state.transactions, period, Number.MAX_SAFE_INTEGER, live, internal),
    // monthKey reads the StoreProvider's active salary-day setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.transactions, period, live, internal, state.monthStartDay]);
  const sort: MerchantSort = view === 'visits' ? 'visits' : 'amount';
  const ranked = useMemo(() => rankMerchants(merchants, sort), [merchants, sort]);
  // "New" is a claim about the past, so it is offered only when the ledger's
  // own history reaches back before the selected period (newMerchantKeys).
  const fresh = useMemo(() => newMerchantKeys(state.transactions, period, merchants.map(row => merchantSpendingKey(row.title))),
    // periodStartISO reads the StoreProvider's active salary-day setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.transactions, period, merchants, state.monthStartDay]);
  const activeView: DirectoryView = view === 'new' && !fresh.available ? 'amount' : view;
  const rows = useMemo(() => {
    const scoped = activeView === 'new' ? ranked.filter(row => fresh.keys.has(rowKey(row))) : ranked;
    return needle ? scoped.filter(row => rowKey(row).includes(needle)) : scoped;
  }, [ranked, activeView, fresh, needle]);
  const totalFils = useMemo(() => checkedMinorSum(rows.map(row => row.totalFils)), [rows]);
  const openMerchant = useCallback((title: string) => router.push(merchantSpendingHref(title)), [router]);
  // The filtered list is a new array per deferred keystroke; a memoized row
  // lets the list skip every cell whose merchant did not change.
  const renderRow = useCallback(({ item }: { item: RankedMerchant }) =>
    <MerchantRow item={item} meta={d.merchants.meta(categoryLabel(item.category, language === 'ar' ? 'ar' : 'en'), item.count)}
      rankLabel={d.merchants.rank(item.rank)} onOpen={openMerchant} />, [openMerchant, d, language]);
  const segments = [
    { value: 'amount' as const, label: d.merchants.byAmount },
    { value: 'visits' as const, label: d.merchants.byVisits },
    ...(fresh.available ? [{ value: 'new' as const,
      label: period.mode === 'month' ? d.merchants.newThisMonth : d.merchants.newInPeriod }] : []),
  ];
  const listNote = activeView === 'visits' ? d.merchants.visitsNote : activeView === 'new' ? d.merchants.newNote : w.highest;

  return <>
    <ScreenScaffold scroll={false} virtualized keyboardAware testID="merchant-directory"
      header={{ title: w.merchants, back: { label: w.back, onPress: () => router.canGoBack() ? router.back() : router.replace('/flow') } }}>
      {!state.hydrated ? <View style={styles.empty}><SkeletonRows count={3} height={80} /></View> :
      <FlatList data={rows} renderItem={renderRow} keyExtractor={rowKey}
        contentContainerStyle={insets.contentContainerStyle} contentInset={insets.contentInset}
        scrollIndicatorInsets={insets.scrollIndicatorInsets} contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        initialNumToRender={14} maxToRenderPerBatch={10} windowSize={7}
        ListHeaderComponent={<View style={styles.header}>
          <View testID="merchant-period"><Button label={periodLabel(period)} icon="calendar" variant="ghost" wrapLabel onPress={() => setPeriodOpen(true)} /></View>
          {periodRange(period) ? <ThemedText type="meta" themeColor="textSecondary">{periodRange(period)}</ThemedText> : null}
          <ThemedText type="meta" themeColor="textSecondary">{needle ? w.matching : w.total}</ThemedText>
          <View testID="merchant-directory-total"><Money fils={totalFils} type="amount" /></View>
          <TextField label={w.search} placeholder={w.searchHint} value={query} onChangeText={setQuery} autoCorrect={false}
            trailing={query ? <ActionIconButton icon="close" label={w.clear} variant="plain" onPress={() => setQuery('')} /> : undefined} />
          {merchants.length > 0 ? <View testID="merchant-sort">
            <SegmentedControl<DirectoryView> label={d.merchants.sortLabel} value={activeView} onChange={setView} segments={segments} />
          </View> : null}
          <ThemedText type="meta" themeColor="textSecondary" accessibilityLiveRegion="polite">{d.merchants.count(rows.length)} · {listNote}</ThemedText>
        </View>}
        ListEmptyComponent={activeView === 'new' && !query ? <View style={styles.empty} testID="merchant-new-empty">
          <ThemedText type="smallBold">{d.merchants.newEmpty}</ThemedText>
        </View> : <View style={styles.empty}><ThemedText type="smallBold">{query ? w.noMatch : w.empty}</ThemedText>
          <Button label={query ? w.clear : w.allTime} variant="outline" onPress={() => query ? setQuery('') : setPeriod({ mode: 'all' })} /></View>}
        ListFooterComponent={<ThemedText type="meta" themeColor="textSecondary" style={styles.footer}>{w.exclusions} {w.identity}</ThemedText>} />}
    </ScreenScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
  </>;
}

const styles = StyleSheet.create({
  header: { gap: 14, paddingBottom: 20 },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
  rank: { minWidth: 22 },
  words: { flex: 1, minWidth: 0, gap: 4 },
  rowStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  wordsStacked: { flex: 0, flexBasis: 'auto', alignSelf: 'stretch' }, empty: { gap: 16, paddingVertical: 24 },
  footer: { paddingVertical: 24 },
});
