import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { buildPaymentReminders } from '@/lib/reminders';
import type { AppState } from '@/lib/types';

const CHANNEL_ID = 'payment-reminders';

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

/**
 * Rebuilds all scheduled payment reminders from current state. Idempotent:
 * cancels everything and re-schedules the next ~30 days of bill due dates,
 * card pay-by dates, and subscription renewals.
 *
 * What to schedule, and when, lives in `@/lib/reminders` — this function only
 * knows how to hand it to the OS.
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

  for (const n of buildPaymentReminders(state, new Date())) {
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
