import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
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
import { TrendCurve } from '@/components/ui/charts';
import { AccountTile } from '@/components/ui/tile';
import { Icon } from '@/components/ui/icon';
import { IconButton, SectionHeader } from '@/components/ui/period-pill';
import { ProgressBar } from '@/components/ui/progress-bar';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLanguage } from '@/hooks/use-language';
import { usePullToRefresh } from '@/hooks/use-auto-import';
import { useScreenEntering } from '@/hooks/use-screen-entering';
import { internalTransferIds, isSpending, liveAccountIds } from '@/lib/ledger';
import { isSmsScanningAvailable } from '@/lib/auto-import';
import { cardFigure, groupCardsByBank, isInactiveAccount, openDues, reissueSuggestions } from '@/lib/cards';
import { tapped } from '@/lib/haptics';
import { netWorthSeries } from '@/lib/analytics';
import { summarizeForeignActivity } from '@/lib/fx-summary';
import {
  formatAED,
  formatAmount,
  monthKey,
  monthLabel,
  parseAmountToFils,
  totalAsShown,
} from '@/lib/format';
import { netWorthFils, reliableBalanceFils, useStore } from '@/lib/store';
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

export default function WalletScreen() {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const language = useLanguage();
  const enter = useScreenEntering();
  const tabBarClearance = useTabBarClearance();
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

  // The curve is an SVG, so it needs a pixel width rather than a percentage.
  // Measured once from the row it sits in, which is what keeps it correct on a
  // tablet and under RTL.
  const [curveWidth, setCurveWidth] = useState(0);

  /**
   * The headline figure, and how much of this screen it can actually speak for.
   *
   * Scans every transaction once per account, so it is kept off the render
   * path — and it counts as well as sums, because the sum alone lies.
   * `netWorthFils` adds up only balances the bank has quoted; an account whose
   * balance cannot be known contributes nothing (balances.ts), which makes
   * "unknown" and "zero" the same output. A phone whose cards have never sent
   * a statement SMS was therefore told, in display type, that its net worth
   * was AED 0 — directly above rows that each said "no balance SMS yet".
   *
   * So the headline gets the same three-state vocabulary those rows already
   * use: nothing knowable is a dash, not a zero, and a partial answer says how
   * many accounts it had to leave out so it can be reconciled against them.
   */
  const worth = useMemo(() => {
    let known = 0;
    let unknown = 0;
    for (const account of state.accounts) {
      // Archived accounts are out of the sum, so they are out of the count.
      if (account.archived) continue;
      if (reliableBalanceFils(state, account) === null) unknown += 1;
      else known += 1;
    }
    return { fils: netWorthFils(state), known, unknown };
  }, [state]);

  /**
   * Movement since the start of the six-month window. A single figure with no
   * direction is a number; with a direction it is an answer.
   */
  const worthSeries = useMemo(() => netWorthSeries(state).slice(-6), [state]);
  const worthChange = useMemo(() => {
    const series = worthSeries;
    if (series.length < 2) return null;
    const first = series[0];
    // Both ends come from the series. Subtracting the headline `total` from
    // it was subtracting two different definitions of net worth: the headline
    // counts only bank-quoted balances on live accounts, the series counts
    // opening balances plus every transaction. The difference between them is
    // not a movement — it is the gap between two ways of measuring.
    const last = series[series.length - 1];
    return { fils: last.fils - first.fils, since: monthLabel(first.key, true) };
  }, [worthSeries]);
  const dues = useMemo(() => openDues(state, now), [state, now]);
  const reissues = useMemo(() => reissueSuggestions(state, now), [state, now]);
  // Totalled AS SHOWN, because this figure is printed directly above the
  // rows it covers. Summing the exact fils and rounding once gives a heading
  // that can differ from its own list by a dirham — the same defect that put
  // "AED 1,025/mo" over rows adding to 1,022 on Bills.
  const duesTotalFils = useMemo(
    () => totalAsShown(dues.map((d) => d.remainingFils)),
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
  const cardGroups = useMemo(() => groupCardsByBank(cards), [cards]);
  // One physical-feeling object gives Wallet an immediate anchor. The same
  // account is omitted from the compact rows below, so this is hierarchy —
  // not duplicated financial information.
  const featuredCard = cards[0] ?? null;
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

  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = useMemo(
    () => internalTransferIds(state.transactions, liveAccounts),
    [state.transactions, liveAccounts],
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
  const monthSpendByAccount = useMemo(() => {
    const key = monthKey(now);
    const map = new Map<string, number>();
    for (const t of state.transactions) {
      if (!isSpending(t, undefined, internal) || monthKey(t.date) !== key) continue;
      map.set(t.accountId, (map.get(t.accountId) ?? 0) + t.amountFils);
    }
    return map;
  }, [state.transactions, now, internal]);

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
      tf('addToGoal', { goal: goalTitle2 }),
      t('amountInAed'),
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
      t('removeAccountTitle'),
      tf('removeAccountBody', { name: accName }),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('delete'), style: 'destructive', onPress: () => deleteAccount(id) },
      ],
    );
  };

  const accountOptions = (account: Account) => {
    Alert.alert(account.name, account.archived ? t('hiddenFromLists') : undefined, [
      {
        text: account.archived ? t('unhide') : t('hideFromLists'),
        onPress: () => editAccount(account.id, { archived: !account.archived }),
      },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => confirmDeleteAccount(account.id, account.name),
      },
      { text: t('cancel'), style: 'cancel' },
    ]);
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }
          showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <ThemedText type="title">{t('walletTitle')}</ThemedText>
            <View style={styles.headerActions}>
              <IconButton
                name="sliders"
                label={t('settingsTitle')}
                onPress={() => router.push('/settings')}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('newAccount')}
                onPress={() => setAdderVisible(true)}
                style={[styles.addBtn, { backgroundColor: theme.primary }]}>
                <Icon name="plus" size={19} color={theme.onPrimary} strokeWidth={2.2} />
              </Pressable>
            </View>
          </View>

          {/* The one figure this screen exists to show. No card and no
              gradient behind it: theme.ts asks for dividers over boxes, and the
              three hard-coded hexes the fill used exist in neither palette. */}
          <View style={styles.worth}>
            <ThemedText type="micro" themeColor="textTertiary">
              {t('netWorth')}
            </ThemedText>
            <View style={styles.worthRow}>
              <ThemedText type="smallBold" themeColor="textSecondary" tabular style={styles.aed}>
                AED
              </ThemedText>
              <ThemedText type="amount" tabular>
                {worth.known > 0 ? formatAmount(worth.fils, { decimals: false }) : '—'}
              </ThemedText>
            </View>
            {worth.unknown > 0 && (
              <ThemedText type="micro" themeColor="textSecondary">
                {/* "label · count" is this screen's own idiom for a qualifier
                    with a number on it — the bank group headings below read
                    the same way — so the caption needs no sentence of its own
                    to say WHICH rows the figure could not include. */}
                {worth.known > 0 ? `${t('noBalanceYet')} · ${worth.unknown}` : t('noBalanceYet')}
              </ThemedText>
            )}
          </View>

          {/* The shape behind that figure — a line, not bars.
              This was six columns scaled 10–40px across the window's own
              min/max, so five of the six months rendered as near-identical
              stubs beside one tall block and the card read as "you had nothing
              until August". Bars are also the wrong mark: a bar says "these are
              six separate amounts", and a balance is one amount that never
              stopped existing between the months. TrendCurve is the shared
              primitive for exactly that. */}
          {worthSeries.length > 1 && (
            <Animated.View
              entering={enter(FadeInDown.duration(320))}
              style={styles.section}>
              <SectionHeader title={t('netWorth6mo')} />
              <View
                accessible
                accessibilityLabel={t('netWorth6mo')}
                onLayout={(e) => setCurveWidth(e.nativeEvent.layout.width)}>
                {curveWidth > 0 && (
                  <TrendCurve points={worthSeries} width={curveWidth} height={104} />
                )}
              </View>
              {/* Every month named. Printing only the first and last left the
                  four in between unlabelled on a chart whose whole subject is
                  when things moved. */}
              <View style={styles.axis}>
                {worthSeries.map((point, index) => (
                  <ThemedText
                    key={point.key}
                    type="nano"
                    themeColor={index === worthSeries.length - 1 ? 'text' : 'textTertiary'}>
                    {monthLabel(point.key, true).split(' ')[0]}
                  </ThemedText>
                ))}
              </View>
              {worthChange && (
                <ThemedText
                  type="meta"
                  tabular
                  style={{ color: worthChange.fils >= 0 ? theme.income : theme.expense }}>
                  {tf('walletChangeSince', {
                    amount: `${worthChange.fils >= 0 ? '+' : '−'}${formatAmount(
                      Math.abs(worthChange.fils),
                      { decimals: false },
                    )}`,
                    date: worthChange.since,
                  })}
                </ThemedText>
              )}
            </Animated.View>
          )}

          {currencies.length > 0 && (
            <View style={styles.section}>
              <SectionHeader
                title={t('walletCurrencies')}
                right={t('review')}
                onPressRight={() => router.push('/currency')}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('walletCurrencies')}
                onPress={() => {
                  tapped();
                  router.push('/currency');
                }}
                style={({ pressed }) => [
                  styles.summaryLink,
                  {
                    borderColor: theme.cardBorder,
                    backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                  },
                ]}>
                <View style={[styles.summaryIcon, { backgroundColor: theme.primarySoft }]}>
                  <Icon name="plane" size={17} color={theme.primary} />
                </View>
                <View style={styles.summaryCopy}>
                  <ThemedText type="smallBold">{t('currencyActivityTitle')}</ThemedText>
                  <ThemedText type="meta" themeColor="textSecondary" numberOfLines={1}>
                    {currencies.slice(0, 3).map((group) => group.currency).join(' · ')}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold" tabular numberOfLines={1}>
                  {formatAED(currenciesTotalFils, { decimals: false })}
                </ThemedText>
                <Icon name="chevron-right" size={16} color={theme.textTertiary} />
              </Pressable>
            </View>
          )}

          {/* Card dues */}
          {dues.length > 0 && (
            <View style={styles.section}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('cardPaymentsDue')}
                onPress={() => {
                  tapped();
                  router.push('/bills');
                }}
                style={({ pressed }) => [
                  styles.summaryLink,
                  {
                    borderColor: theme.cardBorder,
                    backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                  },
                ]}>
                <View style={[styles.summaryIcon, { backgroundColor: theme.expenseSoftBg }]}>
                  <Icon name="wallet" size={17} color={theme.expense} />
                </View>
                <View style={styles.summaryCopy}>
                  <ThemedText type="smallBold">{t('cardPaymentsDue')}</ThemedText>
                  <ThemedText type="meta" themeColor="textSecondary">
                    {tf('itemsTracked', { count: dues.length })}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold" tabular numberOfLines={1}>
                  {formatAED(duesTotalFils, { decimals: false })}
                </ThemedText>
                <Icon name="chevron-right" size={16} color={theme.textTertiary} />
              </Pressable>
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
              {/* A card that has a statement but has never been spent on is
                  almost certainly a reissue: the bank kept the account and
                  changed the digits, so the history is on the old number and
                  the bill arrived on the new one. Offered, never done — a
                  brand-new card looks identical, and merging two real cards
                  is a corruption the user cannot see. */}
              {reissues.map((r) => {
                const fresh = state.accounts.find((a) => a.id === r.newAccountId);
                const prior = state.accounts.find((a) => a.id === r.candidateIds[0]);
                if (!fresh || !prior) return null;
                return (
                  <View
                    key={r.newAccountId}
                    style={[styles.reissue, { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="small">{t('sameCardRenewed')}</ThemedText>
                    <ThemedText type="meta" themeColor="textSecondary">
                      {tf('renewedCardDetected', { last4: fresh.last4 ?? '••••', name: prior.name })}
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
                        accessibilityLabel={tf('keepCardSeparateA11y', { last4: fresh.last4 ?? '••••' })}
                        onPress={() => {
                          tapped();
                          markCardsDistinct(fresh.id);
                        }}
                        style={[styles.reissueBtn, { borderWidth: 1, borderColor: theme.cardBorder }]}>
                        <ThemedText type="nano" themeColor="textSecondary">
                          {t('differentCard')}
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              {featuredCard && (() => {
                const figure = cardFigure(state, featuredCard, now);
                const spent = monthSpendByAccount.get(featuredCard.id) ?? 0;
                const issuer =
                  cardGroups.find((group) =>
                    group.accounts.some((account) => account.id === featuredCard.id),
                  )?.bank ?? featuredCard.name;
                return (
                  <Pressable
                    accessibilityLabel={`${featuredCard.name} ${featuredCard.last4 ?? ''}`}
                    onLongPress={() => accountOptions(featuredCard)}
                    style={({ pressed }) => [
                      styles.featuredCard,
                      {
                        borderColor: dark ? '#4C7A69' : '#285D4C',
                        transform: [{ scale: pressed ? 0.985 : 1 }],
                      },
                    ]}>
                    <LinearGradient
                      pointerEvents="none"
                      colors={dark ? ['#285D4C', '#183C31', '#152820'] : ['#2D725A', '#1D503F', '#193A30']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <View pointerEvents="none" style={styles.featuredOrbLarge} />
                    <View pointerEvents="none" style={styles.featuredOrbSmall} />

                    <View style={styles.featuredTop}>
                      <View style={styles.featuredIssuer}>
                        <View style={styles.featuredMark}>
                          <Icon name="bank" size={15} color="#F7FBF8" strokeWidth={1.9} />
                        </View>
                        <ThemedText type="smallBold" numberOfLines={1} style={styles.featuredText}>
                          {issuer}
                        </ThemedText>
                      </View>
                      <ThemedText type="micro" style={styles.featuredMuted}>
                        {featuredCard.cardType === 'credit' ? t('credit') : t('debit')}
                      </ThemedText>
                    </View>

                    <View style={styles.featuredChip}>
                      <View style={styles.featuredChipLine} />
                      <View style={styles.featuredChipLine} />
                    </View>

                    <View style={styles.featuredBalanceRow}>
                      <View style={styles.featuredBalanceCopy}>
                        <ThemedText type="micro" style={styles.featuredMuted}>
                          {figure.kind === 'owed'
                            ? t('owed')
                            : figure.kind === 'balance'
                              ? t('perBankSms')
                              : t('noBalanceYet')}
                        </ThemedText>
                        <View style={styles.featuredMoney}>
                          <ThemedText type="micro" style={styles.featuredMuted}>AED</ThemedText>
                          <ThemedText type="heading" tabular style={styles.featuredText}>
                            {figure.fils === null
                              ? '—'
                              : formatAmount(Math.abs(figure.fils), { decimals: false })}
                          </ThemedText>
                        </View>
                      </View>
                      <ThemedText type="small" tabular style={styles.featuredText}>
                        •••• {featuredCard.last4 ?? '••••'}
                      </ThemedText>
                    </View>

                    <View style={styles.featuredFooter}>
                      <ThemedText type="meta" numberOfLines={1} style={styles.featuredMuted}>
                        {featuredCard.name}
                      </ThemedText>
                      <View style={styles.featuredSpend}>
                        <ThemedText type="nano" style={styles.featuredMuted}>
                          {t('thisMonth')}
                        </ThemedText>
                        <ThemedText type="smallBold" tabular numberOfLines={1} style={styles.featuredText}>
                          {spent > 0
                            ? formatAED(spent, { decimals: false })
                            : t('nothingSpentThisMonth')}
                        </ThemedText>
                      </View>
                    </View>
                  </Pressable>
                );
              })()}
              {/* Grouped under the bank that issued them. Eleven flat rows,
                  six of them called "FAB Credit Card", told the user nothing
                  about whether that was six cards or one card the app had
                  failed to recognise. Under a FAB heading it is obviously
                  six FAB cards — and if that is wrong, it is obviously
                  wrong. */}
              {cardGroups.map((group) => {
                const compactAccounts = group.accounts.filter(
                  (account) => account.id !== featuredCard?.id,
                );
                if (compactAccounts.length === 0) return null;
                return (
                <View key={group.bank} style={styles.bankGroup}>
                  <ThemedText type="micro" themeColor="textTertiary" style={styles.bankName}>
                    {group.bank}
                    {compactAccounts.length > 1 ? ` · ${compactAccounts.length}` : ''}
                  </ThemedText>
                  {compactAccounts.map((account, i) => {
                    const isCredit = account.cardType === 'credit';
                    // One meaning per row: what you owe, or what you have.
                    // Spending moves to the second line, where it reads as
                    // context rather than as money.
                    const figure = cardFigure(state, account, now);
                    const spent = monthSpendByAccount.get(account.id) ?? 0;
                    return (
                      <Pressable
                        key={account.id}
                        onLongPress={() => accountOptions(account)}
                        accessibilityLabel={`${account.name} ${account.last4 ?? ''}`}
                        style={[
                          styles.accountRow,
                          i > 0 && {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: theme.cardBorder,
                          },
                        ]}>
                        <AccountTile account={account} />
                        <View style={styles.accountInfo}>
                          <ThemedText type="default" numberOfLines={1}>
                            {isCredit ? t('credit') : t('debit')}
                            {account.last4 ? ` ·· ${account.last4}` : ''}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                            {spent > 0
                              ? tf('cardSpentThisMonth', {
                                  amount: formatAmount(spent, { decimals: false }),
                                })
                              : t('nothingSpentThisMonth')}
                          </ThemedText>
                        </View>
                        <View style={styles.accountRight}>
                          <View style={styles.compactMoney}>
                            <ThemedText type="micro" themeColor="textTertiary">AED</ThemedText>
                            <ThemedText
                              type="smallBold"
                              tabular
                              numberOfLines={1}
                            style={{
                              color:
                                figure.kind === 'owed' && (figure.fils ?? 0) > 0
                                  ? theme.expense
                                  : theme.text,
                              fontSize: 15,
                            }}>
                              {figure.fils === null
                                ? '—'
                                : formatAmount(Math.abs(figure.fils), { decimals: false })}
                            </ThemedText>
                          </View>
                          <ThemedText type="micro" themeColor="textSecondary">
                            {figure.kind === 'owed'
                              ? t('owed')
                              : figure.kind === 'balance'
                                ? t('perBankSms')
                                : t('noBalanceYet')}
                          </ThemedText>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                );
              })}
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
                        {t(meta.labelKey)}
                        {account.last4 ? ` ·· ${account.last4}` : ''}
                      </ThemedText>
                    </View>
                    <View style={styles.accountRight}>
                      <View style={styles.compactMoney}>
                        <ThemedText type="micro" themeColor="textTertiary">AED</ThemedText>
                        <ThemedText type="smallBold" tabular numberOfLines={1} style={{ fontSize: 15 }}>
                          {balance !== null ? formatAmount(balance, { decimals: false }) : '—'}
                        </ThemedText>
                      </View>
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
                  {t('noAccountsYet')}
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
                          {account.archived ? t('hidden') : t('noActivity90')}
                        </ThemedText>
                      </View>
                    </Pressable>
                  ))}
                  <ThemedText type="micro" themeColor="textSecondary" style={styles.hint}>
                    {t('longPressInactive')}
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
                    Alert.alert(t('deleteGoalTitle'), goal.title, [
                      { text: t('cancel'), style: 'cancel' },
                      { text: t('delete'), style: 'destructive', onPress: () => deleteGoal(goal.id) },
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
                  borderColor: theme.cardBorder,
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
              <ThemedText type="heading">{t('newAccount')}</ThemedText>
              <Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={() => setAdderVisible(false)}>
                <Icon name="close" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>

            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t('accountNamePlaceholder')}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { backgroundColor: theme.backgroundSelected, color: theme.text, textAlign: language === 'ar' ? 'right' : 'left' }]}
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
                    <ThemedText type="small">{t(KIND_META[k].labelKey)}</ThemedText>
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
                placeholder={t('openingBalanceOptional')}
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
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{t('addAccount')}</ThemedText>
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
              <ThemedText type="heading">{t('newGoalTitle')}</ThemedText>
              <Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={() => setGoalVisible(false)}>
                <Icon name="close" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>

            <TextInput
              value={goalTitle}
              onChangeText={setGoalTitle}
              placeholder={t('goalPlaceholder')}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { backgroundColor: theme.backgroundSelected, color: theme.text, textAlign: language === 'ar' ? 'right' : 'left' }]}
            />

            <View style={[styles.amountBox, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">AED</ThemedText>
              <TextInput
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
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{t('createGoal')}</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  featuredCard: {
    minHeight: 184,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.bottomSheet,
    padding: Spacing.four,
    overflow: 'hidden',
    justifyContent: 'space-between',
    // A floor on the separation between the four blocks. `space-between` alone
    // distributes only the SLACK, and there was almost none: 48 of padding plus
    // ~125 of content inside a 184 minimum left about 3px per gap, so the gold
    // chip sat directly on top of the OWED label — visible on the first card on
    // Wallet. With a gap the card grows to fit instead of packing.
    gap: Spacing.three,
  },
  featuredOrbLarge: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 32,
    borderColor: 'rgba(255,255,255,0.055)',
    top: -92,
    right: -58,
  },
  featuredOrbSmall: {
    position: 'absolute',
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: 'rgba(255,255,255,0.035)',
    bottom: -52,
    left: 52,
  },
  featuredTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  featuredIssuer: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  featuredMark: {
    width: 30,
    height: 30,
    borderRadius: Radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  featuredChip: {
    width: 30,
    height: 23,
    borderRadius: 6,
    paddingVertical: 5,
    justifyContent: 'space-around',
    backgroundColor: '#D8B873',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.42)',
  },
  featuredChipLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(72,55,24,0.55)',
  },
  featuredBalanceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  featuredBalanceCopy: { gap: 1 },
  featuredMoney: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  featuredFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  featuredSpend: { flexShrink: 0, alignItems: 'flex-end', gap: 1 },
  featuredText: { color: '#F7FBF8' },
  featuredMuted: { color: 'rgba(247,251,248,0.72)' },
  bankGroup: {
    paddingTop: Spacing.two,
  },
  bankName: {
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    paddingBottom: Spacing.two - 4,
  },
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
  // One label per point, spread to the same width the curve is drawn to, so a
  // month name sits under the part of the line it belongs to.
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
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
  summaryLink: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
    gap: Spacing.two + 2,
  },
  summaryIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCopy: { flex: 1, minWidth: 0, gap: 1 },
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
