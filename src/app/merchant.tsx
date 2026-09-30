import { useCategoryCatalog } from '@/hooks/use-category-catalog';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { MerchantCategoryRule } from '@/components/merchant-category-rule';
import { MerchantMonthBars } from '@/components/merchant-month-bars';
import { PeriodSheet } from '@/components/period-sheet';
import { TransactionRow } from '@/components/transaction-row';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { BandFigure } from '@/components/ui/band/band-figure';
import { EButton } from '@/components/ui/band/e-button';
import { StatTile, statTileColors } from '@/components/ui/band/stat-tile';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Money } from '@/components/ui/money';
import { SkeletonRows } from '@/components/ui/states';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Fonts } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { assistantCopy } from '@/lib/assistant-copy';

import { everydayBandCopy } from '@/lib/everyday-band-copy';
import { countsInTotals, internalTransferIdsForState, liveAccountIds } from '@/lib/ledger';
import { projectMerchantSpending } from '@/lib/merchant-spending';
import { merchantSpendingCopy } from '@/lib/merchant-spending-copy';
import { transactionPresentation } from '@/lib/transaction-presentation';
import { periodLabel, periodRange } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import type { CategoryId, Transaction } from '@/lib/types';

const RECENT_TRANSACTION_LIMIT = 6;

/** The one category every row shares, or null when they differ (or there are none). */
function sharedCategory(rows: readonly Transaction[]): CategoryId | null {
  const first = rows[0]?.category;
  return first && rows.every(row => row.category === first) ? first : null;
}

export default function MerchantRoute() {
  const { name, type } = useLocalSearchParams<{ name?: string | string[]; type?: string | string[] }>();
  const merchant = typeof name === 'string' ? name.trim() : '';
  const activityType = type === 'income' ? 'income' : 'expense';
  return <MerchantScreen key={`${merchant}:${activityType}`} merchant={merchant} activityType={activityType} />;
}

/**
 * One merchant in design language E. A Spending detail, so it wears the clay
 * band: the logo tile, name and payment count, the period's total with the
 * average under it, and the month-by-month bars. The sheet holds the
 * "Always <category>" rule, Ask, the recent rows (at most six) and the
 * handoff to every transaction.
 */
