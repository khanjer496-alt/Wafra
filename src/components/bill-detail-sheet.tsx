import React, { useMemo } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { HistoryStrip } from '@/components/ui/charts';
import { Button } from '@/components/ui/controls';
import { LabelTable } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { CategoryTile } from '@/components/ui/tile';
import { Spacing } from '@/constants/theme';
import { getCategory } from '@/lib/categories';
import { formatAmount, monthKey, monthLabel, shiftMonthKey, shortDate } from '@/lib/format';
import { requestNotificationPermission, syncPaymentReminders } from '@/lib/notifications';
import { useStore } from '@/lib/store';
import { daysPhrase } from '@/lib/leaving-soon';
import { daysUntilNext, type Subscription } from '@/lib/subscriptions';

interface BillDetailSheetProps {
  /** The recurring charge to show, or null to keep the sheet closed. */
  subscription: Subscription | null;
  onClose: () => void;
}

const CADENCE_LABEL = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' } as const;

/**
 * One recurring charge, and whether it is behaving.
 *
 * The history strip is the point: six equal bars mean the price has not moved
 * and there is nothing here to act on — which is a finding, not an empty state.
 */
export function BillDetailSheet({ subscription, onClose }: BillDetailSheetProps) {
  const { state, setNotSubscription } = useStore();
  const now = useMemo(() => new Date(), []);

  const data = useMemo(() => {
    if (!subscription) return null;
    const key = subscription.title.trim().toLowerCase();
    const nowKey = monthKey(now);
    const months = Array.from({ length: 6 }, (_, i) => shiftMonthKey(nowKey, i - 5));

    const history = months.map((m) => {
      let fils = 0;
      for (const t of state.transactions) {
        if (t.type !== 'expense' || t.isTransfer) continue;
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
    ? `${formatAmount(subscription.avgAmountFils, { decimals: false })} every ${
        subscription.cadence === 'monthly' ? 'month' : subscription.cadence === 'weekly' ? 'week' : 'year'
      }, ${data.chargedMonths} ${data.chargedMonths === 1 ? 'month' : 'months'} running — nothing to watch here.`
    : `The last charge was ${formatAmount(subscription.lastAmountFils, { decimals: false })} against a usual ${formatAmount(
        subscription.avgAmountFils,
        { decimals: false },
      )}. The price went up.`;

  const remindMe = async () => {
    const granted = await requestNotificationPermission();
    if (!granted) {
      Alert.alert(
        'Notifications are off',
        'Wafra needs notification permission to warn you before a charge lands.',
      );
      return;
    }
    await syncPaymentReminders(state);
    // Subscriptions are scheduled one day out, with the body "renews
    // tomorrow". Two days was never scheduled by anything.
    Alert.alert(
      'Reminder set',
      `You'll hear about this the day before ${shortDate(subscription.nextExpectedISO)}.`,
    );
  };

  const notRecurring = () => {
    Alert.alert(
      'Not a recurring charge?',
      `${subscription.title} will stop being tracked as one, and stops counting toward your monthly commitments.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Not recurring',
          onPress: () => {
            setNotSubscription(subscription.title, true);
            onClose();
          },
        },
      ],
    );
  };

  return (
    <BottomSheet visible onClose={onClose} title="Recurring · detected">
      <View style={styles.head}>
        <CategoryTile category={subscription.category} size={46} />
        <View style={styles.headText}>
          <ThemedText type="subtitle" numberOfLines={1}>
            {subscription.title}
          </ThemedText>
          <ThemedText type="meta" themeColor="textTertiary">
            {CADENCE_LABEL[subscription.cadence]} · next {shortDate(subscription.nextExpectedISO)} ·{' '}
            {daysPhrase(daysLeft)}
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
            label: 'Paid from',
            value: <ThemedText type="small">{data.account?.name ?? 'Unknown account'}</ThemedText>,
          },
          { label: 'Category', value: <ThemedText type="small">{meta.label}</ThemedText> },
        ]}
      />

      <View style={styles.actions}>
        <Button inline label="Remind me the day before" onPress={remindMe} />
        <Button inline variant="outline" label="Not recurring" onPress={notRecurring} />
      </View>
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
});
