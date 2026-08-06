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

import { buildDailySummary } from '@/lib/daily-summary';
import { toISODate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { buildPaymentReminders, MAX_REMINDERS } from '@/lib/reminders';
import type { AppState } from '@/lib/types';

const CHANNEL_ID = 'payment-reminders';
/** A separate channel so muting the nightly digest never mutes a bill due. */
const SUMMARY_CHANNEL_ID = 'daily-summary';
/** One id, so re-scheduling replaces tonight's rather than stacking another. */
const SUMMARY_ID = 'wafra-daily-summary';

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

/** The same handler, for callers outside this file (the iOS relay wake). */
export function ensureNotificationHandler(): void {
  configureHandler();
}

/**
 * Will the OS deliver a notification we schedule?
 *
 * `status.granted` is NOT that question on iOS, and the difference silently
 * disabled two features. iOS setup asks for PROVISIONAL authorization on
 * purpose — a quiet Notification Center entry needs no permission sheet in the
 * middle of finance setup — and expo-notifications maps `.provisional` onto
 * `EXPermissionStatusUndetermined`, so `granted` comes back FALSE for a device
 * that will happily deliver everything we schedule. Both sync functions below
 * guarded on `granted`, which meant that after iOS setup the payment reminders
 * and the nightly summary were never scheduled at all, on a screen that
 * promises Wafra "warns before money leaves".
 *
 * Provisional notifications DO deliver. They arrive quietly, straight to
 * Notification Center, with no banner and no sound — which for a bill due
 * tomorrow is a worse presentation than a banner and an infinitely better one
 * than nothing.
 *
 * EPHEMERAL is deliberately absent: that is an App Clip's temporary grant, and
 * this app is not one.
 */
export function notificationsAllowed(status: Notifications.NotificationPermissionsStatus): boolean {
  return (
    status.granted ||
    status.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

/**
 * Ask for full notification permission, unless delivery already works.
 *
 * The early return is `notificationsAllowed`, not `granted`, and the
 * difference is not cosmetic. On a provisionally-authorized iPhone `granted`
 * is false, so every "Remind me" and the daily-summary switch would put the
 * standard iOS permission sheet in front of a user whose reminders were
 * already going to arrive. Tapping "Don't Allow" there sets the status to
 * DENIED — which REVOKES the provisional grant and takes down the reminders,
 * the nightly summary and the charge banner in one go. The user would be
 * strictly worse off for having asked to be reminded.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  configureHandler();
  const current = await Notifications.getPermissionsAsync();
  if (notificationsAllowed(current)) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return notificationsAllowed(asked);
}

/**
 * iOS can grant provisional notification authorization without asking for
 * banners, sounds, or badges. Silent relay wakes need notification delivery,
 * not an attention-grabbing permission sheet during finance setup.
 */
export async function requestSilentCapturePermission(): Promise<boolean> {
  if (Platform.OS !== 'ios') return requestNotificationPermission();
  const current = await Notifications.getPermissionsAsync();
  if (notificationsAllowed(current)) return true;
  if (current.ios?.status === Notifications.IosAuthorizationStatus.DENIED) return false;
  const asked = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: false,
      allowBadge: false,
      allowSound: false,
      allowProvisional: true,
    },
  });
  return notificationsAllowed(asked);
}

/**
 * Rebuilds all scheduled payment reminders from current state. Idempotent:
 * cancels everything and re-schedules the next ~30 days of bill due dates,
 * card pay-by dates, and subscription renewals.
 *
 * The plan — dates, titles, bodies, ordering and the cap — comes from
 * `buildPaymentReminders`. This loop only speaks to the OS.
 */
export async function syncPaymentReminders(state: AppState, now: Date = new Date()): Promise<void> {
  if (Platform.OS === 'web') return;
  configureHandler();
  // Not `perms.granted` — see notificationsAllowed. An iOS device that went
  // through setup is provisionally authorized, which reads as "undetermined"
  // and would skip every reminder below.
  if (!notificationsAllowed(await Notifications.getPermissionsAsync())) return;

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

  for (const n of buildPaymentReminders(state, now, MAX_REMINDERS)) {
    await Notifications.scheduleNotificationAsync({
      content: { title: n.title, body: n.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: n.date,
        channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
      },
    });
  }

  await syncDailySummary(state, now);
}

/** The hour the day's summary is posted. Late enough to be the whole day. */
export const SUMMARY_HOUR = 21;

/**
 * Re-schedule tonight's spend summary from the ledger as it stands now.
 *
 * A repeating daily trigger cannot carry today's figures — a local
 * notification's content is fixed when it is scheduled, and no OS recomputes
 * it at fire time. So this schedules ONE dated notification for tonight and
 * replaces it every time the ledger changes, which on Android is every scan.
 * The consequence is worth stating plainly: the summary is accurate as of the
 * last time the app ran an import, so a charge that arrives after the last
 * scan of the day is in tomorrow's summary, not tonight's.
 *
 * Cancelled and rebuilt rather than updated, for the same reason
 * `syncPaymentReminders` does it: there is no way to ask expo-notifications
 * whether a given notification is still pending and still says the right
 * thing, and two summaries for one evening is a worse failure than one that is
 * a few minutes stale.
 */
export async function syncDailySummary(state: AppState, now: Date = new Date()): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!state.dailySummary) return;
  configureHandler();
  if (!notificationsAllowed(await Notifications.getPermissionsAsync())) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(SUMMARY_CHANNEL_ID, {
      name: t('notificationChannelSummary'),
      importance: Notifications.AndroidImportance.LOW,
    });
  }

  const at = new Date(now);
  at.setHours(SUMMARY_HOUR, 0, 0, 0);
  // Past nine already: there is nothing left to schedule for today, and
  // scheduling tomorrow with today's figures would post yesterday's numbers
  // under the word "today".
  if (at.getTime() <= now.getTime()) return;

  const summary = buildDailySummary(state, toISODate(now));
  if (!summary) return;

  await Notifications.scheduleNotificationAsync({
    identifier: SUMMARY_ID,
    content: { title: summary.title, body: summary.body },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: Platform.OS === 'android' ? SUMMARY_CHANNEL_ID : undefined,
    },
  });
}

/** Drop tonight's summary — the toggle going off has to take effect now. */
export async function cancelDailySummary(): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync(SUMMARY_ID).catch(() => {});
}
