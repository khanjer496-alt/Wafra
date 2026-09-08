import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { CardDetailSheet } from '@/components/card-detail-sheet';
import { PaymentAgenda } from '@/components/bills/payment-agenda';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { PaymentAgendaItem } from '@/lib/reference-presentation';
import { ThemedText } from '@/components/themed-text';
import { CategoryChips } from '@/components/ui/category-chips';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { usePullToRefresh } from '@/hooks/use-auto-import';
import { useScreenEntering } from '@/hooks/use-screen-entering';
import { useTheme } from '@/hooks/use-theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { billsForMonth, type BillStatus } from '@/lib/bills';
import { openDues, recentlySettledDues } from '@/lib/cards';
import { EXPENSE_CATEGORIES } from '@/lib/categories';
import {
  formatAED,
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

/** The next-charge view uses the last actual debit, never its monthly equivalent. */
export function recurringChargePresentation(sub: Subscription): { amountFils: number; estimated: boolean } {
  return {
    amountFils: sub.lastAmountFils,
    estimated: sub.status !== 'stopped' && !sub.paymentHistory && sub.cadence !== 'as-needed',
  };
}

export default function BillsScreen() {
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  const enter = useScreenEntering();
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

  const [agendaView, setAgendaView] = useState<'upcoming' | 'all'>('upcoming');
  const words = { upcoming: t('refUpcoming'), all: t('refAll'), unscheduled: t('refUnscheduled'), stopped: t('refStopped'), fewer: t('refHideStopped'), more: t('refShowStopped') };
  const [detail, setDetail] = useState<Subscription | null>(null);
  // A due is a question about one card, not a reason to leave the Bills tab.
  const [cardDetail, setCardDetail] = useState<Account | null>(null);
  const [selectedDueId, setSelectedDueId] = useState<string | null>(null);
  const [selectedReminderId, setSelectedReminderId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const [adderVisible, setAdderVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [amountText, setAmountText] = useState('');
  const [dueDayText, setDueDayText] = useState('');
  const [category, setCategory] = useState<CategoryId>('utilities');

  const billsHeader: ScreenHeaderProps = {
    title: t('billsTitle'),
    actions: [{
      label: t('newReminder'),
      icon: 'plus',
      onPress: () => setAdderVisible(true),
    }],
  };

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

  // Card projections read accounts, transactions and statements, not the
  // frequently changing import-progress or review-status fields.
  const dues = useMemo(() => openDues(state, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.accounts, state.transactions, state.cardDues, now]);
  const selectedDue = useMemo(
    () => dues.find(({ due }) => due.id === selectedDueId) ?? null,
    [dues, selectedDueId],
  );
  const paidCards = useMemo(() => recentlySettledDues(state, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.accounts, state.transactions, state.cardDues, now]);
  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = useMemo(
    () => internalTransferIds(state.transactions, state.accounts),
    [state.transactions, state.accounts],
  );
  // The same live/internal pair every other screen that adds money up passes.
  // Without it a charge on an archived card reconciles a bill to "Paid" while
  // Flow's Total out never moves.
  const rows = useMemo(
    () => billsForMonth(state.bills, state.transactions, now, liveAccounts, internal),
    [state.bills, state.transactions, now, liveAccounts, internal],
  );
  const selectedReminder = useMemo(
    () => rows.find(({ bill }) => bill.id === selectedReminderId) ?? null,
    [rows, selectedReminderId],
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
  const trackedTitles = useMemo(
    () => new Set(state.bills.map((b) => b.title.toLowerCase())),
    [state.bills],
  );

  const agendaItems = useMemo<PaymentAgendaItem[]>(() => {
    const accountNames = new Map(state.accounts.map((a) => [a.id, a.name]));
    const items: PaymentAgendaItem[] = dues.map(({ due, daysLeft, remainingFils }) => ({
      id: `card-${due.id}`, title: accountNames.get(due.accountId) ?? t('card'), category: 'other',
      kind: 'card', dateISO: due.dueDate, daysLeft, amountFils: remainingFils, estimated: false, paid: false,
    }));
    for (const { due, daysLeft } of paidCards) items.push({
      id: `card-${due.id}`, title: accountNames.get(due.accountId) ?? t('card'), category: 'other',
      kind: 'card', dateISO: due.dueDate, daysLeft, amountFils: due.totalDueFils, estimated: false, paid: true,
    });
    for (const { bill, status, dueISO, daysLeft } of rows) items.push({
      id: `bill-${bill.id}`, title: bill.title, category: bill.category, kind: 'bill', dateISO: dueISO,
      group: subs.some((sub) => sub.title.trim().toLowerCase() === bill.title.trim().toLowerCase())
        ? 'subscriptions' : undefined,
      daysLeft, amountFils: bill.amountFils, estimated: false, paid: status === 'paid',
      accountName: bill.accountId ? accountNames.get(bill.accountId) : undefined,
    });
    const manualTitles = new Set(state.bills.map((bill) => bill.title.trim().toLowerCase()));
    for (const sub of [...subs, ...loans, ...commitments]) {
      if (sub.cadence === 'as-needed' || manualTitles.has(sub.title.trim().toLowerCase())) continue;
      // An observed past charge is not proof the next one is payable or late.
      const charge = recurringChargePresentation(sub);
      items.push({ id: `sub-${sub.title.trim().toLowerCase()}`, title: sub.title, category: sub.category,
        kind: 'recurring', dateISO: sub.nextExpectedISO, daysLeft: daysUntilNext(sub, now),
        group: sub.group === 'subscription' ? 'subscriptions' : undefined,
        amountFils: charge.amountFils, estimated: true, paid: false });
    }
    return items;
  }, [dues, paidCards, rows, subs, loans, commitments, state.accounts, state.bills, now]);

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
    // Keep the paid statement's result visible after the last open due settles.
    setAgendaView('all');
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

  const openCardDetail = (account: Account | null, dueId?: string) => {
    setSelectedDueId(account ? dueId ?? null : null);
    setCardDetail(account);
  };

  const closeCardDetail = () => {
    setCardDetail(null);
    setSelectedDueId(null);
  };

  const renderRecurringRow = (sub: Subscription, i: number) => {
    const charge = recurringChargePresentation(sub);
    const chargeLabel = t(charge.estimated ? 'recurringEstimatedCharge' : 'recurringLastCharge');
    const next = daysUntilNext(sub, now);
    const tracked = trackedTitles.has(sub.title.toLowerCase());
    const paymentObservedThisMonth = monthKey(sub.lastChargedISO) === monthKey(now);
    const schedule =
      sub.status === 'stopped'
        ? tf('stoppedLast', { date: shortDate(sub.lastChargedISO) })
        : sub.paymentHistory
          ? tf(
              paymentObservedThisMonth ? 'recurringPaidObserved' : 'recurringLastPaidObserved',
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
                });
    return (
      <Animated.View
        key={sub.title}
        entering={enter(FadeInDown.delay(Math.min(i, 8) * 40).duration(300))}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${sub.title}. ${schedule}. ${chargeLabel}: ${formatAED(charge.amountFils, { decimals: false })}`}
          onPress={() => setDetail(sub)}
          onLongPress={() => onDismissSub(sub)}
          style={({ pressed }) => [
            styles.row,
            largeText && styles.rowLarge,
            i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
            pressed && { backgroundColor: theme.backgroundSelected },
          ]}>
          <View style={[styles.recurringIdentity, largeText && styles.rowIdentityLarge]}>
            <MerchantAvatar title={sub.title} category={sub.category} size={32} />
            <View style={styles.rowInfo}>
              <View style={styles.rowTitleLine}>
                <ThemedText type="smallBold" numberOfLines={largeText ? undefined : 1} style={styles.rowTitle}>
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
              <ThemedText type="meta" themeColor="textSecondary" numberOfLines={largeText ? undefined : 2}>
                {schedule}
              </ThemedText>
            </View>
          </View>
          <View style={[styles.rowRight, largeText && styles.rowFigureLarge]}>
            <View style={styles.recurringAmount}>
              <ThemedText type="smallBold" tabular>
                {formatAED(charge.amountFils, { decimals: false })}
              </ThemedText>
              <ThemedText type="nano" themeColor="textTertiary">
                {chargeLabel}
              </ThemedText>
            </View>
            {tracked ? (
              <ThemedText type="nano" themeColor="textTertiary" numberOfLines={1}>
                {t('tracked')}
              </ThemedText>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <>
      <ScreenScaffold
        tabbed
        headerMode="inline"
        header={billsHeader}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
        }
        contentStyle={largeText && styles.headerLarge}
        scrollProps={{ showsVerticalScrollIndicator: false }}>
        <SegmentedControl label={t('billsTitle')} value={agendaView} onChange={setAgendaView}
          segments={[{ value: 'upcoming', label: words.upcoming }, { value: 'all', label: words.all }]} />
        <PaymentAgenda items={agendaItems} includePaid={agendaView === 'all'} onOpen={(item) => {
          if (item.kind === 'card') {
            const id = item.id.slice(5);
            const due = state.cardDues.find((due) => due.id === id);
            if (due) openCardDetail(state.accounts.find((a) => a.id === due.accountId) ?? null, item.paid ? undefined : id);
          } else if (item.kind === 'bill') setSelectedReminderId(item.id.slice(5));
          else {
            const sub = detected.find((sub) => `sub-${sub.title.trim().toLowerCase()}` === item.id);
            if (sub) setDetail(sub);
          }
        }} />
        {agendaView === 'all' && otherRepeats.length > 0 && <View style={[styles.referenceGroup, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
          <ThemedText type="heading">{words.unscheduled}</ThemedText>
          {otherRepeats.map(renderRecurringRow)}
        </View>}
        {agendaView === 'all' && stopped.length > 0 && <>
          <Button label={showStopped ? words.fewer : words.more} variant="ghost" onPress={() => setShowStopped(!showStopped)} />
          {showStopped && <View style={[styles.referenceGroup, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
            <ThemedText type="heading">{words.stopped}</ThemedText>
            {stopped.map(renderRecurringRow)}
          </View>}
        </>}
      </ScreenScaffold>

      {/* Subscription detail sheet */}
      {detail && (
        <BottomSheet
          visible
          onClose={() => setDetail(null)}
          title={detail.title}
          footer={(
            <View style={styles.detailActions}>
              {!trackedTitles.has(detail.title.toLowerCase()) &&
                detail.status !== 'stopped' &&
                remindable(detail) && (
                  <Button
                    inline
                    label={t('remindMe')}
                    onPress={() => {
                      addBill(billFromSubscription(detail));
                      setDetail(null);
                    }}
                  />
                )}
              <Button
                inline
                variant="danger"
                label={t('notASubscription')}
                onPress={() => {
                  const sub = detail;
                  setDetail(null);
                  onDismissSub(sub);
                }}
              />
            </View>
          )}>
            {detailData && (
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
                  <ScrollView
                    testID="subscription-history-scroll"
                    nestedScrollEnabled
                    style={styles.historyScroll}
                    showsVerticalScrollIndicator={false}>
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

              </>
            )}
        </BottomSheet>
      )}

      {/* Manual reminder detail sheet */}
      {selectedReminder && (
        <BottomSheet
          visible
          onClose={() => setSelectedReminderId(null)}
          title={selectedReminder.bill.title}
          footer={(
            <View style={styles.detailActions}>
              {selectedReminder.status !== 'paid' && (
                <Button
                  inline
                  label={t('markPaid')}
                  onPress={() => {
                    const reminder = selectedReminder;
                    setSelectedReminderId(null);
                    onPay(reminder.bill.id);
                  }}
                />
              )}
              <Button
                inline
                variant="danger"
                label={t('delete')}
                onPress={() => {
                  const reminder = selectedReminder;
                  setSelectedReminderId(null);
                  onLongPressBill(reminder.bill.id, reminder.bill.title);
                }}
              />
            </View>
          )}>
          <View style={styles.reminderDetail}>
            <ThemedText type="small" style={{ color: statusMeta(selectedReminder.status, selectedReminder.daysLeft).color }}>
              {statusMeta(selectedReminder.status, selectedReminder.daysLeft).label} ·{' '}
              {selectedReminder.bill.yearlyOnISO
                ? shortDate(selectedReminder.dueISO)
                : `${t('day')} ${selectedReminder.bill.dueDay}`}
            </ThemedText>
            <ThemedText type="heading" tabular>
              {formatAED(selectedReminder.bill.amountFils, { decimals: false })}
            </ThemedText>
          </View>
        </BottomSheet>
      )}

      {/* Add reminder sheet */}
      <BottomSheet
        visible={adderVisible}
        onClose={() => setAdderVisible(false)}
        title={t('newReminder')}
        footer={(
          <Button
            label={t('saveReminder')}
            disabled={!draftValid}
            onPress={saveBill}
          />
        )}>
        <TextField
          label={t('reminderNamePlaceholder')}
          accessibilityLabel={t('reminderNamePlaceholder')}
          value={title}
          onChangeText={setTitle}
          placeholder={t('reminderNamePlaceholder')}
        />

        <View style={[styles.inputRow, largeText && styles.inputRowLarge]}>
          <View style={styles.fieldColumn}>
            <TextField
              numeric
              label={t('amount')}
              value={amountText}
              onChangeText={setAmountText}
              placeholder={t('amount')}
              leading={(
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {ledgerCurrencyDisplay()}
                </ThemedText>
              )}
            />
          </View>
          <View style={[styles.fieldColumn, styles.dayField]}>
            <TextField
              numeric
              label={t('day')}
              value={dueDayText}
              onChangeText={setDueDayText}
              placeholder="1-31"
            />
          </View>
        </View>

        <CategoryChips
          categories={EXPENSE_CATEGORIES}
          selected={category}
          onToggle={setCategory}
        />
      </BottomSheet>
      <CardDetailSheet
        account={cardDetail}
        onClose={closeCardDetail}
        footer={selectedDue ? (
          <Button
            label={t('markPaid')}
            onPress={() => {
              const due = selectedDue;
              const accountName = cardDetail?.name ?? t('card');
              closeCardDetail();
              onPayDue(
                due.due.id,
                due.remainingFils,
                due.due.accountId,
                accountName,
              );
            }}
          />
        ) : undefined}
      />
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
    </>
  );
}

const styles = StyleSheet.create({
  referenceGroup: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 8 },
  headerLarge: { alignItems: 'stretch' },
  duesBlock: {
    gap: Spacing.one,
    paddingBottom: Spacing.three,
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  dueRowIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minWidth: 0 },
  dueRowFigure: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, maxWidth: '44%' },
  agendaDate: { width: 76, flexShrink: 0, borderEndWidth: StyleSheet.hairlineWidth, paddingEnd: Spacing.two, paddingVertical: Spacing.two },
  paidCardsBlock: {
    marginTop: Spacing.four,
    gap: Spacing.one,
  },
  paidCardAmount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
    maxWidth: '42%',
  },
  cardSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.three,
    marginBottom: Spacing.two,
    gap: Spacing.two,
  },
  dueFocal: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: Spacing.four, paddingTop: Spacing.three },
  deadlineHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  deadlineDate: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  statementHero: { paddingVertical: Spacing.three, minHeight: 48 },
  statementBody: { gap: Spacing.three },
  statementAmount: { flexWrap: 'wrap' },
  statementMinimum: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: Spacing.two },
  statementProgress: { gap: Spacing.two },
  statementAction: { alignSelf: 'flex-end', minWidth: 104 },
  obligationRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: Spacing.three },
  obligationRowLarge: { flexDirection: 'column', alignItems: 'stretch' },
  obligationAmountLarge: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: '100%' },
  dueFocalTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dueFocalTitle: { flex: 1, minWidth: 0, gap: Spacing.one },
  dueFocalOutstanding: { flex: 1, minWidth: 160, gap: Spacing.one },
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
    paddingVertical: Spacing.three,
  },
  rowLarge: { flexDirection: 'column', alignItems: 'stretch', gap: Spacing.two },
  recurringIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowIdentityLarge: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: '100%' },
  rowFigureLarge: { maxWidth: '100%', marginStart: 0, alignSelf: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: Spacing.two },
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
  // Last debit plus an explicit estimate/observed label; never a monthly equivalent.
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
    gap: Spacing.three,
    paddingVertical: Spacing.six,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.sheet,
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
  inputRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  inputRowLarge: { flexDirection: 'column' },
  fieldColumn: { flex: 1 },
  dayField: { flex: 0.6 },
  catPicker: {
    gap: Spacing.two,
  },
  catChip: {
    paddingHorizontal: Spacing.two + 4,
    paddingVertical: Spacing.two,
    borderRadius: Radius.full,
    borderWidth: 1.5,
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
  reminderDetail: {
    gap: Spacing.two,
  },
});
