import React, { startTransition, useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  InteractionManager,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { CaptureRefreshControl } from '@/components/capture-refresh-control';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { BillDetailSheet } from '@/components/bill-detail-sheet';
import { CardDetailSheet } from '@/components/card-detail-sheet';
import { LedgerCurrencySheet } from '@/components/ledger-currency-sheet';
import {
  BillsGroupFilter,
  BillsSegmentControl,
  type BillsGroupFilterValue,
  type BillsSegment,
} from '@/components/bills/bills-segment-control';
import { BillsTimeline } from '@/components/bills/bills-timeline';
import { PaymentAgenda } from '@/components/bills/payment-agenda';
import { Money } from '@/components/ui/money';
import { paymentGroupFor, type PaymentAgendaItem, type PaymentGroup } from '@/lib/reference-presentation';
import { ThemedText } from '@/components/themed-text';
import { CategoryChips } from '@/components/ui/category-chips';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useScreenEntering } from '@/hooks/use-screen-entering';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { billsForMonth } from '@/lib/bills';
import { openDues, recentlySettledDues } from '@/lib/cards';
import { EXPENSE_CATEGORIES } from '@/lib/categories';
import {
  formatAED,
  monthKey,
  parseAmountWithMoneySpec,
  shortDate,
  toISODate,
} from '@/lib/format';
import { internalTransferIdsForState, liveAccountIds } from '@/lib/ledger';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import { measureRuntimeOperation, recordRuntimeOperation } from '@/lib/runtime-performance';
import {
  activeSubscriptions,
  billCommitments,
  cancelledByUser,
  isCancelledByUser,
  detectSubscriptions,
  detectSubscriptionsCooperatively,
  daysUntilNext,
  fixedCommitments,
  otherCommitments,
  stoppedSubscriptions,
  subscriptionsMonthlyEquivalent,
  trueSubscriptions,
  withoutCancelled,
  type Subscription,
} from '@/lib/subscriptions';
import { useStoreActions, useStoreSelector } from '@/lib/store';
import { upcomingWindowItems, type AgendaRecurrence } from '@/lib/upcoming-window';
import { historyStatusOnly } from '@/lib/store-selection';
import type { Account, Bill, CategoryId, Transaction } from '@/lib/types';
import { t, tf } from '@/lib/i18n';


/**
 * A confirmation waiting on the user, or null.
 *
 * Every committing action on this screen — marking a bill paid, deleting a
 * reminder, dropping a subscription, marking one cancelled — used to be gated
 * by `Alert.alert` with the store call inside a button's `onPress`. On
 * react-native-web that method is empty, so the alert never drew and the store
 * call was unreachable: buttons that did nothing at all, in silence. The work
 * lives in `onConfirm` and is handed to a sheet that is actually drawn.
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

const UPCOMING_RECURRENCE_IDLE_MS = 4_000;
/** "Next 30 days" is a window, and its label is a promise about it. */
const UPCOMING_WINDOW_DAYS = 30;

// "No fixed schedule" and "Stopped" on All had no cap: a long history drew
// every recurring row (avatar, texts, pressable) in one commit, the slowest
// step on the tab. Page them like PaymentAgenda pages its rows.
const RECURRING_PAGE_SIZE = 12;

function cadenceLabel(cadence: Subscription['cadence']): string {
  return cadence === 'weekly'
    ? t('cadenceWeekly')
    : cadence === 'monthly'
      ? t('cadenceMonthly')
      : cadence === 'yearly'
        ? t('cadenceYearly')
        : t('cadenceAsNeeded');
}

function scheduleWhen(days: number): string {
  if (days === 0) return t('today');
  if (days === 1) return t('tomorrow');
  if (days === 2) return t('scheduleInTwoDays');
  if (days <= 10) return tf('scheduleInFewDays', { days });
  return tf('scheduleInManyDays', { days });
}

/**
 * One recurring row, memoised so a segment tap, sheet or form keystroke on
 * the Bills screen does not re-render every row. `language` is a prop only so
 * a language switch still re-renders the copy read through t()/tf().
 */
