import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { LedgerCurrencySheet } from '@/components/ledger-currency-sheet';
import { ThemedText } from '@/components/themed-text';
import { TransactionRow } from '@/components/transaction-row';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ChoiceSheet } from '@/components/ui/choice-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { TextField } from '@/components/ui/text-field';
import { AccountTile } from '@/components/ui/tile';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { accountSnapshotFreshness } from '@/lib/account-freshness';
import { reliableBalanceFils } from '@/lib/balances';
import { formatAED, formatAmountForInput, parseAmountWithMoneySpec } from '@/lib/format';
import { bankPickerOptions } from '@/lib/known-banks';
import { corroboratingTransferIdsForState } from '@/lib/ledger';
import { accountMonthFlow, isAccountDetailTarget, recentAccountTransactions } from '@/lib/money-places';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import { useStoreActions, useStoreSelector } from '@/lib/store';
import type { Transaction } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

type ManageAction = 'visibility' | 'bank' | 'delete';

/** A typed balance: zero is a real answer, so it is accepted explicitly. */
const ZERO = /^\s*0+(?:[.,٫]0*)?\s*$/;

/**
 * One bank or cash account: the latest reported balance and who reported it,
 * what was recorded in and out this month, and its newest entries.
 *
 * There is no balance-history chart: Wafra keeps only the latest reported
 * figure (types.ts), and a line drawn through one point would be invented.
 * Cards open their statement sheet instead (Wallet routes them to /cards).
 */
export default function AccountRoute() {
  const { id, set } = useLocalSearchParams<{ id?: string | string[]; set?: string | string[] }>();
  const accountId = typeof id === 'string' ? id : '';
  // Wallet's "Update balance" on a quiet account lands straight on the sheet.
  return <AccountScreen key={accountId} accountId={accountId} askBalance={set === 'balance'} />;
}

