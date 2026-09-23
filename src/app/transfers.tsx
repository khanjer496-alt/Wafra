import { useRouter } from 'expo-router';
import React, { useDeferredValue, useMemo, useState } from 'react';
import { Keyboard, Platform, Pressable, SectionList, StyleSheet, View } from 'react-native';

import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { PeriodPill } from '@/components/ui/period-pill';
import { ScreenScaffold, useScreenContentInsets } from '@/components/ui/screen-scaffold';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { useTheme } from '@/hooks/use-theme';
import { formatAED, friendlyDate, toISODate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { accountDisplayName, transferReconciliationForState } from '@/lib/ledger';
import { formatMinorUnits } from '@/lib/ledger-money';
import { inPeriod } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import { getTransferActivity } from '@/lib/transfer-activity';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { reconcileTransfers } from '@/lib/transfer-reconciliation';

type Activity = ReturnType<typeof getTransferActivity>[number];
type Scope = 'all' | 'confirmed' | 'unconfirmed';

export default function TransfersScreen() {
  const router = useRouter();
  const theme = useTheme();
  const language = useLanguage();
  const words = transferActivityCopy(language);
  const large = useLargeTextLayout();
  const moneySpec = useLedgerMoney();
  const { state } = useStore();
  const { period } = usePeriod();
  const insets = useScreenContentInsets({ hasFooter: false });
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
    <ScreenScaffold scroll={false} virtualized headerMode="native"
      header={{ title: words.title, back: { label: t('back', language), onPress: () => {
        if (router.canGoBack()) router.back(); else router.replace('/wallet');
      } } }}>
      <SectionList
        testID="transfer-history"
        sections={sections}
        keyExtractor={item => item.transaction.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[insets.contentContainerStyle, styles.content]}
        contentInset={insets.contentInset}
        scrollIndicatorInsets={insets.scrollIndicatorInsets}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        initialNumToRender={14} maxToRenderPerBatch={10} windowSize={9}
        ListHeaderComponent={<View style={styles.controls}>
          <ThemedText type="small" themeColor="textSecondary">{words.intro}</ThemedText>
          <View style={styles.context}>
            <ThemedText type="meta" themeColor="textSecondary" accessibilityLiveRegion="polite">{words.records(count)}</ThemedText>
            <PeriodPill onPress={() => setPeriodOpen(true)} />
          </View>
          <TextField label={words.search} value={query} onChangeText={setQuery}
            inputMode="search" returnKeyType="search" placeholder={words.searchPlaceholder}
            onSubmitEditing={() => Keyboard.dismiss()}
            leading={<Icon name="search" size={17} color={theme.textSecondary} />}
            trailing={query ? <ActionIconButton icon="close" label={t('clearSearch', language)}
              variant="plain" onPress={() => setQuery('')} /> : undefined} />
          <SegmentedControl<Scope> label={words.title} value={scope} onChange={setScope}
            segments={[{ value: 'all', label: words.all }, { value: 'confirmed', label: words.confirmed }, { value: 'unconfirmed', label: words.unconfirmedScope }]} />
          <ThemedText type="meta" themeColor="textSecondary">{words.recordsNote}</ThemedText>
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
          return <View style={[styles.entry, { borderBottomColor: theme.cardBorder }]} testID={`transfer-record-${tx.id}`}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${words.viewDetails}: ${tx.title}. ${direction}. ${t(tx.type === 'income' ? 'plusWord' : 'minusWord', language)} ${amountLabel}. ${accountLabel}. ${status}`}
              onPress={() => { Keyboard.dismiss(); setSelectedId(tx.id); }}
              style={({ pressed }) => [styles.entryButton, { opacity: pressed ? 0.7 : 1 }]}>
              <Icon name={tx.type === 'income' ? 'arrow-down-right' : 'arrow-up-right'} size={20} color={theme.textSecondary} />
              <View style={styles.grow}>
                <View style={[styles.headline, large && styles.stack]}>
                  <ThemedText type="smallBold" style={styles.grow}>{tx.title}</ThemedText>
                  <Money fils={tx.amountFils} sign={tx.type === 'income' ? 'plus' : 'minus'} type="smallBold" decimals />
                </View>
                <ThemedText type="meta" themeColor="textSecondary">
                  {direction} · {accountLabel}
                </ThemedText>
                <ThemedText type="meta" themeColor={item.needsReview ? 'warning' : 'textSecondary'}>{status}</ThemedText>
              </View>
              <Icon name="chevron-right" size={15} color={theme.textTertiary} />
            </Pressable>
            {item.needsReview && <Pressable accessibilityRole="button" accessibilityLabel={`${words.review}: ${tx.title}. ${amountLabel}. ${accountLabel}`}
              onPress={() => router.push({ pathname: '/review-transfers', params: { transactionId: tx.id } })}
              style={styles.reviewAction}><ThemedText type="linkPrimary" themeColor="primary">{words.review}</ThemedText>
              <Icon name="arrow-up-right" size={16} color={theme.primary} /></Pressable>}
          </View>;
        }}
        ListEmptyComponent={<View style={styles.empty}><Icon name="repeat" size={30} color={theme.textSecondary} />
          <ThemedText type="heading">{words.empty}</ThemedText><ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>{words.emptyBody}</ThemedText></View>}
      />
    </ScreenScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
    <EntryDetailSheet transaction={selected?.transaction ?? null} transferAssessment={selected?.assessment}
      showMerchantLink={false} onClose={() => setSelectedId(null)} />
  </>;
}

const styles = StyleSheet.create({
  content: { gap: 0 }, controls: { gap: Spacing.three, paddingBottom: Spacing.two },
  context: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  day: { paddingTop: Spacing.four, paddingBottom: Spacing.two },
  entry: { borderBottomWidth: StyleSheet.hairlineWidth },
  entryButton: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 12 },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  headline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
  reviewAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, alignSelf: 'flex-start', marginStart: 28 },
  empty: { alignItems: 'center', paddingVertical: Spacing.five, gap: Spacing.three },
  emptyCopy: { textAlign: 'center' },
});
