import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BalanceOverview } from '@/components/wallet/balance-overview';
import { AccountGroups, type AccountDisplayRow } from '@/components/wallet/account-groups';
import { AmountSheet } from '@/components/ui/amount-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { ChoiceSheet } from '@/components/ui/choice-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { AccountTile } from '@/components/ui/tile';
import { Icon } from '@/components/ui/icon';
import { SectionHeader } from '@/components/ui/period-pill';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ScreenScaffold, useScreenContentInsets } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLanguage } from '@/hooks/use-language';
import { usePullToRefresh } from '@/hooks/use-auto-import';
import { internalTransferIds, liveAccountIds } from '@/lib/ledger';
import { isSmsScanningAvailable } from '@/lib/auto-import';
import { cardFigure, isInactiveAccount, openDues, reissueSuggestions } from '@/lib/cards';
import { tapped } from '@/lib/haptics';
import { summarizeForeignActivity } from '@/lib/fx-summary';
import { netWorthBreakdown } from '@/lib/balances';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { summarizeCashOutflow } from '@/lib/cash-flow';
import {
  formatAmount,
  monthKey,
  parseAmountToFils,
  totalAsShown,
  shortDate,
  toISODate,
} from '@/lib/format';
import { useStore } from '@/lib/store';
import type { Account, AccountKind } from '@/lib/types';
import { t, tf, type StringKey } from '@/lib/i18n';


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
type AccountAction = 'visibility' | 'delete';

