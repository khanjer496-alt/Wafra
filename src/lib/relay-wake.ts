/**
 * The layers that make a captured transaction land without the user opening
 * anything.
 *
 * WHY THIS FILE EXISTS AT ALL. `src/lib/relay.ts` can collect a queued row, but
 * something has to ask it to. On Android that is a broadcast receiver; on iOS
 * an app cannot run code because a message arrived. The three things it CAN do
 * are: be woken by a content-available push, be given a few seconds by
 * BGTaskScheduler on iOS's own schedule, or run when the user opens the app.
 * This file owns the first two. The third lives in
 * `src/hooks/use-relay-capture.ts` because it needs the store.
 *
 * FIVE THINGS HERE ARE LOAD-BEARING.
 *
 * 1. THE TASKS ARE DEFINED AT MODULE SCOPE, and this module is imported from
 *    `index.js` before the router. When iOS wakes a terminated app for a
 *    background push, expo-task-manager loads the JS bundle and immediately
 *    looks for a task with the registered name. Defining it inside a component,
 *    an effect, or a module the router only reaches while rendering means it is
 *    not there yet and the wake is dropped — silently, with no error anywhere.
 *
 * 2. THE BACKGROUND LAYERS ONLY STAGE. They call `backgroundSyncRelay`, which
 *    writes to its own AsyncStorage key and never to the ledger. See the note
 *    in relay.ts: a headless write behind StoreProvider's back is overwritten
 *    by its next save.
 *
 * 3. EVERY LAYER DEGRADES ON ITS OWN. Notifications declined, no EAS project
 *    id, Background App Refresh off, Low Power Mode, the app force-quit from
 *    the switcher — each of those kills one layer and none of them kills
 *    capture. `relayWakeStatus()` reports which layers are actually live so the
 *    UI can promise "seconds" or "when you open Wafra" truthfully instead of
 *    guessing.
 *
 * 4. NOTHING HERE THROWS. These run in a headless context where a rejection is
 *    a crash report, and in a foreground path where it would be a broken
 *    screen. Every native call is individually guarded.
 *
 * 5. NO LOCAL NOTIFICATION IS POSTED WHEN A ROW ARRIVES. It is tempting —
 *    "AED 187.50 · Carrefour added" — and it is wrong twice over: iOS 17
 *    already forces a banner every time a Run Immediately automation fires, so
 *    this would be the second banner for one purchase, and it would put the
 *    amount and merchant on a lock screen the relay design deliberately keeps
 *    them off.
 */
import Constants from 'expo-constants';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import {
  backgroundSyncRelay,
  isRelaySupported,
  registerRelayPushToken,
  relayStatus,
} from '@/lib/relay';

/** BGTaskScheduler work item. Renaming it strands whatever iOS has scheduled. */
export const RELAY_SYNC_TASK = 'wafra-relay-sync';
/** The headless handler for a content-available push from the relay. */
export const RELAY_PUSH_TASK = 'wafra-relay-push';

/**
 * iOS treats this as a floor and mostly ignores it — the SDK 55 docs say tasks
 * typically run in system windows, often overnight. It is written as 15 because
 * that is the minimum the API accepts, and because this layer's job is to keep
 * the 72-hour queue TTL from ever being reached, not to deliver quickly.
 */
const MINIMUM_INTERVAL_MINUTES = 15;

/* ─────────────────────────── Task definitions ─────────────────────────── */

/**
 * `defineTask` throws if called twice with the same name, and Fast Refresh
 * re-evaluates modules, so this is guarded rather than assumed to run once.
 */
function define(name: string, executor: Parameters<typeof TaskManager.defineTask>[1]): void {
  try {
    if (TaskManager.isTaskDefined(name)) return;
    TaskManager.defineTask(name, executor);
  } catch {
    // A platform without TaskManager (web) or a double definition. Neither is
    // worth taking the app down for.
  }
}

if (Platform.OS === 'ios') {
  define(RELAY_SYNC_TASK, async () => {
    const result = await backgroundSyncRelay();
    // `Failed` tells iOS the work did not complete, and iOS answers by giving
    // the app fewer windows. A skip because the user is not subscribed, or a
    // network blip, is not a failure of the task.
    return result.sync?.error && result.sync.error !== 'unauthorized'
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  });

  define(RELAY_PUSH_TASK, async () => {
    // The push carries `{}` on purpose — the payload is not read, and there is
    // nothing in it to read. It is a knock, and this is answering the door.
    const result = await backgroundSyncRelay();
    return result.sync && result.sync.staged > 0
      ? Notifications.BackgroundNotificationTaskResult.NewData
      : Notifications.BackgroundNotificationTaskResult.NoData;
  });
}

/* ─────────────────────────── Status ─────────────────────────── */

