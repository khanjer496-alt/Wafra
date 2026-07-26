import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { billsForMonth } from '@/lib/bills';
import { openDues } from '@/lib/cards';
import { formatAED } from '@/lib/format';
import { detectSubscriptions, daysUntilNext } from '@/lib/subscriptions';
import type { AppState } from '@/lib/types';

const CHANNEL_ID = 'payment-reminders';
const MAX_SCHEDULED = 24;

let handlerConfigured = false;

function configureHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  configureHandler();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

interface PendingNotification {
  date: Date;
  title: string;
  body: string;
}

/**
 * Rebuilds all scheduled payment reminders from current state. Idempotent:
 * cancels everything and re-schedules the next ~30 days of bill due dates,
 * card pay-by dates, and subscription renewals.
 */
export async function syncPaymentReminders(state: AppState): Promise<void> {
  if (Platform.OS === 'web') return;
  configureHandler();
  const perms = await Notifications.getPermissionsAsync();
  if (!perms.granted) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Payment reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = new Date();
  const pending: PendingNotification[] = [];
  const at9 = (d: Date) => {
    const copy = new Date(d);
    copy.setHours(9, 0, 0, 0);
    return copy;
  };

  // Bills: 1 day before + day-of for this month's unpaid reminders.
  const billTitles = new Set(state.bills.map((b) => b.title.toLowerCase()));
  for (const { bill, status } of billsForMonth(state.bills, state.transactions, now)) {
    if (status === 'paid') continue;
    // Clamp to the month, exactly as billsForMonth does. `new Date(y, m, 31)`
    // in February rolls over into March, so a rent bill on the 31st scheduled
    // "due today" for 3 March while the Bills tab said 28 February — the
    // reminder arrived three days after the app's own deadline.
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const due = new Date(now.getFullYear(), now.getMonth(), Math.min(bill.dueDay, lastDay));
    for (const [offset, label] of [[-1, 'tomorrow'], [0, 'today']] as const) {
      const when = at9(new Date(due.getFullYear(), due.getMonth(), due.getDate() + offset));
      if (when <= now) continue;
      pending.push({
        date: when,
        title: `${bill.title} due ${label}`,
        body: `${formatAED(bill.amountFils, { decimals: false })} · mark it paid in Wafra once done.`,
      });
    }
  }

  // Card dues: 3 days before + day-of.
  for (const { due, remainingFils, minimumKnown } of openDues(state, now)) {
    const account = state.accounts.find((a) => a.id === due.accountId);
    const name = account?.name ?? 'Credit card';
    const dueDate = new Date(`${due.dueDate}T09:00:00`);
    for (const [offset, label] of [[-3, 'in 3 days'], [0, 'today']] as const) {
      const when = new Date(dueDate);
      when.setDate(when.getDate() + offset);
      if (when <= now) continue;
      pending.push({
        date: when,
        title: `${name} payment due ${label}`,
        // Only quote a minimum the bank actually stated. When none was, the
        // stored figure is a 5% placeholder, and a push notification is the
        // last place to hand someone a number the app made up.
        body: minimumKnown
          ? `${formatAED(remainingFils, { decimals: false })} outstanding · minimum ${formatAED(due.minDueFils, { decimals: false })}.`
          : `${formatAED(remainingFils, { decimals: false })} outstanding.`,
      });
    }
  }

  // Subscriptions: 1 day before the next expected charge. Merchants already
  // tracked as bill reminders are skipped — one reminder per obligation.
  for (const sub of detectSubscriptions(state.transactions, state.notSubscriptions)) {
    if (sub.status === 'stopped') continue; // cancelled services need no renewal reminders
    if (billTitles.has(sub.title.toLowerCase())) continue;
    const days = daysUntilNext(sub, now);
    if (days < 1 || days > 30) continue;
    const when = at9(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days - 1));
    if (when <= now) continue;
    pending.push({
      date: when,
      title: `${sub.title} renews tomorrow`,
      body: `Around ${formatAED(sub.avgAmountFils, { decimals: false })} will be charged.`,
    });
  }

  pending.sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const n of pending.slice(0, MAX_SCHEDULED)) {
    await Notifications.scheduleNotificationAsync({
      content: { title: n.title, body: n.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: n.date,
        channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
      },
    });
  }
}