export default function WalletScreen() {
  const theme = useTheme();
  const walletInsets = useScreenContentInsets({ tabbed: true });
  const largeText = useLargeTextLayout();
  const language = useLanguage();
  const router = useRouter();
  const {
    state,
    addAccount,
    editAccount,
    deleteAccount,
    addGoal,
    editGoal,
    deleteGoal,
    mergeRenewedCard,
    markCardsDistinct,
  } = useStore();
  // Every tab that shows money the inbox produces can now go and refresh it.
  const { refreshing, onRefresh } = usePullToRefresh();

  const now = useMemo(() => new Date(), []);

  const [adderVisible, setAdderVisible] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('bank');
  const [openingText, setOpeningText] = useState('');
  const [colorIdx, setColorIdx] = useState(0);

  const [goalVisible, setGoalVisible] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalIcon, setGoalIcon] = useState(GOAL_ICONS[0]);

  // The account a long press is asking about, and the confirmation that a
  // destructive answer to it opens second.
  const [optionsFor, setOptionsFor] = useState<Account | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const walletHeader: ScreenHeaderProps = {
    title: t('walletTitle'),
    actions: [
      {
        label: t('settingsTitle'),
        icon: 'sliders',
        onPress: () => router.push('/settings'),
      },
      {
        label: t('newAccount'),
        icon: 'plus',
        onPress: () => setAdderVisible(true),
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
    () => netWorthBreakdown(state),
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
  const balanceCoverageText =
    balanceAccountCoverage.total === 0
      ? t('addAccountForBalances')
      : tf('balanceCoverage', {
          known: balanceAccountCoverage.known,
          total: balanceAccountCoverage.total,
        });
  // cards.ts reads these three immutable arrays. Import progress, settings and
  // review status do not change statements or justify another ledger scan.
  const dues = useMemo(() => openDues(state, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.accounts, state.transactions, state.cardDues, now]);
  const reissues = useMemo(() => reissueSuggestions(state, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.accounts, state.transactions, state.cardDues, now]);
  // Totalled AS SHOWN, because this figure is printed directly above the
  // rows it covers. Summing the exact fils and rounding once gives a heading
  // that can differ from its own list by a dirham — the same defect that put
  // "AED 1,025/mo" over rows adding to 1,022 on Bills.
  const duesTotalFils = useMemo(
    () => totalAsShown(dues.map((d) => d.remainingFils)),
    [dues],
  );

  // Active accounts and cards share one institution-grouped source list.
  // Expired/unused ones (silent 90+ days, or hidden) live in a drawer below.
  const [showInactive, setShowInactive] = useState(false);
  const activeSources = useMemo(
    () => state.accounts.filter((account) => !isInactiveAccount(state, account, now)),
    // Activity depends on account snapshots and transaction dates only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.accounts, state.transactions, now],
  );
  const inactiveAccounts = useMemo(
    () => state.accounts.filter((a) => isInactiveAccount(state, a, now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.accounts, state.transactions, now],
  );
  const inactiveDisclosureLabel = `${t('inactiveHeader')} ${inactiveAccounts.length}. ${
    showInactive ? t('hide') : t('show')
  }`;
  // This month's spend per account, for the per-card line.
  const smsCount = useMemo(
    () => state.transactions.filter((tx) => tx.source === 'sms').length,
    [state.transactions],
  );

  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = useMemo(
    () => internalTransferIds(state.transactions, state.accounts),
    [state.transactions, state.accounts],
  );
  const cashOut = useMemo(
    () => summarizeCashOutflow(state, monthKey(now), { live: liveAccounts, internal }),
    // Include the setting that changes the global reporting-month boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.accounts, state.transactions, state.cardDues, state.monthStartDay, now, liveAccounts, internal],
  );
  /**
   * Both halves of a move between the user's own accounts are excluded, as
   * they are on Home and Flow — otherwise the second line under a card reads
   * back the sweep that left it as money spent.
   *
   * The live-account set is deliberately not applied, for the reason spelled
   * out over the same map on the Cards screen: this is a per-account figure
   * shown on that account's own row, and no total is built from it.
   */
  const currencies = useMemo(() => {
    const key = monthKey(now);
    return summarizeForeignActivity(
      state.transactions,
      (transaction) => monthKey(transaction.date) === key,
    ).groups;
  }, [state.transactions, now]);
  const currenciesTotalFils = useMemo(
    () => totalAsShown(currencies.map((group) => group.localFils)),
    [currencies],
  );

  const accountRows = useMemo<AccountDisplayRow[]>(() => activeSources.map((account) => {
    const figure = cardFigure(state, account, now);
    const due = dues.find((item) => item.due.accountId === account.id);
    const debtObserved = account.snapshotKind === 'outstanding' && account.snapshotFils !== undefined
      || state.cardDues.some((statement) => statement.accountId === account.id);
    const figureFils = account.cardType === 'credit' && !debtObserved ? null
      : figure.fils === null ? null : figure.kind === 'owed' ? Math.abs(figure.fils) : figure.fils;
    const caption = figureFils === null ? t('noBalanceYet')
      : figure.kind === 'owed' ? t('owed')
        : account.snapshotKind === 'balance' ? t('perBankSms') : t('trackedManually');
    const freshness = due ? `${language === 'ar' ? 'الاستحقاق' : 'Due'} ${shortDate(due.due.dueDate)}`
      : account.snapshotTs ? `${language === 'ar' ? 'آخر تحديث' : 'Updated'} ${shortDate(toISODate(new Date(account.snapshotTs)))}` : '';
    return { account, figureFils, caption, freshness };
  // Captions also follow language; unrelated store metadata must not rescan rows.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [activeSources, state.accounts, state.transactions, state.cardDues, now, dues, language]);

  const saveAccount = () => {
    if (!name.trim()) return;
    addAccount({
      name: name.trim(),
      kind,
      openingFils: parseAmountToFils(openingText) ?? 0,
      color: ACCOUNT_COLORS[colorIdx],
    });
    setName('');
    setOpeningText('');
    setAdderVisible(false);
  };

  const saveGoal = () => {
    const target = parseAmountToFils(goalTarget);
    if (!goalTitle.trim() || !target) return;
    addGoal({ title: goalTitle.trim(), emoji: goalIcon, targetFils: target, savedFils: 0 });
    setGoalTitle('');
    setGoalTarget('');
    setGoalVisible(false);
  };

  /**
   * Ask, on every platform, instead of guessing on one.
   *
   * This was `Alert.prompt?.(…) ?? (+100)`: an iOS prompt, an early return on
   * web, and on Android — which has no `Alert.prompt` — a silent AED 100
   * added to the goal on a bare tap. Three behaviours, one of them correct,
   * and the wrong one moved money without asking. See AmountSheet.
   */
  const [goalTopUp, setGoalTopUp] = useState<{ id: string; title: string } | null>(null);

  const addToGoal = (fils: number) => {
    const goal = state.goals.find((g) => g.id === goalTopUp?.id);
    if (goal) editGoal(goal.id, { savedFils: goal.savedFils + fils });
  };

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
    else confirmDeleteAccount(account.id, account.name);
  };

  const openAccount = (account: Account) => {
    if (account.kind === 'card' || account.cardType) {
      router.push(`/cards?card=${account.id}`);
      return;
    }
    setOptionsFor(account);
  };

  return (
    <>
      <ScreenScaffold
        tabbed
        headerMode="inline"
        header={walletHeader}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
        }
        contentStyle={styles.content}
        scrollProps={{
          contentOffset: Platform.OS === 'ios'
            ? { x: 0, y: -walletInsets.contentInset.top }
            : undefined,
          showsVerticalScrollIndicator: false,
        }}>

          {/* Wallet answers concrete account questions. Inbox history is not
              complete enough to make a defensible net-worth claim. */}
          <BalanceOverview
            onAddAccount={() => setAdderVisible(true)}
            balanceCoverageText={balanceCoverageText}
            balanceFils={balances.balanceFils}
            knownBalanceCount={balanceAccountCoverage.known}
            duesTotalFils={duesTotalFils}
            cashOutTotalFils={cashOut.totalFils}
            cashOutCardPaymentsFils={cashOut.cardPaymentsFils}
            cashOutAccountOutflowFils={cashOut.accountOutflowFils}
            currencies={currencies}
            currenciesTotalFils={currenciesTotalFils}
            activeSourceCount={activeSources.length}
            largeText={largeText}
            theme={theme}
            onOpenBills={() => {
              tapped();
              router.push('/bills');
            }}
            onOpenCurrency={() => router.push('/currency')}
          />

          {/* Group by account purpose without implying a live bank connection. */}
          <Button label={t('accountTransferHistory')} variant="ghost" icon="chevron-right"
            onPress={() => router.push('/review-transfers')} />
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
                      borderColor: theme.cardBorder,
                      backgroundColor: theme.backgroundElement,
                    },
                  ]}>
                  <ThemedText type="small">{t('sameCardRenewed')}</ThemedText>
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
                      style={[styles.reissueBtn, { backgroundColor: theme.primary }]}>
                      <ThemedText type="nano" style={{ color: theme.onPrimary }}>
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
                      style={[
                        styles.reissueBtn,
                        { borderWidth: 1, borderColor: theme.controlBorder },
                      ]}>
                      <ThemedText type="nano" themeColor="textSecondary">
                        {t('differentCard')}
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
              );
            })}

            <AccountGroups rows={accountRows} onOpen={openAccount} onManage={setOptionsFor} />
            <Pressable accessibilityRole="button" onPress={() => router.push('/cards')} style={styles.sectionHeader}>
              <ThemedText type="linkPrimary">{t('cardsHeader')}</ThemedText>
              <Icon name="chevron-right" size={16} color={theme.primary} />
            </Pressable>
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
                <ThemedText type="micro" themeColor="textSecondary">
                  {t('inactiveHeader')} ({inactiveAccounts.length})
                </ThemedText>
                <Icon
                  name={showInactive ? 'chevron-down' : 'chevron-right'}
                  size={15}
                  color={theme.textSecondary}
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
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
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
          <View style={styles.section}>
            <SectionHeader
              title={t('goalsHeader')}
              right={t('newGoal')}
              onPressRight={() => setGoalVisible(true)}
            />
            {state.goals.map((goal) => {
              const ratio = goal.targetFils > 0 ? goal.savedFils / goal.targetFils : 0;
              return (
                <Pressable
                  key={goal.id}
                  onPress={() => setGoalTopUp({ id: goal.id, title: goal.title })}
                  onLongPress={() =>
                    setConfirmation({
                      question: t('deleteGoalTitle'),
                      body: goal.title,
                      confirmLabel: t('delete'),
                      destructive: true,
                      onConfirm: () => deleteGoal(goal.id),
                    })
                  }
                  style={styles.goalRow}>
                  <View style={styles.goalTop}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <Icon
                        name={isIconName(goal.emoji) ? goal.emoji : 'target'}
                        size={14}
                        color={theme.textSecondary}
                      />
                      <ThemedText type="small">{goal.title}</ThemedText>
                    </View>
                    <ThemedText type="small" tabular>
                      {formatAmount(goal.savedFils, { decimals: false })}
                      <ThemedText type="meta" themeColor="textTertiary" tabular>
                        {'  / '}
                        {formatAmount(goal.targetFils, { decimals: false })}
                      </ThemedText>
                    </ThemedText>
                  </View>
                  <ProgressBar ratio={ratio} color={ratio >= 1 ? theme.income : theme.primary} height={6} />
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
                    borderColor: theme.controlBorder,
                    backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                  },
                ]}>
                <View style={[styles.goalEmptyIcon, { backgroundColor: theme.primarySoft }]}>
                  <Icon name="target" size={17} color={theme.primary} strokeWidth={1.8} />
                </View>
                <View style={styles.accountInfo}>
                  <ThemedText type="smallBold">{t('setSavingsGoal')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('savingsGoalHint')}
                  </ThemedText>
                </View>
                <Icon name="chevron-right" size={16} color={theme.textSecondary} />
              </Pressable>
            )}
          </View>

          {/* Where the numbers above came from. The claim that nothing leaves
              the phone is worth stating on the screen that shows balances,
              not only in Settings.

              SMS reading is Android-only, so the scan claim only appears
              where scanning is real. The block itself still does, because
              pasting a bank alert by hand works on every platform and this
              is the only route to the screen that accepts one — gating the
              whole block left iOS and web with no way in at all. */}
          {(
            <Pressable
              onPress={() => router.push('/import-sms')}
              style={({ pressed }) => [
                styles.scan,
                {
                  borderColor: theme.controlBorder,
                  backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                },
              ]}>
              <Icon name="mail" size={17} color={theme.textSecondary} />
              <View style={styles.scanText}>
                <ThemedText type="small">
                  {Platform.OS === 'ios'
                    ? t('importBankActivity')
                    : !isSmsScanningAvailable()
                    ? t('pasteBankMessage')
                    : state.lastScanTs > 0
                      ? tf('inboxScannedAgo', { time: relativeSince(state.lastScanTs, now) })
                      : t('inboxNotRead')}
                </ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {Platform.OS === 'ios'
                    ? t('importBankActivityIosDetail')
                    : !isSmsScanningAvailable()
                    ? t('inboxNeedsAndroid')
                    : tf('entriesReadLocally', {
                        count: smsCount,
                        ending: smsCount === 1 ? 'y' : 'ies',
                      })}
                </ThemedText>
              </View>
              <Icon name="chevron-right" size={16} color={theme.textTertiary} />
            </Pressable>
          )}
      </ScreenScaffold>

      {/* Add account sheet */}
      <BottomSheet visible={adderVisible} onClose={() => setAdderVisible(false)} title={t('newAccount')}
        footer={<Button label={t('addAccount')} onPress={saveAccount} disabled={!name.trim()} />}>
            <ThemedText type="small" accessibilityRole="header">
              {t('accountNamePlaceholder')}
            </ThemedText>
            <TextInput
              accessibilityLabel={t('accountNamePlaceholder')}
              value={name}
              onChangeText={setName}
              placeholder={t('accountNamePlaceholder')}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { backgroundColor: theme.backgroundSelected, borderColor: theme.controlBorder, color: theme.text, textAlign: language === 'ar' ? 'right' : 'left' }]}
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

            <ThemedText type="micro" themeColor="textSecondary">
              {t('openingBalanceOptional')}
            </ThemedText>
            <View style={[styles.amountBox, { backgroundColor: theme.backgroundSelected, borderColor: theme.controlBorder }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">{ledgerCurrencyDisplay()}</ThemedText>
              <TextInput
                accessibilityLabel={t('openingBalanceOptional')}
                value={openingText}
                onChangeText={setOpeningText}
                keyboardType="numeric"
                placeholder={t('openingBalanceOptional')}
                placeholderTextColor={theme.textSecondary}
                style={[styles.amountInput, { color: theme.text }]}
              />
            </View>

            <View style={styles.colorRow}>
              {ACCOUNT_COLORS.map((c, i) => (
                <Pressable
                  key={c}
                  accessibilityRole="radio"
                  accessibilityLabel={tf('choiceColor', { count: i + 1 })}
                  accessibilityState={{ selected: colorIdx === i }}
                  onPress={() => setColorIdx(i)}
                  style={[
                    styles.colorDot,
                    { backgroundColor: c, borderColor: colorIdx === i ? theme.text : 'transparent' },
                  ]}
                />
              ))}
            </View>

      </BottomSheet>

      {/* New goal sheet */}
      <BottomSheet visible={goalVisible} onClose={() => setGoalVisible(false)} title={t('newGoalTitle')}
        footer={<Button label={t('createGoal')} onPress={saveGoal}
          disabled={!goalTitle.trim() || !parseAmountToFils(goalTarget)} />}>
            <ThemedText type="small" accessibilityRole="header">{t('goalPlaceholder')}</ThemedText>
            <TextInput
              accessibilityLabel={t('goalPlaceholder')}
              value={goalTitle}
              onChangeText={setGoalTitle}
              placeholder={t('goalPlaceholder')}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { backgroundColor: theme.backgroundSelected, borderColor: theme.controlBorder, color: theme.text, textAlign: language === 'ar' ? 'right' : 'left' }]}
            />

            <ThemedText type="micro" themeColor="textSecondary">{t('targetAmount')}</ThemedText>
            <View style={[styles.amountBox, { backgroundColor: theme.backgroundSelected, borderColor: theme.controlBorder }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">{ledgerCurrencyDisplay()}</ThemedText>
              <TextInput
                accessibilityLabel={t('targetAmount')}
                value={goalTarget}
                onChangeText={setGoalTarget}
                keyboardType="numeric"
                placeholder={t('targetAmount')}
                placeholderTextColor={theme.textSecondary}
                style={[styles.amountInput, { color: theme.text }]}
              />
            </View>

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
            { value: 'delete' as AccountAction, label: t('delete') },
          ]}
          onSelect={(action) => onAccountAction(optionsFor, action)}
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
      {goalTopUp && (
        <AmountSheet
          visible
          onClose={() => setGoalTopUp(null)}
          title={t('goalsHeader')}
          question={tf('addToGoal', { goal: goalTopUp.title })}
          placeholder={t('amountInAed')}
          onSubmit={addToGoal}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  reissue: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.tile,
    padding: Spacing.three,
    gap: Spacing.two - 2,
    marginBottom: Spacing.two,
  },
  reissueActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingTop: Spacing.two - 2,
  },
  reissueBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two - 2,
    borderRadius: Radius.full,
  },
  content: {
    gap: Spacing.four,
  },
  scan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.three,
    borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scanText: { flex: 1, gap: 1 },
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
    gap: Spacing.one + 2,
    paddingVertical: Spacing.one + 2,
  },
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
  input: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 15,
    fontWeight: '600',
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
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
  },
  amountInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: Spacing.three,
  },
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
