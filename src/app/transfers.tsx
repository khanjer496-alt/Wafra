import { useRouter } from '@/hooks/use-app-router';
import React, { useDeferredValue, useMemo, useState } from 'react';
import { Keyboard, Platform, Pressable, SectionList, StyleSheet, View } from 'react-native';

import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { TransferPairAccounts } from '@/components/transfer-pair-accounts';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { BandScaffold, useBandBottomInset } from '@/components/ui/band-scaffold';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { PeriodPill } from '@/components/ui/period-pill';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextField } from '@/components/ui/text-field';
import { Fonts, Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { detailsWords } from '@/lib/details-copy';
import { formatAED, friendlyDate, shortDate, toISODate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { accountDisplayName, transferReconciliationForState } from '@/lib/ledger';
import { formatMinorUnits } from '@/lib/ledger-money';
import { inPeriod } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import { getTransferActivity } from '@/lib/transfer-activity';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { reconcileTransfers } from '@/lib/transfer-reconciliation';
import { matchedTransferPairs, suggestedTransferPairs } from '@/lib/transfer-pairs';

type Activity = ReturnType<typeof getTransferActivity>[number];
type Scope = 'all' | 'confirmed' | 'unconfirmed';
const MATCHED_PREVIEW = 5;

export default function TransfersScreen() {
  const router = useRouter();
  const band = useBand('accounts');
  const language = useLanguage();
  const words = transferActivityCopy(language);
  const d = detailsWords(language);
  const large = useLargeTextLayout();
  const moneySpec = useLedgerMoney();
  const { state } = useStore();
  const { period } = usePeriod();
  const listBottom = useBandBottomInset();
  const [scope, setScope] = useState<Scope>('all');
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
  const matched = useMemo(() => matchedTransferPairs(reconciliation, rowsById, pair => inPeriod(pair.out.date, period)),
    // monthKey reads the StoreProvider's active salary-day setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reconciliation, rowsById, period, state.monthStartDay]);
  const suggestedPairs = useMemo(() => suggestedTransferPairs(reconciliation, rowsById).length, [reconciliation, rowsById]);
  const [showAllMatched, setShowAllMatched] = useState(false);
  const accountName = (id: string) => {
    const account = accounts.get(id);
    return account ? accountDisplayName(account) : words.accountUnknown;
  };
  const moneyLabel = (fils: number) => moneySpec
    ? `${moneySpec.currency} ${formatMinorUnits(fils, moneySpec, { decimals: true })}`
    : formatAED(fils, { decimals: true });
  const today = toISODate(new Date());
  const sections = useMemo(() => {
    const days = new Map<string, Activity[]>();
    const rows = activity.filter(item => {
      if (!inPeriod(item.transaction.date, period)) return false;
      if (scope === 'confirmed' && !item.confirmed) return false;
      if (scope === 'unconfirmed' && item.confirmed) return false;
      if (!search) return true;
      const account = accounts.get(item.transaction.accountId);
      return [item.transaction.title, account?.name, account?.bankName, account?.last4,
        item.transaction.transferEvidence?.counterpartyName,
        item.transaction.transferEvidence?.counterparty?.last4].filter(Boolean).join(' ').toLocaleLowerCase().includes(search);
    }).sort((a, b) => b.transaction.date.localeCompare(a.transaction.date) ||
      (b.transaction.ts ?? 0) - (a.transaction.ts ?? 0));
    for (const row of rows) {
      const day = days.get(row.transaction.date) ?? [];
      day.push(row);
      days.set(row.transaction.date, day);
    }
    return [...days].map(([date, data]) => ({ title: friendlyDate(date, today), data }));
  // friendlyDate reads the current language internally; invalidate its labels
  // when the app changes language even though it is not a function argument.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, accounts, period, scope, search, today, language]);
  const count = sections.reduce((sum, day) => sum + day.data.length, 0);

  return <>
    <BandScaffold band="accounts" scroll={false} testID="transfers-screen" contentStyle={styles.sheet}
      nav={{ back: () => { if (router.canGoBack()) router.back(); else router.replace('/wallet'); } }}
      bandContent={<View testID="transfers-band" style={styles.bandIntro}>
        <ThemedText accessibilityRole="header" style={[styles.bandHeadline, { color: band.onBand }]}>{words.title}</ThemedText>
        {/* The band stays put over the list, so at large text the line moves onto the sheet. */}
        {!large ? <ThemedText type="small" style={{ color: band.onBandSecondary }}>{words.intro}</ThemedText> : null}
      </View>}>
      <SectionList
        testID="transfer-history"
        sections={sections}
        keyExtractor={item => item.transaction.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[styles.content, { paddingBottom: listBottom }]}
        scrollIndicatorInsets={{ top: 0, bottom: listBottom }}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        initialNumToRender={14} maxToRenderPerBatch={10} windowSize={9}
        ListHeaderComponent={<View style={styles.controls}>
          {large ? <ThemedText type="small" style={{ color: band.textSecondary }}>{words.intro}</ThemedText> : null}
          <View style={styles.context}>
            <ThemedText type="meta" themeColor="textSecondary" accessibilityLiveRegion="polite">{words.records(count)}</ThemedText>
            <PeriodPill onPress={() => setPeriodOpen(true)} />
          </View>
          <TextField label={words.search} value={query} onChangeText={setQuery}
            inputMode="search" returnKeyType="search" placeholder={words.searchPlaceholder}
            onSubmitEditing={() => Keyboard.dismiss()}
            leading={<Icon name="search" size={17} color={band.textSecondary} />}
            trailing={query ? <ActionIconButton icon="close" label={t('clearSearch', language)}
              variant="plain" onPress={() => setQuery('')} /> : undefined} />
          <SegmentedControl<Scope> label={words.title} value={scope} onChange={setScope}
            segments={[{ value: 'all', label: words.all }, { value: 'confirmed', label: words.confirmed }, { value: 'unconfirmed', label: words.unconfirmedScope }]} />
          <ThemedText type="meta" themeColor="textSecondary">{words.recordsNote}</ThemedText>
          {reconciliation.pendingIds.size > 0 ? <Pressable testID="transfer-pairs-link" accessibilityRole="button"
            accessibilityLabel={suggestedPairs > 0 ? d.transfers.pairsLink(suggestedPairs) : words.review}
            onPress={() => router.push('/review-transfers')} style={styles.reviewAction}>
            <ThemedText type="linkPrimary" style={{ color: band.tint }}>{suggestedPairs > 0 ? d.transfers.pairsLink(suggestedPairs) : words.review}</ThemedText>
            <Icon name="arrow-up-right" size={16} color={band.tint} />
          </Pressable> : null}
          {matched.length > 0 ? <View testID="transfer-matched-pairs" style={styles.matched}>
            <ThemedText type="smallBold" accessibilityRole="header">{d.transfers.matchedTitle}</ThemedText>
            {(showAllMatched ? matched : matched.slice(0, MATCHED_PREVIEW)).map(pair => {
              return <Pressable key={pair.key} testID="transfer-matched-pair" accessibilityRole="button"
                accessibilityLabel={`${words.viewDetails}: ${d.transfers.pairA11y(accountName(pair.out.accountId), accountName(pair.in.accountId), moneyLabel(pair.out.amountFils))}. ${shortDate(pair.out.date)}`}
                onPress={() => { Keyboard.dismiss(); setSelectedId(pair.out.id); }}
                style={({ pressed }) => [styles.matchedRow, large && styles.matchedRowStacked, { borderTopColor: band.rule, opacity: pressed ? 0.7 : 1 }]}>
                <View style={large ? styles.stretch : styles.grow}>
                  <TransferPairAccounts outAccount={accountName(pair.out.accountId)} inAccount={accountName(pair.in.accountId)}
                    palette={band} stacked={large} />
                </View>
                <View style={[styles.matchedFigure, large && styles.matchedFigureStacked]}>
                  <Money fils={pair.out.amountFils} type="smallBold" decimals />
                  <ThemedText type="meta" style={{ color: band.textSecondary }}>{shortDate(pair.out.date)}</ThemedText>
                </View>
              </Pressable>;
            })}
            {matched.length > MATCHED_PREVIEW ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAllMatched }}
              onPress={() => setShowAllMatched(value => !value)} style={styles.reviewAction}>
              <ThemedText type="linkPrimary" style={{ color: band.tint }}>{showAllMatched ? d.transfers.showFewer : d.transfers.showAll(matched.length)}</ThemedText>
            </Pressable> : null}
          </View> : null}
        </View>}
        renderSectionHeader={({ section }) => <ThemedText type="smallBold" style={styles.day}>{section.title}</ThemedText>}
        renderItem={({ item }) => {
          const tx = item.transaction;
          const account = accounts.get(tx.accountId);
          // Only the reconciler's review queue is a chore. A generic transfer
          // with no link to another owned account is stated neutrally.
          const status = item.confirmed ? item.ownership === 'own' ? words.own : words.external
            : item.needsReview ? words.needsReview : words.unconfirmed;
          const accountLabel = account ? accountDisplayName(account) : words.accountUnknown;
          const direction = tx.type === 'income' ? words.incoming : words.outgoing;
          const amountLabel = moneySpec
            ? `${moneySpec.currency} ${formatMinorUnits(tx.amountFils, moneySpec, { decimals: true })}`
            : formatAED(tx.amountFils, { decimals: true });
          return <View style={[styles.entry, { borderBottomColor: band.rule }]} testID={`transfer-record-${tx.id}`}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${words.viewDetails}: ${tx.title}. ${direction}. ${t(tx.type === 'income' ? 'plusWord' : 'minusWord', language)} ${amountLabel}. ${accountLabel}. ${status}`}
              onPress={() => { Keyboard.dismiss(); setSelectedId(tx.id); }}
              style={({ pressed }) => [styles.entryButton, { opacity: pressed ? 0.7 : 1 }]}>
              <Icon name={tx.type === 'income' ? 'arrow-down-right' : 'arrow-up-right'} size={20} color={band.textSecondary} />
              <View style={styles.grow}>
                <View style={[styles.headline, large && styles.stack]}>
                  <ThemedText type="smallBold" style={styles.grow}>{tx.title}</ThemedText>
                  <Money fils={tx.amountFils} sign={tx.type === 'income' ? 'plus' : 'minus'} type="smallBold" decimals />
                </View>
                <ThemedText type="meta" themeColor="textSecondary">
                  {direction} · {accountLabel}
                </ThemedText>
                <ThemedText type="meta" style={{ color: item.needsReview ? band.statusNear : band.textSecondary }}>{status}</ThemedText>
              </View>
              <Icon name="chevron-right" size={15} color={band.textSecondary} />
            </Pressable>
            {item.needsReview && <Pressable accessibilityRole="button" accessibilityLabel={`${words.review}: ${tx.title}. ${amountLabel}. ${accountLabel}`}
              onPress={() => router.push({ pathname: '/review-transfers', params: { transactionId: tx.id } })}
              style={styles.reviewAction}><ThemedText type="linkPrimary" style={{ color: band.tint }}>{words.review}</ThemedText>
              <Icon name="arrow-up-right" size={16} color={band.tint} /></Pressable>}
          </View>;
        }}
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
  bandIntro: { gap: Spacing.two },
  // The band's headline: Geist SemiBold, never Geist Mono.
  bandHeadline: { fontFamily: Fonts.sansSemi, fontSize: 34, lineHeight: 40, letterSpacing: -1.2 },
  sheet: { paddingTop: Spacing.two },
  content: { gap: 0 }, controls: { gap: Spacing.three, paddingBottom: Spacing.two },
  context: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  day: { paddingTop: Spacing.four, paddingBottom: Spacing.two },
  entry: { borderBottomWidth: StyleSheet.hairlineWidth },
  entryButton: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 12 },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  headline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
  matched: { gap: 0, paddingTop: Spacing.two },
  matchedRow: { minHeight: 60, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  matchedFigure: { alignItems: 'flex-end', gap: 2 },
  matchedRowStacked: { flexDirection: 'column', alignItems: 'stretch' },
  matchedFigureStacked: { alignItems: 'flex-start' },
  stretch: { alignSelf: 'stretch' },
  reviewAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, alignSelf: 'flex-start', marginStart: 28 },
  empty: { alignItems: 'center', paddingVertical: Spacing.five, gap: Spacing.three },
  emptyCopy: { textAlign: 'center' },
});
