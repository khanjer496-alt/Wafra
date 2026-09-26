import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { CaptureRefreshControl } from '@/components/capture-refresh-control';
import { CardPaymentSheet } from '@/components/card-payment-sheet';
import { ThemedText } from '@/components/themed-text';
import { LedgerCurrencySheet } from '@/components/ledger-currency-sheet';
import { BalanceOverview } from '@/components/wallet/balance-overview';
import { AccountGroups, type AccountDisplayRow } from '@/components/wallet/account-groups';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { ChoiceSheet } from '@/components/ui/choice-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { AccountTile } from '@/components/ui/tile';
import { TextField } from '@/components/ui/text-field';
import { Icon } from '@/components/ui/icon';
import { ProgressBar } from '@/components/ui/progress-bar';
import { BandScaffold, type BandNav } from '@/components/ui/band-scaffold';
import { Radius, Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useTheme } from '@/hooks/use-theme';
import { useResumeClock, useToday } from '@/hooks/use-today';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLanguage } from '@/hooks/use-language';
import { isSmsScanningAvailable } from '@/lib/auto-import';
import { isInactiveAccount, openDues, reissueSuggestions } from '@/lib/cards';
import { tapped } from '@/lib/haptics';
import { netWorthBreakdown } from '@/lib/balances';
import { accountSnapshotFreshness, snapshotOrigin } from '@/lib/account-freshness';
import { internalTransferIdsForState } from '@/lib/ledger';
import {
  capturedCardSpendFils,
  cardPaymentOptions,
  cardUsage,
  isAccountDetailTarget,
  type CardPaymentChoice,
} from '@/lib/money-places';
import { accountsBandCounts } from '@/lib/money-places-band';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import { measureRuntimeOperation } from '@/lib/runtime-performance';
import {
  formatAmount,
  parseAmountWithMoneySpec,
  shortDate,
} from '@/lib/format';
import { useStoreActions, useStoreSelector } from '@/lib/store';
import { historyStatusOnly } from '@/lib/store-selection';
import type { Account, AccountKind, CardDue } from '@/lib/types';
import { bankPickerOptions } from '@/lib/known-banks';
import { accountGroupsCopy } from '@/lib/reference-copy';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { t, tf, type StringKey } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';


const KIND_META: Record<AccountKind, { labelKey: StringKey; icon: import('@/components/ui/icon').IconName }> = {
  bank: { labelKey: 'accountKindBank', icon: 'bank' },
  card: { labelKey: 'accountKindCard', icon: 'wallet' },
  cash: { labelKey: 'accountKindCash', icon: 'cash' },
};

const ACCOUNT_COLORS = ['#2DD4A8', '#60A5FA', '#E3B54A', '#F472B6', '#A78BFA', '#FB923C'];
const GOAL_ICONS: import('@/components/ui/icon').IconName[] = [
  'target', 'plane', 'home', 'gift', 'car', 'cap', 'diamond', 'chart',
];
const isIconName = (v: string): v is (typeof GOAL_ICONS)[number] =>
  (GOAL_ICONS as string[]).includes(v);

