import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Platform, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { TransactionRow } from '@/components/transaction-row';
import { Button } from '@/components/ui/controls';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Money } from '@/components/ui/money';
import { SkeletonRows } from '@/components/ui/states';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ScreenScaffold, useScreenContentInsets } from '@/components/ui/screen-scaffold';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { countsInTotals, internalTransferIds, liveAccountIds } from '@/lib/ledger';
import { projectMerchantSpending } from '@/lib/merchant-spending';
import { merchantSpendingCopy } from '@/lib/merchant-spending-copy';
import { periodLabel, periodRange } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import type { Transaction } from '@/lib/types';

const transactionKey = (tx: Transaction) => tx.id;
const RECENT_TRANSACTION_LIMIT = 6;

export default function MerchantRoute() {
  const { name, type } = useLocalSearchParams<{ name?: string | string[]; type?: string | string[] }>();
  const merchant = typeof name === 'string' ? name.trim() : '';
  const activityType = type === 'income' ? 'income' : 'expense';
  return <MerchantScreen key={`${merchant}:${activityType}`} merchant={merchant} activityType={activityType} />;
}

function MerchantScreen({ merchant, activityType }: { merchant: string; activityType: Transaction['type'] }) {
  const router = useRouter(); const theme = useTheme(); const language = useLanguage();
  const large = useLargeTextLayout(); const { state } = useStore(); const { period, setPeriod } = usePeriod();
  const w = merchantSpendingCopy[language === 'ar' ? 'ar' : 'en'];
  const insets = useScreenContentInsets({ hasFooter: false });
  const income = activityType === 'income';
  const [view, setView] = useState<'spending' | 'received' | 'all'>(income ? 'received' : 'spending');
  const [entry, setEntry] = useState<Transaction | null>(null); const [periodOpen, setPeriodOpen] = useState(false);
  const live = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = useMemo(() => internalTransferIds(state.transactions, state.accounts), [state.transactions, state.accounts]);
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
  const renderRow = useCallback(({ item }: { item: Transaction }) => <View style={[styles.transaction, { borderColor: theme.cardBorder }]}>
    <ThemedText type="meta" themeColor="textSecondary">{item.date}</ThemedText>
    <TransactionRow transaction={item} account={accountById.get(item.accountId)} internal={internal.has(item.id)} onPress={openEntry} merchantLinks={false} />
    {!countsInTotals(item, live, internal) && <ThemedText type="meta" themeColor="textSecondary">{income ? w.excludedIncomeRow : w.excludedRow}</ThemedText>}
  </View>, [theme.cardBorder, accountById, internal, live, openEntry, income, w.excludedIncomeRow, w.excludedRow]);

  return <>
    <ScreenScaffold scroll={false} virtualized testID="merchant-detail"
      header={{ title: activityTitle, back: { label: w.back, onPress: () => router.canGoBack() ? router.back() : router.replace(fallback) } }}>
      {!state.hydrated ? <View style={styles.empty}><SkeletonRows count={3} height={80} /></View> :
      <FlatList data={data} renderItem={renderRow} keyExtractor={transactionKey}
        contentContainerStyle={[insets.contentContainerStyle, styles.listContent]} contentInset={insets.contentInset}
        scrollIndicatorInsets={insets.scrollIndicatorInsets} contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled" initialNumToRender={12} maxToRenderPerBatch={10} windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        ListHeaderComponent={<View style={styles.header}>
          <View style={styles.identity}><MerchantAvatar title={merchant} category={summary.activity[0]?.category ?? 'other'} size={48} />
            <ThemedText type="heading" style={styles.name}>{merchant || pickLabel}</ThemedText></View>
          <View testID="merchant-period" style={styles.period}><Button label={periodLabel(period)} icon="calendar" variant="ghost" wrapLabel onPress={() => setPeriodOpen(true)} /></View>
          {periodRange(period) ? <ThemedText type="meta" themeColor="textSecondary">{periodRange(period)}</ThemedText> : null}
          <View style={styles.hero} testID={income ? 'merchant-total-received' : 'merchant-total-spent'}>
            <ThemedText type="small" themeColor="textSecondary">{income ? w.totalReceived : w.total}</ThemedText>
            <Money fils={primaryTotal} type="display" color={income ? theme.income : undefined} />
          </View>
          <View style={[styles.facts, { borderColor: theme.cardBorder }, large && styles.stack]}>
            <View style={styles.fact}><ThemedText type="meta" themeColor="textSecondary">{income ? w.incomeCount : w.purchases}</ThemedText>
              <ThemedText type="heading" tabular testID={income ? 'merchant-income-count' : 'merchant-purchase-count'}>{primaryRows.length}</ThemedText></View>
            {average !== null && <View style={styles.fact}>
              <ThemedText type="meta" themeColor="textSecondary">{income ? w.averageReceived : w.average}{approximate ? ' ≈' : ''}</ThemedText>
              <Money fils={average} type="smallBold" /></View>}
          </View>
          {!income && summary.received.length > 0 && <View style={styles.received} testID="merchant-money-received">
            <ThemedText type="smallBold">{w.received}</ThemedText><Money fils={summary.receivedFils} type="smallBold" color={theme.income} />
            <ThemedText type="meta" themeColor="textSecondary">{w.receivedNote}</ThemedText>
          </View>}
          <ThemedText type="meta" themeColor="textSecondary">{income ? w.incomeExclusions : w.exclusions}</ThemedText>
          <SegmentedControl value={view} onChange={setView} label={activityTitle} segments={[
            income ? { value: 'received', label: w.income } : { value: 'spending', label: w.spending }, { value: 'all', label: w.allActivity },
          ]} />
          <View style={styles.recentHeading}>
          <ThemedText type="smallBold">{w.recent}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary" accessibilityLiveRegion="polite">{data.length} / {matches.length}</ThemedText>
          </View>
        </View>}
        ListEmptyComponent={<View style={styles.empty}><ThemedText type="smallBold">{view === 'received' ? w.incomeEmpty : view === 'spending' ? w.empty : w.emptyActivity}</ThemedText>
          <Button label={merchant ? w.allTime : pickLabel} variant="outline" onPress={() => merchant ? setPeriod({ mode: 'all' }) : router.replace(fallback)} />
        </View>}
        ListFooterComponent={<View style={styles.footer}>
          {merchant && <View testID="merchant-view-all-transactions"><Button label={view === 'received' ? w.viewAllIncome : w.viewAllTransactions}
            variant="outline" icon="arrow-up-right" wrapLabel
            onPress={() => router.push(`/transactions?type=${view === 'received' ? 'income' : 'all'}&merchant=${encodeURIComponent(merchant)}`)} /></View>}
          {(view === 'received' ? summary.hasConvertedIncome : view === 'spending' ? summary.hasConvertedAmounts :
            summary.hasConvertedAmounts || summary.hasConvertedIncome) &&
            <ThemedText type="meta" themeColor="textSecondary">{w.converted}</ThemedText>}
          <ThemedText type="meta" themeColor="textSecondary">{income ? w.sourceIdentity : w.identity} {income ? w.incomePeriod : w.sharedPeriod}</ThemedText>
        </View>} />}
    </ScreenScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
    <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} showMerchantLink={false} />
  </>;
}

const styles = StyleSheet.create({
  listContent: { gap: 0 },
  header: { gap: 12, paddingBottom: 12 }, identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  period: { alignSelf: 'flex-start', maxWidth: '100%' },
  recentHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { flex: 1, minWidth: 0 }, hero: { gap: 6, paddingVertical: 8 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  fact: { flex: 1, minWidth: 110, gap: 6 }, stack: { flexDirection: 'column' },
  received: { gap: 8 }, transaction: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  empty: { gap: 16, paddingVertical: 24 }, footer: { gap: 8, paddingVertical: 24 },
});
