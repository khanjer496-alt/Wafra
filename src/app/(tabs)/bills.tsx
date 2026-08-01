import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
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
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';
import { billsForMonth, type BillStatus, type BillWithStatus } from '@/lib/bills';
import { openDues } from '@/lib/cards';
import { EXPENSE_CATEGORIES } from '@/lib/categories';
import { formatAED, monthKey, parseAmountToFils, shortDate, toISODate } from '@/lib/format';
import {
  activeSubscriptions,
  detectSubscriptions,
  daysUntilNext,
  fixedCommitments,
  stoppedSubscriptions,
  subscriptionsMonthlyTotal,
  trueSubscriptions,
  type Subscription,
} from '@/lib/subscriptions';
import { useStore } from '@/lib/store';
import type { Account, CategoryId } from '@/lib/types';

type Segment = 'subscriptions' | 'cards' | 'utilities';

/**
 * A REMINDER IS NOT A BILL. It is a bill's alarm clock.
 *
 * Tapping "Remind me" on a detected charge writes a `Bill` carrying the
 * merchant's name and the amount it cost that day. The screen then listed both
 * — the detected charge AND the reminder it had just created — so DEWA, du and
 * Etisalat each appeared twice on one scroll, and DEWA read 449 in the top
 * list against the 450 frozen into its reminder. Two amounts for one bill,
 * eight rows apart, is a data bug as far as anyone reading it is concerned.
 *
 * So a merchant is rendered exactly once, by its detected row, and the
 * reminder shows up as state ON that row. Only a reminder with nothing to
 * attach to — something typed in by hand that no charge history has caught up
 * with yet — gets a row of its own.
 */
const titleKey = (s: string): string => s.trim().toLowerCase();