export type WakeLayerState =
  | 'on'
  /** Registered as far as the app can tell, but the OS may still refuse. */
  | 'off'
  | 'unsupported';

export interface RelayWakeStatus {
  /** Instant delivery: the relay knows a push token for this device. */
  push: WakeLayerState;
  /** Periodic catch-up: BGTaskScheduler accepted the registration. */
  background: WakeLayerState;
  /**
   * Why a layer is off, in words a support reply can use. Not shown raw to
   * users — the setup screen turns it into a sentence.
   */
  reason: string | null;
}

const OFF: RelayWakeStatus = { push: 'unsupported', background: 'unsupported', reason: null };

/**
 * The Expo project id, which `getExpoPushTokenAsync` cannot work without.
 * Absent in a checkout that has never been built with EAS — in which case the
 * push layer is simply off, and the app says so rather than throwing on launch.
 */
function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = typeof extra?.eas?.projectId === 'string' ? extra.eas.projectId.trim() : '';
  return id || null;
}

/* ─────────────────────────── Registration ─────────────────────────── */

let ensuring: Promise<RelayWakeStatus> | null = null;

/**
 * Turn on whichever layers this phone and this build allow. Safe to call on
 * every launch: registration is idempotent, and an unchanged push token costs
 * no network request.
 *
 * Concurrent callers share one run — Home's hydrate effect and the setup
 * screen can both ask, and neither should register twice.
 */
export function ensureRelayWake(): Promise<RelayWakeStatus> {
  if (!ensuring) {
    ensuring = run().finally(() => {
      ensuring = null;
    });
  }
  return ensuring;
}

async function run(): Promise<RelayWakeStatus> {
  if (!isRelaySupported()) return OFF;
  const status: RelayWakeStatus = { push: 'off', background: 'off', reason: null };

  /* ── Layer 2: the periodic sweep ── */
  try {
    const available = await BackgroundTask.getStatusAsync();
    if (available === BackgroundTask.BackgroundTaskStatus.Available) {
      await BackgroundTask.registerTaskAsync(RELAY_SYNC_TASK, {
        minimumInterval: MINIMUM_INTERVAL_MINUTES,
      });
      status.background = 'on';
    } else {
      // Background App Refresh off, Low Power Mode, or a simulator — the API is
      // unavailable on iOS simulators entirely.
      status.reason = 'background-refresh-off';
    }
  } catch {
    status.reason = status.reason ?? 'background-task-failed';
  }

  /* ── Layer 1: the wake that makes it feel instant ── */
  try {
    const id = projectId();
    if (!id) {
      status.reason = status.reason ?? 'no-project-id';
    } else {
      // No permission prompt is triggered here on purpose. A content-available
      // push needs APNs registration, not alert permission, so a user who has
      // declined banners still gets instant capture. The reminder feature asks
      // for permission separately, for its own reasons.
      await Notifications.registerTaskAsync(RELAY_PUSH_TASK);
      const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
      const outcome = await registerRelayPushToken(token.data);
      if (outcome === 'registered' || outcome === 'unchanged') status.push = 'on';
      else status.reason = status.reason ?? outcome;
    }
  } catch {
    // No APNs entitlement, no network, a simulator, or a device that refuses to
    // register. The other two layers carry the product.
    status.reason = status.reason ?? 'push-unavailable';
  }

  return status;
}

/**
 * Read the layers back without registering anything. Used by the setup screen,
 * which must not claim "arrives in seconds" on a phone where it will not.
 */
export async function relayWakeStatus(): Promise<RelayWakeStatus> {
  if (!isRelaySupported()) return OFF;
  const status: RelayWakeStatus = { push: 'off', background: 'off', reason: null };
  try {
    status.background = (await TaskManager.isTaskRegisteredAsync(RELAY_SYNC_TASK)) ? 'on' : 'off';
  } catch {
    status.background = 'off';
  }
  try {
    status.push = (await relayStatus()).pushEnabled ? 'on' : 'off';
  } catch {
    status.push = 'off';
  }
  return status;
}

/**
 * Stop waking this phone. Called on unpair, and it does the local half of that
 * only — clearing the token the RELAY holds is `registerRelayPushToken('')`,
 * which unpairing makes moot by deleting the device row outright.
 */
export async function stopRelayWake(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(RELAY_SYNC_TASK)) {
      await BackgroundTask.unregisterTaskAsync(RELAY_SYNC_TASK);
    }
  } catch {
    // Nothing to unregister, or the OS refused. Either way the task's body
    // checks pairing first and does nothing without it.
  }
  try {
    if (await TaskManager.isTaskRegisteredAsync(RELAY_PUSH_TASK)) {
      await Notifications.unregisterTaskAsync(RELAY_PUSH_TASK);
    }
  } catch {
    // As above.
  }
}
