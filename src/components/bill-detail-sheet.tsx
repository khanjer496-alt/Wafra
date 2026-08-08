import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { HistoryStrip } from '@/components/ui/charts';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { LabelTable } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { CategoryTile } from '@/components/ui/tile';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isSpending } from '@/lib/ledger';
import { categoryLabel, getCategory } from '@/lib/categories';
import { formatAmount, monthKey, monthLabel, shiftMonthKey, shortDate } from '@/lib/format';
import { requestNotificationPermission, syncPaymentReminders } from '@/lib/notifications';
import { useStore } from '@/lib/store';
import { daysPhrase } from '@/lib/leaving-soon';
import { daysUntilNext, type Subscription } from '@/lib/subscriptions';
import { t, tf } from '@/lib/i18n';

interface BillDetailSheetProps {
  /** The recurring charge to show, or null to keep the sheet closed. */
  subscription: Subscription | null;
  onClose: () => void;
}

/**
 * One recurring charge, and whether it is behaving.
 *
 * The history strip is the point: six equal bars mean the price has not moved
 * and there is nothing here to act on — which is a finding, not an empty state.
 */
export function BillDetailSheet({ subscription, onClose }: BillDetailSheetProps) {
  const theme = useTheme();
  const { state, setNotSubscription } = useStore();
  const now = useMemo(() => new Date(), []);

  const [confirming, setConfirming] = useState(false);
  /**
   * What "Remind me the day before" has to say, drawn in the sheet instead of
   * announced. Both outcomes — permission refused, reminder scheduled — went
   * through `Alert.alert`, which on react-native-web is `static alert() {}`:
   * the button scheduled the reminder and then said nothing whatsoever, so the
   * only evidence it had worked was a notification the day before the charge.
   * An inline line under the actions is visible on every platform and does not
   * cover the history strip the user came here to read.
   */
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  useEffect(() => {
    // A new charge is a new sheet: neither the confirmation nor the last
    // reminder's answer belongs to it.
    setConfirming(false);
    setNotice(null);
  }, [subscription]);

  const cadenceLabel = (cadence: Subscription['cadence']): string =>
    cadence === 'weekly'
      ? t('cadenceWeekly')
      : cadence === 'monthly'
        ? t('cadenceMonthly')
        : t('cadenceYearly');
  const cadencePeriod = (cadence: Subscription['cadence']): string =>
    cadence === 'weekly'
      ? t('cadencePeriodWeek')
      : cadence === 'monthly'
        ? t('cadencePeriodMonth')
        : t('cadencePeriodYear');

  const data = useMemo(() => {
    if (!subscription) return null;
    const key = subscription.title.trim().toLowerCase();
    const nowKey = monthKey(now);
    const months = Array.from({ length: 6 }, (_, i) => shiftMonthKey(nowKey, i - 5));

    const history = months.map((m) => {
      let fils = 0;
      for (const t of state.transactions) {
        if (!isSpending(t)) continue;
        if (t.title.trim().toLowerCase() !== key) continue;
        if (monthKey(t.date) !== m) continue;
        fils += t.amountFils;
      }
      return { label: monthLabel(m, true).slice(0, 3), fils, current: m === nowKey };
    });

    const charged = history.filter((h) => h.fils > 0);
    const lastAccount = state.transactions.find(
      (t) => t.title.trim().toLowerCase() === key && !t.isTransfer,
    )?.accountId;

    return {
      history,
      chargedMonths: charged.length,
      account: state.accounts.find((a) => a.id === lastAccount),
    };
  }, [subscription, state.transactions, state.accounts, now]);

  if (!subscription || !data) return null;

  const meta = getCategory(subscription.category);
  const daysLeft = daysUntilNext(subscription, now);
  const stable = !subscription.priceIncreased;

  const verdict = stable
    ? tf('recurringStableVerdict', {
        amount: formatAmount(subscription.avgAmountFils, { decimals: false }),
        period: cadencePeriod(subscription.cadence),
        count: data.chargedMonths,
        s: data.chargedMonths === 1 ? '' : 's',
      })
    : tf('recurringPriceUpVerdict', {
        last: formatAmount(subscription.lastAmountFils, { decimals: false }),
        usual: formatAmount(subscription.avgAmountFils, { decimals: false }),
      });

  const remindMe = async () => {
    const granted = await requestNotificationPermission();
    if (!granted) {
      setNotice({ title: t('notifsAreOff'), body: t('notifsForBill') });
      return;
    }
    await syncPaymentReminders(state);
    // Subscriptions are scheduled one day out, with the body "renews
    // tomorrow". Two days was never scheduled by anything.
    setNotice({
      title: t('reminderSet'),
      body: tf('reminderDayBeforeBody', { date: shortDate(subscription.nextExpectedISO) }),
    });
  };

  // The demotion itself. Reachable from the confirmation sheet and from
  // nowhere else — it used to live inside an alert button's `onPress`, which
  // on the web export was code no tap could ever reach.
  const stopRecurring = () => {
    setNotSubscription(subscription.title, true);
    onClose();
  };

  return (
    <BottomSheet visible onClose={onClose} title={t('recurringDetected')}>
      <View style={styles.head}>
        <CategoryTile category={subscription.category} size={46} />
        <View style={styles.headText}>
          <ThemedText type="subtitle" numberOfLines={1}>
            {subscription.title}
          </ThemedText>
          <ThemedText type="meta" themeColor="textTertiary">
            {tf('recurringMeta', {
              cadence: cadenceLabel(subscription.cadence),
              date: shortDate(subscription.nextExpectedISO),
              when: daysPhrase(daysLeft),
            })}
          </ThemedText>
        </View>
        <Money fils={subscription.lastAmountFils} type="sheetAmount" prefix={false} style={styles.headAmount} />
      </View>

      <View style={styles.history}>
        <HistoryStrip months={data.history} />
        <ThemedText type="default" themeColor="textSecondary">
          {verdict}
        </ThemedText>
      </View>

      <LabelTable
        rows={[
          {
            label: t('paidFrom'),
            value: <ThemedText type="small">{data.account?.name ?? t('unknownAccount')}</ThemedText>,
          },
          { label: t('category'), value: <ThemedText type="small">{categoryLabel(meta)}</ThemedText> },
        ]}
      />

      <View style={styles.actions}>
        <Button inline label={t('remindDayBefore')} onPress={remindMe} />
        <Button
          inline
          variant="outline"
          label={t('notRecurring')}
          onPress={() => setConfirming(true)}
        />
      </View>

      {notice && (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.notice,
            { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement },
          ]}>
          <ThemedText type="smallBold">{notice.title}</ThemedText>
          <ThemedText type="meta" themeColor="textSecondary">
            {notice.body}
          </ThemedText>
        </View>
      )}

      {/* Nested inside this sheet rather than beside it: a Modal presented
          from within the presented one stacks, where dismissing this sheet
          and presenting another in the same frame does not. */}
      {confirming && (
        <ConfirmSheet
          visible
          onClose={() => setConfirming(false)}
          question={t('notRecurringQ')}
          body={tf('stopRecurringBody', { title: subscription.title })}
          confirmLabel={t('notRecurring')}
          onConfirm={stopRecurring}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 2,
  },
  headText: {
    flex: 1,
    gap: Spacing.half,
  },
  headAmount: {
    alignSelf: 'center',
  },
  history: {
    gap: Spacing.three - 4,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
  },
  notice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
    gap: Spacing.half,
  },
});
