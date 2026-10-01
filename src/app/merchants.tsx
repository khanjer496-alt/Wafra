import { useCategoryCatalog } from '@/hooks/use-category-catalog';
import { useRouter } from '@/hooks/use-app-router';
import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { PeriodSheet } from '@/components/period-sheet';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { BAND_GUTTER, BandScaffold, useBandBottomInset } from '@/components/ui/band-scaffold';
import { BandSegmented } from '@/components/ui/band/band-segmented';
import { EButton } from '@/components/ui/band/e-button';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Money } from '@/components/ui/money';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { SkeletonRows } from '@/components/ui/states';
import { TextField } from '@/components/ui/text-field';
import { Fonts, Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { topMerchants } from '@/lib/analytics';

import { detailsWords } from '@/lib/details-copy';
import { everydayBandCopy } from '@/lib/everyday-band-copy';
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

/**
 * One ranked merchant on the sheet: its rank, the logo tile (category glyph
 * only as the fallback), name, "category · N payments" and the amount.
 */
const MerchantRow = React.memo(function MerchantRow({ item, meta, rankLabel, onOpen, palette, first }: {
  item: RankedMerchant; meta: string; rankLabel: string; onOpen: (title: string) => void; palette: BandPalette; first: boolean;
}) {
  // At the accessibility sizes the logo sits above the name (as iOS Settings
  // stacks its icons), so a long name gets the full width.
  const largeText = useLargeTextLayout();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${rankLabel}. ${item.title}. ${formatAED(item.totalFils)}. ${meta}`}
    testID="merchant-spending-row" onPress={() => onOpen(item.title)}
    style={({ pressed }) => [styles.row, largeText && styles.rowStacked, {
      borderTopColor: palette.rule, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
      backgroundColor: pressed ? palette.card : 'transparent' }]}>
    <ThemedText type="smallBold" tabular style={[styles.rank, { color: palette.textSecondary }]} testID="merchant-rank">
      {String(item.rank)}
    </ThemedText>
    <MerchantAvatar title={item.title} category={item.category} size={40} />
    <View style={[styles.words, largeText && styles.wordsStacked]}>
      <ThemedText type="smallBold" numberOfLines={largeText ? undefined : 2} style={{ color: palette.text }}>{item.title}</ThemedText>
      <ThemedText type="meta" style={{ color: palette.textSecondary }}>{meta}</ThemedText></View>
    <Money fils={item.totalFils} type="smallBold" color={palette.text} />
  </Pressable>;
});

/**
 * The merchants directory in design language E, a Spending detail on the clay
 * band: the title, the period and how many merchants it holds, and the sort
 * (by amount, by visits, and New only when the ledger's history predates the
 * period). The sheet holds the total, search and the ranked rows. At the
 * accessibility sizes the line and the sort move onto the sheet and scroll
 * with the list, so the rows keep room to scroll.
 */
export default function MerchantsScreen() {
  const { categoryLabel } = useCategoryCatalog();
  const router = useRouter(); const language = useLanguage();
  const band = useBand('spending');
  const largeText = useLargeTextLayout();
  const { state } = useStore(); const { period, setPeriod } = usePeriod();
  const listBottom = useBandBottomInset();
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
  const renderRow = useCallback(({ item, index }: { item: RankedMerchant; index: number }) =>
    <MerchantRow item={item} meta={d.merchants.meta(categoryLabel(item.category, language === 'ar' ? 'ar' : 'en'), item.count)}
      rankLabel={d.merchants.rank(item.rank)} onOpen={openMerchant} palette={band} first={index === 0} />, [openMerchant, d, language, band, categoryLabel]);
  const segments = [
    { value: 'amount' as const, label: d.merchants.byAmount },
    { value: 'visits' as const, label: d.merchants.byVisits },
    ...(fresh.available ? [{ value: 'new' as const,
      label: period.mode === 'month' ? d.merchants.newThisMonth : d.merchants.newInPeriod }] : []),
  ];
  const listNote = activeView === 'visits' ? d.merchants.visitsNote : activeView === 'new' ? d.merchants.newNote : w.highest;
  const range = periodRange(period);
  // "Sep 2026 · 61 merchants": the period and every merchant in it, before search.
  const directoryLine = `${periodLabel(period)} · ${d.merchants.count(merchants.length)}`;
  const onBand = !largeText;

  const bandContent = <View style={styles.band}>
    <ThemedText type="title" accessibilityRole="header" style={[styles.headline, { color: band.onBand }]}>{w.merchants}</ThemedText>
    {onBand ? <ThemedText type="small" testID="merchant-directory-line" style={{ color: band.onBandSecondary }}>{directoryLine}</ThemedText> : null}
    {onBand && state.hydrated && merchants.length > 0 ? <BandSegmented<DirectoryView> palette={band} testID="merchant-sort"
      label={d.merchants.sortLabel} value={activeView} onChange={setView} segments={segments} /> : null}
  </View>;

  return <>
    <BandScaffold band="spending" scroll={false} keyboardAware testID="merchant-directory" contentStyle={styles.sheetContent}
      nav={{
        back: () => router.canGoBack() ? router.back() : router.replace('/flow'),
        actions: [{ icon: 'calendar', label: everydayBandCopy(language).choosePeriod(periodLabel(period)),
          onPress: () => setPeriodOpen(true), testID: 'merchant-period' }],
      }}
      bandContent={bandContent}>
      {!state.hydrated ? <View style={styles.empty}><SkeletonRows count={3} height={80} /></View> :
      <FlatList data={rows} renderItem={renderRow} keyExtractor={rowKey}
        contentContainerStyle={[styles.listContent, { paddingBottom: listBottom }]}
        scrollIndicatorInsets={{ top: 0, bottom: listBottom }} contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        initialNumToRender={14} maxToRenderPerBatch={10} windowSize={7}
        ListHeaderComponent={<View style={styles.header}>
          {onBand ? null : <ThemedText type="small" testID="merchant-directory-line" style={{ color: band.textSecondary }}>{directoryLine}</ThemedText>}
          {!onBand && merchants.length > 0 ? <View testID="merchant-sort">
            <SegmentedControl<DirectoryView> label={d.merchants.sortLabel} value={activeView} onChange={setView} segments={segments} />
          </View> : null}
          <View style={styles.total}>
            <ThemedText type="meta" style={{ color: band.textSecondary }}>{needle ? w.matching : w.total}{range ? ` · ${range}` : ''}</ThemedText>
            <View testID="merchant-directory-total"><Money fils={totalFils} type="amount" color={band.text} /></View>
          </View>
          <TextField label={w.search} placeholder={w.searchHint} value={query} onChangeText={setQuery} autoCorrect={false}
            trailing={query ? <ActionIconButton icon="close" label={w.clear} variant="plain" onPress={() => setQuery('')} /> : undefined} />
          <ThemedText type="meta" style={{ color: band.textSecondary }} accessibilityLiveRegion="polite">{d.merchants.count(rows.length)} · {listNote}</ThemedText>
        </View>}
        ListEmptyComponent={activeView === 'new' && !query ? <View style={styles.empty} testID="merchant-new-empty">
          <ThemedText type="smallBold" style={{ color: band.text }}>{d.merchants.newEmpty}</ThemedText>
        </View> : <View style={styles.empty}><ThemedText type="smallBold" style={{ color: band.text }}>{query ? w.noMatch : w.empty}</ThemedText>
          <EButton palette={band} variant="secondary" label={query ? w.clear : w.allTime}
            onPress={() => query ? setQuery('') : setPeriod({ mode: 'all' })} /></View>}
        ListFooterComponent={<ThemedText type="meta" style={[styles.footer, { color: band.textSecondary }]}>{w.exclusions} {w.identity}</ThemedText>} />}
    </BandScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
  </>;
}

const styles = StyleSheet.create({
  band: { gap: 10 },
  headline: { fontFamily: Fonts.sansSemi, fontSize: 36, lineHeight: 42, letterSpacing: -1.2 },
  // The sheet holds the list edge to edge; header and rows carry the gutter.
  sheetContent: { paddingHorizontal: 0, paddingTop: Spacing.two },
  listContent: { paddingHorizontal: BAND_GUTTER },
  header: { gap: 14, paddingBottom: 12 },
  total: { gap: 4 },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rank: { minWidth: 22 },
  words: { flex: 1, minWidth: 0, gap: 3 },
  rowStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  wordsStacked: { flex: 0, flexBasis: 'auto', alignSelf: 'stretch' }, empty: { gap: 16, paddingVertical: 24 },
  footer: { paddingVertical: 24 },
});
