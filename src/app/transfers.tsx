import { useRouter } from '@/hooks/use-app-router';
import React, { useDeferredValue, useMemo, useState } from 'react';
import { FlatList, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';

import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { TransferQuestionCard } from '@/components/transfers/transfer-question-card';
import { TransferRouteRow } from '@/components/transfers/transfer-route-row';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { BandFigure } from '@/components/ui/band/band-figure';
import { BandScaffold, useBandBottomInset } from '@/components/ui/band-scaffold';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { PeriodPill } from '@/components/ui/period-pill';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { useTransferAnswer } from '@/hooks/use-transfer-answer';
import { formatAED } from '@/lib/format';
import { t } from '@/lib/i18n';
import { accountDisplayName, transferReconciliationForState } from '@/lib/ledger';
import { formatMinorUnits } from '@/lib/ledger-money';
import { inPeriod, isCurrentMonth, periodLabel } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import { getTransferActivity } from '@/lib/transfer-activity';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { ownCandidates, type TransferAnswer } from '@/lib/transfer-answer';
import { filterTransferItems, transferListItems, transferTotals, type TransferTile } from '@/lib/transfer-list';
import { matchedTransferPairs } from '@/lib/transfer-pairs';
import { reconcileTransfers } from '@/lib/transfer-reconciliation';

type Activity = ReturnType<typeof getTransferActivity>[number];
const TILES = [['own', 'repeat'], ['sent', 'arrow-up-right'], ['received', 'arrow-down-right']] as const;

export default function TransfersScreen() {
  const router = useRouter();
  const band = useBand('accounts');
  const language = useLanguage();
  const words = transferActivityCopy(language);
  const large = useLargeTextLayout();
  const moneySpec = useLedgerMoney();
  const { state } = useStore();
  const { period } = usePeriod();
  const listBottom = useBandBottomInset();
  const { answer, busy } = useTransferAnswer();
  const [tile, setTile] = useState<TransferTile | null>(null);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim().toLocaleLowerCase());
  const [periodOpen, setPeriodOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Reuse the reconciliation keyed on the stored transfer receipt. Only while a
  // history import holds a provisional receipt does this dedicated screen
  // build the graph itself (array-identity memoized in the reconciler).
  const storedReconciliation = transferReconciliationForState(state);
  const reconciliation = useMemo(() => storedReconciliation ?? reconcileTransfers(state.transactions, state.accounts),
    [storedReconciliation, state.transactions, state.accounts]);
  const activity = useMemo(() => getTransferActivity(state.transactions, state.accounts, reconciliation),
    [state.transactions, state.accounts, reconciliation]);
  const accounts = useMemo(() => new Map(state.accounts.map(account => [account.id, account])), [state.accounts]);
  const selected = selectedId ? activity.find(item => item.transaction.id === selectedId) : undefined;
  const rowsById = useMemo(() => new Map(state.transactions.map(row => [row.id, row] as const)), [state.transactions]);
  // Pairs the reconciler has confirmed, both legs naming each other, in the selected period.
  const pairs = useMemo(() => matchedTransferPairs(reconciliation, rowsById, pair => inPeriod(pair.out.date, period)),
    // monthKey reads the StoreProvider's active salary-day setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reconciliation, rowsById, period, state.monthStartDay]);
  const accountName = (id: string) => {
    const account = accounts.get(id);
    return account ? accountDisplayName(account) : words.accountUnknown;
  };
  const moneyLabel = (fils: number) => moneySpec
    ? `${moneySpec.currency} ${formatMinorUnits(fils, moneySpec, { decimals: true })}`
    : formatAED(fils, { decimals: true });
  const matchesSearch = (item: Activity) => {
    if (!search) return true;
    const account = accounts.get(item.transaction.accountId);
    return [item.transaction.title, account?.name, account?.bankName, account?.last4,
      item.transaction.transferEvidence?.counterpartyName,
      item.transaction.transferEvidence?.counterparty?.last4].filter(Boolean).join(' ').toLocaleLowerCase().includes(search);
  };
  const inView = useMemo(() => activity.filter(item => inPeriod(item.transaction.date, period) && matchesSearch(item)),
    // monthKey reads the StoreProvider's active salary-day setting; matchesSearch closes over search and accounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activity, period, search, accounts, state.monthStartDay]);
  const items = useMemo(() => transferListItems(inView, pairs), [inView, pairs]);
  const totals = useMemo(() => transferTotals(items), [items]);
  const shown = useMemo(() => filterTransferItems(items, tile), [items, tile]);
  // The questions are the reconciler's queue, newest first, whatever the period or search.
  // Saving an answer takes the row out of the queue, so the card always shows the first one.
  const queue = useMemo(() => activity.filter(item => item.needsReview)
    .sort((a, b) => b.transaction.date.localeCompare(a.transaction.date) || (b.transaction.ts ?? 0) - (a.transaction.ts ?? 0)), [activity]);
  const current = queue[0];
  const hint = current ? (() => {
    const [candidate] = ownCandidates(current.transaction, current.assessment, rowsById);
    return candidate ? words.card.looksLike(accountName(candidate.accountId)) : undefined;
  })() : undefined;
  const answerCurrent = async (choice: TransferAnswer) => {
    if (!current) return;
    const candidates = ownCandidates(current.transaction, current.assessment, rowsById);
    // Several accounts could be the other side: the detail sheet asks which.
    if (choice === 'own' && candidates.length > 1) { setSelectedId(current.transaction.id); return; }
    const labels = current.transaction.type === 'income' ? words.answers.in : words.answers.out;
    await answer({ transaction: current.transaction, answer: choice, counterpart: candidates[0], label: labels[choice] });
  };

  return <>
    <BandScaffold band="accounts" scroll={false} testID="transfers-screen" contentStyle={styles.sheet}
      nav={{ back: () => { if (router.canGoBack()) router.back(); else router.replace('/wallet'); }, title: words.title }}
      bandContent={<View testID="transfers-band" style={styles.bandIntro}>
        <BandFigure label={words.headline(periodLabel(period))} fils={totals.ownFils} decimals palette={band}
          qualifier={words.notCounted} />
        <View style={[styles.tiles, large && styles.tilesStack]}>
          {TILES.map(([key, icon]) => {
            const on = tile === key;
            const fils = key === 'own' ? totals.ownFils : key === 'sent' ? totals.sentFils : totals.receivedFils;
            return <Pressable key={key} testID={`transfers-tile-${key}`} accessibilityRole="button"
              accessibilityState={{ selected: on }} accessibilityLabel={`${words.tiles[key]}. ${moneyLabel(fils)}`}
              onPress={() => setTile(on ? null : key)}
              style={[styles.tile, { backgroundColor: on ? band.onBand : band.tile }]}>
              <Icon name={icon} size={15} color={on ? band.band : band.onBand} />
              <ThemedText type="meta" style={{ color: on ? band.band : band.onBandSecondary }}>{words.tiles[key]}</ThemedText>
              <Money fils={fils} type="smallBold" decimals color={on ? band.band : band.onBand} />
            </Pressable>;
          })}
        </View>
      </View>}>
      <FlatList
        testID="transfer-history"
        data={shown}
        keyExtractor={item => item.key}
        contentContainerStyle={[styles.content, { paddingBottom: listBottom }]}
        scrollIndicatorInsets={{ top: 0, bottom: listBottom }}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        initialNumToRender={14} maxToRenderPerBatch={10} windowSize={9}
        ListHeaderComponent={<View style={styles.controls}>
          <View style={styles.context}><PeriodPill onPress={() => setPeriodOpen(true)} /></View>
          <TextField label={words.search} value={query} onChangeText={setQuery}
            inputMode="search" returnKeyType="search" placeholder={words.searchPlaceholder}
            onSubmitEditing={() => Keyboard.dismiss()}
            leading={<Icon name="search" size={17} color={band.textSecondary} />}
            trailing={query ? <ActionIconButton icon="close" label={t('clearSearch', language)}
              variant="plain" onPress={() => setQuery('')} /> : undefined} />
          {current ? <TransferQuestionCard transaction={current.transaction} index={0} total={queue.length}
            accountLabel={accountName(current.transaction.accountId)} hint={hint} palette={band} busy={busy}
            onAnswer={answerCurrent} onSeeAll={() => router.push('/review-transfers')} /> : null}
          <ThemedText type="smallBold" accessibilityRole="header">
            {isCurrentMonth(period) ? words.listTitle : periodLabel(period)}
          </ThemedText>
        </View>}
        renderItem={({ item, index }) => <View style={[styles.rowCard, { backgroundColor: band.card },
          index === 0 && styles.rowCardFirst, index === shown.length - 1 && styles.rowCardLast]}>
          <TransferRouteRow item={item} first={index === 0} accountLabel={accountName} palette={band}
            onPress={() => { Keyboard.dismiss(); setSelectedId(item.transactionId); }} />
        </View>}
        ListEmptyComponent={<View style={styles.empty}><Icon name="repeat" size={30} color={band.textSecondary} />
          <ThemedText type="heading">{words.empty}</ThemedText><ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>{words.emptyBody}</ThemedText></View>}
      />
    </BandScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
    <EntryDetailSheet transaction={selected?.transaction ?? null} transferAssessment={selected?.assessment}
      showMerchantLink={false} onClose={() => setSelectedId(null)} />
  </>;
}

const styles = StyleSheet.create({
  bandIntro: { gap: Spacing.three },
  tiles: { flexDirection: 'row', gap: Spacing.two },
  tilesStack: { flexDirection: 'column' },
  tile: { flex: 1, minHeight: 72, borderRadius: 14, padding: Spacing.two, gap: 2 },
  sheet: { paddingTop: Spacing.two },
  content: { gap: 0 }, controls: { gap: Spacing.three, paddingBottom: Spacing.two },
  context: { flexDirection: 'row', alignItems: 'center' },
  rowCard: { paddingHorizontal: Spacing.three },
  rowCardFirst: { borderTopStartRadius: 18, borderTopEndRadius: 18 },
  rowCardLast: { borderBottomStartRadius: 18, borderBottomEndRadius: 18 },
  empty: { alignItems: 'center', paddingVertical: Spacing.five, gap: Spacing.three },
  emptyCopy: { textAlign: 'center' },
});
