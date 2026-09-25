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
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { SkeletonRows } from '@/components/ui/states';
import { ScreenScaffold, useScreenContentInsets } from '@/components/ui/screen-scaffold';
import { TextField } from '@/components/ui/text-field';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { topMerchants, type MerchantStat } from '@/lib/analytics';
import { formatAED } from '@/lib/format';
import { internalTransferIdsForState, liveAccountIds } from '@/lib/ledger';
import { checkedMinorSum } from '@/lib/ledger-money';
import { merchantSpendingHref, merchantSpendingKey } from '@/lib/merchant-spending';
import { merchantSpendingCopy } from '@/lib/merchant-spending-copy';
import { periodLabel, periodRange } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';

const rowKey = (row: MerchantStat) => merchantSpendingKey(row.title);

const MerchantRow = React.memo(function MerchantRow({ item, purchases, onOpen }: {
  item: MerchantStat; purchases: string; onOpen: (title: string) => void;
}) {
  const theme = useTheme();
  // At the accessibility sizes the logo sits above the name (as iOS Settings
  // stacks its icons), so a long name gets the full width.
  const largeText = useLargeTextLayout();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}. ${formatAED(item.totalFils)}. ${purchases}: ${item.count}`}
    testID="merchant-spending-row" onPress={() => onOpen(item.title)}
    style={({ pressed }) => [styles.row, largeText && styles.rowStacked, { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
    <MerchantAvatar title={item.title} category={item.category} size={40} />
    <View style={[styles.words, largeText && styles.wordsStacked]}><ThemedText type="smallBold">{item.title}</ThemedText>
      <ThemedText type="meta" themeColor="textSecondary">{purchases} · {item.count}</ThemedText>
      <Money fils={item.totalFils} type="smallBold" /></View>
    {largeText ? null : <Icon name="chevron-right" size={17} color={theme.textTertiary} />}
  </Pressable>;
});

export default function MerchantsScreen() {
  const router = useRouter(); const language = useLanguage();
  const { state } = useStore(); const { period, setPeriod } = usePeriod();
  const insets = useScreenContentInsets({ hasFooter: false });
  const w = merchantSpendingCopy[language === 'ar' ? 'ar' : 'en'];
  const [query, setQuery] = useState(''); const [periodOpen, setPeriodOpen] = useState(false);
  const needle = useDeferredValue(query.trim().toLowerCase());
  const live = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = internalTransferIdsForState(state);
  // One ledger pass, independent of keystrokes and import-progress events.
  const merchants = useMemo(() => topMerchants(state.transactions, period, Number.MAX_SAFE_INTEGER, live, internal),
    // monthKey reads the StoreProvider's active salary-day setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.transactions, period, live, internal, state.monthStartDay]);
  const rows = useMemo(() => needle ? merchants.filter(row => merchantSpendingKey(row.title).includes(needle)) : merchants,
    [merchants, needle]);
  const totalFils = useMemo(() => checkedMinorSum(rows.map(row => row.totalFils)), [rows]);
  const openMerchant = useCallback((title: string) => router.push(merchantSpendingHref(title)), [router]);
  // The filtered list is a new array per deferred keystroke; a memoized row
  // lets the list skip every cell whose merchant did not change.
  const renderRow = useCallback(({ item }: { item: MerchantStat }) =>
    <MerchantRow item={item} purchases={w.purchases} onOpen={openMerchant} />, [openMerchant, w.purchases]);

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
          <ThemedText type="meta" themeColor="textSecondary" accessibilityLiveRegion="polite">{w.merchants} · {rows.length} · {w.highest}</ThemedText>
        </View>}
        ListEmptyComponent={<View style={styles.empty}><ThemedText type="smallBold">{query ? w.noMatch : w.empty}</ThemedText>
          <Button label={query ? w.clear : w.allTime} variant="outline" onPress={() => query ? setQuery('') : setPeriod({ mode: 'all' })} /></View>}
        ListFooterComponent={<ThemedText type="meta" themeColor="textSecondary" style={styles.footer}>{w.exclusions} {w.identity}</ThemedText>} />}
    </ScreenScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
  </>;
}

const styles = StyleSheet.create({
  header: { gap: 14, paddingBottom: 20 },
  row: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
  words: { flex: 1, minWidth: 0, gap: 4 },
  rowStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  wordsStacked: { flex: 0, flexBasis: 'auto', alignSelf: 'stretch' }, empty: { gap: 16, paddingVertical: 24 },
  footer: { paddingVertical: 24 },
});
