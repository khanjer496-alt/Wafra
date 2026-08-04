/**
 * The OS half of reminders: permissions, the Android channel, and handing a
 * list of dates to expo-notifications.
 *
 * Deliberately thin. Everything that can actually be WRONG — which day a bill
 * falls on, whether a minimum may be quoted, which obligations deserve a push
 * at all — lives in reminders.ts, which imports no native module and is
 * therefore reachable from the test harness. This file imports
 * expo-notifications, so nothing in it can be tested; the rule is that nothing
 * in it should need to be.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { t } from '@/lib/i18n';
import { buildPaymentReminders, MAX_REMINDERS } from '@/lib/reminders';
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
 * iOS can grant provisional notification authorization without asking for
 * banners, sounds, or badges. Silent relay wakes need notification delivery,
 * not an attention-grabbing permission sheet during finance setup.
 */
export async function requestSilentCapturePermission(): Promise<boolean> {
  if (Platform.OS !== 'ios') return requestNotificationPermission();
  const allowed = (status: Notifications.NotificationPermissionsStatus) =>
    status.granted ||
    status.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  const current = await Notifications.getPermissionsAsync();
  if (allowed(current)) return true;
  if (current.ios?.status === Notifications.IosAuthorizationStatus.DENIED) return false;
  const asked = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: false,
      allowBadge: false,
      allowSound: false,
      allowProvisional: true,
    },
  });
  return allowed(asked);
}

/**
 * Rebuilds all scheduled payment reminders from current state. Idempotent:
 * cancels everything and re-schedules the next ~30 days of bill due dates,
 * card pay-by dates, and subscription renewals.
 *
 * The plan — dates, titles, bodies, ordering and the cap — comes from
 * `buildPaymentReminders`. This loop only speaks to the OS.
 */
export async function syncPaymentReminders(state: AppState): Promise<void> {
  if (Platform.OS === 'web') return;
  configureHandler();
  const perms = await Notifications.getPermissionsAsync();
  if (!perms.granted) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      // The channel name is what Android shows in system settings, so it is a
      // user-facing string like any other. CHANNEL_ID itself has to match
      // app.json's notification `defaultChannel`.
      name: t('notificationChannelPayments'),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await Notifications.cancelAllScheduledNotificationsAsync();

  for (const n of buildPaymentReminders(state, new Date(), MAX_REMINDERS)) {
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
