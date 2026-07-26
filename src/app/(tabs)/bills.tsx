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
import { billsForMonth, type BillStatus } from '@/lib/bills';
import { openDues } from '@/lib/cards';
import { EXPENSE_CATEGORIES } from '@/lib/categories';
import {
  formatAED,
  monthKey,
  parseAmountToFils,
  shortDate,
  toISODate,
  totalAsShown,
} from '@/lib/format';
import {
  activeSubscriptions,
  billCommitments,
  detectSubscriptions,
  daysUntilNext,
  fixedCommitments,
  otherCommitments,
  stoppedSubscriptions,
  trueSubscriptions,
  type Subscription,
} from '@/lib/subscriptions';
import { useStore } from '@/lib/store';
import type { Account, CategoryId } from '@/lib/types';

type Segment = 'subscriptions' | 'cards' | 'utilities';

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
  const detected = useMemo(
    () => detectSubscriptions(state.transactions, state.notSubscriptions),
    [state.transactions, state.notSubscriptions],
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
  const trackedTitles = useMemo(
    () => new Set(state.bills.map((b) => b.title.toLowerCase())),
    [state.bills],
  );

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
    const tracked = trackedTitles.has(sub.title.toLowerCase());
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
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {sub.status === 'stopped'
                ? `stopped · last charged ${shortDate(sub.lastChargedISO)}`
                : `${sub.cadence} · last ${shortDate(sub.lastChargedISO)} · ${
                    next >= 0
                      ? `next ${shortDate(sub.nextExpectedISO)} (${next}d)`
                      : `expected ${-next}d ago`
                  }`}
            </ThemedText>
          </View>
          <View style={styles.rowRight}>
            {/* The monthly equivalent, because the heading above this list is
                a monthly total and a column has to add up to its own heading.
                A yearly charge of AED 2,399 printed raw under a heading of
                "AED 256/mo" was two different quantities in one table. The
                actual charge is not lost — it is on the line below, with the
                cadence that explains it. */}
            <ThemedText type="smallBold" tabular>
              {formatAED(sub.monthlyEquivalentFils, { decimals: false })}
            </ThemedText>
            {sub.cadence !== 'monthly' && sub.status !== 'stopped' && (
              <ThemedText type="nano" themeColor="textTertiary" tabular>
                {formatAED(sub.avgAmountFils, { decimals: false })}/{sub.cadence === 'yearly' ? 'yr' : 'wk'}
              </ThemedText>
            )}
            {!tracked && sub.status !== 'stopped' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remind me about ${sub.title}`}
                hitSlop={8}
                onPress={() =>
                  addBill({
                    title: sub.title,
                    category: sub.category,
                    amountFils: sub.avgAmountFils,
                    dueDay: Number(sub.nextExpectedISO.slice(8)),
                    autoDetected: true,
                  })
                }
                style={({ pressed }) => [
                  styles.remindBtn,
                  {
                    backgroundColor: pressed ? `${theme.primary}2e` : `${theme.primary}17`,
                    borderColor: `${theme.primary}44`,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  },
                ]}>
                <ThemedText type="nano" style={{ color: theme.primary }}>
                  Remind me
                </ThemedText>
              </Pressable>
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
                {rows.map(({ bill, status, daysLeft }, i) => {
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
                        <ThemedText type="small" style={{ color: meta.color }}>
                          {meta.label} · day {bill.dueDay}
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
              {rows.length > 0 && (
                <ThemedText type="micro" themeColor="textSecondary" style={styles.hint}>
                  Long-press a reminder to delete it.
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

                {/* Actions */}
                <View style={styles.detailActions}>
                  {!trackedTitles.has(detail.title.toLowerCase()) && detail.status !== 'stopped' && (
                    <Pressable
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
  /** Matches the "Mark paid" chip on Wallet dues: a real target, not bare text. */
  remindBtn: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 3,
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
});
