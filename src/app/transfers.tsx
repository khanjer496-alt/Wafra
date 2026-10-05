import { useRouter } from '@/hooks/use-app-router';
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';

import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { introCues, legTags, newlyOwnRoutes, type CoinCue } from '@/components/transfer-coins/coin-cues';
import { TransferQuestionCard } from '@/components/transfers/transfer-question-card';
import { TransferRouteRow } from '@/components/transfers/transfer-route-row';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { BandFigure } from '@/components/ui/band/band-figure';
import { BandScaffold, useBandBottomInset } from '@/components/ui/band-scaffold';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { useTransferAnswer } from '@/hooks/use-transfer-answer';
import { formatAED } from '@/lib/format';
import { t, tf } from '@/lib/i18n';
import { accountDisplayName, transferReconciliationForState } from '@/lib/ledger';
import { formatMinorUnits } from '@/lib/ledger-money';
import { inPeriod, isCurrentMonth, periodLabel } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import { getTransferActivity, onePerPair } from '@/lib/transfer-activity';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { ownCandidates, type TransferAnswer } from '@/lib/transfer-answer';
import { filterTransferItems, transferListItems, transferTotals, type TransferTag, type TransferTile } from '@/lib/transfer-list';
import { matchedTransferPairs } from '@/lib/transfer-pairs';
import { reconcileTransfers } from '@/lib/transfer-reconciliation';
import type { Transaction } from '@/lib/types';

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
  // Set with selectedId when the sheet opens for the several-accounts question: it starts on the picker.
  const [pickFor, setPickFor] = useState<string | null>(null);
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
  // A confirmed pair belongs to the period of its outgoing leg and is always listed whole:
  // both legs come in with it, and the incoming leg of a pair that left in another period stays out.
  const allPairs = useMemo(() => matchedTransferPairs(reconciliation, rowsById), [reconciliation, rowsById]);
  const pairs = useMemo(() => allPairs.filter(pair => inPeriod(pair.out.date, period)),
    // monthKey reads the StoreProvider's active salary-day setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allPairs, period, state.monthStartDay]);
  const accountName = (id: string) => {
    const account = accounts.get(id);
    return account ? accountDisplayName(account) : words.accountUnknown;
  };
  const moneyLabel = (fils: number) => moneySpec
    ? `${moneySpec.currency} ${formatMinorUnits(fils, moneySpec, { decimals: true })}`
    : formatAED(fils, { decimals: true });
  const matchesSearch = (tx: Transaction) => {
    const account = accounts.get(tx.accountId);
    return [tx.title, account?.name, account?.bankName, account?.last4,
      tx.transferEvidence?.counterpartyName,
      tx.transferEvidence?.counterparty?.last4].filter(Boolean).join(' ').toLocaleLowerCase().includes(search);
  };
  const periodItems = useMemo(() => {
    const inPair = new Set(pairs.flatMap(pair => [pair.out.id, pair.in.id]));
    const outOfPeriod = new Set(allPairs.flatMap(pair => inPair.has(pair.out.id) ? [] : [pair.out.id, pair.in.id]));
    return transferListItems(activity.filter(item => !outOfPeriod.has(item.transaction.id)
      && (inPair.has(item.transaction.id) || inPeriod(item.transaction.date, period))), pairs);
  // monthKey reads the StoreProvider's active salary-day setting.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, allPairs, pairs, period, state.monthStartDay]);
  const pairsByKey = useMemo(() => new Map(pairs.map(pair => [pair.key, pair])), [pairs]);
  // Search is applied to whole routes: a pair matches when either leg does.
  const items = useMemo(() => !search ? periodItems : periodItems.filter(item => {
    const pair = pairsByKey.get(item.key);
    const legs = pair ? [pair.out, pair.in] : [rowsById.get(item.transactionId)];
    return legs.some(tx => !!tx && matchesSearch(tx));
  // matchesSearch closes over search and accounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [periodItems, pairsByKey, rowsById, search, accounts]);
  const totals = useMemo(() => transferTotals(items), [items]);
  const shown = useMemo(() => filterTransferItems(items, tile), [items, tile]);
  // A coin travels a route when the list first appears (the first few rows only) and again
  // the moment a route's money is explained as moving between the person's own accounts,
  // however it was answered (the card, the detail sheet, the batch review).
  const [coins, setCoins] = useState<ReadonlyMap<string, CoinCue>>(() => new Map());
  const introduced = useRef(false);
  const lastTags = useRef<ReadonlyMap<string, TransferTag> | null>(null);
  useEffect(() => {
    if (introduced.current || !shown.length) return;
    introduced.current = true;
    const intro = introCues(shown.map(item => item.key), Date.now());
    setCoins(previous => new Map([...previous, ...intro]));
  }, [shown]);
  useEffect(() => {
    const previous = lastTags.current;
    lastTags.current = legTags(periodItems);
    if (!previous) return;
    const arrived = newlyOwnRoutes(previous, periodItems);
    if (!arrived.length) return;
    const at = Date.now();
    setCoins(cues => new Map([...cues, ...arrived.map(key => [key, { at, delay: 0 }] as const)]));
  }, [periodItems]);
  // The questions are the reconciler's queue, newest first, whatever the period or search.
  // Saving an answer takes the row out of the queue, so the card always shows the first one.
  // A pair with both legs queued is one movement: one question, asked about its outgoing leg.
  const queue = useMemo(() => onePerPair(activity.filter(item => item.needsReview)
    .sort((a, b) => b.transaction.date.localeCompare(a.transaction.date) || (b.transaction.ts ?? 0) - (a.transaction.ts ?? 0))), [activity]);
  const current = queue[0];
  const hint = useMemo(() => {
    if (!current) return undefined;
    const [candidate] = ownCandidates(current.transaction, current.assessment, rowsById);
    return candidate ? words.card.looksLike(accountName(candidate.accountId)) : undefined;
  // accountName reads accounts and the language's copy.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, rowsById, accounts, words]);
  const answerCurrent = async (choice: TransferAnswer) => {
    if (!current) return;
    const candidates = ownCandidates(current.transaction, current.assessment, rowsById);
    // Several accounts could be the other side: the detail sheet asks which.
    if (choice === 'own' && candidates.length > 1) { setSelectedId(current.transaction.id); setPickFor(current.transaction.id); return; }
    const labels = current.transaction.type === 'income' ? words.answers.in : words.answers.out;
    await answer({ transaction: current.transaction, answer: choice, counterpart: candidates[0], label: labels[choice] });
  };

  // At the default sizes the tiles sit on the band; at accessibility text sizes they would crowd the
  // list out of the screen, so they move onto the sheet and scroll away with it.
  const tilesOnBand = !large;
  const tiles = <View testID="transfers-tiles" style={[styles.tiles, large && styles.tilesStack]}>
    {TILES.map(([key, icon]) => {
      const on = tile === key;
      const fils = key === 'own' ? totals.ownFils : key === 'sent' ? totals.sentFils : totals.receivedFils;
      const counted = key !== 'own';
      const ground = tilesOnBand ? (on ? band.onBand : band.tile) : (on ? band.fill : band.card);
      const ink = tilesOnBand ? (on ? band.band : band.onBand) : (on ? band.onFill : band.text);
      const quiet = tilesOnBand ? (on ? band.band : band.onBandSecondary) : (on ? band.onFill : band.textSecondary);
      return <Pressable key={key} testID={`transfers-tile-${key}`} accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${words.tiles[key]}. ${moneyLabel(fils)}${counted ? `. ${words.tiles.counted}` : ''}`}
        onPress={() => setTile(on ? null : key)}
        style={[styles.tile, { backgroundColor: ground }, !tilesOnBand && { borderWidth: 1, borderColor: on ? band.fill : band.rule }]}>
        <Icon name={icon} size={15} color={ink} />
        <ThemedText type="meta" style={{ color: quiet }}>{words.tiles[key]}</ThemedText>
        <Money fils={fils} type="smallBold" decimals color={ink} currencyColor={quiet} />
        {counted ? <ThemedText type="micro" style={{ color: quiet }}>{words.tiles.counted}</ThemedText> : null}
      </Pressable>;
    })}
  </View>;
  // The period sits in the nav row (the Spending pattern); the picker sheet is unchanged.
  const periodChip = <Pressable testID="transfers-period" accessibilityRole="button"
    accessibilityLabel={tf('reportingPeriod', { period: periodLabel(period) }, language)}
    onPress={() => setPeriodOpen(true)} style={[styles.periodChip, { backgroundColor: band.tile }]}>
    <ThemedText type="smallBold" style={[styles.periodLabel, { color: band.onBand }]}>{periodLabel(period)}</ThemedText>
    <Icon name="chevron-down" size={16} color={band.onBand} />
  </Pressable>;

  return <>
    <BandScaffold band="accounts" scroll={false} testID="transfers-screen" contentStyle={styles.sheet}
      nav={{ back: () => { if (router.canGoBack()) router.back(); else router.replace('/wallet'); }, title: words.title, trailing: periodChip }}
      bandContent={<View testID="transfers-band" style={styles.bandIntro}>
        <BandFigure label={words.headline(periodLabel(period))} fils={totals.ownFils} decimals palette={band}
          qualifier={words.notCounted} />
        {tilesOnBand ? tiles : null}
      </View>}>
      <FlatList
        testID="transfer-history"
        data={shown}
        extraData={coins}
        keyExtractor={item => item.key}
        contentContainerStyle={[styles.content, { paddingBottom: listBottom }]}
        scrollIndicatorInsets={{ top: 0, bottom: listBottom }}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        initialNumToRender={14} maxToRenderPerBatch={10} windowSize={9}
        ListHeaderComponent={<View style={styles.controls}>
          {tilesOnBand ? null : tiles}
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
          <TransferRouteRow item={item} first={index === 0} accountLabel={accountName} palette={band} coin={coins.get(item.key)}
            onPress={() => { Keyboard.dismiss(); setSelectedId(item.transactionId); }} />
        </View>}
        ListEmptyComponent={<View style={styles.empty}><Icon name="repeat" size={30} color={band.textSecondary} />
          {tile && items.length > 0 ? <>
            <ThemedText type="heading" style={styles.emptyCopy}>{words.emptyTile}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>{words.emptyTileBody}</ThemedText>
            <Pressable testID="transfers-clear-tile" accessibilityRole="button" onPress={() => setTile(null)} style={styles.clearTile}>
              <ThemedText type="linkPrimary" style={{ color: band.tint }}>{words.clearTile}</ThemedText>
            </Pressable>
          </> : <>
            <ThemedText type="heading" style={styles.emptyCopy}>{words.empty}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>{words.emptyBody}</ThemedText>
          </>}</View>}
      />
    </BandScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
    <EntryDetailSheet transaction={selected?.transaction ?? null} transferAssessment={selected?.assessment}
      showMerchantLink={false} startWithAccountPicker={!!selectedId && pickFor === selectedId}
      onClose={() => { setSelectedId(null); setPickFor(null); }} />
  </>;
}

const styles = StyleSheet.create({
  bandIntro: { gap: Spacing.three },
  tiles: { flexDirection: 'row', gap: Spacing.two },
  tilesStack: { flexDirection: 'column' },
  tile: { flex: 1, minHeight: 72, borderRadius: 14, padding: Spacing.two, gap: 2 },
  sheet: { paddingTop: Spacing.two },
  content: { gap: 0 }, controls: { gap: Spacing.three, paddingBottom: Spacing.two },
  periodChip: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%', flexShrink: 1 },
  periodLabel: { flexShrink: 1 },
  clearTile: { minHeight: 44, justifyContent: 'center' },
  rowCard: { paddingHorizontal: Spacing.three },
  rowCardFirst: { borderTopStartRadius: 18, borderTopEndRadius: 18 },
  rowCardLast: { borderBottomStartRadius: 18, borderBottomEndRadius: 18 },
  empty: { alignItems: 'center', paddingVertical: Spacing.five, gap: Spacing.three },
  emptyCopy: { textAlign: 'center' },
});