export default function BillsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { state, addBill, deleteBill, markBillPaid, setNotSubscription, payCardDue } = useStore();

  const now = useMemo(() => new Date(), []);
  const key = monthKey(now);
  const todayISO = toISODate(now);

  const [segment, setSegment] = useState<Segment>('subscriptions');
  const [detail, setDetail] = useState<Subscription | null>(null);
  // A due is a question about one card, not a reason to leave the Bills tab.
  const [cardDetail, setCardDetail] = useState<Account | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const [adderVisible, setAdderVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [amountText, setAmountText] = useState('');
  const [dueDayText, setDueDayText] = useState('');
  const [category, setCategory] = useState<CategoryId>('utilities');

  const rows = useMemo(
    () => billsForMonth(state.bills, state.transactions, now),
    [state.bills, state.transactions, now],
  );
  const dues = useMemo(() => openDues(state, now), [state, now]);
  // `now`, not the internal `new Date()` default: active-vs-stopped is decided
  // against a date, and without passing the screen's own one this memo judged
  // it from whenever it last happened to run while the rows beside it used
  // `now` — two clocks on one screen.
  const detected = useMemo(
    () => detectSubscriptions(state.transactions, state.notSubscriptions, now),
    [state.transactions, state.notSubscriptions, now],
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
  const commitments = useMemo(
    () => allCommitments.filter((s) => s.category !== 'loan'),
    [allCommitments],
  );
  const subsTotal = subscriptionsMonthlyTotal(subs);

  /** The reminder attached to a merchant, if one has been set. */
  const reminderFor = useMemo(() => {
    const map = new Map<string, BillWithStatus>();
    for (const row of rows) map.set(titleKey(row.bill.title), row);
    return map;
  }, [rows]);

  /**
   * Reminders with no detected row to sit on. Everything else is drawn once,
   * where its charge history lives.
   */
  const standaloneReminders = useMemo(() => {
    const detectedTitles = new Set(
      [...subs, ...loans, ...commitments].map((s) => titleKey(s.title)),
    );
    return rows.filter((row) => !detectedTitles.has(titleKey(row.bill.title)));
  }, [rows, subs, loans, commitments]);

  /** What the FIXED badge counts: rows a user will actually see under it. */
  const fixedCount = loans.length + commitments.length + standaloneReminders.length;

  // Everything the detail sheet needs about the tapped subscription: its raw
  // charges (newest first), which cards paid it, first charge, lifetime total.
  const detailData = useMemo(() => {
    if (!detail) return null;
    const titleKey = detail.title.trim().toLowerCase();
    const txs = state.transactions
      .filter(
        (t) => t.type === 'expense' && !t.isTransfer && t.title.trim().toLowerCase() === titleKey,
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    if (txs.length === 0) return null;
    const firstISO = txs[txs.length - 1].date;
    const accounts = [...new Set(txs.map((t) => t.accountId))]
      .map((id) => state.accounts.find((a) => a.id === id))
      .filter((a): a is NonNullable<typeof a> => a != null);
    const totalFils = txs.reduce((s, t) => s + t.amountFils, 0);
    const sortedAmounts = txs.map((t) => t.amountFils).sort((a, b) => a - b);
    const medianFils = sortedAmounts[Math.floor(sortedAmounts.length / 2)];
    return { txs, firstISO, accounts, totalFils, medianFils };
  }, [detail, state.transactions, state.accounts]);

  const subscribedFor = (firstISO: string): string => {
    const d = new Date(`${firstISO}T12:00:00`);
    const months =
      (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (months < 1) return 'under a month';
    if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
    const y = Math.floor(months / 12);
    const m = months % 12;
    return m > 0 ? `${y} yr ${m} mo` : `${y} year${y === 1 ? '' : 's'}`;
  };

  const statusMeta = (status: BillStatus, daysLeft: number) => {
    switch (status) {
      case 'paid':
        return { label: 'Paid', color: theme.income };
      case 'overdue':
        return { label: `${-daysLeft}d overdue`, color: theme.expense };
      case 'due-soon':
        return { label: daysLeft === 0 ? 'Due today' : `Due in ${daysLeft}d`, color: theme.warning };
      default:
        return { label: `Due in ${daysLeft}d`, color: theme.textSecondary };
    }
  };

  const saveBill = () => {
    const fils = parseAmountToFils(amountText);
    const dueDay = Number(dueDayText);
    if (!title.trim() || !fils || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return;
    addBill({ title: title.trim(), category, amountFils: fils, dueDay });
    setTitle('');
    setAmountText('');
    setDueDayText('');
    setAdderVisible(false);
  };

  const onPay = (billId: string) => {
    const bill = state.bills.find((b) => b.id === billId);
    if (!bill) return;
    const accountId = bill.accountId ?? state.accounts[0]?.id;
    if (!accountId) return;
    Alert.alert(
      `Mark "${bill.title}" as paid?`,
      `Records an expense of ${formatAED(bill.amountFils, { decimals: false })} today.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark paid',
          onPress: () =>
            markBillPaid(billId, key, {
              type: 'expense',
              amountFils: bill.amountFils,
              category: bill.category,
              accountId,
              title: bill.title,
              date: todayISO,
              source: 'manual',
            }),
        },
      ],
    );
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

  const onLongPressBill = (billId: string, billTitle: string) => {
    Alert.alert('Delete reminder?', `"${billTitle}" will no longer be tracked.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteBill(billId) },
    ]);
  };

  const onRemoveReminder = (billId: string, billTitle: string) => {
    Alert.alert('Stop reminding you?', `Wafra will still track "${billTitle}" — it just won't remind you before it is due.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop reminding', style: 'destructive', onPress: () => deleteBill(billId) },
    ]);
  };

  const onDismissSub = (sub: Subscription) => {
    Alert.alert(
      'Not a subscription?',
      `"${sub.title}" will stop appearing in subscriptions and won't count toward the monthly total.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => setNotSubscription(sub.title, true) },
      ],
    );
  };

  const renderRecurringRow = (sub: Subscription, i: number) => {
    const next = daysUntilNext(sub, now);
    const reminder = reminderFor.get(titleKey(sub.title));
    const reminderMeta = reminder ? statusMeta(reminder.status, reminder.daysLeft) : null;
    return (
      <Animated.View key={sub.title} entering={FadeInDown.delay(Math.min(i, 8) * 40).duration(300)}>
        <Pressable
          onPress={() => setDetail(sub)}
          onLongPress={() => onDismissSub(sub)}
          style={[
            styles.row,
            i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
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
                    price up
                  </ThemedText>
                </View>
              )}
            </View>
            {/* The next charge date is the whole reason this line exists, and
                it was the part that got cut: a 90px "Remind me" pill on the
                right plus a "last charged" date nobody asked for left eight of
                ten rows ending in "next 2…". The pill has moved to the detail
                sheet this row already opens, the last-charged date lives there
                too, and the line wraps rather than truncates — so the date
                survives however long the merchant's name is. */}
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {sub.status === 'stopped'
                ? `stopped · last charged ${shortDate(sub.lastChargedISO)}`
                : next >= 0
                  ? `${sub.cadence} · next ${shortDate(sub.nextExpectedISO)} (${next}d)`
                  : `${sub.cadence} · expected ${shortDate(sub.nextExpectedISO)}, ${-next}d ago`}
            </ThemedText>
          </View>
          <View style={styles.rowRight}>
            <ThemedText type="smallBold" tabular>
              {formatAED(sub.avgAmountFils, { decimals: false })}
            </ThemedText>
            {/* The reminder, shown as state on the bill it belongs to rather
                than as a second row for the same merchant further down. */}
            {reminder && reminderMeta && (
              <ThemedText type="nano" numberOfLines={1} style={{ color: reminderMeta.color }}>
                {reminder.status === 'paid'
                  ? `${reminderMeta.label} · ${shortDate(reminder.dueISO)}`
                  : reminderMeta.label}
              </ThemedText>
            )}
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
                  : `${t('utilitiesSeg')} ${fixedCount}`;
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
          showsVerticalScrollIndicator={false}>
          {/* Credit-card statement dues live in their own tab. */}
          {segment === 'cards' && (
            <>
              {dues.map(({ due, status, daysLeft, remainingFils, belowMinimum }, i) => {
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
                      <ThemedText type="default">{account?.name ?? 'Card'}</ThemedText>
                      <ThemedText
                        type="small"
                        style={{ color: urgent ? theme.expense : theme.textSecondary }}>
                        {status === 'overdue'
                          ? `${-daysLeft}d overdue`
                          : `Pay by ${shortDate(due.dueDate)} · ${daysLeft}d left`}
                        {belowMinimum
                          ? ` · min ${formatAED(due.minDueFils, { decimals: false })}`
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
                          onPayDue(due.id, remainingFils, due.accountId, account?.name ?? 'Card')
                        }>
                        <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>
                          Mark paid
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
            </>
          )}

          {segment === 'subscriptions' && (
            <>
              {subs.length > 0 && (
                <View style={styles.totalRow}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.totalCaption}>
                    {t('detectedHint')}
                  </ThemedText>
                  <ThemedText type="smallBold" tabular style={styles.totalAmount}>
                    {formatAED(subsTotal, { decimals: false })}/mo
                  </ThemedText>
                </View>
              )}
              <View>{subs.map((sub, i) => renderRecurringRow(sub, i))}</View>

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
                  <ThemedText type="smallBold">No subscriptions detected yet</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                    Import your bank SMS and repeat charges will show up here.
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

              {(loans.length > 0 || commitments.length > 0) && (
                <ThemedText type="micro" themeColor="textTertiary" style={styles.hint}>
                  {t('recurringHint')}
                </ThemedText>
              )}

              {standaloneReminders.length > 0 && (
                <View style={commitments.length > 0 ? styles.commitBlock : undefined}>
                  <ThemedText type="micro" themeColor="textSecondary">
                    {t('remindersSeg')}
                  </ThemedText>
                </View>
              )}
              <View>
                {standaloneReminders.map(({ bill, status, dueISO, daysLeft }, i) => {
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
                        {/* The date it actually falls on, not the stored day.
                            A bill set to day 31 is due on 28 Feb, and "day 31"
                            next to "Due in 8d" reads like one of the two is
                            broken. */}
                        <ThemedText type="small" style={{ color: meta.color }}>
                          {meta.label} · {shortDate(dueISO)}
                        </ThemedText>
                      </View>
                      <View style={styles.rowRight}>
                        <ThemedText type="smallBold" tabular>
                          {formatAED(bill.amountFils, { decimals: false })}
                        </ThemedText>
                        {status !== 'paid' ? (
                          <Pressable onPress={() => onPay(bill.id)}>
                            <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>
                              Mark paid
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
              {standaloneReminders.length > 0 && (
                <ThemedText type="micro" themeColor="textTertiary" style={styles.hint}>
                  Long-press a reminder to delete it.
                </ThemedText>
              )}
              {fixedCount === 0 && (
                <View style={styles.empty}>
                  <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
                    <Icon name="calendar" size={26} color={theme.textSecondary} strokeWidth={1.7} />
                  </View>
                  <ThemedText type="smallBold">No utilities yet</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                    Tap + to track DEWA, rent, or any monthly payment. Detected utility charges
                    show up here on their own.
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
                          ? `stopped · last charged ${shortDate(detail.lastChargedISO)}`
                          : `${detail.cadence} · ${formatAED(detail.monthlyEquivalentFils, { decimals: false })}/mo`}
                      </ThemedText>
                    </View>
                  </View>
                  <Pressable onPress={() => setDetail(null)}>
                    <Icon name="close" size={20} color={theme.textSecondary} />
                  </Pressable>
                </View>

                {/* Lifetime facts */}
                <View style={styles.factRow}>
                  <View style={styles.fact}>
                    <ThemedText type="micro" themeColor="textSecondary">
                      {detail.category === 'loan' ? t('payingFor') : t('subscribedFor')}
                    </ThemedText>
                    <ThemedText type="smallBold">{subscribedFor(detailData.firstISO)}</ThemedText>
                    <ThemedText type="micro" themeColor="textSecondary">
                      since {shortDate(detailData.firstISO)}
                    </ThemedText>
                  </View>
                  <View style={styles.fact}>
                    <ThemedText type="micro" themeColor="textSecondary">
                      {detail.category === 'loan' ? t('payments') : t('charges')}
                    </ThemedText>
                    <ThemedText type="smallBold" tabular>
                      {detailData.txs.length}
                    </ThemedText>
                  </View>
                  <View style={styles.fact}>
                    <ThemedText type="micro" themeColor="textSecondary">
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
                    {detailData.accounts.length > 0
                      ? detailData.accounts.map((a) => a.name).join(', ')
                      : 'Unknown account'}
                  </ThemedText>
                </View>

                {/* Charge history */}
                <View style={styles.historyBlock}>
                  <ThemedText type="micro" themeColor="textSecondary">
                    {t('history')}
                  </ThemedText>
                  <ScrollView style={styles.historyScroll} showsVerticalScrollIndicator={false}>
                    {detailData.txs.slice(0, 36).map((t, i) => {
                      const acc = state.accounts.find((a) => a.id === t.accountId);
                      const offMedian =
                        detailData.medianFils > 0 && t.amountFils > detailData.medianFils * 1.1;
                      return (
                        <View
                          key={t.id}
                          style={[
                            styles.historyRow,
                            i > 0 && {
                              borderTopWidth: StyleSheet.hairlineWidth,
                              borderTopColor: theme.cardBorder,
                            },
                          ]}>
                          <View>
                            <ThemedText type="small">{shortDate(t.date)}</ThemedText>
                            {acc?.last4 && (
                              <ThemedText type="micro" themeColor="textSecondary">
                                ••{acc.last4}
                              </ThemedText>
                            )}
                          </View>
                          <ThemedText
                            type="smallBold"
                            tabular
                            style={offMedian ? { color: theme.warning } : undefined}>
                            {formatAED(t.amountFils, { decimals: false })}
                          </ThemedText>
                        </View>
                      );
                    })}
                    {detailData.txs.length > 36 && (
                      <ThemedText type="micro" themeColor="textSecondary" style={styles.historyMore}>
                        + {detailData.txs.length - 36} older charges
                      </ThemedText>
                    )}
                  </ScrollView>
                </View>

                {/* Actions. The reminder is set and unset HERE now that the
                    list row no longer carries a pill — the row opens straight
                    into this sheet, and here the control has room for a label.
                    One button, two states: filled when there is a reminder to
                    set, outlined and ticked when there is one to call off. */}
                <View style={styles.detailActions}>
                  {(() => {
                    const reminder = reminderFor.get(titleKey(detail.title));
                    if (reminder) {
                      return (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => {
                            const { id, title: billTitle } = reminder.bill;
                            setDetail(null);
                            onRemoveReminder(id, billTitle);
                          }}
                          style={[
                            styles.detailBtn,
                            styles.detailToggle,
                            { borderColor: theme.primaryBorder },
                          ]}>
                          <Icon name="check" size={15} color={theme.primary} strokeWidth={2.6} />
                          <ThemedText type="smallBold" style={{ color: theme.primary }}>
                            {t('reminderSet')}
                          </ThemedText>
                        </Pressable>
                      );
                    }
                    return detail.status === 'stopped' ? null : (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          addBill({
                            title: detail.title,
                            category: detail.category,
                            amountFils: detail.avgAmountFils,
                            dueDay: Number(detail.nextExpectedISO.slice(8)),
                            autoDetected: true,
                          });
                          setDetail(null);
                        }}
                        style={[styles.detailBtn, { backgroundColor: theme.primary }]}>
                        <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                          {t('remindMe')}
                        </ThemedText>
                      </Pressable>
                    );
                  })()}
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
              <ThemedText type="heading">New reminder</ThemedText>
              <Pressable onPress={() => setAdderVisible(false)}>
                <Icon name="close" size={20} color={theme.textSecondary} />
              </Pressable>
            </View>

            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Name (e.g. DEWA, Netflix, Rent)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { backgroundColor: theme.backgroundSelected, color: theme.text }]}
            />

            <View style={styles.inputRow}>
              <View style={[styles.amountBox, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold" themeColor="textSecondary">AED</ThemedText>
                <TextInput
                  value={amountText}
                  onChangeText={setAmountText}
                  keyboardType="numeric"
                  placeholder="Amount"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.amountInput, { color: theme.text }]}
                />
              </View>
              <View style={[styles.amountBox, styles.dayBox, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold" themeColor="textSecondary">Day</ThemedText>
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
              disabled={!title.trim() || !parseAmountToFils(amountText) || !dueDayText}
              style={[
                styles.saveBtn,
                {
                  backgroundColor: theme.primary,
                  opacity: !title.trim() || !parseAmountToFils(amountText) || !dueDayText ? 0.45 : 1,
                },
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>Save reminder</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <CardDetailSheet account={cardDetail} onClose={() => setCardDetail(null)} />
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
  totalAmount: {
    flexShrink: 0,
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
    paddingVertical: Spacing.two + 4,
  },
  rowInfo: {
    flex: 1,
    // Without this a flex child refuses to shrink below its content width, so
    // the subtitle pushes the amount off instead of wrapping.
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
    flexShrink: 0,
    gap: 2,
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
    paddingRight: Spacing.two,
  },
  factRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  fact: {
    flex: 1,
    gap: 2,
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
  /** The "on" half of the reminder toggle: an outline, not a second fill. */
  detailToggle: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