function AccountScreen({ accountId, askBalance }: { accountId: string; askBalance: boolean }) {
  const router = useRouter();
  const theme = useTheme();
  const language = useLanguage();
  const large = useLargeTextLayout();
  const w = moneyPlacesWords(language);
  const now = useToday();
  const state = useStoreSelector(({ state: s }) => ({
    accounts: s.accounts, transactions: s.transactions, ledgerMoney: s.ledgerMoney,
    knownBanks: s.knownBanks, marketId: s.marketId,
  }));
  const { editAccount, deleteAccount, setAccountBalance, setLedgerMoney } = useStoreActions();
  const account = state.accounts.find((candidate) => candidate.id === accountId) ?? null;

  const [entry, setEntry] = useState<Transaction | null>(null);
  const [managing, setManaging] = useState(false);
  const [choosingBank, setChoosingBank] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(() => askBalance && account !== null && isAccountDetailTarget(account));
  const [balanceText, setBalanceText] = useState('');
  const [currencyOpen, setCurrencyOpen] = useState(false);

  const balanceFils = useMemo(
    () => (account ? reliableBalanceFils(state, account) : null),
    // The reliable figure reads this account and the rows on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account, state.transactions],
  );
  const flow = useMemo(
    () => accountMonthFlow(state.transactions, accountId, now, corroboratingTransferIdsForState(state)),
    // Duplicate detection reads accounts and transactions only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.transactions, state.accounts, accountId, now],
  );
  const recent = useMemo(() => recentAccountTransactions(state.transactions, accountId, 8), [state.transactions, accountId]);
  const openEntry = useCallback((transaction: Transaction) => setEntry(transaction), []);

  const header: ScreenHeaderProps = {
    title: account?.name ?? w.accountTitle,
    back: { label: t('back'), onPress: () => router.back() },
    actions: account ? [{ label: w.manage, icon: 'sliders', onPress: () => setManaging(true) }] : [],
  };

  if (!account) {
    return (
      <ScreenScaffold headerMode="native" header={header} contentStyle={styles.content}>
        <ThemedText type="default" themeColor="textSecondary">{w.accountMissing}</ThemedText>
      </ScreenScaffold>
    );
  }

  // Only a balance snapshot dates the figure shown; a quoted limit is not one.
  const freshness = account.snapshotKind === 'balance' ? accountSnapshotFreshness(account, now, language) : null;
  const handKept = account.snapshotTs === undefined && balanceFils !== null;
  const kindLabel = account.kind === 'cash' ? w.cashAccount : w.bankAccount;
  const identity = [account.bankName && account.bankName !== account.name ? account.bankName : null,
    account.last4 ? `•• ${account.last4}` : null, kindLabel].filter(Boolean).join(' · ');

  const typedFils = ZERO.test(balanceText)
    ? 0
    : state.ledgerMoney ? parseAmountWithMoneySpec(balanceText, state.ledgerMoney) : null;
  const balanceValid = typedFils !== null && state.ledgerMoney !== null;
  const openBalance = () => {
    setBalanceText(balanceFils !== null && balanceFils >= 0 ? formatAmountForInput(balanceFils) : '');
    setBalanceOpen(true);
  };
  const saveBalance = () => {
    if (!balanceValid || typedFils === null) return;
    setAccountBalance(account.id, typedFils);
    setBalanceOpen(false);
  };

  const onManage = (action: ManageAction) => {
    setManaging(false);
    if (action === 'visibility') editAccount(account.id, { archived: !account.archived });
    else if (action === 'bank') setChoosingBank(true);
    else setConfirmingDelete(true);
  };
  const banks = bankPickerOptions(state.knownBanks, state.marketId);
  const setBank = (value: string) => {
    const bank = banks.find((candidate) => candidate.name === value);
    editAccount(account.id, bank ? { bankName: bank.name, color: bank.color } : { bankName: undefined });
    setChoosingBank(false);
  };

  return (
    <>
      <ScreenScaffold headerMode="native" header={header} contentStyle={styles.content}
        scrollProps={{ showsVerticalScrollIndicator: false }}>
        <View style={styles.identity} testID="account-detail-header">
          <AccountTile account={account} size={46} />
          <View style={styles.grow}>
            <ThemedText type="subtitle">{account.name}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">{identity}</ThemedText>
          </View>
        </View>

        <View style={[styles.balance, { borderColor: theme.cardBorder }]} testID="account-detail-balance"
          accessible accessibilityLabel={[w.latestBalance,
            balanceFils === null ? w.noBalanceYet : formatAED(balanceFils),
            freshness?.label ?? (handKept ? w.trackedByHand : '')].filter(Boolean).join('. ')}>
          <ThemedText type="small" themeColor="textSecondary">{w.latestBalance}</ThemedText>
          {balanceFils === null
            ? <ThemedText type="amount" themeColor="textTertiary">—</ThemedText>
            : <Money fils={balanceFils} type="amount" />}
          <ThemedText type="meta" themeColor={freshness?.quiet ? 'warning' : 'textSecondary'}>
            {freshness?.label ?? (handKept ? w.trackedByHand : w.noBalanceYet)}
          </ThemedText>
        </View>

        <View style={[styles.flow, large && styles.stack]} testID="account-detail-flow">
          <View style={[styles.flowCell, { borderColor: theme.cardBorder }]}>
            <ThemedText type="meta" themeColor="textSecondary">{w.recordedIn}</ThemedText>
            <Money fils={flow.inFils} type="smallBold" sign={flow.inFils > 0 ? 'plus' : 'none'} />
          </View>
          <View style={[styles.flowCell, { borderColor: theme.cardBorder }]}>
            <ThemedText type="meta" themeColor="textSecondary">{w.recordedOut}</ThemedText>
            <Money fils={flow.outFils} type="smallBold" sign={flow.outFils > 0 ? 'minus' : 'none'} />
          </View>
        </View>
        <ThemedText type="meta" themeColor="textTertiary">{w.recordedNote}</ThemedText>

        {isAccountDetailTarget(account) && (
          <View style={[styles.correction, { borderColor: theme.cardBorder }]} testID="account-set-balance">
            <View style={styles.grow}>
              <ThemedText type="smallBold">{w.balanceWrong}</ThemedText>
              <ThemedText type="meta" themeColor="textSecondary">{w.setBalanceBody}</ThemedText>
            </View>
            <Button inline={!large} variant="outline" label={w.setTodaysBalance} onPress={openBalance} />
          </View>
        )}

        <View style={styles.section} testID="account-recent">
          <View style={styles.sectionHead}>
            <ThemedText type="smallBold" accessibilityRole="header" style={styles.grow}>{w.recent}</ThemedText>
            {recent.length > 0 && (
              <Pressable accessibilityRole="link" accessibilityLabel={w.seeAllA11y(account.name)}
                testID="account-see-all"
                onPress={() => router.push(`/transactions?account=${encodeURIComponent(account.id)}`)}
                style={styles.seeAll}>
                <ThemedText type="linkPrimary">{w.seeAll}</ThemedText>
                <Icon name="chevron-right" size={16} color={theme.primary} />
              </Pressable>
            )}
          </View>
          {recent.length === 0
            ? <ThemedText type="small" themeColor="textSecondary">{w.noRecent}</ThemedText>
            : recent.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} account={account} onPress={openEntry} />
            ))}
        </View>
      </ScreenScaffold>

      <BottomSheet visible={balanceOpen} onClose={() => setBalanceOpen(false)} title={w.setTodaysBalance}
        footer={<Button label={w.save} onPress={saveBalance} disabled={!balanceValid} />}>
        <ThemedText type="subtitle" accessibilityRole="header">{w.setBalanceQuestion(account.name)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{w.setBalanceBody}</ThemedText>
        {!state.ledgerMoney && (
          <Button label={t('chooseLedgerCurrency')} variant="outline" onPress={() => setCurrencyOpen(true)} />
        )}
        <TextField
          numeric
          label={w.balanceToday}
          value={balanceText}
          onChangeText={setBalanceText}
          placeholder={w.balanceToday}
          onSubmitEditing={saveBalance}
          leading={<ThemedText type="smallBold" themeColor="textSecondary">{state.ledgerMoney?.currency ?? '—'}</ThemedText>}
        />
      </BottomSheet>

      <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} />
      {managing && (
        <ChoiceSheet
          visible
          onClose={() => setManaging(false)}
          title={account.name}
          body={account.archived ? t('hiddenFromLists') : undefined}
          options={[
            { value: 'visibility' as ManageAction, label: account.archived ? t('unhide') : t('hideFromLists') },
            { value: 'bank' as ManageAction, label: t('accountSetBank'), detail: account.bankName },
            { value: 'delete' as ManageAction, label: t('delete') },
          ]}
          onSelect={onManage}
        />
      )}
      {choosingBank && (
        <ChoiceSheet
          visible
          onClose={() => setChoosingBank(false)}
          title={t('accountSetBank')}
          question={t('accountBankQuestion')}
          options={[
            ...banks.map((bank) => ({ value: bank.name, label: bank.name })),
            { value: 'none', label: t('accountNoBank') },
          ]}
          value={account.bankName ?? 'none'}
          onSelect={setBank}
        />
      )}
      {confirmingDelete && (
        <ConfirmSheet
          visible
          onClose={() => setConfirmingDelete(false)}
          question={t('removeAccountTitle')}
          body={tf('removeAccountBody', { name: account.name })}
          confirmLabel={t('delete')}
          destructive
          onConfirm={() => {
            deleteAccount(account.id);
            router.back();
          }}
        />
      )}
      <LedgerCurrencySheet
        visible={currencyOpen}
        value={state.ledgerMoney?.currency ?? null}
        onClose={() => setCurrencyOpen(false)}
        onSelect={setLedgerMoney}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1, minWidth: 0, gap: Spacing.half },
  balance: { gap: Spacing.one, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  flow: { flexDirection: 'row', gap: Spacing.two },
  stack: { flexDirection: 'column' },
  flowCell: {
    flex: 1, gap: Spacing.one, padding: Spacing.three, borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
  },
  correction: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two,
    paddingVertical: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  section: { gap: Spacing.one },
  sectionHead: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  seeAll: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
});
