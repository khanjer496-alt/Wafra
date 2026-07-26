import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AccountTile } from '@/components/ui/tile';
import { Icon } from '@/components/ui/icon';
import { IconButton, SectionHeader } from '@/components/ui/period-pill';
import { ProgressBar } from '@/components/ui/progress-bar';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';
import { isSmsScanningAvailable } from '@/lib/auto-import';
import { isInactiveAccount, openDues } from '@/lib/cards';
import { netWorthSeries } from '@/lib/analytics';
import {
  cardTitle,
  formatAED,
  formatAmount,
  monthKey,
  monthLabel,
  parseAmountToFils,
  shortDate,
  toISODate,
} from '@/lib/format';
import { netWorthFils, reliableBalanceFils, useStore } from '@/lib/store';
import type { Account, AccountKind } from '@/lib/types';


const KIND_META: Record<AccountKind, { label: string; icon: import('@/components/ui/icon').IconName }> = {
  bank: { label: 'Bank', icon: 'bank' },
  card: { label: 'Card', icon: 'wallet' },
  cash: { label: 'Cash', icon: 'cash' },
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
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export default function WalletScreen() {
  const theme = useTheme();
  const tabBarClearance = useTabBarClearance();
  const router = useRouter();
  const { state, addAccount, editAccount, deleteAccount, payCardDue, addGoal, editGoal, deleteGoal } =
    useStore();

  const now = useMemo(() => new Date(), []);
  const todayISO = toISODate(now);

  const [adderVisible, setAdderVisible] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('bank');
  const [openingText, setOpeningText] = useState('');
  const [colorIdx, setColorIdx] = useState(0);

  const [goalVisible, setGoalVisible] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalIcon, setGoalIcon] = useState(GOAL_ICONS[0]);

  // Scans every transaction once per account, so it is kept off the render path.
  const total = useMemo(() => netWorthFils(state), [state]);

  /**
   * Movement since the start of the six-month window. A single figure with no
   * direction is a number; with a direction it is an answer.
   */
  const worthChange = useMemo(() => {
    const series = netWorthSeries(state);
    if (series.length < 2) return null;
    const first = series[0];
    // Both ends come from the series. Subtracting the headline `total` from
    // it was subtracting two different definitions of net worth: the headline
    // counts only bank-quoted balances on live accounts, the series counts
    // opening balances plus every transaction. The difference between them is
    // not a movement — it is the gap between two ways of measuring.
    const last = series[series.length - 1];
    return { fils: last.fils - first.fils, since: monthLabel(first.key, true) };
  }, [state]);
  const dues = useMemo(() => openDues(state, now), [state, now]);
  const duesTotalFils = useMemo(
    () => dues.reduce((sum, d) => sum + d.remainingFils, 0),
    [dues],
  );

  // Cards (auto-discovered from SMS or added manually) get their own section.
  // Expired/unused ones (silent 90+ days, or hidden) live in a drawer below.
  const [showInactive, setShowInactive] = useState(false);
  const cards = useMemo(
    () =>
      state.accounts.filter(
        (a) => (a.kind === 'card' || a.cardType) && !isInactiveAccount(state, a, now),
      ),
    [state, now],
  );
  const nonCardAccounts = useMemo(
    () =>
      state.accounts.filter(
        (a) => a.kind !== 'card' && !a.cardType && !isInactiveAccount(state, a, now),
      ),
    [state, now],
  );
  const inactiveAccounts = useMemo(
    () => state.accounts.filter((a) => isInactiveAccount(state, a, now)),
    [state, now],
  );
  // This month's spend per account, for the per-card line.
  const smsCount = useMemo(
    () => state.transactions.filter((tx) => tx.source === 'sms').length,
    [state.transactions],
  );

  const monthSpendByAccount = useMemo(() => {
    const key = monthKey(now);
    const map = new Map<string, number>();
    for (const t of state.transactions) {
      if (t.type !== 'expense' || t.isTransfer || monthKey(t.date) !== key) continue;
      map.set(t.accountId, (map.get(t.accountId) ?? 0) + t.amountFils);
    }
    return map;
  }, [state.transactions, now]);

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

  const addToGoal = (goalId: string, goalTitle2: string) => {
    if (Platform.OS === 'web') return;
    Alert.prompt?.(
      `Add to ${goalTitle2}`,
      'Amount in AED',
      (text) => {
        const fils = parseAmountToFils(text ?? '');
        const goal = state.goals.find((g) => g.id === goalId);
        if (fils && goal) editGoal(goalId, { savedFils: goal.savedFils + fils });
      },
      'plain-text',
      '',
      'numeric',
    ) ??
      // Android has no Alert.prompt: quick +100 with long-press hint
      (() => {
        const goal = state.goals.find((g) => g.id === goalId);
        if (goal) editGoal(goalId, { savedFils: goal.savedFils + 10_000 });
      })();
  };

  const confirmDeleteAccount = (id: string, accName: string) => {
    Alert.alert(
      'Remove account?',
      `"${accName}" and all its transactions will be deleted. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteAccount(id) },
      ],
    );
  };

  const accountOptions = (account: Account) => {
    Alert.alert(account.name, account.archived ? 'Hidden from lists.' : undefined, [
      {
        text: account.archived ? 'Unhide' : 'Hide from lists',
        onPress: () => editAccount(account.id, { archived: !account.archived }),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => confirmDeleteAccount(account.id, account.name),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const onPayDue = (dueId: string, remainingFils: number, accountId: string, accName: string) => {
    Alert.alert(
      `Pay ${accName}?`,
      `Marks ${formatAED(remainingFils, { decimals: false })} as paid and records the transfer.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark paid',
          onPress: () =>
            payCardDue(
              dueId,
              remainingFils,
              {
                type: 'income',
                amountFils: remainingFils,
                category: 'other',
                accountId,
                title: `${accName} payment`,
                date: todayISO,
                source: 'manual',
                isTransfer: true,
              },
              true,
            ),
        },
      ],
    );
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <ThemedText type="title">{t('walletTitle')}</ThemedText>
            <View style={styles.headerActions}>
              <IconButton
                name="sliders"
                label="Settings"
                onPress={() => router.push('/settings')}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="New account"
                onPress={() => setAdderVisible(true)}
                style={[styles.addBtn, { backgroundColor: theme.primary }]}>
                <Icon name="plus" size={19} color={theme.onPrimary} strokeWidth={2.2} />
              </Pressable>
            </View>
          </View>

          {/* The one figure this screen exists to show. */}
          <View style={styles.worth}>
            <ThemedText type="micro" themeColor="textTertiary">
              {t('netWorth')}
            </ThemedText>
            <View style={styles.worthRow}>
              <ThemedText type="smallBold" themeColor="textSecondary" tabular style={styles.aed}>
                AED
              </ThemedText>
              <ThemedText type="amount" tabular>
                {formatAmount(total, { decimals: false })}
              </ThemedText>
            </View>
            {worthChange && (
              <ThemedText
                type="meta"
                tabular
                style={{ color: worthChange.fils >= 0 ? theme.income : theme.expense }}>
                {worthChange.fils >= 0 ? '+' : '−'}
                {formatAmount(Math.abs(worthChange.fils), { decimals: false })} since{' '}
                {worthChange.since}
              </ThemedText>
            )}
          </View>

          {/* Card dues */}
          {dues.length > 0 && (
            <View style={styles.section}>
              <SectionHeader
                title={t('cardPaymentsDue')}
                right={`${formatAED(duesTotalFils, { decimals: false })} total`}
              />
              {dues.map(({ due, status, daysLeft, remainingFils, belowMinimum }, i) => {
                const account = state.accounts.find((a) => a.id === due.accountId);
                const urgent = status === 'urgent' || status === 'overdue';
                // Only the most pressing due is shouted in the alert color. A
                // column of identical red rows reads as one alarm and hides
                // which card actually needs paying first.
                const leading = i === 0 && urgent;
                return (
                  <Animated.View key={due.id} entering={FadeInDown.duration(300)}>
                    <View
                      style={[
                        styles.dueRow,
                        i > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: theme.cardBorder,
                        },
                      ]}>
                      <View
                        style={[
                          styles.dueMarker,
                          { backgroundColor: leading ? theme.expense : urgent ? `${theme.expense}55` : theme.track },
                        ]}
                      />
                      <View style={styles.dueInfo}>
                        <ThemedText type="default" numberOfLines={1}>
                          {cardTitle(account?.name ?? 'Card')}
                        </ThemedText>
                        <ThemedText
                          type="small"
                          themeColor={leading ? undefined : 'textSecondary'}
                          style={leading ? { color: theme.expense } : undefined}>
                          {status === 'overdue'
                            ? `${-daysLeft}d overdue`
                            : `Pay by ${shortDate(due.dueDate)} · ${daysLeft}d left`}
                          {belowMinimum ? ` · min ${formatAED(due.minDueFils, { decimals: false })}` : ''}
                        </ThemedText>
                      </View>
                      <View style={styles.dueRight}>
                        <ThemedText
                          type="heading"
                          tabular
                          style={leading ? { color: theme.expense } : undefined}>
                          {formatAED(remainingFils, { decimals: false })}
                        </ThemedText>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Mark ${account?.name ?? 'card'} as paid`}
                          onPress={() =>
                            onPayDue(due.id, remainingFils, due.accountId, account?.name ?? 'Card')
                          }
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.payBtn,
                            {
                              backgroundColor: pressed ? `${theme.primary}2e` : `${theme.primary}17`,
                              borderColor: `${theme.primary}44`,
                              transform: [{ scale: pressed ? 0.97 : 1 }],
                            },
                          ]}>
                          <ThemedText type="nano" style={{ color: theme.primary }}>
                            Mark paid
                          </ThemedText>
                        </Pressable>
                      </View>
                    </View>
                  </Animated.View>
                );
              })}
            </View>
          )}

          {/* Cards */}
          {cards.length > 0 && (
            <View style={styles.section}>
              <SectionHeader
                title={`${t('cardsHeader')} (${cards.length})`}
                right={t('seeAll')}
                onPressRight={() => router.push('/cards')}
              />
              <View>
                {cards.map((account, i) => {
                  const isCredit = account.cardType === 'credit';
                  // Only figures the bank itself quoted (balance/outstanding
                  // SMS) are shown as balances. Partial SMS history can't
                  // reconstruct one, so without a quote we show month spend.
                  const reliable = reliableBalanceFils(state, account);
                  const display = reliable !== null ? Math.abs(reliable) : null;
                  const spent = monthSpendByAccount.get(account.id) ?? 0;
                  return (
                    <Pressable
                      key={account.id}
                      onLongPress={() => accountOptions(account)}
                      style={[
                        styles.accountRow,
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
                      ]}>
                      <AccountTile account={account} />
                      <View style={styles.accountInfo}>
                        <ThemedText type="default" numberOfLines={1}>
                          {cardTitle(account.name)}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {isCredit ? 'Credit' : 'Debit'}
                          {account.last4 ? ` ·· ${account.last4}` : ''}
                        </ThemedText>
                      </View>
                      <View style={styles.accountRight}>
                        <ThemedText
                          type="smallBold"
                          tabular
                          style={{
                            color:
                              isCredit && display !== null && display > 0
                                ? theme.expense
                                : theme.text,
                            fontSize: 15,
                          }}>
                          {formatAED(display ?? spent, { decimals: false })}
                        </ThemedText>
                        <ThemedText type="micro" themeColor="textSecondary">
                          {display !== null
                            ? isCredit
                              ? t('outstanding')
                              : t('perBankSms')
                            : t('spentThisMonthCaption')}
                        </ThemedText>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Accounts */}
          <View style={styles.section}>
            <SectionHeader title={t('accountsHeader')} />
            <View>
              {nonCardAccounts.map((account, i) => {
                const balance = reliableBalanceFils(state, account);
                const fromBank = account.snapshotKind === 'balance' && account.snapshotFils !== undefined;
                const meta = KIND_META[account.kind];
                return (
                  <Pressable
                    key={account.id}
                    onLongPress={() => accountOptions(account)}
                    style={[
                      styles.accountRow,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
                    ]}>
                    <AccountTile account={account} />
                    <View style={styles.accountInfo}>
                      <ThemedText type="default" numberOfLines={1}>
                        {account.name}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {meta.label}
                        {account.last4 ? ` ·· ${account.last4}` : ''}
                      </ThemedText>
                    </View>
                    <View style={styles.accountRight}>
                      <ThemedText type="smallBold" tabular style={{ fontSize: 15 }}>
                        {balance !== null ? formatAED(balance, { decimals: false }) : '—'}
                      </ThemedText>
                      {fromBank ? (
                        <ThemedText type="micro" themeColor="textSecondary">
                          {t('perBankSms')}
                        </ThemedText>
                      ) : balance === null ? (
                        <ThemedText type="micro" themeColor="textSecondary">
                          {t('noBalanceYet')}
                        </ThemedText>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
              {nonCardAccounts.length === 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  No bank or cash accounts yet.
                </ThemedText>
              )}
            </View>
          </View>

          {/* Inactive: expired/unused cards and accounts */}
          {inactiveAccounts.length > 0 && (
            <View style={styles.section}>
              <Pressable onPress={() => setShowInactive((v) => !v)} style={styles.sectionHeader}>
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
                      onLongPress={() => accountOptions(account)}
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
                          {account.archived ? 'Hidden' : 'No activity for 90+ days'}
                        </ThemedText>
                      </View>
                    </Pressable>
                  ))}
                  <ThemedText type="micro" themeColor="textSecondary" style={styles.hint}>
                    Long-press to unhide or delete
                  </ThemedText>
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
                  onPress={() => addToGoal(goal.id, goal.title)}
                  onLongPress={() =>
                    Alert.alert('Delete goal?', goal.title, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => deleteGoal(goal.id) },
                    ])
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
                    borderColor: theme.cardBorder,
                    backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                  },
                ]}>
                <View style={[styles.goalEmptyIcon, { backgroundColor: theme.primarySoft }]}>
                  <Icon name="target" size={17} color={theme.primary} strokeWidth={1.8} />
                </View>
                <View style={styles.accountInfo}>
                  <ThemedText type="smallBold">Set a savings goal</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Umrah, a car, a rainy-day fund — track it here.
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
                  borderColor: theme.cardBorder,
                  backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                },
              ]}>
              <Icon name="mail" size={17} color={theme.textSecondary} />
              <View style={styles.scanText}>
                <ThemedText type="small">
                  {!isSmsScanningAvailable()
                    ? 'Paste a bank message'
                    : state.lastScanTs > 0
                      ? `Inbox scanned ${relativeSince(state.lastScanTs, now)}`
                      : 'Inbox not read yet'}
                </ThemedText>
                <ThemedText type="meta" themeColor="textTertiary" tabular>
                  {!isSmsScanningAvailable()
                    ? 'Reading the inbox needs the Android app; pasting works anywhere'
                    : `${smsCount} entr${smsCount === 1 ? 'y' : 'ies'} read on this device · nothing uploaded`}
                </ThemedText>
              </View>
              <Icon name="chevron-right" size={16} color={theme.textTertiary} />
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Add account sheet */}
      <Modal visible={adderVisible} transparent animationType="fade" onRequestClose={() => setAdderVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAdderVisible(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
            onPress={() => {}}>
            <View style={[styles.grabber, { backgroundColor: theme.cardBorder }]} />
            <View style={styles.sheetHeader}>
              <ThemedText type="heading">New account</ThemedText>
              <Pressable onPress={() => setAdderVisible(false)}>
                <Icon name="close" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>

            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Account name (e.g. ADCB Savings)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { backgroundColor: theme.backgroundSelected, color: theme.text }]}
            />

            <View style={styles.kindRow}>
              {(Object.keys(KIND_META) as AccountKind[]).map((k) => (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  style={[
                    styles.kindChip,
                    {
                      backgroundColor: kind === k ? `${theme.primary}22` : theme.backgroundSelected,
                      borderColor: kind === k ? theme.primary : 'transparent',
                    },
                  ]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Icon name={KIND_META[k].icon} size={13} color={theme.text} />
                    <ThemedText type="small">{KIND_META[k].label}</ThemedText>
                  </View>
                </Pressable>
              ))}
            </View>

            <View style={[styles.amountBox, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">AED</ThemedText>
              <TextInput
                value={openingText}
                onChangeText={setOpeningText}
                keyboardType="numeric"
                placeholder="Opening balance (optional)"
                placeholderTextColor={theme.textSecondary}
                style={[styles.amountInput, { color: theme.text }]}
              />
            </View>

            <View style={styles.colorRow}>
              {ACCOUNT_COLORS.map((c, i) => (
                <Pressable
                  key={c}
                  onPress={() => setColorIdx(i)}
                  style={[
                    styles.colorDot,
                    { backgroundColor: c, borderColor: colorIdx === i ? theme.text : 'transparent' },
                  ]}
                />
              ))}
            </View>

            <Pressable
              onPress={saveAccount}
              disabled={!name.trim()}
              style={[styles.saveBtn, { backgroundColor: theme.primary, opacity: name.trim() ? 1 : 0.45 }]}>
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>Add account</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* New goal sheet */}
      <Modal visible={goalVisible} transparent animationType="fade" onRequestClose={() => setGoalVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setGoalVisible(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
            onPress={() => {}}>
            <View style={[styles.grabber, { backgroundColor: theme.cardBorder }]} />
            <View style={styles.sheetHeader}>
              <ThemedText type="heading">New goal</ThemedText>
              <Pressable onPress={() => setGoalVisible(false)}>
                <Icon name="close" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>

            <TextInput
              value={goalTitle}
              onChangeText={setGoalTitle}
              placeholder="Goal (e.g. Umrah trip, new car)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { backgroundColor: theme.backgroundSelected, color: theme.text }]}
            />

            <View style={[styles.amountBox, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">AED</ThemedText>
              <TextInput
                value={goalTarget}
                onChangeText={setGoalTarget}
                keyboardType="numeric"
                placeholder="Target amount"
                placeholderTextColor={theme.textSecondary}
                style={[styles.amountInput, { color: theme.text }]}
              />
            </View>

            <View style={styles.colorRow}>
              {GOAL_ICONS.map((ic) => (
                <Pressable
                  key={ic}
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

            <Pressable
              onPress={saveGoal}
              disabled={!goalTitle.trim() || !parseAmountToFils(goalTarget)}
              style={[
                styles.saveBtn,
                {
                  backgroundColor: theme.primary,
                  opacity: !goalTitle.trim() || !parseAmountToFils(goalTarget) ? 0.45 : 1,
                },
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>Create goal</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.three,
    gap: Spacing.five,
  },
  worth: { gap: Spacing.two, marginTop: -Spacing.two },
  worthRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  aed: { fontSize: 15, lineHeight: 20 },
  scan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.three,
    borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scanText: { flex: 1, gap: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: Radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    gap: Spacing.two,
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
    gap: 1,
  },
  dueRight: {
    alignItems: 'flex-end',
    gap: Spacing.one + 2,
  },
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
    gap: 1,
  },
  accountRight: {
    alignItems: 'flex-end',
  },
  hint: {
    opacity: 0.8,
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
    width: 40,
    height: 40,
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
