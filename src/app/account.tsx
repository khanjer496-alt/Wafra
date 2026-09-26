import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { BandScaffold, type BandNav } from '@/components/ui/band-scaffold';
import { BandFigure } from '@/components/ui/band/band-figure';
import { EButton } from '@/components/ui/band/e-button';
import { StatTile } from '@/components/ui/band/stat-tile';
import { TextField } from '@/components/ui/text-field';
import { AccountTile } from '@/components/ui/tile';
import { Fonts, Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
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
  // A detail screen takes its parent's band: Accounts' slate.
  const band = useBand('accounts');
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
  // Asked for once. A cold deep link can land before the ledger has loaded the
  // account, so the sheet opens when it arrives — and never again after the
  // user has closed it.
  const balanceReady = askBalance && account !== null && isAccountDetailTarget(account);
  const balanceAsked = useRef(balanceReady);
  const [balanceOpen, setBalanceOpen] = useState(balanceReady);
  useEffect(() => {
    if (!balanceReady || balanceAsked.current) return;
    balanceAsked.current = true;
    setBalanceOpen(true);
  }, [balanceReady]);
  const [balanceText, setBalanceText] = useState('');
  const [currencyOpen, setCurrencyOpen] = useState(false);

  const balanceFils = useMemo(
    () => (account ? reliableBalanceFils(state, account) : null),
    // The reliable figure reads this account and the rows on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account, state.transactions],
  );
  // Second alerts for one bank move, left out of both the month's figures and
  // the recent rows, as Transactions leaves them out.
  const duplicates = useMemo(
    () => corroboratingTransferIdsForState(state),
    // Duplicate detection reads accounts and transactions only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.transactions, state.accounts],
  );
  const flow = useMemo(
    () => accountMonthFlow(state.transactions, accountId, now, duplicates),
    [state.transactions, accountId, now, duplicates],
  );
  const recent = useMemo(
    () => recentAccountTransactions(state.transactions, accountId, 8, duplicates),
    [state.transactions, accountId, duplicates],
  );
  const openEntry = useCallback((transaction: Transaction) => setEntry(transaction), []);

  // The account's name is the band's headline; the nav row keeps back and Manage.
  const nav: BandNav = {
    back: () => router.back(),
    actions: account ? [{ label: w.manage, icon: 'sliders', onPress: () => setManaging(true), testID: 'account-manage' }] : [],
  };

  if (!account) {
    return (
      <BandScaffold band="accounts" testID="account-screen" nav={{ ...nav, title: w.accountTitle }} contentStyle={styles.content}>
        <ThemedText type="default" themeColor="textSecondary">{w.accountMissing}</ThemedText>
      </BandScaffold>
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
      <BandScaffold
        band="accounts"
        testID="account-screen"
        nav={nav}
        contentStyle={styles.content}
        scrollProps={{ showsVerticalScrollIndicator: false }}
        bandContent={(
          <View style={styles.bandBody}>
            <View style={styles.identity} testID="account-detail-header">
              <AccountTile account={account} size={52} />
              <View style={styles.grow}>
                <ThemedText type="heading" accessibilityRole="header" style={{ color: band.onBand }}>{account.name}</ThemedText>
                <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{identity}</ThemedText>
              </View>
            </View>

            {balanceFils === null
              ? <View testID="account-detail-balance" accessible accessibilityRole="text"
                  accessibilityLabel={[w.latestBalance, w.noBalanceYet].join('. ')} style={styles.noBalance}>
                  <ThemedText type="small" style={{ color: band.onBandSecondary }}>{w.latestBalance}</ThemedText>
                  <ThemedText maxFontSizeMultiplier={1.5} style={[styles.dash, { color: band.onBand }]}>—</ThemedText>
                  <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{w.noBalanceYet}</ThemedText>
                </View>
              : <View style={styles.balance}>
                  <BandFigure testID="account-detail-balance" label={w.latestBalance} fils={balanceFils} decimals
                    palette={band} size="hero" />
                  {/* Who reported it and when. A quiet figure (no new one for two
                      weeks) reads bold: it is the latest known, not current. */}
                  {freshness || handKept ? <ThemedText testID="account-detail-freshness"
                    type={freshness?.quiet ? 'smallBold' : 'meta'}
                    style={{ color: freshness?.quiet ? band.onBand : band.onBandSecondary }}>
                    {freshness?.label ?? w.trackedByHand}
                  </ThemedText> : null}
                </View>}

            <View style={[styles.flow, large && styles.stack]} testID="account-detail-flow">
              <StatTile palette={band} label={w.recordedIn} testID="account-detail-in"
                accessibilityLabel={`${w.recordedIn}, ${formatAED(flow.inFils)}`}
                style={large && styles.tileStacked}>
                <BandFigure fils={flow.inFils} sign={flow.inFils > 0 ? 'plus' : 'none'} palette={band} size="medium"
                  fitInset={large ? 28 : 200} />
              </StatTile>
              <StatTile palette={band} label={w.recordedOut} testID="account-detail-out"
                accessibilityLabel={`${w.recordedOut}, ${formatAED(flow.outFils)}`}
                style={large && styles.tileStacked}>
                <BandFigure fils={flow.outFils} sign={flow.outFils > 0 ? 'minus' : 'none'} palette={band} size="medium"
                  fitInset={large ? 28 : 200} />
              </StatTile>
            </View>
          </View>
        )}>
        <ThemedText type="meta" themeColor="textSecondary">{w.recordedNote}</ThemedText>

        <View style={styles.section} testID="account-recent">
          <View style={styles.sectionHead}>
            <ThemedText type="heading" accessibilityRole="header" style={styles.grow}>{w.recent}</ThemedText>
            {recent.length > 0 && (
              <Pressable accessibilityRole="link" accessibilityLabel={w.seeAllA11y(account.name)}
                testID="account-see-all"
                onPress={() => router.push(`/transactions?account=${encodeURIComponent(account.id)}`)}
                style={styles.seeAll}>
                <ThemedText type="smallBold" style={{ color: band.tint }}>{w.seeAll}</ThemedText>
                <Icon name="chevron-right" size={16} color={band.tint} />
              </Pressable>
            )}
          </View>
          {recent.length === 0
            ? <ThemedText type="small" themeColor="textSecondary">{w.noRecent}</ThemedText>
            : recent.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} account={account} onPress={openEntry} />
            ))}
        </View>

        {isAccountDetailTarget(account) && (
          <Pressable accessibilityRole="button" testID="account-set-balance"
            accessibilityLabel={`${w.balanceWrong} ${w.setTodaysBalance}`} accessibilityHint={w.setBalanceBody}
            onPress={openBalance}
            style={({ pressed }) => [styles.correction, large && styles.stack,
              { borderColor: band.rule, backgroundColor: band.card, opacity: pressed ? 0.8 : 1 }]}>
            <ThemedText type="small" style={styles.grow}>{w.balanceWrong}</ThemedText>
            <ThemedText type="smallBold" style={{ color: band.tint }}>{w.setTodaysBalance}</ThemedText>
          </Pressable>
        )}
      </BandScaffold>

      <BottomSheet visible={balanceOpen} onClose={() => setBalanceOpen(false)} title={w.setTodaysBalance}
        footer={<EButton palette={band} label={w.save} onPress={saveBalance} disabled={!balanceValid} testID="account-balance-save" />}>
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
  bandBody: { gap: 20 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  grow: { flex: 1, minWidth: 0, gap: Spacing.half },
  balance: { gap: Spacing.one },
  noBalance: { gap: 4 },
  dash: { fontFamily: Fonts.sansSemi, fontSize: 56, lineHeight: 62 },
  flow: { flexDirection: 'row', gap: 10 },
  stack: { flexDirection: 'column', alignItems: 'stretch' },
  tileStacked: { flexBasis: 'auto', flexGrow: 0, alignSelf: 'stretch' },
  correction: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, minHeight: 56,
    paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, marginTop: Spacing.two,
  },
  section: { gap: Spacing.one },
  sectionHead: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  seeAll: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
});
