import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MerchantSpendingLink } from '@/components/merchant-spending-link';
import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { HistoryStrip } from '@/components/ui/charts';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { LabelTable } from '@/components/ui/layout';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Money } from '@/components/ui/money';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import type { BillWithStatus } from '@/lib/bills';
import { categoryLabel, getCategory } from '@/lib/categories';
import {
  formatAED,
  formatAmount,
  formatAmountForInput,
  fullDateTime,
  monthKey,
  monthLabel,
  parseAmountWithMoneySpec,
  shiftMonthKey,
  shortDate,
  toISODate,
  totalAsShown,
} from '@/lib/format';
import { daysPhrase } from '@/lib/leaving-soon';
import { internalTransferIdsForState, isSpending, liveAccountIds } from '@/lib/ledger';
import { applyBillEdit } from '@/lib/money-places';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import { requestNotificationPermission, syncPaymentReminders } from '@/lib/notifications';
import { useStore } from '@/lib/store';
import {
  daysUntilNext,
  isCancelledByUser,
  recurringPaymentAccount,
  type Subscription,
} from '@/lib/subscriptions';
import { t, tf } from '@/lib/i18n';

interface BillDetailSheetProps {
  /** A recurring charge Wafra detected, or null. */
  subscription?: Subscription | null;
  /** A reminder the user keeps (manual or tracked), with this month's status, or null. */
  bill?: BillWithStatus | null;
  onClose: () => void;
  /**
   * Screen-owned actions. Bills passes its own (they commit through its drawn
   * confirmations); Home passes none and gets the recurring defaults below.
   */
  footer?: React.ReactNode;
}

/**
 * One bill: a detected recurring charge, or a reminder the user keeps.
 *
 * Home and Bills open this same sheet. For a recurring charge the history is
 * the point — six equal bars mean the price has not moved, which is a finding,
 * not an empty state — and the amount ahead is an estimate from the latest
 * charges, said as one. For a reminder the user made, the name, amount and due
 * day can be edited here. Detected charges are never marked paid from this
 * sheet: the bank's own debit would count the same money twice.
 */