function MerchantScreen({ merchant, activityType }: { merchant: string; activityType: Transaction['type'] }) {
  const { categoryLabel } = useCategoryCatalog();
  const router = useRouter(); const language = useLanguage();
  const band = useBand('spending');
  const large = useLargeTextLayout(); const { state } = useStore(); const { period, setPeriod } = usePeriod();
  const w = merchantSpendingCopy[language === 'ar' ? 'ar' : 'en'];
  const income = activityType === 'income';
  const [view, setView] = useState<'spending' | 'received' | 'all'>(income ? 'received' : 'spending');
  const [entry, setEntry] = useState<Transaction | null>(null); const [periodOpen, setPeriodOpen] = useState(false);
  const live = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = internalTransferIdsForState(state);
  const accountById = useMemo(() => new Map(state.accounts.map(account => [account.id, account])), [state.accounts]);
  const summary = useMemo(() => projectMerchantSpending(state.transactions, merchant, period, live, internal),
    // monthKey reads the StoreProvider's active salary-day setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.transactions, merchant, period, live, internal, state.monthStartDay]);
  const primaryRows = income ? summary.received : summary.spending;
  const primaryTotal = income ? summary.receivedFils : summary.totalFils;
  const average = income ? summary.averageReceivedFils : summary.averageFils;
  const approximate = income ? summary.averageReceivedApproximate : summary.averageApproximate;
  const matches = view === 'received' ? summary.received : view === 'spending' ? summary.spending : summary.activity;
  const activityTitle = income ? w.incomeActivity : w.activity;
  const pickLabel = income ? w.pickSource : w.pick;
  const fallback = income ? '/transactions?type=income' : '/merchants';
  const data = useMemo(() => matches.slice(0, RECENT_TRANSACTION_LIMIT), [matches]);
  const openEntry = useCallback((tx: Transaction) => setEntry(tx), []);
  const category = sharedCategory(primaryRows);
  const representative = summary.activity[0];
  const displayName = representative ? transactionPresentation(representative, language).title : merchant;
  const lang = language === 'ar' ? 'ar' : 'en';
  const range = periodRange(period);
  const countLabel = income ? w.incomeCount : w.purchases;
  const averageLabel = `${income ? w.averageReceived : w.average}${approximate ? ' ≈' : ''}`;
  const tileText = statTileColors(band, 'band');

  const bandContent = state.hydrated ? <View style={styles.band}>
    <View style={[styles.identity, large && styles.stack]}>
      <MerchantAvatar title={merchant} category={summary.activity[0]?.category ?? 'other'} size={56} />
      <View style={styles.identityCopy}>
        <ThemedText type="title" accessibilityRole="header" numberOfLines={large ? undefined : 2}
          style={[styles.name, { color: band.onBand }]}>{displayName || pickLabel}</ThemedText>
        {/* A category only when every row shares it; mixed rows name none. */}
        {category ? <ThemedText type="small" style={{ color: band.onBandSecondary }}>{categoryLabel(category, lang)}</ThemedText> : null}
      </View>
    </View>
    <BandFigure testID={income ? 'merchant-total-received' : 'merchant-total-spent'} palette={band}
      label={`${income ? w.totalReceived : w.total} · ${periodLabel(period)}`} fils={primaryTotal}
      qualifier={range ?? undefined} />
    <View style={[styles.tiles, large && styles.stack]}>
      <StatTile palette={band} label={countLabel} accessibilityLabel={`${countLabel}: ${primaryRows.length}`}
        style={large ? styles.tileFull : undefined}>
        <ThemedText type="title" tabular testID={income ? 'merchant-income-count' : 'merchant-purchase-count'}
          style={[styles.tileFigure, { color: tileText.fg }]}>{primaryRows.length}</ThemedText>
      </StatTile>
      {average !== null && <StatTile palette={band} label={averageLabel} style={large ? styles.tileFull : undefined}>
        <BandFigure palette={band} size="medium" fils={average} color={tileText.fg} secondaryColor={tileText.fgSecondary}
          fitInset={large ? 28 : 200} />
      </StatTile>}
    </View>
    {merchant ? <MerchantMonthBars transactions={state.transactions} merchant={merchant} period={period}
      live={live} internal={internal} kind={income ? 'income' : 'expense'} monthStartDay={state.monthStartDay} palette={band} /> : null}
  </View> : null;

  return <>
    <BandScaffold band="spending" testID="merchant-detail" contentStyle={styles.sheet}
      nav={{
        back: () => router.canGoBack() ? router.back() : router.replace(fallback),
        title: activityTitle,
        actions: [{ icon: 'calendar', label: everydayBandCopy(language).choosePeriod(periodLabel(period)),
          onPress: () => setPeriodOpen(true), testID: 'merchant-period' }],
      }}
      bandContent={bandContent}>
      {!state.hydrated ? <View style={styles.empty}><SkeletonRows count={3} height={80} /></View> : <>
        {merchant ? <MerchantCategoryRule merchant={merchant} kind={income ? 'income' : 'expense'} palette={band} /> : null}
        {merchant && view !== 'all' && <View testID="merchant-ask-wafra">
          <EButton palette={band} variant="secondary" icon="spark"
            label={income ? assistantCopy.askIncome : assistantCopy.askMerchant}
            onPress={() => router.push({ pathname: '/assistant', params: { question: income
              ? assistantCopy.incomeQuestion(merchant)
              : assistantCopy.merchantChangedQuestion(merchant) } })} />
        </View>}
        {!income && summary.received.length > 0 && <View style={[styles.received, { backgroundColor: band.card, borderColor: band.rule }]}
          testID="merchant-money-received">
          <View style={styles.receivedRow}>
            <ThemedText type="smallBold" style={{ color: band.text }}>{w.received}</ThemedText>
            <Money fils={summary.receivedFils} type="smallBold" color={band.text} />
          </View>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{w.receivedNote}</ThemedText>
        </View>}
        <SegmentedControl value={view} onChange={setView} label={activityTitle} segments={[
          income ? { value: 'received', label: w.income } : { value: 'spending', label: w.spending }, { value: 'all', label: w.allActivity },
        ]} />
        <View style={styles.recentHeading}>
          <ThemedText type="subtitle" accessibilityRole="header" style={{ color: band.text }}>{w.recent}</ThemedText>
          <ThemedText type="meta" style={{ color: band.textSecondary }} accessibilityLiveRegion="polite">{data.length} / {matches.length}</ThemedText>
        </View>
        {data.length === 0 ? <View style={styles.empty} testID="merchant-recent-empty">
          <ThemedText type="smallBold" style={{ color: band.text }}>{view === 'received' ? w.incomeEmpty : view === 'spending' ? w.empty : w.emptyActivity}</ThemedText>
          <EButton palette={band} variant="secondary" label={merchant ? w.allTime : pickLabel}
            onPress={() => merchant ? setPeriod({ mode: 'all' }) : router.replace(fallback)} />
        </View> : <View testID="merchant-recent-rows">
          {data.map((item, index) => <View key={item.id} testID="merchant-recent-row"
            style={[styles.transaction, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: band.rule }]}>
            <ThemedText type="meta" style={{ color: band.textSecondary }}>{item.date}</ThemedText>
            <TransactionRow transaction={item} account={accountById.get(item.accountId)} internal={internal.has(item.id)}
              onPress={openEntry} merchantLinks={false} />
            {!countsInTotals(item, live, internal) && <ThemedText type="meta" style={{ color: band.textSecondary }}>
              {income ? w.excludedIncomeRow : w.excludedRow}</ThemedText>}
          </View>)}
        </View>}
        <View style={styles.footer}>
          {merchant && <View testID="merchant-view-all-transactions"><EButton palette={band} variant="secondary"
            label={view === 'received' ? w.viewAllIncome : w.viewAllTransactions}
            onPress={() => router.push(`/transactions?type=${view === 'received' ? 'income' : 'all'}&merchant=${encodeURIComponent(merchant)}`)} /></View>}
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{income ? w.incomeExclusions : w.exclusions}</ThemedText>
          {(view === 'received' ? summary.hasConvertedIncome : view === 'spending' ? summary.hasConvertedAmounts :
            summary.hasConvertedAmounts || summary.hasConvertedIncome) &&
            <ThemedText type="meta" style={{ color: band.textSecondary }}>{w.converted}</ThemedText>}
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{income ? w.sourceIdentity : w.identity} {income ? w.incomePeriod : w.sharedPeriod}</ThemedText>
        </View>
      </>}
    </BandScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
    <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} showMerchantLink={false} />
  </>;
}

const styles = StyleSheet.create({
  band: { gap: 18 },
  sheet: { gap: 14 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  identityCopy: { flex: 1, minWidth: 140, gap: 2 },
  name: { fontFamily: Fonts.sansSemi, letterSpacing: -0.6 },
  tiles: { flexDirection: 'row', gap: 10 },
  tileFull: { alignSelf: 'stretch', flex: 0 },
  tileFigure: { fontFamily: Fonts.sansSemi, fontSize: 22, lineHeight: 28 },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
  recentHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingTop: 6 },
  received: { gap: 6, paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1, borderRadius: 18 },
  receivedRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  transaction: { paddingVertical: 8 },
  empty: { gap: 16, paddingVertical: 24 },
  footer: { gap: 10, paddingTop: 12, paddingBottom: 12 },
});
