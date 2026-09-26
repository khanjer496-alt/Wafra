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
import { historyImportIncomplete } from '@/lib/history-import';
import { internalTransferIdsForState, liveAccountIds } from '@/lib/ledger';
import { buildPaymentReminders, MAX_REMINDERS } from '@/lib/reminders';
import {
  applyReminderPlan,
  createLatestWinsRunner,
  type ReminderSchedulerApi,
} from '@/lib/reminder-schedule';
import { recordRuntimeOperation } from '@/lib/runtime-performance';
import { detectSubscriptionsCooperatively, type Subscription } from '@/lib/subscriptions';
import type { AppState } from '@/lib/types';

const CHANNEL_ID = 'payment-reminders';
/** A separate channel so muting the nightly digest never mutes a bill due. */
const SUMMARY_CHANNEL_ID = 'daily-summary';
/** One id, so re-scheduling replaces tonight's rather than stacking another. */
const SUMMARY_ID = 'wafra-daily-summary';

let handlerConfigured = false;

// A summary can be requested by Home, onboarding, Settings or the reminder
// sync. Keep its consent generation separate from the payment-reminder run.
// Only OS mutations are queued: disabling must not wait for an older
// permission lookup or channel setup before it can cancel the current digest.
let summaryGeneration = 0;
let summaryMutation: Promise<void> = Promise.resolve();
function mutateSummary(generation: number, action: () => Promise<void>): Promise<void> {
  const next = summaryMutation.catch(() => {}).then(async () => {
    if (generation === summaryGeneration) await action();
  });
  summaryMutation = next;
  return next;
}

function configureHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
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

/** Read the OS state without prompting. Used by UI that must never claim an
 * alert is enabled when this phone cannot deliver it. */
export async function notificationDeliveryAllowed(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  return notificationsAllowed(await Notifications.getPermissionsAsync());
}

/**
 * Ask specifically for user-visible iPhone notifications.
 *
 * This is deliberately separate from the quiet/provisional authorization used
 * by older background-delivery code. A user who explicitly taps "Enable
 * notifications" after onboarding is asking for banners/sounds, so a
 * provisional grant must be upgraded rather than silently treated as enough.
 */
export async function requestVisibleNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (Platform.OS !== 'ios') return requestNotificationPermission();
  configureHandler();
  const current = await Notifications.getPermissionsAsync();
  if (current.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED) return true;
  if (current.ios?.status === Notifications.IosAuthorizationStatus.DENIED) return false;
  const asked = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true,
    },
  });
  return asked.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED || asked.granted;
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

/** The OS half of `applyReminderPlan`: expo-notifications, keyed by identifier. */
const reminderScheduler: ReminderSchedulerApi = {
  getAllScheduled: () => Notifications.getAllScheduledNotificationsAsync(),
  cancel: (identifier) => Notifications.cancelScheduledNotificationAsync(identifier),
  schedule: async (identifier, n) => {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title: n.title, body: n.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: n.date,
        channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
      },
    });
  },
};

/** One sync at a time; the newest request wins. See reminder-schedule.ts. */
const runReminderSync = createLatestWinsRunner(
  ({ state, now, summaryGenerationAtRequest }: { state: AppState; now: Date; summaryGenerationAtRequest: number }, isCurrent: () => boolean) =>
    syncPaymentRemindersNow(state, now, isCurrent, summaryGenerationAtRequest),
);

/**
 * Rebuilds the scheduled payment reminders from current state: the next ~30
 * days of bill due dates, card pay-by dates, and subscription renewals.
 *
 * Idempotent and safe to call from anywhere, concurrently: calls are
 * serialised with the newest state winning, and every reminder has a stable
 * identifier so re-scheduling replaces rather than stacks. Only reminders are
 * cancelled — the nightly summary is left in place.
 *
 * The plan — dates, titles, bodies, ordering and the cap — comes from
 * `buildPaymentReminders`. This file only speaks to the OS.
 */
export function syncPaymentReminders(state: AppState, now: Date = new Date()): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  return runReminderSync({ state, now, summaryGenerationAtRequest: summaryGeneration });
}