export function BillDetailSheet({ subscription = null, bill = null, onClose, footer }: BillDetailSheetProps) {
  const theme = useTheme();
  const language = useLanguage();
  const large = useLargeTextLayout();
  const w = moneyPlacesWords(language);
  const { state, setNotSubscription, setSubscriptionCancelled, editBill } = useStore();
  const now = useToday();
  const todayISO = toISODate(now);

  const [confirming, setConfirming] = useState<'not-recurring' | 'cancelled' | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameText, setNameText] = useState('');
  const [amountText, setAmountText] = useState('');
  const [dayText, setDayText] = useState('');
  /**
   * What "Remind me the day before" has to say, drawn in the sheet instead of
   * announced. Both outcomes — permission refused, reminder scheduled — went
   * through `Alert.alert`, which on react-native-web is `static alert() {}`:
   * the button scheduled the reminder and then said nothing whatsoever.
   */
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  useEffect(() => {
    // A new charge is a new sheet: neither a confirmation, an open edit nor
    // the last reminder's answer belongs to it.
    setConfirming(null);
    setEditing(false);
    setNotice(null);
  }, [subscription, bill?.bill.id]);

  const cadenceLabel = (cadence: Subscription['cadence']): string =>
    cadence === 'weekly'
      ? t('cadenceWeekly')
      : cadence === 'monthly'
        ? t('cadenceMonthly')
        : cadence === 'yearly'
          ? t('cadenceYearly')
          : t('cadenceAsNeeded');
  const cadencePeriod = (cadence: Subscription['cadence']): string =>
    cadence === 'weekly'
      ? t('cadencePeriodWeek')
      : cadence === 'monthly'
        ? t('cadencePeriodMonth')
        : t('cadencePeriodYear');

  const data = useMemo(() => {
    if (!subscription) return null;
    const key = subscription.title.trim().toLowerCase();
    // The SAME predicate detectSubscriptions grouped these rows with, so the
    // counts here cannot exceed the figure the row that opened the sheet came
    // from (an archived card's charge or an own-account move is not a charge).
    const live = liveAccountIds(state.accounts);
    const internal = internalTransferIdsForState(state);
    const txs = state.transactions
      .filter((transaction) => isSpending(transaction, live, internal) && transaction.title.trim().toLowerCase() === key)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const nowKey = monthKey(now);
    const history = Array.from({ length: 6 }, (_, i) => shiftMonthKey(nowKey, i - 5)).map((m) => {
      let fils = 0;
      for (const transaction of txs) if (monthKey(transaction.date) === m) fils += transaction.amountFils;
      return { label: monthLabel(m, true).slice(0, 3), fils, current: m === nowKey };
    });
    const paymentAccounts = txs.map((transaction) => recurringPaymentAccount(transaction, state.accounts));
    const accounts = [...new Set(paymentAccounts.map((account) => account?.id).filter((id): id is string => Boolean(id)))]
      .map((id) => state.accounts.find((account) => account.id === id))
      .filter((account): account is NonNullable<typeof account> => account != null);
    const sorted = txs.map((transaction) => transaction.amountFils).sort((a, b) => a - b);
    return {
      txs,
      history,
      chargedMonths: history.filter((h) => h.fils > 0).length,
      firstISO: txs.length ? txs[txs.length - 1].date : null,
      accounts,
      unknownInstrumentCount: paymentAccounts.filter((account) => account === undefined).length,
      // Totalled as the rows below are shown, so the heading agrees with them.
      totalFils: totalAsShown(txs.map((transaction) => transaction.amountFils)),
      medianFils: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    };
  }, [subscription, state, now]);

  if (!subscription && !bill) return null;

  const subscribedFor = (firstISO: string): string => {
    const d = new Date(`${firstISO}T12:00:00`);
    const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (months < 1) return t('subscriptionUnderMonth');
    if (months < 12) return tf('subscriptionMonths', { count: months, s: months === 1 ? '' : 's' });
    const y = Math.floor(months / 12);
    const m = months % 12;
    return m > 0 ? tf('subscriptionYearsMonths', { years: y, months: m }) : tf('subscriptionYears', { count: y, s: y === 1 ? '' : 's' });
  };

  const remindMe = async () => {
    const granted = await requestNotificationPermission();
    if (!granted) {
      setNotice({ title: t('notifsAreOff'), body: t('notifsForBill') });
      return;
    }
    await syncPaymentReminders(state);
    // Subscriptions are scheduled one day out (reminders.ts).
    setNotice({
      title: t('reminderSet'),
      body: tf('reminderDayBeforeBody', { date: shortDate(subscription?.nextExpectedISO ?? todayISO) }),
    });
  };

  const noticeView = notice && (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">{notice.title}</ThemedText>
      <ThemedText type="meta" themeColor="textSecondary">{notice.body}</ThemedText>
    </View>
  );

  if (subscription) {
    const daysLeft = daysUntilNext(subscription, now);
    const stopped = subscription.status === 'stopped';
    // Same rule as the Bills row: a figure not confirmed by a registered-biller
    // receipt, and not an on-demand top-up, is an estimate of the next charge.
    const estimated = !stopped && !subscription.paymentHistory && subscription.cadence !== 'as-needed';
    const sampled = Math.max(1, Math.min(3, subscription.chargeCount));
    const cancelledOn = state.cancelledSubscriptions?.[subscription.title.trim().toLowerCase()];
    const cancelled = isCancelledByUser(subscription, state.cancelledSubscriptions);
    const cancellable = subscription.group === 'subscription';
    const verdict = subscription.priceIncreased
      ? tf('recurringPriceUpVerdict', {
          last: formatAmount(subscription.lastAmountFils, { decimals: false }),
          usual: formatAmount(subscription.priorTypicalFils, { decimals: false }),
        })
      : tf('recurringStableVerdict', {
          amount: formatAmount(subscription.avgAmountFils, { decimals: false }),
          period: cadencePeriod(subscription.cadence),
          count: data?.chargedMonths ?? 0,
          s: data?.chargedMonths === 1 ? '' : 's',
        });

    const defaultFooter = (
      <View style={styles.actions}>
        {!stopped && subscription.cadence !== 'as-needed' && (
          <Button label={t('remindDayBefore')} onPress={remindMe} />
        )}
        <Button variant="ghost" labelColor={theme.expense} label={t('notRecurring')} onPress={() => setConfirming('not-recurring')} />
      </View>
    );

    return (
      <BottomSheet visible onClose={onClose} title={t('recurringDetected')} footer={footer ?? defaultFooter}>
        <View style={styles.head} testID="bill-detail-head">
          <MerchantAvatar title={subscription.title} category={subscription.category} size={42} />
          <View style={styles.headText}>
            <ThemedText type="heading">{subscription.title}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">
              {stopped
                ? tf('stoppedLastCharged', { date: shortDate(subscription.lastChargedISO) })
                : subscription.cadence === 'as-needed'
                  ? cadenceLabel(subscription.cadence)
                  : tf('recurringMeta', {
                      cadence: cadenceLabel(subscription.cadence),
                      date: shortDate(subscription.nextExpectedISO),
                      when: daysPhrase(daysLeft),
                    })}
            </ThemedText>
          </View>
        </View>

        <View style={styles.hero} testID="bill-detail-amount">
          <View style={styles.amountLine}>
            {estimated && <ThemedText type="subtitle" themeColor="textSecondary">≈</ThemedText>}
            <Money fils={estimated ? subscription.avgAmountFils : subscription.lastAmountFils} type="sheetAmount" />
          </View>
          <ThemedText type="meta" themeColor="textSecondary">
            {estimated ? w.estimateFrom(sampled) : t('recurringLastCharge')}
          </ThemedText>
          {subscription.priceIncreased && (
            <ThemedText type="meta" style={{ color: theme.warning }} testID="bill-detail-price-up">
              {`${w.wasPrice(formatAED(subscription.priorTypicalFils))} · ${w.priceWentUp}`}
            </ThemedText>
          )}
        </View>

        {data && (
          <>
            <View style={styles.history}>
              <HistoryStrip months={data.history} />
              <ThemedText type="default" themeColor="textSecondary">{verdict}</ThemedText>
            </View>

            {data.firstISO && (
              <View style={[styles.factRow, large && styles.stack]}>
                <View style={styles.fact}>
                  <ThemedText type="micro" themeColor="textSecondary" style={styles.factLabel}>
                    {subscription.category === 'loan'
                      ? t('payingFor')
                      : subscription.group === 'subscription' ? t('subscribedFor') : t('trackingSince')}
                  </ThemedText>
                  <ThemedText type="smallBold">{subscribedFor(data.firstISO)}</ThemedText>
                  <ThemedText type="micro" themeColor="textSecondary">{tf('walletSince', { date: shortDate(data.firstISO) })}</ThemedText>
                </View>
                <View style={styles.fact}>
                  <ThemedText type="micro" themeColor="textSecondary" style={styles.factLabel}>
                    {subscription.group === 'subscription' ? t('charges') : t('payments')}
                  </ThemedText>
                  <ThemedText type="smallBold" tabular>{data.txs.length}</ThemedText>
                </View>
                <View style={styles.fact}>
                  <ThemedText type="micro" themeColor="textSecondary" style={styles.factLabel}>{t('totalPaid')}</ThemedText>
                  <ThemedText type="smallBold" tabular>{formatAED(data.totalFils, { decimals: false })}</ThemedText>
                </View>
              </View>
            )}

            <LabelTable
              rows={[
                {
                  label: t('paidWith'),
                  value: (
                    <ThemedText type="small">
                      {[
                        data.accounts.map((account) => account.name).join(', ') || t('unknownAccount'),
                        data.unknownInstrumentCount > 0 && data.accounts.length > 0
                          ? tf('paymentInstrumentMissingCount', {
                              count: data.unknownInstrumentCount,
                              s: data.unknownInstrumentCount === 1 ? '' : 's',
                            })
                          : '',
                      ].filter(Boolean).join(' · ')}
                    </ThemedText>
                  ),
                },
                { label: t('category'), value: <ThemedText type="small">{categoryLabel(getCategory(subscription.category))}</ThemedText> },
              ]}
            />

            {data.txs.length > 0 && (
              <View style={styles.historyBlock}>
                <ThemedText type="micro" themeColor="textSecondary">
                  {subscription.group === 'subscription' ? t('history') : t('paymentHistory')}
                </ThemedText>
                <View testID="subscription-history-scroll">
                  {data.txs.slice(0, 36).map((transaction, i) => {
                    const account = recurringPaymentAccount(transaction, state.accounts);
                    const offMedian = data.medianFils > 0 && transaction.amountFils > data.medianFils * 1.1;
                    return (
                      <View key={transaction.id} style={[styles.historyRow, large && styles.stack,
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder }]}>
                        <View style={styles.headText}>
                          <ThemedText type="small">{fullDateTime(transaction)}</ThemedText>
                          <ThemedText type="micro" themeColor="textSecondary" numberOfLines={2}>
                            {account?.name ?? t('paymentInstrumentNotStated')}
                          </ThemedText>
                        </View>
                        <ThemedText type="smallBold" tabular style={offMedian ? { color: theme.warning } : undefined}>
                          {formatAED(transaction.amountFils, { decimals: false })}
                        </ThemedText>
                      </View>
                    );
                  })}
                  {data.txs.length > 36 && (
                    <ThemedText type="micro" themeColor="textSecondary" style={styles.historyMore}>
                      {tf('olderCharges', { count: data.txs.length - 36 })}
                    </ThemedText>
                  )}
                </View>
                <MerchantSpendingLink merchant={subscription.title} onClose={onClose} />
              </View>
            )}
          </>
        )}

        {!stopped && subscription.cadence !== 'as-needed' && !cancelled && (
          <ThemedText type="meta" themeColor="textTertiary">{w.renewalReminder}</ThemedText>
        )}

        {cancellable && (cancelled && cancelledOn ? (
          <View style={[styles.cancelled, { borderColor: theme.cardBorder }]} testID="bill-detail-cancelled">
            <ThemedText type="small" themeColor="textSecondary" style={styles.headText}>
              {w.cancelledOn(shortDate(cancelledOn))}
            </ThemedText>
            <Button inline variant="outline" label={w.stillPaying}
              onPress={() => setSubscriptionCancelled(subscription.title, null)} />
          </View>
        ) : (
          <Button variant="outline" label={w.markCancelled} onPress={() => setConfirming('cancelled')} />
        ))}

        {noticeView}

        {/* Nested inside this sheet rather than beside it: a Modal presented
            from within the presented one stacks, where dismissing this sheet
            and presenting another in the same frame does not. */}
        {confirming === 'not-recurring' && (
          <ConfirmSheet
            visible
            onClose={() => setConfirming(null)}
            question={t('notRecurringQ')}
            body={tf('stopRecurringBody', { title: subscription.title })}
            confirmLabel={t('notRecurring')}
            onConfirm={() => {
              setNotSubscription(subscription.title, true);
              onClose();
            }}
          />
        )}
        {confirming === 'cancelled' && (
          <ConfirmSheet
            visible
            onClose={() => setConfirming(null)}
            question={w.markCancelledQuestion(subscription.title)}
            body={w.markCancelledBody}
            confirmLabel={w.markCancelled}
            onConfirm={() => setSubscriptionCancelled(subscription.title, todayISO)}
          />
        )}
      </BottomSheet>
    );
  }

  // A reminder the user keeps.
  const row = bill!;
  const reminder = row.bill;
  const editable = !reminder.autoDetected;
  const money = state.ledgerMoney;
  const draftAmount = money ? parseAmountWithMoneySpec(amountText, money) : null;
  const draftDay = Number(dayText);
  const draftShapeValid = Boolean(nameText.trim()) && draftAmount !== null && draftAmount > 0 &&
    dayText.trim() !== '' && Number.isInteger(draftDay) && draftDay >= 1 && draftDay <= 31;
  // The store's own rule, asked before Save is offered: a yearly reminder
  // refuses a day its anniversary month does not have, and a refused edit
  // must not close the form as if it had saved.
  const draftValid = draftShapeValid && draftAmount !== null &&
    applyBillEdit(reminder, { title: nameText, amountFils: draftAmount, dueDay: draftDay }) !== null;
  const dayRefused = draftShapeValid && !draftValid;
  const openEdit = () => {
    setNameText(reminder.title);
    setAmountText(formatAmountForInput(reminder.amountFils));
    setDayText(String(reminder.dueDay));
    setEditing(true);
  };
  const saveEdit = () => {
    if (!draftValid || draftAmount === null) return;
    editBill(reminder.id, { title: nameText.trim(), amountFils: draftAmount, dueDay: draftDay });
    setEditing(false);
  };
  const status = row.status === 'paid'
    ? t('paid')
    : row.status === 'overdue'
      ? tf('overdueDays', { days: -row.daysLeft })
      : row.daysLeft === 0 ? t('dueToday') : tf('dueInDays', { days: row.daysLeft });

  return (
    <BottomSheet visible onClose={onClose} title={w.billTitle} footer={footer}>
      <View style={styles.head} testID="bill-detail-head">
        <MerchantAvatar title={reminder.title} category={reminder.category} size={42} />
        <View style={styles.headText}>
          <ThemedText type="heading">{reminder.title}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary">
            {`${categoryLabel(getCategory(reminder.category))} · ${status}`}
          </ThemedText>
        </View>
      </View>
      <View style={styles.hero} testID="bill-detail-amount">
        <Money fils={reminder.amountFils} type="sheetAmount" />
        <ThemedText type="meta" style={{ color: row.status === 'overdue' ? theme.expense : theme.textSecondary }}>
          {`${w.dueOn(shortDate(row.dueISO))} · ${daysPhrase(row.daysLeft)}`}
        </ThemedText>
      </View>
      <LabelTable
        rows={[
          {
            label: w.dueDayLabel,
            value: (
              <ThemedText type="small">
                {reminder.yearlyOnISO ? shortDate(reminder.yearlyOnISO) : w.dueDayEachMonth(reminder.dueDay)}
              </ThemedText>
            ),
          },
          { label: t('category'), value: <ThemedText type="small">{categoryLabel(getCategory(reminder.category))}</ThemedText> },
        ]}
      />
      <ThemedText type="meta" themeColor="textTertiary">{w.billReminder}</ThemedText>

      {editable ? (
        editing ? (
          <View style={styles.edit} testID="bill-detail-edit">
            <TextField label={w.billName} value={nameText} onChangeText={setNameText} placeholder={w.billName} />
            <TextField numeric label={w.billAmount} value={amountText} onChangeText={setAmountText} placeholder={w.billAmount}
              leading={<ThemedText type="smallBold" themeColor="textSecondary">{money?.currency ?? '—'}</ThemedText>} />
            <TextField numeric label={w.billDueDay} value={dayText} onChangeText={setDayText} placeholder="1-31" />
            {dayRefused && reminder.yearlyOnISO && (
              <ThemedText type="meta" accessibilityLiveRegion="polite" style={{ color: theme.expense }}>
                {w.dayNotInMonth(shortDate(reminder.yearlyOnISO))}
              </ThemedText>
            )}
            <View style={[styles.actionsRow, large && styles.stack]}>
              <Button inline={!large} label={w.saveBill} disabled={!draftValid} onPress={saveEdit} />
              <Button inline={!large} variant="outline" label={t('cancel')} onPress={() => setEditing(false)} />
            </View>
          </View>
        ) : (
          <Button variant="outline" label={w.editBill} onPress={openEdit} />
        )
      ) : (
        <ThemedText type="meta" themeColor="textSecondary">{w.detectedCannotEdit}</ThemedText>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three - 2 },
  headText: { flex: 1, minWidth: 0, gap: Spacing.half },
  hero: { gap: Spacing.one },
  amountLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one },
  history: { gap: Spacing.three - 4 },
  factRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  fact: { flex: 1, gap: 2 },
  // The caption sits above the figure and must reserve the taller of the
  // three, or the column that wraps drops out of line with its neighbours.
  factLabel: { minHeight: 28 },
  stack: { flexDirection: 'column', alignItems: 'stretch' },
  historyBlock: { gap: Spacing.one },
  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.two },
  historyMore: { paddingVertical: Spacing.two },
  cancelled: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two,
    paddingVertical: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth,
  },
  actions: { gap: Spacing.one },
  actionsRow: { flexDirection: 'row', gap: Spacing.two },
  edit: { gap: Spacing.two },
  notice: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.sheet, padding: Spacing.three, gap: Spacing.half },
});