/** "4 minutes ago", "yesterday" — a timestamp nobody has to decode. */
function relativeSince(ts: number, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - ts) / 60_000));
  if (mins < 1) return t('justNow');
  if (mins < 60) return tf('minutesAgo', { count: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return tf('hoursAgo', { count: hours });
  const days = Math.round(hours / 24);
  return days === 1 ? t('yesterday') : tf('daysAgo', { count: days });
}

/**
 * A confirmation waiting on the user, or null.
 *
 * Removing an account and deleting a goal were both gated by `Alert.alert`
 * with the store call inside a button's `onPress`. On react-native-web that
 * method is `static alert() {}` — an empty method, no dialog, no warning, no
 * throw — so the alert never drew and `deleteAccount`/`deleteGoal` sat as
 * unreachable code: a long press that did nothing at all, in silence. The
 * work lives in `onConfirm` and is handed to a sheet that is actually drawn.
 */
type Confirmation = {
  question: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
};

/** The two things a long press on an account row offers. */
type AccountAction = 'visibility' | 'bank' | 'delete';

export default function WalletScreen() {
  const theme = useTheme();
  // Design language E: Accounts wears the slate band.
  const band = useBand('accounts');
  const largeText = useLargeTextLayout();
  const language = useLanguage();
  const transferWords = transferActivityCopy(language);
  const placeWords = moneyPlacesWords(language);
  const router = useRouter();
  // Only what Accounts reads. lastScanTs is shown here, so a finished scan
  // still refreshes it; import progress and unrelated settings do not.
  const state = useStoreSelector(({ state: s }) => ({
    transactions: s.transactions, accounts: s.accounts, cardDues: s.cardDues, goals: s.goals,
    knownBanks: s.knownBanks, lastScanTs: s.lastScanTs, ledgerMoney: s.ledgerMoney, marketId: s.marketId,
    // Transfer scope for the captured-card figure; status only, so import
    // progress does not re-render Accounts.
    transferInternalIds: s.transferInternalIds, transferNormalizationVersion: s.transferNormalizationVersion,
    historyImport: historyStatusOnly(s.historyImport),
  }));
  const {
    addAccount,
    editAccount,
    deleteAccount,
    addGoal,
    deleteGoal,
    setLedgerMoney,
    mergeRenewedCard,
    markCardsDistinct,
  } = useStoreActions();
  // Every tab that shows money the inbox produces can go and refresh it; the
  // scan runs from CaptureRefreshControl below, which re-renders on its own.

  const now = useToday();
  // Minute-level "scanned … ago" text; the ledger memos below key on `now`.
  const resumeClock = useResumeClock();

  const [adderVisible, setAdderVisible] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('bank');
  const [openingText, setOpeningText] = useState('');
  const [colorIdx, setColorIdx] = useState(0);

  const [goalVisible, setGoalVisible] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalIcon, setGoalIcon] = useState(GOAL_ICONS[0]);
  const [currencySheetVisible, setCurrencySheetVisible] = useState(false);

  // The account a long press is asking about, and the confirmation that a
  // destructive answer to it opens second.
  const [optionsFor, setOptionsFor] = useState<Account | null>(null);
  const [bankFor, setBankFor] = useState<Account | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const walletNav: BandNav = {
    title: t('walletTitle'),
    actions: [
      {
        label: t('settingsTitle'),
        icon: 'sliders',
        onPress: () => router.push('/settings'),
        testID: 'wallet-settings',
      },
      {
        label: t('newAccount'),
        icon: 'plus',
        onPress: () => setAdderVisible(true),
        testID: 'wallet-add-account',
      },
    ],
  };

  /**
   * Reliable balances and how much of this screen they can actually cover.
   *
   * Scans every transaction once per account, so it is kept off the render
   * path — and it counts as well as sums, because the sum alone lies.
   * `netWorthBreakdown` adds up only balances the bank has quoted; an account
   * whose balance cannot be known contributes nothing (balances.ts), which makes
   * "unknown" and "zero" the same output. A phone whose cards have never sent
   * a statement SMS was therefore told, in display type, that its net worth
   * was AED 0 — directly above rows that each said "no balance SMS yet".
   *
   * Wallet no longer turns those incomplete observations into "net worth".
   * The useful fact here is the latest balance the banks actually reported;
   * card debt remains beside its statements and payment state below.
  */
  const balances = useMemo(
    () => measureRuntimeOperation('wallet-balances', () => netWorthBreakdown(state)),
    // The shared balance calculator reads only accounts and transactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.accounts, state.transactions],
  );
  const balanceAccountCoverage = useMemo(() => {
    const accounts = state.accounts.filter(
      (account) => !account.archived && account.cardType !== 'credit',
    );
    return {
      known: accounts.filter((account) => balances.balanceByAccountId[account.id] !== null).length,
      total: accounts.length,
    };
  }, [state.accounts, balances.balanceByAccountId]);
  // The band's second chip: credit cards shown on their own, never netted.
  const bandCounts = useMemo(() => accountsBandCounts(state.accounts), [state.accounts]);
  const balanceCoverageText =
    balanceAccountCoverage.total === 0
      ? t('addAccountForBalances')
      : tf('balanceCoverage', {
          known: balanceAccountCoverage.known,
          total: balanceAccountCoverage.total,
        });
  // cards.ts reads these three immutable arrays. Import progress, settings and
  // review status do not change statements or justify another ledger scan.
  const dues = useMemo(() => measureRuntimeOperation('wallet-dues', () => openDues(state, now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.accounts, state.transactions, state.cardDues, now]);
  const reissues = useMemo(() => measureRuntimeOperation('wallet-reissues', () => reissueSuggestions(state, now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.accounts, state.transactions, state.cardDues, now]);
  const dueByAccountId = useMemo(
    () => new Map(dues.map((item) => [item.due.accountId, item] as const)),
    [dues],
  );
  const dueAccountIds = useMemo(
    () => new Set(state.cardDues.map((statement) => statement.accountId)),
    [state.cardDues],
  );

  // Active accounts and cards share one institution-grouped source list.
  // Expired/unused ones (silent 90+ days, or hidden) live in a drawer below.
  const [showInactive, setShowInactive] = useState(false);
  const accountActivity = useMemo(
    () => measureRuntimeOperation('wallet-activity', () => {
      const active: Account[] = [];
      const inactive: Account[] = [];
      for (const account of state.accounts) {
        (isInactiveAccount(state, account, now) ? inactive : active).push(account);
      }
      let smsCount = 0;
      for (const tx of state.transactions) {
        if (tx.source === 'sms') smsCount += 1;
      }
      return { active, inactive, smsCount };
    }),
    // Activity depends on account snapshots and transaction dates only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.accounts, state.transactions, now],
  );
  const activeSources = accountActivity.active;
  const inactiveAccounts = accountActivity.inactive;
  const smsCount = accountActivity.smsCount;
  const inactiveDisclosureLabel = `${t('inactiveHeader')} ${inactiveAccounts.length}. ${
    showInactive ? t('hide') : t('show')
  }`;
  // Captured spending this money month, only for credit cards with an open
  // statement — the one place Accounts shows it, labelled as captured rather
  // than as a bank figure. One pass over the ledger for all of them.
  const capturedByCard = useMemo(() => {
    const cardIds = new Set<string>();
    for (const account of activeSources) {
      if (account.cardType === 'credit' && dueByAccountId.has(account.id)) cardIds.add(account.id);
    }
    return capturedCardSpendFils(state.transactions, cardIds, now, internalTransferIdsForState(state));
    // Transfer scope reads accounts and transactions, which this already keys on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSources, dueByAccountId, state.transactions, state.accounts, state.transferInternalIds,
    state.transferNormalizationVersion, state.historyImport, now]);

  const accountRows = useMemo<AccountDisplayRow[]>(() => activeSources.map((account) => {
    const due = dueByAccountId.get(account.id);
    const debtObserved = account.snapshotKind === 'outstanding' && account.snapshotFils !== undefined
      || dueAccountIds.has(account.id);
    // Wallet already indexed the entire ledger once in netWorthBreakdown() and
    // openDues(). Do not call cardFigure() per account: non-credit cards can
    // otherwise re-scan transactions account-by-account on the render path.
    const figureFils = account.cardType === 'credit'
      ? !debtObserved
        ? null
        : due
          ? Math.abs(due.remainingFils)
          : account.snapshotKind === 'outstanding' && account.snapshotFils !== undefined
            ? Math.abs(account.snapshotFils)
            : 0
      : balances.balanceByAccountId[account.id] ?? null;
    const figureKind = account.cardType === 'credit' ? 'owed' : figureFils === null ? 'unknown' : 'balance';
    // A figure the user set is theirs, never "per bank SMS" (account-freshness.ts).
    const reported = !due ? accountSnapshotFreshness(account, now, language) : null;
    const caption = figureFils === null ? t('noBalanceYet')
      : figureKind === 'owed' ? t('owed')
        : account.snapshotKind === 'balance'
          ? snapshotOrigin(account) === 'manual' && reported ? reported.label : t('perBankSms')
          : t('trackedManually');
    const freshness = due ? placeWords.dueOn(shortDate(due.due.dueDate)) : reported?.label ?? '';
    const statement = due && account.cardType === 'credit' && due.remainingFils > 0 ? {
      due: due.due,
      totalFils: due.due.totalDueFils,
      capturedFils: capturedByCard.get(account.id) ?? 0,
      minimumStated: cardPaymentOptions({ due: due.due, remainingFils: due.remainingFils }).minimumFils !== null,
    } : undefined;
    return {
      account, figureFils, caption, freshness, quiet: reported?.quiet ?? false,
      statement, usage: cardUsage(account), balanceEditable: isAccountDetailTarget(account),
    };
  // Captions also follow language; unrelated store metadata must not rescan rows.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [activeSources, balances.balanceByAccountId, dueByAccountId, dueAccountIds, capturedByCard, language, now]);

  const openingFils = openingText.trim() === ''
    ? 0
    : state.ledgerMoney
      ? parseAmountWithMoneySpec(openingText, state.ledgerMoney)
      : null;
  const accountDraftValid = Boolean(name.trim()) && openingFils !== null;
  const goalTargetFils = state.ledgerMoney
    ? parseAmountWithMoneySpec(goalTarget, state.ledgerMoney)
    : null;

  const saveAccount = () => {
    if (!accountDraftValid || openingFils === null) return;
    addAccount({
      name: name.trim(),
      kind,
      openingFils,
      color: ACCOUNT_COLORS[colorIdx],
    });
    setName('');
    setOpeningText('');
    setAdderVisible(false);
  };

  const saveGoal = () => {
    if (!goalTitle.trim() || !goalTargetFils) return;
    addGoal({ title: goalTitle.trim(), emoji: goalIcon, targetFils: goalTargetFils, savedFils: 0 });
    setGoalTitle('');
    setGoalTarget('');
    setGoalVisible(false);
  };

  // Adding to a goal lives on its own screen (/goal), which asks for the
  // amount with AmountSheet on every platform and says no money moves.

  const confirmDeleteAccount = (id: string, accName: string) => {
    setConfirmation({
      question: t('removeAccountTitle'),
      body: tf('removeAccountBody', { name: accName }),
      confirmLabel: t('delete'),
      destructive: true,
      onConfirm: () => deleteAccount(id),
    });
  };

  // Hide/unhide applies straight away; delete asks first, exactly as the two
  // stacked alerts did.
  const onAccountAction = (account: Account, action: AccountAction) => {
    if (action === 'visibility') editAccount(account.id, { archived: !account.archived });
    else if (action === 'bank') setBankFor(account);
    else confirmDeleteAccount(account.id, account.name);
  };
  // The bank behind an account: known banks first, then the market's; "No
  // bank" clears a wrong label. The badge and logo follow bankName.
  const bankChoices = () => [
    ...bankPickerOptions(state.knownBanks, state.marketId).map((bank) => ({ value: bank.name, label: bank.name })),
    { value: 'none', label: t('accountNoBank') },
  ];
  const setBank = (account: Account, value: string) => {
    const bank = bankPickerOptions(state.knownBanks, state.marketId).find((candidate) => candidate.name === value);
    editAccount(account.id, bank ? { bankName: bank.name, color: bank.color } : { bankName: undefined });
    setBankFor(null);
  };

  // Bank and cash accounts open their own screen; the manage sheet stays one
  // tap away there (header) and here (the sliders beside each row).
  const openAccount = (account: Account) => {
    if (account.kind === 'card' || account.cardType) {
      router.push(`/cards?card=${account.id}`);
      return;
    }
    if (isAccountDetailTarget(account)) {
      router.push(`/account?id=${encodeURIComponent(account.id)}`);
      return;
    }
    setOptionsFor(account);
  };
  const updateBalance = (account: Account) =>
    router.push(`/account?id=${encodeURIComponent(account.id)}&set=balance`);
  const hideAccount = (account: Account) => editAccount(account.id, { archived: true });
  // "Mark paid" on a card row records a payment the user made; it opens the
  // payment sheet (amount + confirmation) rather than committing from the row.
  const [paying, setPaying] = useState<{ due: CardDue; choice: CardPaymentChoice } | null>(null);

  return (
    <>
      <BandScaffold
        band="accounts"
        tabbed
        testID="wallet-screen"
        nav={walletNav}
        refreshControl={<CaptureRefreshControl />}
        contentStyle={styles.content}
        scrollProps={{ showsVerticalScrollIndicator: false }}
        bandContent={(
          // Wallet answers concrete account questions. Inbox history is not
          // complete enough to make a defensible net-worth claim.
          <BalanceOverview
            onAddAccount={() => setAdderVisible(true)}
            balanceCoverageText={balanceCoverageText}
            balanceFils={balances.balanceFils}
            knownBalanceCount={balanceAccountCoverage.known}
            activeSourceCount={activeSources.length}
            creditCardCount={bandCounts.creditCards}
            sourceNote={accountGroupsCopy[language === 'ar' ? 'ar' : 'en'].sourceBody}
            language={language}
            largeText={largeText}
            palette={band}
          />
        )}>

          {/* Accounts is the source-of-truth surface for balances and instruments.
              Transfer reconciliation is contextual work, not a permanent section
              between the balance hero and the accounts it summarizes. */}
          <View style={styles.section}>
            {reissues.map((r) => {
              const fresh = state.accounts.find((a) => a.id === r.newAccountId);
              const prior = state.accounts.find((a) => a.id === r.candidateIds[0]);
              if (!fresh || !prior) return null;
              return (
                <View
                  key={r.newAccountId}
                  style={[
                    styles.reissue,
                    {
                      borderColor: band.rule,
                      backgroundColor: band.card,
                    },
                  ]}>
                  <ThemedText type="smallBold">{t('sameCardRenewed')}</ThemedText>
                  <ThemedText type="meta" themeColor="textSecondary">
                    {tf('renewedCardDetected', {
                      last4: fresh.last4 ?? '••••',
                      name: prior.name,
                    })}
                  </ThemedText>
                  <View style={styles.reissueActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={tf('linkCardsA11y', {
                        old: prior.last4 ?? '••••',
                        next: fresh.last4 ?? '••••',
                      })}
                      onPress={() => {
                        tapped();
                        mergeRenewedCard(prior.id, fresh.id);
                      }}
                      style={[styles.reissueBtn, { backgroundColor: band.fill, borderColor: band.fill }]}>
                      <ThemedText type="smallBold" style={{ color: band.onFill }}>
                        {tf('sameAsCard', { last4: prior.last4 ?? '••••' })}
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={tf('keepCardSeparateA11y', {
                        last4: fresh.last4 ?? '••••',
                      })}
                      onPress={() => {
                        tapped();
                        markCardsDistinct(fresh.id);
                      }}
                      style={[styles.reissueBtn, { backgroundColor: band.sheet, borderColor: band.rule }]}>
                      <ThemedText type="smallBold">
                        {t('differentCard')}
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
              );
            })}

            <AccountGroups rows={accountRows} onOpen={openAccount} onManage={setOptionsFor}
              onUpdateBalance={updateBalance} onHide={hideAccount}
              onMarkPaid={(due, choice) => setPaying({ due, choice })} palette={band} />
            <View style={[styles.linkGroup, { borderColor: band.rule }]}>
              <Pressable accessibilityRole="button" accessibilityLabel={transferWords.title}
                testID="wallet-transfers-link" onPress={() => router.push('/transfers')}
                style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}>
                <View style={[styles.linkTile, { backgroundColor: band.glyphGround }]}>
                  <Icon name="repeat" size={20} color={band.tint} />
                </View>
                <View style={styles.transferCopy}>
                  <ThemedText type="smallBold">{transferWords.title}</ThemedText>
                  <ThemedText type="meta" themeColor="textSecondary">{transferWords.walletDetail}</ThemedText>
                </View>
                <Icon name="chevron-right" size={16} color={band.textSecondary} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t('cardsHeader')} testID="wallet-cards-link"
                onPress={() => router.push('/cards')}
                style={({ pressed }) => [styles.linkRow, styles.linkRowRule, { borderTopColor: band.rule, opacity: pressed ? 0.7 : 1 }]}>
                <View style={[styles.linkTile, { backgroundColor: band.glyphGround }]}>
                  <Icon name="wallet" size={20} color={band.tint} />
                </View>
                <ThemedText type="smallBold" style={styles.transferCopy}>{t('cardsHeader')}</ThemedText>
                <Icon name="chevron-right" size={16} color={band.textSecondary} />
              </Pressable>
            </View>
          </View>
          {/* Inactive: expired/unused cards and accounts */}
          {inactiveAccounts.length > 0 && (
            <View style={styles.section}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={inactiveDisclosureLabel}
                accessibilityState={{ expanded: showInactive }}
                onPress={() => setShowInactive((v) => !v)}
                style={styles.sectionHeader}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {t('inactiveHeader')} ({inactiveAccounts.length})
                </ThemedText>
                <Icon
                  name={showInactive ? 'chevron-down' : 'chevron-right'}
                  size={15}
                  color={band.textSecondary}
                />
              </Pressable>
              {showInactive && (
                <View>
                  {inactiveAccounts.map((account, i) => (
                    <Pressable
                      key={account.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${account.name}. ${account.archived ? t('hidden') : t('noActivity90')}`}
                      onPress={() => openAccount(account)}
                      onLongPress={() => setOptionsFor(account)}
                      style={[
                        styles.accountRow,
                        styles.inactiveRow,
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: band.rule },
                      ]}>
                      <AccountTile account={account} />
                      <View style={styles.accountInfo}>
                        <ThemedText type="default" numberOfLines={1}>
                          {account.name}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {account.archived ? t('hidden') : t('noActivity90')}
                        </ThemedText>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Goals */}
          <View style={styles.section} testID="wallet-goals">
            <View style={styles.sectionTitleRow}>
              <ThemedText type="heading" accessibilityRole="header" style={styles.transferCopy}>{t('goalsHeader')}</ThemedText>
              <Pressable accessibilityRole="button" accessibilityLabel={t('newGoal')} testID="wallet-new-goal"
                onPress={() => setGoalVisible(true)} hitSlop={4} style={styles.sectionAction}>
                <ThemedText type="smallBold" style={{ color: band.tint }}>{t('newGoal')}</ThemedText>
              </Pressable>
            </View>
            {state.goals.map((goal, i) => {
              const ratio = goal.targetFils > 0 ? goal.savedFils / goal.targetFils : 0;
              return (
                <Pressable
                  key={goal.id}
                  testID={`wallet-goal-${goal.id}`}
                  onPress={() => router.push(`/goal?id=${encodeURIComponent(goal.id)}`)}
                  onLongPress={() =>
                    setConfirmation({
                      question: t('deleteGoalTitle'),
                      body: goal.title,
                      confirmLabel: t('delete'),
                      destructive: true,
                      onConfirm: () => deleteGoal(goal.id),
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${goal.title}. ${ledgerCurrencyDisplay()} ${formatAmount(goal.savedFils, { decimals: false })} / ${formatAmount(goal.targetFils, { decimals: false })}`}
                  style={({ pressed }) => [styles.goalRow,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: band.rule },
                    { opacity: pressed ? 0.7 : 1 }]}>
                  <View style={[styles.linkTile, { backgroundColor: band.glyphGround }]}>
                    <Icon name={isIconName(goal.emoji) ? goal.emoji : 'target'} size={20} color={band.text} />
                  </View>
                  <View style={styles.goalBody}>
                    <View style={[styles.goalTop, largeText && styles.goalTopStacked]}>
                      <ThemedText type="smallBold" style={styles.goalTitleText}>{goal.title}</ThemedText>
                      <ThemedText type="small" tabular>
                        {formatAmount(goal.savedFils, { decimals: false })}
                        <ThemedText type="meta" themeColor="textSecondary" tabular>
                          {'  / '}
                          {formatAmount(goal.targetFils, { decimals: false })}
                        </ThemedText>
                      </ThemedText>
                    </View>
                    <ProgressBar ratio={ratio} color={ratio >= 1 ? band.statusOk : band.tint} height={6} />
                  </View>
                </Pressable>
              );
            })}
            {state.goals.length === 0 && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setGoalVisible(true)}
                style={({ pressed }) => [
                  styles.goalEmpty,
                  {
                    borderColor: band.rule,
                    backgroundColor: pressed ? theme.backgroundSelected : band.card,
                  },
                ]}>
                <View style={[styles.linkTile, { backgroundColor: band.glyphGround }]}>
                  <Icon name="target" size={20} color={band.tint} strokeWidth={1.8} />
                </View>
                <View style={styles.accountInfo}>
                  <ThemedText type="smallBold">{t('setSavingsGoal')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('savingsGoalHint')}
                  </ThemedText>
                </View>
                <Icon name="chevron-right" size={16} color={band.textSecondary} />
              </Pressable>
            )}
          </View>

          {/* Add activity: the three ways money gets into Wafra besides live
              alerts, each an existing screen. The Android inbox row keeps
              saying when the inbox was last read, because that is where
              reading happens there; elsewhere it is the paste route. SMS
              reading is Android-only, so the scan claim only appears where
              scanning is real; pasting a bank alert by hand works everywhere. */}
          <View style={styles.section} testID="wallet-add-activity">
            <ThemedText type="heading" accessibilityRole="header">
              {placeWords.addActivity}
            </ThemedText>
            {[
              { key: 'statement', icon: 'upload' as const, route: '/statement-import' as const,
                title: placeWords.importStatement, detail: placeWords.importStatementDetail },
              { key: 'manual', icon: 'plus' as const, route: '/add-transaction' as const,
                title: placeWords.addByHand, detail: placeWords.addByHandDetail },
              { key: 'paste', icon: 'mail' as const, route: '/import-sms' as const,
                title: Platform.OS !== 'ios' && isSmsScanningAvailable()
                  ? state.lastScanTs > 0
                    ? tf('inboxScannedAgo', { time: relativeSince(state.lastScanTs, resumeClock) })
                    : t('inboxNotRead')
                  : placeWords.pasteMessage,
                detail: Platform.OS !== 'ios' && isSmsScanningAvailable()
                  ? tf('entriesReadLocally', { count: smsCount, ending: smsCount === 1 ? 'y' : 'ies' })
                  : placeWords.pasteMessageDetail },
            ].map((row, index) => (
              <Pressable
                key={row.key}
                accessibilityRole="button"
                accessibilityLabel={`${row.title}. ${row.detail}`}
                testID={`wallet-add-${row.key}`}
                onPress={() => router.push(row.route)}
                style={({ pressed }) => [
                  styles.scan,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: band.rule },
                  { opacity: pressed ? 0.7 : 1 },
                ]}>
                <View style={[styles.linkTile, { backgroundColor: band.glyphGround }]}>
                  <Icon name={row.icon} size={18} color={band.text} />
                </View>
                <View style={styles.scanText}>
                  <ThemedText type="smallBold">{row.title}</ThemedText>
                  <ThemedText type="meta" themeColor="textSecondary">{row.detail}</ThemedText>
                </View>
                <Icon name="chevron-right" size={16} color={band.textSecondary} />
              </Pressable>
            ))}
          </View>
      </BandScaffold>

      {/* Add account sheet */}
      <BottomSheet visible={adderVisible} onClose={() => setAdderVisible(false)} title={t('newAccount')}
        footer={<Button label={t('addAccount')} onPress={saveAccount} disabled={!accountDraftValid} />}>
            <TextField
              label={t('accountNameLabel')}
              value={name}
              onChangeText={setName}
              placeholder={t('accountNamePlaceholder')}
            />

            <View style={styles.kindRow}>
              {(Object.keys(KIND_META) as AccountKind[]).map((k) => (
                <Pressable
                  key={k}
                  accessibilityRole="radio"
                  accessibilityLabel={t(KIND_META[k].labelKey)}
                  accessibilityState={{ selected: kind === k }}
                  onPress={() => setKind(k)}
                  style={[
                    styles.kindChip,
                    {
                      backgroundColor: kind === k ? `${theme.primary}22` : theme.backgroundSelected,
                      borderColor: kind === k ? theme.primary : theme.controlBorder,
                    },
                  ]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Icon name={KIND_META[k].icon} size={13} color={theme.text} />
                    <ThemedText type="small">{t(KIND_META[k].labelKey)}</ThemedText>
                  </View>
                </Pressable>
              ))}
            </View>

            {!state.ledgerMoney && openingText.trim() !== '' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('chooseLedgerCurrency')}
                onPress={() => setCurrencySheetVisible(true)}
                style={[styles.currencyChoice, { borderColor: theme.controlBorder, backgroundColor: theme.backgroundElement }]}>
                <View style={styles.accountInfo}>
                  <ThemedText type="smallBold">{t('chooseLedgerCurrency')}</ThemedText>
                  <ThemedText type="meta" themeColor="textTertiary">{t('ledgerCurrencyRequiredHint')}</ThemedText>
                </View>
                <Icon name="chevron-right" size={16} color={theme.textSecondary} />
              </Pressable>
            )}
            <TextField
              label={t('openingBalanceOptional')}
              value={openingText}
              onChangeText={setOpeningText}
              keyboardType="numeric"
              placeholder={t('openingBalanceOptional')}
              leading={<ThemedText type="smallBold" themeColor="textSecondary">{state.ledgerMoney?.currency ?? '—'}</ThemedText>}
            />

            <View style={styles.choiceGroup}>
              <ThemedText type="meta">{t('accountColorLabel')}</ThemedText>
              <View style={styles.colorRow}>
                {ACCOUNT_COLORS.map((c, i) => (
                  <Pressable
                    key={c}
                    accessibilityRole="radio"
                    accessibilityLabel={tf('choiceColor', { count: i + 1 })}
                    accessibilityState={{ selected: colorIdx === i }}
                    onPress={() => setColorIdx(i)}
                    style={styles.colorChoice}>
                    <View style={[styles.colorDot, { backgroundColor: c, borderColor: colorIdx === i ? theme.text : 'transparent' }]} />
                  </Pressable>
                ))}
              </View>
            </View>

      </BottomSheet>

      {/* New goal sheet */}
      <BottomSheet visible={goalVisible} onClose={() => setGoalVisible(false)} title={t('newGoalTitle')}
        footer={<Button label={t('createGoal')} onPress={saveGoal}
          disabled={!goalTitle.trim() || !goalTargetFils} />}>
            <TextField
              label={t('goalNameLabel')}
              value={goalTitle}
              onChangeText={setGoalTitle}
              placeholder={t('goalPlaceholder')}
            />

            {!state.ledgerMoney && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('chooseLedgerCurrency')}
                onPress={() => setCurrencySheetVisible(true)}
                style={[styles.currencyChoice, { borderColor: theme.controlBorder, backgroundColor: theme.backgroundElement }]}>
                <View style={styles.accountInfo}>
                  <ThemedText type="smallBold">{t('chooseLedgerCurrency')}</ThemedText>
                  <ThemedText type="meta" themeColor="textTertiary">{t('ledgerCurrencyRequiredHint')}</ThemedText>
                </View>
                <Icon name="chevron-right" size={16} color={theme.textSecondary} />
              </Pressable>
            )}
            <TextField
              label={t('targetAmount')}
              value={goalTarget}
              onChangeText={setGoalTarget}
              keyboardType="numeric"
              placeholder={t('targetAmount')}
              leading={<ThemedText type="smallBold" themeColor="textSecondary">{state.ledgerMoney?.currency ?? '—'}</ThemedText>}
            />

            <View style={styles.choiceGroup}>
              <ThemedText type="meta">{t('goalIconLabel')}</ThemedText>
              <View style={styles.colorRow}>
                {GOAL_ICONS.map((ic) => (
                  <Pressable
                    key={ic}
                    accessibilityRole="radio"
                    accessibilityLabel={tf('choiceIcon', { count: GOAL_ICONS.indexOf(ic) + 1 })}
                    accessibilityState={{ selected: goalIcon === ic }}
                    onPress={() => setGoalIcon(ic)}
                    style={[
                      styles.emojiPick,
                      {
                        backgroundColor: goalIcon === ic ? `${theme.primary}22` : theme.backgroundSelected,
                        borderColor: goalIcon === ic ? theme.primary : 'transparent',
                      },
                    ]}>
                    <Icon name={ic} size={19} color={goalIcon === ic ? theme.primary : theme.textSecondary} />
                  </Pressable>
                ))}
              </View>
            </View>

      </BottomSheet>

      {/* Outside the ScrollView: a sheet mounted inside a scrolling parent
          inherits its clipping and its scroll offset on web. */}
      {optionsFor && (
        <ChoiceSheet
          visible
          onClose={() => setOptionsFor(null)}
          title={optionsFor.name}
          body={optionsFor.archived ? t('hiddenFromLists') : undefined}
          options={[
            {
              value: 'visibility' as AccountAction,
              label: optionsFor.archived ? t('unhide') : t('hideFromLists'),
            },
            { value: 'bank' as AccountAction, label: t('accountSetBank'), detail: optionsFor.bankName },
            { value: 'delete' as AccountAction, label: t('delete') },
          ]}
          onSelect={(action) => onAccountAction(optionsFor, action)}
        />
      )}
      {bankFor && (
        <ChoiceSheet
          visible
          onClose={() => setBankFor(null)}
          title={t('accountSetBank')}
          question={t('accountBankQuestion')}
          options={bankChoices()}
          value={bankFor.bankName ?? 'none'}
          onSelect={(value) => setBank(bankFor, value)}
        />
      )}
      {/* Mounted only while there is something to confirm, so the entry
          animation runs on every open rather than once per screen. */}
      {confirmation && (
        <ConfirmSheet
          visible
          onClose={() => setConfirmation(null)}
          question={confirmation.question}
          body={confirmation.body}
          confirmLabel={confirmation.confirmLabel}
          destructive={confirmation.destructive}
          onConfirm={confirmation.onConfirm}
        />
      )}
      <LedgerCurrencySheet
        visible={currencySheetVisible}
        value={state.ledgerMoney?.currency ?? null}
        onClose={() => setCurrencySheetVisible(false)}
        onSelect={setLedgerMoney}
      />
      <CardPaymentSheet due={paying?.due ?? null} initialChoice={paying?.choice} onClose={() => setPaying(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  transferCopy: { flex: 1, minWidth: 0, gap: Spacing.half },
  linkGroup: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, marginTop: Spacing.two },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: Spacing.two + 2 },
  linkRowRule: { borderTopWidth: StyleSheet.hairlineWidth },
  // One glyph ground for every tile on the sheet (design language E).
  linkTile: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two, minHeight: 44 },
  sectionAction: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  reissue: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    padding: Spacing.three,
    gap: Spacing.two - 2,
    marginBottom: Spacing.two,
  },
  reissueActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingTop: Spacing.two - 2,
  },
  reissueBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: 22,
    borderWidth: 1,
  },
  content: {
    gap: Spacing.four,
  },
  scan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 64,
    paddingVertical: Spacing.two + 2,
  },
  scanText: { flex: 1, minWidth: 0, gap: 1 },
  section: {
    gap: Spacing.two,
  },
  institutionGroup: { gap: Spacing.two },
  institutionHeader: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  institutionBadge: {
    width: 30,
    height: 30,
    borderRadius: Radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  institutionName: {
    flex: 1,
    minWidth: 0,
  },
  sourceCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.sheet, padding: Spacing.three, gap: Spacing.three },
  sourceIdentity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  sourceFigure: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, gap: Spacing.two },
  sourceCaption: { flexShrink: 1 },
  sourceMoney: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: Spacing.one },
  moreSources: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.control,
    marginTop: Spacing.one,
  },
  chevronExpanded: {
    transform: [{ rotate: '180deg' }],
  },
  sectionHeader: {
    minHeight: 48,
    gap: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingVertical: Spacing.three,
  },
  dueMarker: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
  },
  dueInfo: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  dueRight: {
    flexShrink: 0,
    maxWidth: '42%',
    alignItems: 'flex-end',
    gap: Spacing.one + 2,
  },
  compactMoney: { flexDirection: 'row', alignItems: 'baseline', gap: 4, flexShrink: 0 },
  payBtn: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 3,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingVertical: Spacing.two + 3,
  },
  accountBadge: {
    width: 42,
    height: 42,
    borderRadius: Radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountBadgeEmoji: {
    fontSize: 19,
  },
  accountInfo: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  accountRight: {
    flexShrink: 0,
    alignItems: 'flex-end',
    marginStart: Spacing.two,
  },
  inactiveRow: {
    opacity: 0.55,
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 64,
    paddingVertical: Spacing.two + 2,
  },
  goalBody: { flex: 1, minWidth: 0, gap: Spacing.one + 2 },
  goalEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  goalEmptyIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  goalTopStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: Spacing.one },
  goalTitle: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1, minWidth: 0 },
  goalTitleText: { flexShrink: 1 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two + 3,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  about: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.three,
  },
  aboutText: {
    textAlign: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 15, 12, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: -Spacing.two,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kindRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  kindChip: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two + 4,
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    borderWidth: 1.5,
  },
  currencyChoice: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  choiceGroup: { gap: Spacing.one },
  colorChoice: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  colorRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  colorDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
  },
  emojiPick: {
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  emojiText: {
    fontSize: 20,
  },
  saveBtn: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