async function syncPaymentRemindersNow(
  state: AppState,
  now: Date,
  isCurrent: () => boolean,
  summaryGenerationAtRequest: number,
): Promise<void> {
  const historyBusy = Platform.OS === 'android' && historyImportIncomplete(state.historyImport);
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

  // Recurrence detection is a complete-ledger analysis. On a 10k-20k row
  // Android ledger the synchronous detector can monopolise Hermes for seconds
  // immediately after Home becomes visible, which looks exactly like a launch
  // freeze. Bills already uses the cooperative detector; reminder setup must do
  // the same because it runs automatically once per app launch.
  let detectedSubscriptions: readonly Subscription[] | undefined;
  if (Platform.OS === 'android') {
    if (historyBusy) {
      detectedSubscriptions = [];
    } else {
      const startedAt = Date.now();
      const liveAccounts = liveAccountIds(state.accounts);
      const internalTransfers = internalTransferIdsForState(state);
      const detected = await detectSubscriptionsCooperatively(
        state.transactions,
        state.notSubscriptions,
        now,
        liveAccounts,
        internalTransfers,
      );
      recordRuntimeOperation('reminder-projection', Date.now() - startedAt);
      if (detected === null) return;
      detectedSubscriptions = detected;
    }
  }

  if (!isCurrent()) return;

  const plan = buildPaymentReminders(state, now, MAX_REMINDERS, detectedSubscriptions);
  if ((await applyReminderPlan(reminderScheduler, plan, isCurrent)) === 'superseded') return;

  // The summary is no longer collateral damage of a reminder rebuild, so while
  // a history import is busy the one already scheduled simply stays. When the
  // toggle is off, make sure none is left behind.
  // A direct Settings cancellation (or newer summary) supersedes the
  // summary work of a reminder request that was queued before it.
  if (!isCurrent() || summaryGenerationAtRequest !== summaryGeneration) return;
  if (!state.dailySummary) await cancelDailySummary();
  else if (!historyBusy) await syncDailySummary(state, now);
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
 * Replaced under one fixed identifier rather than updated, for the same reason
 * payment reminders are: scheduling again under the same identifier swaps the
 * pending notification atomically, so there can never be two summaries for
 * one evening.
 */
export async function syncDailySummary(state: AppState, now: Date = new Date()): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!state.dailySummary) return cancelDailySummary();
  const generation = ++summaryGeneration;
  configureHandler();
  if (!notificationsAllowed(await Notifications.getPermissionsAsync()) || generation !== summaryGeneration) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(SUMMARY_CHANNEL_ID, {
      name: t('notificationChannelSummary'),
      importance: Notifications.AndroidImportance.LOW,
    });
  }

  if (generation !== summaryGeneration) return;
  const at = new Date(now);
  at.setHours(SUMMARY_HOUR, 0, 0, 0);
  // Past nine already: there is nothing left to schedule for today, and
  // scheduling tomorrow with today's figures would post yesterday's numbers
  // under the word "today".
  if (at.getTime() <= now.getTime()) return;

  const summary = buildDailySummary(state, toISODate(now));
  // Nothing spent today (for instance the only charge was deleted): a summary
  // scheduled earlier with that charge in it must not still fire tonight. A
  // reminder rebuild used to clear it as a side effect; now this does.
  if (!summary) {
    await mutateSummary(generation, () => Notifications.cancelScheduledNotificationAsync(SUMMARY_ID).catch(() => {}));
    return;
  }

  await mutateSummary(generation, async () => {
    await Notifications.scheduleNotificationAsync({
      identifier: SUMMARY_ID,
      content: { title: summary.title, body: summary.body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        channelId: Platform.OS === 'android' ? SUMMARY_CHANNEL_ID : undefined,
      },
    });
  });
}

/** Drop tonight's summary — the toggle going off has to take effect now. */
export async function cancelDailySummary(): Promise<void> {
  if (Platform.OS === 'web') return;
  const generation = ++summaryGeneration;
  await mutateSummary(generation, () => Notifications.cancelScheduledNotificationAsync(SUMMARY_ID).catch(() => {}));
}