const RecurringRow = React.memo(function RecurringRow({
  sub, index, now, tracked, largeText, language, enter, onOpen, onLongPress,
}: {
  sub: Subscription;
  index: number;
  now: Date;
  tracked: boolean;
  largeText: boolean;
  language: string;
  enter: ReturnType<typeof useScreenEntering>;
  onOpen: (sub: Subscription) => void;
  onLongPress: (sub: Subscription) => void;
}) {
  const theme = useTheme();
  const w = moneyPlacesWords(language);
  const i = index;
  const charge = recurringChargePresentation(sub);
  const chargeLabel = t(charge.estimated ? 'recurringEstimatedCharge' : 'recurringLastCharge');
  const next = daysUntilNext(sub, now);
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
      entering={enter(FadeInDown.delay(Math.min(i, 8) * 40).duration(300))}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${sub.title}. ${schedule}. ${chargeLabel}: ${formatAED(charge.amountFils, { decimals: false })}`}
        onPress={() => onOpen(sub)}
        onLongPress={() => onLongPress(sub)}
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
                <View style={[styles.badge, { backgroundColor: theme.goldSoft }]}>
                  <ThemedText type="micro" style={{ color: theme.warning }}>
                    {w.priceWentUp}
                  </ThemedText>
                </View>
              )}
            </View>
            {/* The schedule owns the body width and wraps rather than
                truncating, so the next-charge date survives a long merchant
                name. The cadence is named here ONCE. */}
            <ThemedText type="meta" themeColor="textSecondary" numberOfLines={largeText ? undefined : 2}>
              {sub.priceIncreased ? `${schedule} · ${w.wasPrice(formatAED(sub.priorTypicalFils, { decimals: false }))}` : schedule}
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
});

export default function BillsScreen() {
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  const language = useLanguage();
  const w = moneyPlacesWords(language);
  const enter = useScreenEntering();
  // Only what Bills reads, so scans, progress and unrelated settings do not
  // re-render the whole payment agenda.
  const state = useStoreSelector(({ state: s }) => ({
    transactions: s.transactions, accounts: s.accounts, bills: s.bills, cardDues: s.cardDues,
    notSubscriptions: s.notSubscriptions, cancelledSubscriptions: s.cancelledSubscriptions, ledgerMoney: s.ledgerMoney,
    transferInternalIds: s.transferInternalIds, transferNormalizationVersion: s.transferNormalizationVersion,
    historyImport: historyStatusOnly(s.historyImport),
  }));
  const {
    addBill, deleteBill, markBillPaid, setNotSubscription, setSubscriptionCancelled, setLedgerMoney,
  } = useStoreActions();
  /**
   * The screen that answers "is this card settled?" can now go and find out.
   *
   * Paying a credit card and coming straight here to check is the single most
   * likely reason this tab is open, and until now nothing on it could ask the
   * inbox for the payment SMS — the scan lived on Home. A user who paid
   * AED 5,645 off a FAB card saw the card still listing AED 5,645 owing, with
   * no gesture on this screen able to change that. The scan runs from
   * CaptureRefreshControl below, which re-renders on its own.
   */

  const now = useToday();
  const key = monthKey(now);
  const todayISO = toISODate(now);
  // Recurrence is day-based. Reusing the same Date for the whole day prevents
  // every Android foreground/resume from invalidating a full-ledger projection.
  const recurrenceToday = useMemo(() => new Date(`${todayISO}T12:00:00`), [todayISO]);

  const [agendaView, setAgendaView] = useState<BillsSegment>('upcoming');
  const words = { unscheduled: t('refUnscheduled'), stopped: t('refStopped'), fewer: t('refHideStopped'), more: t('refShowStopped') };
  const [detail, setDetail] = useState<Subscription | null>(null);
  // A due is a question about one card, not a reason to leave the Bills tab.
  // The card sheet itself records payments (Record a payment).
  const [cardDetail, setCardDetail] = useState<Account | null>(null);
  // Inside All: the payment types that used to be their own tabs.
  const [groupFilter, setGroupFilter] = useState<BillsGroupFilterValue>('everything');
  const [selectedReminderId, setSelectedReminderId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const [adderVisible, setAdderVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [amountText, setAmountText] = useState('');
  const [dueDayText, setDueDayText] = useState('');
  const [category, setCategory] = useState<CategoryId>('utilities');
  const [currencySheetVisible, setCurrencySheetVisible] = useState(false);
  const [androidRecurringResult, setAndroidRecurringResult] = useState<{
    value: Subscription[];
    transactions: Transaction[];
    notSubscriptions: string[];
    today: Date;
    liveAccounts: Set<string>;
    internal: Set<string>;
  } | null>(null);
  const [otherLimit, setOtherLimit] = useState(RECURRING_PAGE_SIZE);
  const [stoppedLimit, setStoppedLimit] = useState(RECURRING_PAGE_SIZE);
  // The subscription just marked cancelled, until undone or replaced.
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  const billsHeader: ScreenHeaderProps = {
    title: t('billsTitle'),
    actions: [{
      label: t('newReminder'),
      icon: 'plus',
      onPress: () => setAdderVisible(true),
    }],
  };

  // Card projections read accounts, transactions and statements, not the
  // frequently changing import-progress or review-status fields.
  const dues = useMemo(() => measureRuntimeOperation('bills-open-dues', () => openDues(state, now)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.accounts, state.transactions, state.cardDues, now]);
  // Recently-paid history is invisible in Next 30 days (and in the
  // subscription/utility filters). Do not make the first Bills tap replay
  // historical card settlement just to immediately filter those rows away.
  // All computes it when the user actually asks for that history.
  const needsPaidCards = agendaView === 'all' && (groupFilter === 'everything' || groupFilter === 'cards');
  const paidCards = useMemo(() => needsPaidCards
    ? measureRuntimeOperation('bills-paid-cards', () => recentlySettledDues(state, now))
    : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needsPaidCards, state.accounts, state.transactions, state.cardDues, now]);
  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  const internal = measureRuntimeOperation('bills-transfer-scope', () => internalTransferIdsForState(state));
  // Recurrence detection walks the complete ledger. It is useful on Next 30
  // days, but it is not required to make Bills usable. Never start that
  // historical job in the same interaction window as the first tab paint.
  // All starts it immediately after paint; the default view only warms it
  // after an idle grace period. A shared detector in subscriptions.ts means
  // reminders/Bills join one job instead of racing duplicate scans, and
  // leaving the tab no longer throws completed work away and restarts from
  // row zero next time.
  // The last result stays on screen while a changed ledger is re-analysed.
  // Resetting it to null on every capture or pull-to-refresh emptied
  // Subscriptions until the job finished, then refilled them.
  const recurringFresh = androidRecurringResult !== null &&
    androidRecurringResult.transactions === state.transactions &&
    androidRecurringResult.notSubscriptions === state.notSubscriptions &&
    androidRecurringResult.today === recurrenceToday &&
    androidRecurringResult.liveAccounts === liveAccounts &&
    androidRecurringResult.internal === internal;
  const hasRecurringResult = androidRecurringResult !== null;
  // A previous result may predate a "Not a subscription" choice; never show a
  // merchant the user has just dismissed while the refresh runs.
  const androidRecurring = useMemo(() => {
    if (!androidRecurringResult) return null;
    if (androidRecurringResult.notSubscriptions === state.notSubscriptions) return androidRecurringResult.value;
    const dismissed = new Set(state.notSubscriptions.map((title) => title.trim().toLowerCase()));
    return androidRecurringResult.value.filter((sub) => !dismissed.has(sub.title.trim().toLowerCase()));
  }, [androidRecurringResult, state.notSubscriptions]);

  // useFocusEffect rather than useIsFocused: focus changes no longer re-render
  // the whole screen just to start or cancel this job.
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android' || recurringFresh ||
      (agendaView === 'all' && groupFilter === 'cards')) return;
    let cancelled = false;
    let delay: ReturnType<typeof setTimeout> | null = null;
    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    let task: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
    const transactions = state.transactions;
    const notSubscriptions = state.notSubscriptions;

    const startProjection = () => {
      if (cancelled) return;
      task = InteractionManager.runAfterInteractions(() => {
        firstFrame = requestAnimationFrame(() => {
          secondFrame = requestAnimationFrame(() => {
            const projectionStartedAt = Date.now();
            void detectSubscriptionsCooperatively(
              transactions,
              notSubscriptions,
              recurrenceToday,
              liveAccounts,
              internal,
              () => cancelled,
            ).then((value) => {
              recordRuntimeOperation('bills-projection', Date.now() - projectionStartedAt);
              if (cancelled || value === null) return;
              startTransition(() => setAndroidRecurringResult({
                value, transactions, notSubscriptions, today: recurrenceToday, liveAccounts, internal,
              }));
            });
          });
        });
      });
    };

    // The first analysis on Next 30 days waits for an idle grace period.
    // Refreshing an existing result runs in the cooperative worker's small
    // slices, so it starts straight away instead of showing stale rows for
    // seconds.
    const needsRecurrenceNow = hasRecurringResult || agendaView === 'all';
    if (needsRecurrenceNow) startProjection();
    else delay = setTimeout(startProjection, UPCOMING_RECURRENCE_IDLE_MS);

    return () => {
      cancelled = true;
      if (delay !== null) clearTimeout(delay);
      task?.cancel();
      if (firstFrame !== null) cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) cancelAnimationFrame(secondFrame);
    };
  }, [agendaView, groupFilter, recurringFresh, hasRecurringResult, state.transactions, state.notSubscriptions,
    recurrenceToday, liveAccounts, internal]));
  // The same live/internal pair every other screen that adds money up passes.
  // Without it a charge on an archived card reconciles a bill to "Paid" while
  // Flow's Total out never moves.
  const rows = useMemo(
    () => measureRuntimeOperation(
      'bills-manual',
      () => billsForMonth(state.bills, state.transactions, now, liveAccounts, internal),
    ),
    [state.bills, state.transactions, now, liveAccounts, internal],
  );
  const selectedReminder = useMemo(
    () => rows.find(({ bill }) => bill.id === selectedReminderId) ?? null,
    [rows, selectedReminderId],
  );
  const detected = useMemo(
    () => Platform.OS === 'android'
      ? androidRecurring ?? []
      : detectSubscriptions(state.transactions, state.notSubscriptions, now, liveAccounts, internal),
    [androidRecurring, state.transactions, state.notSubscriptions, now, liveAccounts, internal],
  );
  // A subscription the user said they cancelled leaves upcoming renewals and
  // every total here — until a later charge says it is still being paid.
  const cancelled = state.cancelledSubscriptions;
  const subs = useMemo(
    () => withoutCancelled(activeSubscriptions(trueSubscriptions(detected)), cancelled),
    [detected, cancelled],
  );
  const stopped = useMemo(
    () => withoutCancelled(stoppedSubscriptions(trueSubscriptions(detected)), cancelled),
    [detected, cancelled],
  );
  const cancelledList = useMemo(() => cancelledByUser(trueSubscriptions(detected), cancelled), [detected, cancelled]);
  const monthlySubscriptionsFils = useMemo(
    () => subscriptionsMonthlyEquivalent(detected, cancelled),
    [detected, cancelled],
  );
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
  const subByAgendaId = useMemo(
    () => new Map<string, Subscription>(
      [...subs, ...loans, ...commitments].map((sub) => [`sub-${sub.title.trim().toLowerCase()}`, sub]),
    ),
    [subs, loans, commitments],
  );

  const agendaItems = useMemo<PaymentAgendaItem[]>(() => measureRuntimeOperation('bills-agenda-items', () => {
    const accountNames = new Map(state.accounts.map((a) => [a.id, a.name]));
    const items: PaymentAgendaItem[] = dues.map(({ due, daysLeft, remainingFils }) => ({
      id: `card-${due.id}`, title: accountNames.get(due.accountId) ?? t('card'), category: 'other',
      kind: 'card', accountId: due.accountId, dateISO: due.dueDate, daysLeft, amountFils: remainingFils, estimated: false, paid: false,
    }));
    for (const { due, daysLeft } of paidCards) items.push({
      id: `card-${due.id}`, title: accountNames.get(due.accountId) ?? t('card'), category: 'other',
      kind: 'card', accountId: due.accountId, dateISO: due.dueDate, daysLeft, amountFils: due.totalDueFils, estimated: false, paid: true,
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
        amountFils: charge.amountFils, estimated: charge.estimated, paid: false });
    }
    return items;
  }), [dues, paidCards, rows, subs, loans, commitments, state.accounts, state.bills, now]);

  // Next 30 days: everything unpaid that falls due inside the window,
  // including what is already late, and each time a repeating payment falls
  // due inside it (a weekly charge four or five times; a bill paid this month
  // again when next month's due date is near). Later items stay in All.
  const windowed = useMemo(() => {
    const billById = new Map(state.bills.map((bill) => [bill.id, bill]));
    const paidIn = (bill: Bill) => (iso: string) => bill.paidMonths.includes(monthKey(iso));
    const recurrenceOf = (item: PaymentAgendaItem): AgendaRecurrence | null => {
      if (item.kind === 'bill') {
        const bill = billById.get(item.id.slice(5));
        if (!bill) return null;
        return bill.yearlyOnISO
          ? { cadence: 'yearly', anchorDay: Number(bill.yearlyOnISO.slice(8, 10)), isPaid: paidIn(bill) }
          : { cadence: 'monthly', anchorDay: bill.dueDay, isPaid: paidIn(bill) };
      }
      if (item.kind !== 'recurring') return null;
      const cadence = subByAgendaId.get(item.id)?.cadence;
      return cadence === 'weekly' || cadence === 'monthly' || cadence === 'yearly' ? { cadence } : null;
    };
    return upcomingWindowItems(agendaItems, recurrenceOf, todayISO, UPCOMING_WINDOW_DAYS);
  }, [agendaItems, state.bills, subByAgendaId, todayISO]);
  const selectedAgendaGroup = useMemo<PaymentGroup | undefined>(() => {
    if (agendaView !== 'all' || groupFilter === 'everything') return undefined;
    return groupFilter;
  }, [agendaView, groupFilter]);
  const visibleAgendaItems = useMemo(
    () => agendaView === 'upcoming'
      ? windowed
      : selectedAgendaGroup
        ? agendaItems.filter((item) => paymentGroupFor(item) === selectedAgendaGroup)
        : agendaItems,
    [agendaView, windowed, agendaItems, selectedAgendaGroup],
  );
  const includePaidAgenda = agendaView !== 'upcoming';
  const summary = useMemo(() => {
    const openItems = visibleAgendaItems.filter((item) => !item.paid);
    const label = agendaView === 'upcoming'
      ? w.next30Total
      : groupFilter === 'subscriptions'
        ? t('billsSubscriptionsTotal')
        : groupFilter === 'utilities'
          ? t('billsUtilitiesTotal')
          : groupFilter === 'cards'
            ? t('billsCardsTotal')
            : t('billsAllTotal');
    return {
      label,
      totalFils: openItems.reduce((sum, item) => sum + item.amountFils, 0),
      count: openItems.length,
      estimated: openItems.filter((item) => item.estimated).length,
    };
  }, [agendaView, groupFilter, visibleAgendaItems, w.next30Total]);
  const timelineItems = useMemo(
    () => windowed.filter((item) => item.daysLeft >= 0).map(({ id, title, dateISO }) => ({ id, title, dateISO })),
    [windowed],
  );
  const subscriptionItems = useMemo(
    () => windowed.filter((item) => paymentGroupFor(item) === 'subscriptions'),
    [windowed],
  );
  const billAndCardItems = useMemo(
    () => windowed.filter((item) => paymentGroupFor(item) !== 'subscriptions'),
    [windowed],
  );

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

  /**
   * Exactly what `saveBill` will accept — asked once so the button cannot
   * offer what the handler refuses.
   *
   * The disabled test used to be `!dueDayText`, which is true of "45", "0" and
   * "12.5". Those left the Save button at full opacity and the tap silently did
   * nothing, with the sheet still open and no reason given.
   */
  const draftDueDay = Number(dueDayText);
  const draftAmountFils = state.ledgerMoney
    ? parseAmountWithMoneySpec(amountText, state.ledgerMoney)
    : null;
  const draftValid =
    Boolean(title.trim()) &&
    Boolean(draftAmountFils) &&
    dueDayText.trim() !== '' &&
    Number.isInteger(draftDueDay) &&
    draftDueDay >= 1 &&
    draftDueDay <= 31;

  const saveBill = () => {
    if (!draftValid || !draftAmountFils) return;
    addBill({ title: title.trim(), category, amountFils: draftAmountFils, dueDay: draftDueDay });
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

  const onLongPressBill = (billId: string, billTitle: string) => {
    setConfirmation({
      question: t('deleteReminderTitle'),
      body: tf('deleteReminderBody', { title: billTitle }),
      confirmLabel: t('delete'),
      destructive: true,
      onConfirm: () => deleteBill(billId),
    });
  };

  // Stable (the store's setter is a useCallback), so the memoised recurring
  // rows are not re-rendered by it.
  const onDismissSub = useCallback((sub: Subscription) => {
    setConfirmation({
      question: t('notASubscriptionQ'),
      body: tf('removeSubscriptionBody', { title: sub.title }),
      confirmLabel: t('remove'),
      destructive: true,
      onConfirm: () => setNotSubscription(sub.title, true),
    });
  }, [setNotSubscription]);

  // "I cancelled it" — reversible, dated, and different from "never a
  // subscription": its history stays, and a later charge brings it back.
  const onMarkCancelled = (sub: Subscription) => {
    setConfirmation({
      question: w.markCancelledQuestion(sub.title),
      body: w.markCancelledBody,
      confirmLabel: w.markCancelled,
      onConfirm: () => {
        setSubscriptionCancelled(sub.title, todayISO);
        setCancelNotice(sub.title);
      },
    });
  };
  const undoCancelled = (subTitle: string) => {
    setSubscriptionCancelled(subTitle, null);
    setCancelNotice(null);
  };

  const openCardDetail = (account: Account | null) => {
    setCardDetail(account);
  };

  const closeCardDetail = () => {
    setCardDetail(null);
  };

  // Stable identity for the memoised PaymentAgenda; reads the latest values.
  const agendaOpenRef = useRef<(item: PaymentAgendaItem) => void>(() => {});
  agendaOpenRef.current = (item) => {
    if (item.kind === 'card') {
      const id = item.id.slice(5);
      const due = state.cardDues.find((due) => due.id === id);
      if (due) openCardDetail(state.accounts.find((a) => a.id === due.accountId) ?? null);
    } else if (item.kind === 'bill') setSelectedReminderId((item.repeatOf ?? item.id).slice(5));
    else {
      const id = item.repeatOf ?? item.id;
      const sub = detected.find((sub) => `sub-${sub.title.trim().toLowerCase()}` === id);
      if (sub) setDetail(sub);
    }
  };
  const onOpenAgendaItem = useCallback((item: PaymentAgendaItem) => agendaOpenRef.current(item), []);

  // "was AED 10.99 · Price went up" under a subscription whose price rose,
  // against the price it was before (priorTypicalFils), never its average.
  // Stable while its inputs are, so the memoised PaymentAgenda is not
  // re-rendered by it.
  const renderAgendaMeta = useCallback((item: PaymentAgendaItem) => {
    const sub = item.kind === 'recurring' ? subByAgendaId.get(item.repeatOf ?? item.id) : undefined;
    if (!sub?.priceIncreased) return null;
    return (
      <ThemedText type="meta" style={{ color: theme.warning }} testID={`bills-price-up-${item.id}`}>
        {`${w.wasPrice(formatAED(sub.priorTypicalFils))} · ${w.priceWentUp}`}
      </ThemedText>
    );
  }, [subByAgendaId, theme.warning, w]);

  // A known service that has gone quiet: "Likely stopped", and the one
  // action that says so for certain.
  const renderStoppedRow = (sub: Subscription, i: number) => (
    <View key={sub.title} testID={`bills-stopped-${sub.title.trim().toLowerCase()}`}
      style={[styles.row, largeText && styles.rowLarge,
        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder }]}>
      <Pressable accessibilityRole="button"
        accessibilityLabel={`${sub.title}. ${w.likelyStopped}. ${tf('stoppedLast', { date: shortDate(sub.lastChargedISO) })}`}
        onPress={() => setDetail(sub)}
        style={[styles.recurringIdentity, largeText && styles.rowIdentityLarge]}>
        <MerchantAvatar title={sub.title} category={sub.category} size={32} />
        <View style={styles.rowInfo}>
          <ThemedText type="smallBold" numberOfLines={largeText ? undefined : 1}>{sub.title}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary">
            {`${w.likelyStopped} · ${tf('stoppedLast', { date: shortDate(sub.lastChargedISO) })}`}
          </ThemedText>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${w.markCancelled}: ${sub.title}`}
        testID={`bills-mark-cancelled-${sub.title.trim().toLowerCase()}`}
        onPress={() => onMarkCancelled(sub)}
        style={({ pressed }) => [styles.pill, { borderColor: theme.controlBorder,
          backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
        <ThemedText type="smallBold">{w.markCancelled}</ThemedText>
      </Pressable>
    </View>
  );

  const renderRecurringRow = (sub: Subscription, i: number) => (
    <RecurringRow
      key={sub.title}
      sub={sub}
      index={i}
      now={now}
      tracked={trackedTitles.has(sub.title.toLowerCase())}
      largeText={largeText}
      language={language}
      enter={enter}
      onOpen={setDetail}
      onLongPress={onDismissSub}
    />
  );

  return (
    <>
      <ScreenScaffold
        tabbed
        headerMode="inline"
        header={billsHeader}
        refreshControl={
          <CaptureRefreshControl tintColor={theme.primary} />
        }
        contentStyle={largeText && styles.headerLarge}
        scrollProps={{ showsVerticalScrollIndicator: false }}>
        <BillsSegmentControl segment={agendaView} onChange={setAgendaView} />
        {agendaView === 'all' && <BillsGroupFilter value={groupFilter} onChange={setGroupFilter} />}
        <View
          accessible
          accessibilityLabel={`${summary.label}. ${tf('billsSummaryPayments', {
            count: summary.count,
            s: summary.count === 1 ? '' : 's',
          })}`}
          style={[styles.summary, { borderColor: theme.cardBorder }]}>
          <ThemedText type="micro" themeColor="textSecondary" style={styles.summaryLabel}>
            {summary.label}
          </ThemedText>
          <Money fils={summary.totalFils} type="display" decimals fitInset={Spacing.three * 2 + 2} />
          <View style={styles.summaryMeta}>
            <ThemedText type="meta" themeColor="textSecondary">
              {tf('billsSummaryPayments', {
                count: summary.count,
                s: summary.count === 1 ? '' : 's',
              })}
            </ThemedText>
            {summary.estimated > 0 && <>
              <ThemedText type="meta" themeColor="textTertiary">·</ThemedText>
              <ThemedText type="meta" style={{ color: theme.gold }}>
                {tf('billsSummaryEstimated', { count: summary.estimated })}
              </ThemedText>
            </>}
          </View>
        </View>
        {/* Only while it is still cancelled: Still paying, or a new charge, ends it. */}
        {cancelNotice && cancelled?.[cancelNotice.trim().toLowerCase()] && (
          <View accessibilityLiveRegion="polite" testID="bills-cancel-notice"
            style={[styles.notice, { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" style={styles.rowInfo}>{w.markedCancelled(cancelNotice)}</ThemedText>
            <Pressable accessibilityRole="button" accessibilityLabel={`${w.undo}: ${cancelNotice}`}
              onPress={() => undoCancelled(cancelNotice)} style={styles.noticeAction}>
              <ThemedText type="linkPrimary">{w.undo}</ThemedText>
            </Pressable>
          </View>
        )}
        {agendaView === 'upcoming' ? <>
          <BillsTimeline items={timelineItems} todayISO={todayISO} />
          {(subscriptionItems.length > 0 || stopped.length > 0) && <View style={styles.block} testID="bills-subscriptions">
            <View style={styles.blockHeader} accessible accessibilityRole="header"
              accessibilityLabel={w.subscriptionsTotalA11y(formatAED(monthlySubscriptionsFils))}>
              <ThemedText type="heading" style={styles.rowInfo}>{w.subscriptions}</ThemedText>
              <ThemedText type="smallBold" themeColor="textSecondary" tabular>
                {w.perMonth(formatAED(monthlySubscriptionsFils))}
              </ThemedText>
            </View>
            {subscriptionItems.length > 0 && <PaymentAgenda
              items={subscriptionItems}
              accounts={state.accounts}
              includePaid={false}
              showNote={false}
              renderMeta={renderAgendaMeta}
              onOpen={onOpenAgendaItem} />}
            {stopped.slice(0, stoppedLimit).map(renderStoppedRow)}
            {stopped.length > stoppedLimit && <Button
              label={tf('showMoreRecurring', { count: stopped.length - stoppedLimit })}
              variant="ghost"
              onPress={() => setStoppedLimit((limit) => limit + RECURRING_PAGE_SIZE)} />}
          </View>}
          <View style={styles.block} testID="bills-and-cards">
            <ThemedText type="heading" accessibilityRole="header">{w.billsAndCards}</ThemedText>
            <PaymentAgenda
              items={billAndCardItems}
              accounts={state.accounts}
              includePaid={false}
              renderMeta={renderAgendaMeta}
              onOpen={onOpenAgendaItem} />
          </View>
        </> : <>
          <PaymentAgenda
            items={visibleAgendaItems}
            accounts={state.accounts}
            includePaid={includePaidAgenda}
            group={selectedAgendaGroup}
            renderMeta={renderAgendaMeta}
            onOpen={onOpenAgendaItem} />
          {groupFilter === 'everything' && otherRepeats.length > 0 && <View style={[styles.referenceGroup, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
            <ThemedText type="heading">{words.unscheduled}</ThemedText>
            {otherRepeats.slice(0, otherLimit).map(renderRecurringRow)}
            {otherRepeats.length > otherLimit && <Button
              label={tf('showMoreRecurring', { count: otherRepeats.length - otherLimit })}
              variant="ghost"
              onPress={() => setOtherLimit((limit) => limit + RECURRING_PAGE_SIZE)} />}
          </View>}
          {(groupFilter === 'everything' || groupFilter === 'subscriptions') && stopped.length > 0 && <>
            <Button label={showStopped ? words.fewer : words.more} variant="ghost" onPress={() => setShowStopped(!showStopped)} />
            {showStopped && <View style={[styles.referenceGroup, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
              <ThemedText type="heading">{words.stopped}</ThemedText>
              {stopped.slice(0, stoppedLimit).map(renderRecurringRow)}
              {stopped.length > stoppedLimit && <Button
                label={tf('showMoreRecurring', { count: stopped.length - stoppedLimit })}
                variant="ghost"
                onPress={() => setStoppedLimit((limit) => limit + RECURRING_PAGE_SIZE)} />}
            </View>}
          </>}
          {(groupFilter === 'everything' || groupFilter === 'subscriptions') && cancelledList.length > 0 &&
            <View style={[styles.referenceGroup, { borderColor: theme.cardBorder, backgroundColor: theme.card }]} testID="bills-cancelled">
              <ThemedText type="heading">{w.cancelledByYou}</ThemedText>
              {cancelledList.map((sub, i) => {
                const on = cancelled?.[sub.title.trim().toLowerCase()];
                return (
                  <View key={sub.title} style={[styles.row, largeText && styles.rowLarge,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder }]}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`${sub.title}. ${w.cancelledByYou}`}
                      onPress={() => setDetail(sub)} style={[styles.recurringIdentity, largeText && styles.rowIdentityLarge]}>
                      <MerchantAvatar title={sub.title} category={sub.category} size={32} />
                      <View style={styles.rowInfo}>
                        <ThemedText type="smallBold" numberOfLines={largeText ? undefined : 1}>{sub.title}</ThemedText>
                        {on && <ThemedText type="meta" themeColor="textSecondary">{w.cancelledOn(shortDate(on))}</ThemedText>}
                      </View>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={w.stillPayingA11y(sub.title)}
                      testID={`bills-still-paying-${sub.title.trim().toLowerCase()}`}
                      onPress={() => undoCancelled(sub.title)}
                      style={({ pressed }) => [styles.pill, { borderColor: theme.controlBorder,
                        backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
                      <ThemedText type="smallBold">{w.stillPaying}</ThemedText>
                    </Pressable>
                  </View>
                );
              })}
            </View>}
        </>}
      </ScreenScaffold>

      {/* One detail sheet for recurring charges and reminders alike (also
          Home's). Bills hands it the actions that commit through the
          confirmations this screen draws. */}
      {detail && (
        <BillDetailSheet
          subscription={detail}
          onClose={() => setDetail(null)}
          footer={(
            <View style={[styles.detailActions, largeText && styles.detailStack]}>
              {!trackedTitles.has(detail.title.toLowerCase()) &&
                detail.status !== 'stopped' &&
                !isCancelledByUser(detail, cancelled) &&
                remindable(detail) && (
                  <Button
                    inline={!largeText}
                    label={t('remindMe')}
                    onPress={() => {
                      addBill(billFromSubscription(detail));
                      setDetail(null);
                    }}
                  />
                )}
              <Button
                inline={!largeText}
                variant="ghost"
                labelColor={theme.expense}
                label={t('notASubscription')}
                onPress={() => {
                  const sub = detail;
                  setDetail(null);
                  onDismissSub(sub);
                }}
              />
            </View>
          )}
        />
      )}

      {/* Manual reminder detail */}
      {selectedReminder && (
        <BillDetailSheet
          bill={selectedReminder}
          onClose={() => setSelectedReminderId(null)}
          footer={(
            <View style={[styles.detailActions, largeText && styles.detailStack]}>
              {selectedReminder.status !== 'paid' && (
                <Button
                  inline={!largeText}
                  label={t('markPaid')}
                  onPress={() => {
                    const reminder = selectedReminder;
                    setSelectedReminderId(null);
                    onPay(reminder.bill.id);
                  }}
                />
              )}
              <Button
                inline={!largeText}
                variant="ghost"
                labelColor={theme.expense}
                label={t('delete')}
                onPress={() => {
                  const reminder = selectedReminder;
                  setSelectedReminderId(null);
                  onLongPressBill(reminder.bill.id, reminder.bill.title);
                }}
              />
            </View>
          )}
        />
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

        {!state.ledgerMoney && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chooseLedgerCurrency')}
            onPress={() => setCurrencySheetVisible(true)}
            style={[styles.currencyChoice, { borderColor: theme.controlBorder, backgroundColor: theme.backgroundElement }]}>
            <View style={styles.currencyChoiceCopy}>
              <ThemedText type="smallBold">{t('chooseLedgerCurrency')}</ThemedText>
              <ThemedText type="meta" themeColor="textTertiary">{t('ledgerCurrencyRequiredHint')}</ThemedText>
            </View>
            <Icon name="chevron-right" size={16} color={theme.textSecondary} />
          </Pressable>
        )}

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
                  {state.ledgerMoney?.currency ?? '—'}
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
      {/* The card's own sheet records payments (Record a payment); Bills does
          not file one from here. */}
      <CardDetailSheet
        account={cardDetail}
        onClose={closeCardDetail}
      />
      <LedgerCurrencySheet
        visible={currencySheetVisible}
        value={state.ledgerMoney?.currency ?? null}
        onClose={() => setCurrencySheetVisible(false)}
        onSelect={setLedgerMoney}
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
  summary: {
    borderWidth: 1,
    borderRadius: Radius.sheet,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.one,
  },
  summaryLabel: { textTransform: 'uppercase', letterSpacing: 0.8 },
  summaryMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  referenceGroup: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 6 },
  headerLarge: { alignItems: 'stretch' },
  block: { gap: Spacing.one },
  blockHeader: { minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingStart: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.sheet,
  },
  noticeAction: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.two },
  pill: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three,
    borderRadius: Radius.full, borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 11,
  },
  rowLarge: { flexDirection: 'column', alignItems: 'stretch', gap: Spacing.two },
  recurringIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
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
  inputRow: {
    flexDirection: 'row',
    gap: Spacing.two,
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
  currencyChoiceCopy: { flex: 1, minWidth: 0, gap: 2 },
  inputRowLarge: { flexDirection: 'column' },
  fieldColumn: { flex: 1 },
  dayField: { flex: 0.6 },
  detailStack: { flexDirection: 'column', alignItems: 'stretch' },
  detailActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
});
