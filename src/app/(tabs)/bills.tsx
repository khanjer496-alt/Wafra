import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CardDetailSheet } from '@/components/card-detail-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Icon } from '@/components/ui/icon';
import { CategoryChips } from '@/components/ui/category-chips';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-auto-import';
import { useScreenEntering } from '@/hooks/use-screen-entering';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { billsForMonth, type BillStatus } from '@/lib/bills';
import { openDues, recentlySettledDues } from '@/lib/cards';
import { EXPENSE_CATEGORIES } from '@/lib/categories';
import {
  formatAED,
  formatAmount,
  fullDateTime,
  monthKey,
  parseAmountToFils,
  shortDate,
  toISODate,
  totalAsShown,
} from '@/lib/format';
import { internalTransferIds, isSpending, liveAccountIds } from '@/lib/ledger';
import {
  activeSubscriptions,
  billCommitments,
  detectSubscriptions,
  daysUntilNext,
  fixedCommitments,
  otherCommitments,
  recurringPaymentAccount,
  stoppedSubscriptions,
  trueSubscriptions,
  type Subscription,
} from '@/lib/subscriptions';
import { useStore } from '@/lib/store';
import type { Account, Bill, CategoryId } from '@/lib/types';
import { t, tf } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';

type Segment = 'subscriptions' | 'cards' | 'utilities';

/**
 * A confirmation waiting on the user, or null.
 *
 * Every committing action on this screen — marking a bill paid, settling a
 * card statement, deleting a reminder, dropping a subscription — used to be
 * gated by `Alert.alert` with the store call inside a button's `onPress`. On
 * react-native-web that method is empty, so the alert never drew and the store
 * call was unreachable: four buttons that did nothing at all, in silence. The
 * work lives in `onConfirm` and is handed to a sheet that is actually drawn.
 */
type Confirmation = {
  question: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
};

