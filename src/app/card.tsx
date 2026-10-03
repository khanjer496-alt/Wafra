import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/hooks/use-app-router';
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { KeyValueRows, type KeyValueRow } from '@/components/money-places/key-value-rows';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { TransactionRow } from '@/components/transaction-row';
import { BandScaffold, useBandBottomInset } from '@/components/ui/band-scaffold';
import { BandFigure } from '@/components/ui/band/band-figure';
import { EButton } from '@/components/ui/band/e-button';
import { Money } from '@/components/ui/money';
import { AccountTile } from '@/components/ui/tile';
import { Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { projectCardActivity } from '@/lib/card-activity';
import { cardActivityWords } from '@/lib/card-activity-copy';
import { shortDate, toISODate } from '@/lib/format';
import { periodLabel, periodRange } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStoreSelector } from '@/lib/store';
import type { Transaction } from '@/lib/types';

export default function CardRoute() {
  const { id, all } = useLocalSearchParams<{ id?: string | string[]; all?: string | string[] }>();
  return <CardScreen key={typeof id === 'string' ? id : ''} accountId={typeof id === 'string' ? id : ''} all={all === '1'} />;
}

function CardScreen({ accountId, all }: { accountId: string; all: boolean }) {
  const router = useRouter();
  const band = useBand('accounts');
  const language = useLanguage();
  const large = useLargeTextLayout();
  const bottomInset = useBandBottomInset();
  const { width } = useWindowDimensions();
  const w = cardActivityWords(language);
  const { period } = usePeriod();
  const [entry, setEntry] = useState<Transaction | null>(null);
  const [periodOpen, setPeriodOpen] = useState(false);
  const state = useStoreSelector(({ state: s }) => ({ hydrated: s.hydrated,
    accounts: s.accounts, transactions: s.transactions, cardDues: s.cardDues,
    monthStartDay: s.monthStartDay, ledgerMoney: s.ledgerMoney,
    transferInternalIds: s.transferInternalIds, transferNormalizationVersion: s.transferNormalizationVersion, historyImport: s.historyImport }));
  const account = state.accounts.find(a => a.id === accountId && (a.kind === 'card' || a.cardType));
  const activity = useMemo(() => account ? projectCardActivity(state, account, period) : null,
    // Salary-day changes alter inPeriod even when the selected month is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account, state.accounts, state.transactions, state.cardDues, state.monthStartDay, state.transferInternalIds, state.transferNormalizationVersion, state.historyImport, period]);
  const nav = { back: () => router.back(), title: w.title,
    actions: [{ icon: 'calendar' as const, label: `${w.choosePeriod}: ${periodLabel(period)}`,
      onPress: () => setPeriodOpen(true), testID: 'card-period' }] };
  if (!state.hydrated || !account || !activity) return <BandScaffold band="accounts" testID="card-screen" nav={nav}>
    <ThemedText>{state.hydrated ? w.missing : w.loading}</ThemedText>
  </BandScaffold>;
  const kind = account.cardType === 'credit' ? w.credit : account.cardType === 'debit' ? w.debit : w.card;
  const reported = account.snapshotTs !== undefined && Number.isFinite(account.snapshotTs)
    ? shortDate(toISODate(new Date(account.snapshotTs))) : null;
  const range = periodRange(period);
  // Side by side, each fact fits half the band: the other half and the gap are its inset.
  const factInset = large ? 0 : Math.ceil((width - 40) / 2 + Spacing.three / 2);
  // Card details as label · value rows; money values keep their own formatting.
  const money = (fils: number, testID?: string) => <View testID={testID}><Money fils={fils} decimals type="smallBold" color={band.text} /></View>;
  const details: KeyValueRow[] = [
    ...(account.bankName ? [{ key: 'issuer', label: w.issuer, value: account.bankName }] : []),
    ...(account.last4 ? [{ key: 'ending', label: w.ending, value: `•• ${account.last4}` }] : []),
    ...(activity.figure ? [{ key: 'figure', label: w[activity.figure.label], value: money(activity.figure.fils, 'card-known-figure') }] : []),
    ...(account.cardType === 'credit' && account.creditLimitFils !== undefined
      ? [{ key: 'limit', label: w.limit, value: money(account.creditLimitFils) }] : []),
    ...(account.cardType === 'credit' && account.snapshotKind === 'limit' && account.snapshotFils !== undefined
      ? [{ key: 'available', label: w.available, value: money(account.snapshotFils) }] : []),
    ...(reported ? [{ key: 'reported', label: w.asOf, value: reported }] : []),
  ];
  if (all) return <>
    <BandScaffold band="accounts" testID="card-all-screen" nav={{ ...nav, title: w.all }} scroll={false}
      contentStyle={styles.listContainer} bandContent={<ThemedText type="small" style={{ color: band.onBand }}>
        {account.name} · {periodLabel(period)}{range ? ` · ${range}` : ''}
      </ThemedText>}>
      <FlatList testID="card-all-list" data={activity.rows} keyExtractor={row => row.id}
        initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset }]}
        renderItem={({ item: row }) => <View>
          <ThemedText type="meta" themeColor="textSecondary">{shortDate(row.date)}</ThemedText>
          <TransactionRow transaction={row} account={account} onPress={setEntry} merchantLinks={false} internal={activity.internal.has(row.id)} />
        </View>}
        ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary">{w.empty}</ThemedText>} />
    </BandScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
    <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} showMerchantLink={false} />
  </>;
  return <>
    <BandScaffold band="accounts" testID="card-screen" nav={nav} contentStyle={styles.content}
      bandContent={<View style={styles.band}>
        <View style={[styles.identity, large && styles.stack]}>
          <AccountTile account={account} size={52} />
          <View style={styles.grow}>
            <ThemedText type="heading" accessibilityRole="header" style={{ color: band.onBand }}>{account.name}</ThemedText>
            <ThemedText type="small" style={{ color: band.onBandSecondary }}>{[kind, account.last4 ? `•• ${account.last4}` : null].filter(Boolean).join(' · ')}</ThemedText>
          </View>
        </View>
        {/* One hero: the period's captured spending, named with its period. */}
        <View style={styles.period}>
          <ThemedText type="smallBold" testID="card-selected-period" style={{ color: band.onBand }}>{periodLabel(period)}</ThemedText>
          {range ? <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{range}</ThemedText> : null}
        </View>
        <BandFigure palette={band} label={w.spending} fils={activity.spendingFils} decimals testID="card-spending" />
        {/* Credits and card payments are secondary facts, side by side (stacked at the large text sizes). */}
        <View style={[styles.figures, large && styles.figuresStacked]}>
          <BandFigure palette={band} size="medium" label={w.credits} fils={activity.creditsFils} decimals testID="card-credits"
            style={styles.fact} fitInset={factInset} />
          {activity.billable ? <BandFigure palette={band} size="medium" label={w.payments} fils={activity.paymentsFils} decimals testID="card-payments"
            style={styles.fact} fitInset={factInset} /> : null}
        </View>
      </View>}>
      <ThemedText type="meta" themeColor="textSecondary">{w.note}</ThemedText>
      <View style={styles.section} testID="card-activity">
        <ThemedText type="heading" accessibilityRole="header">{w.activity}</ThemedText>
        {activity.rows.length ? activity.rows.slice(0, 12).map(row => <View key={row.id}>
          <ThemedText type="meta" themeColor="textSecondary">{shortDate(row.date)}</ThemedText>
          <TransactionRow transaction={row} account={account} onPress={setEntry} merchantLinks={false} internal={activity.internal.has(row.id)} />
        </View>) : <ThemedText type="small" themeColor="textSecondary">{w.empty}</ThemedText>}
        <EButton palette={band} variant="secondary" label={w.all} testID="card-all-transactions"
          onPress={() => router.push(`/card?id=${encodeURIComponent(account.id)}&all=1`)} />
      </View>
      <View style={styles.section} testID="card-details">
        <ThemedText type="heading" accessibilityRole="header">{w.details}</ThemedText>
        {details.length ? <KeyValueRows rows={details} palette={band} /> : null}
        {activity.figure ? null : <ThemedText type="small" themeColor="textSecondary" testID="card-unknown-figure">{w.unknown}</ThemedText>}
        {activity.billable ? <EButton palette={band} label={w.statements} testID="card-statements"
          onPress={() => router.push(`/cards?card=${encodeURIComponent(account.id)}`)} /> : null}
      </View>
    </BandScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
    <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} showMerchantLink={false} />
  </>;
}

const styles = StyleSheet.create({
  listContainer: { flex: 1, paddingBottom: 0 }, listContent: { paddingBottom: 32, gap: Spacing.three },
  content: { gap: Spacing.four }, band: { gap: Spacing.three },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1 }, stack: { flexDirection: 'column', alignItems: 'stretch' },
  period: { gap: 2 },
  figures: { flexDirection: 'row', gap: Spacing.three }, figuresStacked: { flexDirection: 'column' },
  fact: { flex: 1, minWidth: 0 }, section: { gap: Spacing.three },
});