export default function BillsScreen() {
  const theme = useTheme();
  const enter = useScreenEntering();
  const clearance = useTabBarClearance();
  const { state, addBill, deleteBill, markBillPaid, setNotSubscription, payCardDue } = useStore();
  /**
   * The screen that answers "is this card settled?" can now go and find out.
   *
   * Paying a credit card and coming straight here to check is the single most
   * likely reason this tab is open, and until now nothing on it could ask the
   * inbox for the payment SMS — the scan lived on Home. A user who paid
   * AED 5,645 off a FAB card saw the card still listing AED 5,645 owing, with
   * no gesture on this screen able to change that.
   */
  const { refreshing, onRefresh } = usePullToRefresh();

  const now = useMemo(() => new Date(), []);
  const key = monthKey(now);
  const todayISO = toISODate(now);

  const [segment, setSegment] = useState<Segment>('subscriptions');
  const [detail, setDetail] = useState<Subscription | null>(null);
  // A due is a question about one card, not a reason to leave the Bills tab.
  const [cardDetail, setCardDetail] = useState<Account | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const [adderVisible, setAdderVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [amountText, setAmountText] = useState('');
  const [dueDayText, setDueDayText] = useState('');
  const [category, setCategory] = useState<CategoryId>('utilities');

  const cadenceLabel = (cadence: Subscription['cadence']): string =>
    cadence === 'weekly'
      ? t('cadenceWeekly')
      : cadence === 'monthly'
        ? t('cadenceMonthly')
        : cadence === 'yearly'
          ? t('cadenceYearly')
          : t('cadenceAsNeeded');

  const scheduleWhen = (days: number): string => {
    if (days === 0) return t('today');
    if (days === 1) return t('tomorrow');
    if (days === 2) return t('scheduleInTwoDays');
    if (days <= 10) return tf('scheduleInFewDays', { days });
    return tf('scheduleInManyDays', { days });
  };

  const dues = useMemo(() => openDues(state, now), [state, now]);
  const paidCards = useMemo(() => recentlySettledDues(state, now), [state, now]);
  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = useMemo(
    () => internalTransferIds(state.transactions, liveAccounts),
    [state.transactions, liveAccounts],
  );
  // The same live/internal pair every other screen that adds money up passes.
  // Without it a charge on an archived card reconciles a bill to "Paid" while
  // Flow's Total out never moves.
  const rows = useMemo(
    () => billsForMonth(state.bills, state.transactions, now, liveAccounts, internal),
    [state.bills, state.transactions, now, liveAccounts, internal],
  );
  const detected = useMemo(
    () =>
      detectSubscriptions(state.transactions, state.notSubscriptions, now, liveAccounts, internal),
    [state.transactions, state.notSubscriptions, now, liveAccounts, internal],
  );
  const subs = useMemo(() => activeSubscriptions(trueSubscriptions(detected)), [detected]);
  const stopped = useMemo(() => stoppedSubscriptions(trueSubscriptions(detected)), [detected]);
  const allCommitments = useMemo(
    () => activeSubscriptions(fixedCommitments(detected)),
    [detected],
  );
  // A car loan filed under "Utilities & fixed bills" reads as a bug even when
  // the detection is right, so repayments get their own block.
  const loans = useMemo(
    () => allCommitments.filter((s) => s.category === 'loan'),
    [allCommitments],
  );
  // And so does a grocer. "Everything that recurs and is not a subscription"
  // was one bucket wearing the utilities heading, which is how a fish shop and
  // a furniture store came to be listed as monthly bills.
  const commitments = useMemo(
    () => billCommitments(allCommitments).filter((s) => s.category !== 'loan'),
    [allCommitments],
  );
  const otherRepeats = useMemo(() => otherCommitments(allCommitments), [allCommitments]);
  // Rounded per row, because it is printed directly above those rows and has
  // to equal them. `subscriptionsMonthlyTotal` stays the figure for anything
  // that does arithmetic with it.
  const subsTotal = totalAsShown(subs.map((s) => s.monthlyEquivalentFils));

  /**
   * The single-due focal card's figures.
   *
   * This was an IIFE inside the render tree, so a full scan of every
   * transaction ran on EVERY render — toggling "Stopped subscriptions",
   * opening or closing the detail modal, any store dispatch — for a card that
   * shows exactly one due. Memoised on what it actually reads.
   */
  const focalDue = useMemo(() => {
    if (dues.length !== 1) return null;
    const item = dues[0];
    const account = state.accounts.find((a) => a.id === item.due.accountId) ?? null;
    let recentSpend = 0;
    for (const transaction of state.transactions) {
      if (
        transaction.accountId === item.due.accountId &&
        transaction.type === 'expense' &&
        !transaction.isTransfer &&
        monthKey(transaction.date) === key
      ) {
        recentSpend += transaction.amountFils;
      }
    }
    // `openDues` has already allocated imported card-payment transactions
    // across statements. Keep every focal figure on that one result: raw
    // due.paidFils only records manual edits.
    const paidFils = Math.max(0, item.due.totalDueFils - item.remainingFils);
    const paidShare = Math.max(0, Math.min(1, paidFils / Math.max(1, item.due.totalDueFils)));
    return {
      item,
      account,
      recentSpend,
      paidFils,
      paidShare,
      urgent: item.status === 'urgent' || item.status === 'overdue',
    };
  }, [dues, state.accounts, state.transactions, key]);
  const trackedTitles = useMemo(
    () => new Set(state.bills.map((b) => b.title.toLowerCase())),
    [state.bills],
  );

  // Everything the detail sheet needs about the tapped subscription: its raw
  // charges (newest first), which cards paid it, first charge, lifetime total.
  const detailData = useMemo(() => {
    if (!detail) return null;
    const titleKey = detail.title.trim().toLowerCase();
    // The SAME predicate `detectSubscriptions` grouped these rows with. A
    // looser one here (type + isTransfer, with no live/internal sets) counted
    // charges the detection had already excluded: a Netflix charge on an
    // archived card inflated this sheet's "Charges" and "Total paid" above the
    // figure the row that opened the sheet was derived from.
    const txs = state.transactions
      .filter(
        (t) =>
          isSpending(t, liveAccounts, internal) && t.title.trim().toLowerCase() === titleKey,
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    if (txs.length === 0) return null;
    const firstISO = txs[txs.length - 1].date;
    const paymentAccounts = txs.map((transaction) =>
      recurringPaymentAccount(transaction, state.accounts));
    const accounts = [...new Set(
      paymentAccounts.map((account) => account?.id)
        .filter((id): id is string => Boolean(id)),
    )]
      .map((id) => state.accounts.find((a) => a.id === id))
      .filter((a): a is NonNullable<typeof a> => a != null);
    // Totalled as the history rows below are shown. Rounding the raw sum once
    // put "AED 222" over four rows of 56 — the same defect the Flow heading
    // had, in the same sheet as the rows that disprove it.
    const totalFils = totalAsShown(txs.map((t) => t.amountFils));
    const sortedAmounts = txs.map((t) => t.amountFils).sort((a, b) => a - b);
    const medianFils = sortedAmounts[Math.floor(sortedAmounts.length / 2)];
    return {
      txs,
      firstISO,
      accounts,
      unknownInstrumentCount: paymentAccounts.filter((account) => account === undefined).length,
      totalFils,
      medianFils,
    };
  }, [detail, state.transactions, state.accounts, liveAccounts, internal]);

  const subscribedFor = (firstISO: string): string => {
    const d = new Date(`${firstISO}T12:00:00`);
    const months =
      (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (months < 1) return t('subscriptionUnderMonth');
    if (months < 12) return tf('subscriptionMonths', { count: months, s: months === 1 ? '' : 's' });
    const y = Math.floor(months / 12);
    const m = months % 12;
    return m > 0
      ? tf('subscriptionYearsMonths', { years: y, months: m })
      : tf('subscriptionYears', { count: y, s: y === 1 ? '' : 's' });
  };

  /**
   * Whether "Remind me" can honestly be offered for this subscription.
   *
   * Weekly cannot. `paidMonths` is keyed by money month and `billsForMonth`
   * returns one row per bill, so a charge that lands four times a month has
   * nowhere to live — and filing AED 40 a WEEK as a monthly reminder of AED 40
   * understates it by 4.33x, which is the same class of error as the yearly
   * case below in the opposite direction. An affordance that can only produce
   * a wrong number is worse than no affordance.
   */
  const remindable = (sub: Subscription): boolean =>
    sub.cadence !== 'weekly' && sub.cadence !== 'as-needed';

  /**
   * The reminder a subscription becomes.
   *
   * `sub.avgAmountFils` is the RAW charge and `Bill` was monthly-only, so an
   * Amazon Prime renewal of AED 310 a YEAR was filed as AED 310 a MONTH and
   * restated at twelve times the money in the Reminders list and in every
   * notification derived from it. `yearlyOnISO` is what confines it to the one
   * month it actually falls in; see types.ts.
   */
  const billFromSubscription = (sub: Subscription): Omit<Bill, 'id' | 'paidMonths'> => ({
    title: sub.title,
    category: sub.category,
    amountFils: sub.avgAmountFils,
    dueDay: Number(sub.nextExpectedISO.slice(8)),
    yearlyOnISO: sub.cadence === 'yearly' ? sub.nextExpectedISO : undefined,
    autoDetected: true,
  });

  const statusMeta = (status: BillStatus, daysLeft: number) => {
    switch (status) {
      case 'paid':
        return { label: t('paid'), color: theme.income };
      case 'overdue':
        return { label: tf('overdueDays', { days: -daysLeft }), color: theme.expense };
      case 'due-soon':
        return {
          label: daysLeft === 0 ? t('dueToday') : tf('dueInDays', { days: daysLeft }),
          color: theme.warning,
        };
      default:
        return { label: tf('dueInDays', { days: daysLeft }), color: theme.textSecondary };
    }
  };

  /**
   * Exactly what `saveBill` will accept — asked once so the button cannot
   * offer what the handler refuses.
   *
   * The disabled test used to be `!dueDayText`, which is true of "45", "0" and
   * "12.5". Those left the Save button at full opacity and the tap silently did
   * nothing, with the sheet still open and no reason given.
   */
  const draftDueDay = Number(dueDayText);
  const draftValid =
    Boolean(title.trim()) &&
    Boolean(parseAmountToFils(amountText)) &&
    dueDayText.trim() !== '' &&
    Number.isInteger(draftDueDay) &&
    draftDueDay >= 1 &&
    draftDueDay <= 31;

  const saveBill = () => {
    const fils = parseAmountToFils(amountText);
    if (!draftValid || !fils) return;
    addBill({ title: title.trim(), category, amountFils: fils, dueDay: draftDueDay });
    setTitle('');
    setAmountText('');
    setDueDayText('');
    setAdderVisible(false);
  };

  const onPay = (billId: string) => {
    const bill = state.bills.find((b) => b.id === billId);
    if (!bill) return;
    // `state.accounts[0]` is the raw, UNFILTERED list, so index 0 can be an
    // archived account — and an expense booked there is excluded by
    // `liveAccountIds`/`isSpending`, so an AED 450 DEWA bill flipped to "Paid"
    // while Flow's Total out never moved. Prefer the account the user pinned to
    // the bill, then the first one still in play; the raw first account is kept
    // only as the last resort where EVERY account is archived, because a
    // "Mark paid" that quietly does nothing is worse than one that books the
    // expense where the user can still see it.
    const accountId =
      bill.accountId ?? state.accounts.find((a) => !a.archived)?.id ?? state.accounts[0]?.id;
    if (!accountId) return;
    setConfirmation({
      question: tf('markBillPaidTitle', { title: bill.title }),
      body: tf('billRecordsExpense', { amount: formatAED(bill.amountFils, { decimals: false }) }),
      confirmLabel: t('markPaid'),
      onConfirm: () =>
        markBillPaid(billId, key, {
          type: 'expense',
          amountFils: bill.amountFils,
          category: bill.category,
          accountId,
          title: bill.title,
          date: todayISO,
          source: 'manual',
        }),
    });
  };

  const onPayDue = (dueId: string, remainingFils: number, accountId: string, accName: string) => {
    setConfirmation({
      question: tf('payAccountTitle', { name: accName }),
      body: tf('payAccountBody', { amount: formatAED(remainingFils, { decimals: false }) }),
      confirmLabel: t('markPaid'),
      onConfirm: () =>
        payCardDue(
          dueId,
          remainingFils,
          {
            type: 'income',
            amountFils: remainingFils,
            category: 'other',
            accountId,
            title: tf('accountPaymentTitle', { name: accName }),
            date: todayISO,
            source: 'manual',
            isTransfer: true,
          },
          true,
        ),
    });
  };

  const onLongPressBill = (billId: string, billTitle: string) => {
    setConfirmation({
      question: t('deleteReminderTitle'),
      body: tf('deleteReminderBody', { title: billTitle }),
      confirmLabel: t('delete'),
      destructive: true,
      onConfirm: () => deleteBill(billId),
    });
  };

  const onDismissSub = (sub: Subscription) => {
    setConfirmation({
      question: t('notASubscriptionQ'),
      body: tf('removeSubscriptionBody', { title: sub.title }),
      confirmLabel: t('remove'),
      destructive: true,
      onConfirm: () => setNotSubscription(sub.title, true),
    });
  };

  const renderRecurringRow = (sub: Subscription, i: number) => {
    const next = daysUntilNext(sub, now);
    const tracked = trackedTitles.has(sub.title.toLowerCase());
    const paymentObservedThisMonth = monthKey(sub.lastChargedISO) === monthKey(now);
    return (
      <Animated.View
        key={sub.title}
        entering={enter(FadeInDown.delay(Math.min(i, 8) * 40).duration(300))}>
        {/* A divider row, not a card. Per theme.ts a card earns its border
            only when the whole thing is one tappable object; four bordered,
            filled panels stacked with 8px of air between them turned a list
            into four competing surfaces, and the amounts never lined up
            because each row measured its own width. */}
        <Pressable
          onPress={() => setDetail(sub)}
          onLongPress={() => onDismissSub(sub)}
          style={({ pressed }) => [
            styles.row,
            i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
            pressed && { backgroundColor: theme.backgroundSelected },
          ]}>
          <MerchantAvatar title={sub.title} category={sub.category} size={36} />
          <View style={styles.rowInfo}>
            <View style={styles.rowTitleLine}>
              <ThemedText type="default" numberOfLines={1} style={styles.rowTitle}>
                {sub.title}
              </ThemedText>
              {sub.priceIncreased && (
                <View style={[styles.badge, { backgroundColor: `${theme.warning}22` }]}>
                  <ThemedText type="micro" style={{ color: theme.warning }}>
                    {t('priceUp')}
                  </ThemedText>
                </View>
              )}
            </View>
            {/* The schedule owns the body width and wraps rather than
                truncating, so the next-charge date survives a long merchant
                name. The cadence is named here ONCE — it used to be repeated
                verbatim in a footer under this same line, so every monthly row
                said "Monthly" twice. */}
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {sub.status === 'stopped'
                ? tf('stoppedLast', { date: shortDate(sub.lastChargedISO) })
                : sub.paymentHistory
                  ? tf(
                      paymentObservedThisMonth
                        ? 'recurringPaidObserved'
                        : 'recurringLastPaidObserved',
                      {
                        date: shortDate(sub.lastChargedISO),
                        cadence: cadenceLabel(sub.cadence),
                      },
                    )
                : sub.cadence === 'as-needed'
                  ? tf('asNeededScheduleList', { date: shortDate(sub.lastChargedISO) })
                : next >= 0
                  ? tf('cadenceScheduleList', {
                      cadence: cadenceLabel(sub.cadence),
                      date: shortDate(sub.nextExpectedISO),
                      when: scheduleWhen(next),
                    })
                  : tf('cadenceExpectedAgo', {
                      cadence: cadenceLabel(sub.cadence),
                      days: -next,
                    })}
            </ThemedText>
          </View>
          {/* The amount column. It lived inside the title line, after the
              title and the PRICE UP chip, with nothing pushing it over — so it
              printed mid-sentence ("Apple Store US AED 184") and orphaned its
              /MO onto the next line, on every row. Out here it is a column the
              eye can run down. */}
          <View style={styles.rowRight}>
            <View style={styles.recurringAmount}>
              <ThemedText type="smallBold" tabular numberOfLines={1}>
                {formatAED(sub.monthlyEquivalentFils, { decimals: false })}
              </ThemedText>
              <ThemedText type="nano" themeColor="textTertiary">
                {t('perMonthShort')}
              </ThemedText>
            </View>
            {/* The monthly equivalent above adds to the section total. For
                non-monthly charges this smaller figure preserves the actual
                debit that the conversion was derived from. */}
            {sub.cadence !== 'monthly' && sub.cadence !== 'as-needed' && sub.status !== 'stopped' ? (
              <ThemedText type="nano" themeColor="textTertiary" tabular numberOfLines={1}>
                {`${formatAED(sub.avgAmountFils, { decimals: false })}${
                  sub.cadence === 'yearly' ? t('perYearShort') : t('perWeekShort')
                }`}
              </ThemedText>
            ) : tracked ? (
              <ThemedText type="nano" themeColor="textTertiary" numberOfLines={1}>
                {t('tracked')}
              </ThemedText>
            ) : null}
            {!tracked && sub.status !== 'stopped' && remindable(sub) && next >= 0 && next <= 7 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tf('remindAboutA11y', { title: sub.title })}
                hitSlop={8}
                onPress={() => addBill(billFromSubscription(sub))}
                style={({ pressed }) => [
                  styles.remindBtn,
                  {
                    backgroundColor: pressed ? `${theme.primary}2e` : `${theme.primary}17`,
                    borderColor: `${theme.primary}44`,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  },
                ]}>
                <ThemedText type="nano" style={{ color: theme.primary }}>
                  {t('remindMe')}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View>
            <ThemedText type="title">{t('billsTitle')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('billsSubtitle')}
            </ThemedText>
          </View>
          <Pressable
            onPress={() => setAdderVisible(true)}
            style={[styles.backBtn, { backgroundColor: theme.primary }]}>
            <Icon name="plus" size={18} color={theme.onPrimary} strokeWidth={2.4} />
          </Pressable>
        </View>

        <View style={[styles.segment, { backgroundColor: theme.backgroundSelected }]}>
          {(['subscriptions', 'cards', 'utilities'] as Segment[]).map((s) => {
            const label =
              s === 'subscriptions'
                ? `${t('subscriptionsSeg')} ${subs.length}`
                : s === 'cards'
                  ? `${t('cardsSeg')} ${dues.length}`
                  : `${t('utilitiesSeg')} ${
                      loans.length + commitments.length + otherRepeats.length + rows.length
                    }`;
            return (
              <Pressable
                key={s}
                onPress={() => setSegment(s)}
                style={[
                  styles.segmentItem,
                  segment === s && {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.cardBorder,
                    borderWidth: StyleSheet.hairlineWidth,
                  },
                ]}>
                <ThemedText
                  type="nano"
                  numberOfLines={1}
                  tabular
                  themeColor={segment === s ? 'text' : 'textTertiary'}>
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }
          showsVerticalScrollIndicator={false}>
          {/* Credit-card statement dues live in their own tab. */}
          {segment === 'cards' && (
            <>
              {focalDue && (() => {
                const { item, account, urgent, recentSpend, paidFils, paidShare } = focalDue;
                return (
                  <View
                    style={[
                      styles.dueFocal,
                      { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder },
                    ]}>
                    {/* One target, not a decorated header sitting above one.
                        The card name, the due date and the chevron used to be
                        a plain View — the chevron promised a tap and only the
                        amount below it answered. */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={account?.name ?? t('card')}
                      onPress={() => setCardDetail(account)}
                      style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>
                      <View style={styles.dueFocalTop}>
                        <View style={[styles.cardSummaryBadge, { backgroundColor: theme.primarySoft }]}>
                          <Icon name="wallet" size={18} color={theme.primary} />
                        </View>
                        <View style={styles.dueFocalTitle}>
                          <ThemedText type="smallBold" numberOfLines={1}>
                            {account?.name ?? t('card')}
                          </ThemedText>
                          <ThemedText
                            type="meta"
                            style={{ color: urgent ? theme.expense : theme.textSecondary }}>
                            {item.status === 'overdue'
                              ? tf('overdueDays', { days: -item.daysLeft })
                              : tf('payByWithDays', {
                                  date: shortDate(item.due.dueDate),
                                  days: item.daysLeft,
                                })}
                          </ThemedText>
                        </View>
                        <Icon name="chevron-right" size={16} color={theme.textTertiary} />
                      </View>

                      <View style={styles.dueFocalOutstanding}>
                        <ThemedText type="meta" themeColor="textSecondary">
                          {t('outstandingTitle')}
                        </ThemedText>
                        <View style={styles.cardSummaryMoney}>
                          <ThemedText type="micro" themeColor="textTertiary">{ledgerCurrencyDisplay()}</ThemedText>
                          <ThemedText
                            type="sheetAmount"
                            tabular
                            style={urgent ? { color: theme.expense } : undefined}>
                            {formatAmount(item.remainingFils, { decimals: false })}
                          </ThemedText>
                        </View>
                      </View>
                    </Pressable>

                    <View style={[styles.dueProgress, { backgroundColor: theme.track }]}>
                      <View
                        style={[
                          styles.dueProgressFill,
                          {
                            width: `${paidShare <= 0 ? 0 : Math.max(2, paidShare * 100)}%`,
                            backgroundColor: theme.primary,
                          },
                        ]}
                      />
                    </View>
                    <ThemedText type="meta" themeColor="textTertiary" tabular>
                      {tf('paidOfTotal', {
                        paid: formatAED(paidFils, { decimals: false }),
                        total: formatAED(item.due.totalDueFils, { decimals: false }),
                      })}
                    </ThemedText>

                    <View style={[styles.dueFacts, { borderColor: theme.cardBorder }]}>
                      <View style={styles.dueFact}>
                        <ThemedText type="micro" themeColor="textTertiary">
                          {t('minimumDueLabel')}
                        </ThemedText>
                        <ThemedText type="smallBold" tabular>
                          {item.minimumKnown
                            ? formatAED(item.due.minDueFils, { decimals: false })
                            : '—'}
                        </ThemedText>
                      </View>
                      <View style={[styles.dueFact, styles.dueFactDivided, { borderColor: theme.cardBorder }]}>
                        <ThemedText type="micro" themeColor="textTertiary">
                          {t('thisMonth')}
                        </ThemedText>
                        <ThemedText type="smallBold" tabular>
                          {formatAED(recentSpend, { decimals: false })}
                        </ThemedText>
                      </View>
                    </View>

                    <View style={styles.dueFocalActions}>
                      <Pressable
                        onPress={() =>
                          onPayDue(
                            item.due.id,
                            item.remainingFils,
                            item.due.accountId,
                            account?.name ?? t('card'),
                          )
                        }
                        style={[styles.duePayButton, { backgroundColor: theme.primary }]}>
                        <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                          {t('markPaid')}
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() => setCardDetail(account)}
                        style={[styles.dueDetailsButton, { borderColor: theme.cardBorderStrong }]}>
                        <ThemedText type="smallBold">{t('seeAll')}</ThemedText>
                      </Pressable>
                    </View>
                  </View>
                );
              })()}
              {dues.length > 1 && (
                <View style={[styles.cardSummary, { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder }]}>
                  <View>
                    <ThemedText type="meta" themeColor="textSecondary">{t('dueAcrossCards')}</ThemedText>
                    <View style={styles.cardSummaryMoney}>
                      <ThemedText type="micro" themeColor="textTertiary">{ledgerCurrencyDisplay()}</ThemedText>
                      <ThemedText type="heading" tabular>
                        {formatAmount(totalAsShown(dues.map((item) => item.remainingFils)), { decimals: false })}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={[styles.cardSummaryBadge, { backgroundColor: theme.primarySoft }]}>
                    <Icon name="bank" size={18} color={theme.primary} />
                  </View>
                </View>
              )}
              {dues.length > 1 && dues.map(({ due, status, daysLeft, remainingFils, belowMinimum }, i) => {
                const account = state.accounts.find((a) => a.id === due.accountId);
                const urgent = status === 'urgent' || status === 'overdue';
                return (
                  // The whole row opens the card's statements and payment
                  // history; only "Mark paid" is a separate target. A due with
                  // no way to see what it is made of is just a number.
                  <Pressable
                    key={due.id}
                    onPress={() => setCardDetail(account ?? null)}
                    style={[
                      styles.dueRow,
                      i > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: theme.cardBorder,
                      },
                    ]}>
                    <View style={{ flex: 1, gap: 1 }}>
                      <ThemedText type="default">{account?.name ?? t('card')}</ThemedText>
                      <ThemedText
                        type="small"
                        style={{ color: urgent ? theme.expense : theme.textSecondary }}>
                        {status === 'overdue'
                          ? tf('overdueDays', { days: -daysLeft })
                          : tf('payByWithDays', { date: shortDate(due.dueDate), days: daysLeft })}
                        {belowMinimum
                          ? ` · ${tf('minimumAmountShort', { amount: formatAED(due.minDueFils, { decimals: false }) })}`
                          : ''}
                      </ThemedText>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <ThemedText
                        type="smallBold"
                        tabular
                        style={urgent ? { color: theme.expense } : undefined}>
                        {formatAED(remainingFils, { decimals: false })}
                      </ThemedText>
                      <Pressable
                        hitSlop={8}
                        onPress={() =>
                          onPayDue(due.id, remainingFils, due.accountId, account?.name ?? t('card'))
                        }>
                        <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>
                          {t('markPaid')}
                        </ThemedText>
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })}
              {dues.length === 0 && (
                <View style={styles.empty}>
                  <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
                    <Icon name="wallet" size={26} color={theme.textSecondary} strokeWidth={1.7} />
                  </View>
                  <ThemedText type="smallBold">{t('noCardDues')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                    {t('noCardDuesText')}
                  </ThemedText>
                </View>
              )}
              {paidCards.length > 0 && (
                <View style={styles.paidCardsBlock}>
                  <ThemedText type="micro" themeColor="textSecondary">
                    {t('paidCardsRecently')}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('paidCardsRecentlyHint')}
                  </ThemedText>
                  {paidCards.map(({ due }, i) => {
                    const account = state.accounts.find((row) => row.id === due.accountId);
                    return (
                      <Pressable
                        key={due.id}
                        accessibilityRole="button"
                        onPress={() => setCardDetail(account ?? null)}
                        style={[
                          styles.dueRow,
                          i > 0 && {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: theme.cardBorder,
                          },
                        ]}>
                        <View style={{ flex: 1, gap: 1 }}>
                          <ThemedText type="default">{account?.name ?? t('card')}</ThemedText>
                          <ThemedText type="small" style={{ color: theme.income }}>
                            {tf('paidStatementDue', { date: shortDate(due.dueDate) })}
                          </ThemedText>
                        </View>
                        <View style={styles.paidCardAmount}>
                          <ThemedText type="smallBold" tabular>
                            {formatAED(due.totalDueFils, { decimals: false })}
                          </ThemedText>
                          <Icon name="check" size={16} color={theme.income} strokeWidth={2.6} />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          )}

          {segment === 'subscriptions' && (
            <>
              {subs.length > 0 && (
                <View style={styles.totalRow}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.totalCaption}>
                    {t('detectedHint')}
                  </ThemedText>
                  <ThemedText type="smallBold" tabular>
                    {tf('monthlyTotal', {
                      amount: formatAED(subsTotal, { decimals: false }),
                    })}
                  </ThemedText>
                </View>
              )}
              <View>{subs.map((sub, i) => renderRecurringRow(sub, i))}</View>

              <View style={[styles.trackingRail, { borderColor: theme.cardBorder }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('cardPaymentsDue')}
                  onPress={() => setSegment('cards')}
                  style={styles.trackingLink}>
                  <View style={[styles.trackingIcon, { backgroundColor: theme.primarySoft }]}>
                    <Icon name="wallet" size={15} color={theme.primary} />
                  </View>
                  <View style={styles.trackingCopy}>
                    <ThemedText type="smallBold">{t('cardPaymentsDue')}</ThemedText>
                    <ThemedText type="meta" themeColor="textSecondary">
                      {tf('itemsTracked', { count: dues.length })}
                    </ThemedText>
                  </View>
                  <Icon name="chevron-right" size={15} color={theme.textTertiary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('fixedPayments')}
                  onPress={() => setSegment('utilities')}
                  style={[styles.trackingLink, { borderTopColor: theme.cardBorder, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <View style={[styles.trackingIcon, { backgroundColor: theme.backgroundSelected }]}>
                    <Icon name="receipt" size={15} color={theme.textSecondary} />
                  </View>
                  <View style={styles.trackingCopy}>
                    <ThemedText type="smallBold">{t('fixedPayments')}</ThemedText>
                    <ThemedText type="meta" themeColor="textSecondary">
                      {tf('itemsTracked', { count: loans.length + commitments.length + otherRepeats.length + rows.length })}
                    </ThemedText>
                  </View>
                  <Icon name="chevron-right" size={15} color={theme.textTertiary} />
                </Pressable>
              </View>

              {stopped.length > 0 && (
                <View style={styles.commitBlock}>
                  <Pressable
                    onPress={() => setShowStopped((v) => !v)}
                    style={styles.collapseHeader}>
                    <ThemedText type="micro" themeColor="textSecondary">
                      {t('stoppedSubs')} ({stopped.length})
                    </ThemedText>
                    <Icon
                      name={showStopped ? 'chevron-down' : 'chevron-right'}
                      size={14}
                      color={theme.textSecondary}
                    />
                  </Pressable>
                  {showStopped && (
                    <>
                      <ThemedText type="small" themeColor="textSecondary">
                        {t('stoppedSubsHint')}
                      </ThemedText>
                      <View>{stopped.map((sub, i) => renderRecurringRow(sub, i))}</View>
                    </>
                  )}
                </View>
              )}

              {subs.length === 0 && (
                <View style={styles.empty}>
                  <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
                    <Icon name="repeat" size={26} color={theme.textSecondary} strokeWidth={1.7} />
                  </View>
                  <ThemedText type="smallBold">{t('noSubscriptionsTitle')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                    {t('noSubscriptionsBody')}
                  </ThemedText>
                </View>
              )}
            </>
          )}

          {segment === 'utilities' && (
            <>
              {loans.length > 0 && (
                <View style={styles.utilitiesBlock}>
                  <ThemedText type="micro" themeColor="textSecondary">
                    {t('loansHeader')}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('loansHint')}
                  </ThemedText>
                  <View>{loans.map((sub, i) => renderRecurringRow(sub, i))}</View>
                </View>
              )}

              {commitments.length > 0 && (
                <View style={styles.utilitiesBlock}>
                  <ThemedText type="micro" themeColor="textSecondary">
                    {t('utilitiesHeader')}
                  </ThemedText>
                  <View>{commitments.map((sub, i) => renderRecurringRow(sub, i))}</View>
                </View>
              )}

              {otherRepeats.length > 0 && (
                <View style={commitments.length > 0 ? styles.commitBlock : styles.utilitiesBlock}>
                  <ThemedText type="micro" themeColor="textSecondary">
                    {t('otherRecurringHeader')}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('otherRecurringHint')}
                  </ThemedText>
                  <View>{otherRepeats.map((sub, i) => renderRecurringRow(sub, i))}</View>
                </View>
              )}

              {rows.length > 0 && (
                <View
                  style={
                    commitments.length > 0 || otherRepeats.length > 0
                      ? styles.commitBlock
                      : undefined
                  }>
                  <ThemedText type="micro" themeColor="textSecondary">
                    {t('remindersSeg')}
                  </ThemedText>
                </View>
              )}
              <View>
                {rows.map(({ bill, status, daysLeft, dueISO }, i) => {
                  const meta = statusMeta(status, daysLeft);
                  return (
                    <Pressable
                      key={bill.id}
                      onLongPress={() => onLongPressBill(bill.id, bill.title)}
                      style={[
                        styles.row,
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
                      ]}>
                      <MerchantAvatar title={bill.title} category={bill.category} size={42} />
                      <View style={styles.rowInfo}>
                        <ThemedText type="default" numberOfLines={1}>
                          {bill.title}
                        </ThemedText>
                        {/* "Day 12" is the right phrasing for something that
                            happens every month and the wrong one for a yearly
                            renewal, which needs to name its month or it reads
                            as another monthly charge. */}
                        <ThemedText type="small" style={{ color: meta.color }}>
                          {meta.label} ·{' '}
                          {bill.yearlyOnISO ? shortDate(dueISO) : `${t('day')} ${bill.dueDay}`}
                        </ThemedText>
                      </View>
                      <View style={styles.rowRight}>
                        <ThemedText type="smallBold" tabular>
                          {formatAED(bill.amountFils, { decimals: false })}
                        </ThemedText>
                        {status !== 'paid' ? (
                          <Pressable onPress={() => onPay(bill.id)}>
                            <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>
                              {t('markPaid')}
                            </ThemedText>
                          </Pressable>
                        ) : (
                          <Icon name="check" size={16} color={theme.income} strokeWidth={2.6} />
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {rows.length > 0 && (
                <ThemedText type="micro" themeColor="textSecondary" style={styles.hint}>
                  {t('longPressDeleteReminder')}
                </ThemedText>
              )}
              {rows.length === 0 &&
                commitments.length === 0 &&
                loans.length === 0 &&
                otherRepeats.length === 0 && (
                <View style={styles.empty}>
                  <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
                    <Icon name="calendar" size={26} color={theme.textSecondary} strokeWidth={1.7} />
                  </View>
                  <ThemedText type="smallBold">{t('noUtilitiesTitle')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                    {t('noUtilitiesBody')}
                  </ThemedText>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Subscription detail sheet */}
      <Modal
        visible={detail !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDetail(null)}>
        <Pressable style={styles.backdrop} onPress={() => setDetail(null)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
            onPress={() => {}}>
            <View style={[styles.grabber, { backgroundColor: theme.cardBorder }]} />
            {detail && detailData && (
              <>
                <View style={styles.sheetHeader}>
                  <View style={styles.detailTitleRow}>
                    <MerchantAvatar title={detail.title} category={detail.category} size={42} />
                    <View style={{ flexShrink: 1 }}>
                      <ThemedText type="heading" numberOfLines={1}>
                        {detail.title}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {detail.status === 'stopped'
                          ? tf('stoppedLastCharged', { date: shortDate(detail.lastChargedISO) })
                          : tf('detailCadenceMonthly', {
                              cadence: cadenceLabel(detail.cadence),
                              amount: formatAED(detail.monthlyEquivalentFils, { decimals: false }),
                            })}
                      </ThemedText>
                    </View>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('close')}
                    hitSlop={8}
                    onPress={() => setDetail(null)}>
                    <Icon name="close" size={20} color={theme.textSecondary} />
                  </Pressable>
                </View>

                {/* Lifetime facts */}
                <View style={styles.factRow}>
                  <View style={styles.fact}>
                    <ThemedText type="micro" themeColor="textSecondary" style={styles.factLabel}>
                      {detail.category === 'loan'
                        ? t('payingFor')
                        : detail.group === 'subscription'
                          ? t('subscribedFor')
                          : t('trackingSince')}
                    </ThemedText>
                    <ThemedText type="smallBold">{subscribedFor(detailData.firstISO)}</ThemedText>
                    <ThemedText type="micro" themeColor="textSecondary">
                      {tf('walletSince', { date: shortDate(detailData.firstISO) })}
                    </ThemedText>
                  </View>
                  <View style={styles.fact}>
                    <ThemedText type="micro" themeColor="textSecondary" style={styles.factLabel}>
                      {detail.group === 'subscription' ? t('charges') : t('payments')}
                    </ThemedText>
                    <ThemedText type="smallBold" tabular>
                      {detailData.txs.length}
                    </ThemedText>
                  </View>
                  <View style={styles.fact}>
                    <ThemedText type="micro" themeColor="textSecondary" style={styles.factLabel}>
                      {t('totalPaid')}
                    </ThemedText>
                    <ThemedText type="smallBold" tabular>
                      {formatAED(detailData.totalFils, { decimals: false })}
                    </ThemedText>
                  </View>
                </View>

                {/* Which card pays it */}
                <View style={styles.paidWith}>
                  <ThemedText type="micro" themeColor="textSecondary">
                    {t('paidWith')}
                  </ThemedText>
                  <ThemedText type="small" numberOfLines={2}>
                    {[
                      detailData.accounts.map((account) => account.name).join(', '),
                      detailData.unknownInstrumentCount > 0
                        ? tf('paymentInstrumentMissingCount', {
                            count: detailData.unknownInstrumentCount,
                            s: detailData.unknownInstrumentCount === 1 ? '' : 's',
                          })
                        : '',
                    ].filter(Boolean).join(' · ')}
                  </ThemedText>
                </View>

                {/* Charge history */}
                <View style={styles.historyBlock}>
                  <ThemedText type="micro" themeColor="textSecondary">
                    {detail.group === 'subscription' ? t('history') : t('paymentHistory')}
                  </ThemedText>
                  <ScrollView style={styles.historyScroll} showsVerticalScrollIndicator={false}>
                    {detailData.txs.slice(0, 36).map((transaction, i) => {
                      const acc = recurringPaymentAccount(transaction, state.accounts);
                      const offMedian =
                        detailData.medianFils > 0 &&
                        transaction.amountFils > detailData.medianFils * 1.1;
                      return (
                        <View
                          key={transaction.id}
                          style={[
                            styles.historyRow,
                            i > 0 && {
                              borderTopWidth: StyleSheet.hairlineWidth,
                              borderTopColor: theme.cardBorder,
                            },
                          ]}>
                          <View style={styles.historyIdentity}>
                            <ThemedText type="small">{fullDateTime(transaction)}</ThemedText>
                            <ThemedText type="micro" themeColor="textSecondary" numberOfLines={2}>
                              {acc?.name ?? t('paymentInstrumentNotStated')}
                            </ThemedText>
                          </View>
                          <ThemedText
                            type="smallBold"
                            tabular
                            style={offMedian ? { color: theme.warning } : undefined}>
                            {formatAED(transaction.amountFils, { decimals: false })}
                          </ThemedText>
                        </View>
                      );
                    })}
                    {detailData.txs.length > 36 && (
                      <ThemedText type="micro" themeColor="textSecondary" style={styles.historyMore}>
                        {tf('olderCharges', { count: detailData.txs.length - 36 })}
                      </ThemedText>
                    )}
                  </ScrollView>
                </View>

                {/* Actions */}
                <View style={styles.detailActions}>
                  {!trackedTitles.has(detail.title.toLowerCase()) &&
                    detail.status !== 'stopped' &&
                    remindable(detail) && (
                    <Pressable
                      onPress={() => {
                        addBill(billFromSubscription(detail));
                        setDetail(null);
                      }}
                      style={[styles.detailBtn, { backgroundColor: theme.primary }]}>
                      <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                        {t('remindMe')}
                      </ThemedText>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => {
                      const sub = detail;
                      setDetail(null);
                      onDismissSub(sub);
                    }}
                    style={[styles.detailBtn, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText type="smallBold" style={{ color: theme.expense }}>
                      {t('notASubscription')}
                    </ThemedText>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Add reminder sheet */}
      <Modal visible={adderVisible} transparent animationType="fade" onRequestClose={() => setAdderVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAdderVisible(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
            onPress={() => {}}>
            <View style={[styles.grabber, { backgroundColor: theme.cardBorder }]} />
            <View style={styles.sheetHeader}>
              <ThemedText type="heading">{t('newReminder')}</ThemedText>
              <Pressable onPress={() => setAdderVisible(false)}>
                <Icon name="close" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>

            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={t('reminderNamePlaceholder')}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { backgroundColor: theme.backgroundSelected, color: theme.text }]}
            />

            <View style={styles.inputRow}>
              <View style={[styles.amountBox, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold" themeColor="textSecondary">{ledgerCurrencyDisplay()}</ThemedText>
                <TextInput
                  value={amountText}
                  onChangeText={setAmountText}
                  keyboardType="numeric"
                  placeholder={t('amount')}
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.amountInput, { color: theme.text }]}
                />
              </View>
              <View style={[styles.amountBox, styles.dayBox, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold" themeColor="textSecondary">{t('day')}</ThemedText>
                <TextInput
                  value={dueDayText}
                  onChangeText={setDueDayText}
                  keyboardType="numeric"
                  placeholder="1-31"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.amountInput, { color: theme.text }]}
                />
              </View>
            </View>

            <CategoryChips
              categories={EXPENSE_CATEGORIES}
              selected={category}
              onToggle={setCategory}
            />

            <Pressable
              onPress={saveBill}
              disabled={!draftValid}
              style={[
                styles.saveBtn,
                { backgroundColor: theme.primary, opacity: draftValid ? 1 : 0.45 },
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{t('saveReminder')}</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <CardDetailSheet account={cardDetail} onClose={() => setCardDetail(null)} />
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  /** Matches the "Mark paid" chip on Wallet dues: a real target, not bare text. */
  remindBtn: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 1,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-end',
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding,
    paddingVertical: Spacing.two,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: Radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: {
    flexDirection: 'row',
    marginHorizontal: ScreenPadding,
    borderRadius: 11,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 8,
  },
  content: {
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.three,
  },
  duesBlock: {
    gap: Spacing.one,
    paddingBottom: Spacing.three,
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  paidCardsBlock: {
    marginTop: Spacing.four,
    gap: Spacing.one,
  },
  paidCardAmount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  cardSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  cardSummaryMoney: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 2 },
  cardSummaryBadge: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dueFocal: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.two + 2,
  },
  dueFocalTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  dueFocalTitle: { flex: 1, minWidth: 0, gap: 1 },
  // The header row and the outstanding figure are now one Pressable, so the
  // parent's `gap` no longer separates them — it separates the Pressable from
  // the progress bar below. This restores the space it used to add.
  dueFocalOutstanding: { marginTop: Spacing.two + 2 },
  dueProgress: { height: 7, borderRadius: 4, overflow: 'hidden' },
  dueProgressFill: { height: '100%', borderRadius: 4 },
  dueFacts: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dueFact: { flex: 1, gap: 3, paddingVertical: Spacing.three },
  dueFactDivided: { borderStartWidth: StyleSheet.hairlineWidth, paddingStart: Spacing.three },
  dueFocalActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  duePayButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dueDetailsButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  totalCaption: {
    flex: 1,
  },
  trackingRail: {
    marginTop: Spacing.four,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    overflow: 'hidden',
  },
  trackingLink: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  trackingIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackingCopy: { flex: 1, minWidth: 0, gap: 1 },
  utilitiesBlock: {
    gap: Spacing.one,
  },
  commitBlock: {
    marginTop: Spacing.four,
    gap: Spacing.one,
  },
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingVertical: Spacing.two + 4,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowTitle: {
    flexShrink: 1,
  },
  rowRight: {
    alignItems: 'flex-end',
    gap: 2,
    marginStart: Spacing.two,
    // Never let the Remind me pill claim more than a third of the row.
    maxWidth: '38%',
  },
  // The monthly-equivalent figure and its /MO unit, stacked and right-aligned
  // at the head of the right-hand column.
  recurringAmount: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Radius.full,
  },
  hint: {
    paddingBottom: Spacing.one,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 280,
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
  inputRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  amountBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
  },
  dayBox: {
    flex: 0.6,
  },
  amountInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: Spacing.three,
  },
  catPicker: {
    gap: Spacing.two,
  },
  catChip: {
    paddingHorizontal: Spacing.two + 4,
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    borderWidth: 1.5,
  },
  saveBtn: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  detailTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    flexShrink: 1,
    paddingEnd: Spacing.two,
  },
  factRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    // Top-aligned, so a two-line caption ("Subscribed for") does not push its
    // own value a line below the other two and break the shared baseline.
    alignItems: 'flex-start',
  },
  fact: {
    flex: 1,
    gap: 2,
  },
  // The caption sits above the figure and must reserve the taller of the
  // three, or the column that wraps drops out of line with its neighbours.
  factLabel: {
    minHeight: 28,
  },
  paidWith: {
    gap: 2,
  },
  historyBlock: {
    gap: Spacing.one,
  },
  historyScroll: {
    maxHeight: 260,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  historyIdentity: {
    flex: 1,
    paddingEnd: Spacing.two,
  },
  historyMore: {
    paddingVertical: Spacing.two,
  },
  detailActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  detailBtn: {
    flex: 1,
    borderRadius: Radius.md,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
