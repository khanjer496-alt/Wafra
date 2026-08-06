/**
 * Silent iOS relay delivery.
 *
 * The push is only a wake signal. It contains no amount, merchant, account,
 * or queue identifier. Once woken, this task opens the authenticated relay,
 * decrypts device-sealed structured rows, writes them to SQLCipher, and only
 * then acknowledges the server queue. StoreProvider folds this durable local
 * inbox into the ledger on its next render.
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import type { ScannedSms } from '@/lib/auto-import';
import { buildChargeAlert } from '@/lib/charge-alert';
import { detectLanguage, getLanguage, type Lang } from '@/lib/i18n';
import { ensureNotificationHandler, notificationsAllowed } from '@/lib/notifications';
import {
  ackRelay,
  getBackgroundRelayConfig,
  getRelayConfig,
  recordRelayAutomationProof,
  registerRelayPush,
  syncRelay,
  unregisterRelayPush,
  type RelayConfig,
} from '@/lib/relay';
import { backgroundRelayStorage } from '@/lib/background-relay-storage';

const TASK_NAME = 'wafra-relay-background-sync-v1';
const QUEUE_KEY = 'wafra/background-relay/v1';
const ALERT_KEY = 'wafra/background-relay/alerts/v1';
const MAX_LOCAL_ROWS = 1_000;

interface WakePayload {
  kind?: unknown;
  v?: unknown;
}

function isWake(data: unknown): boolean {
  if (!data || typeof data !== 'object' || 'actionIdentifier' in data) return false;
  const wake = data as WakePayload;
  return wake.kind === 'wafra.sync' && wake.v === 1;
}

function rowKey(row: ScannedSms): string {
  return [
    row.smsTs ?? 0,
    row.amountFils,
    row.type,
    row.merchant,
    row.card?.last4 ?? '',
    row.card?.kind ?? '',
  ].join('|');
}

function parseQueue(raw: string | null): ScannedSms[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (row): row is ScannedSms =>
        !!row &&
        typeof row === 'object' &&
        typeof (row as Partial<ScannedSms>).merchant === 'string' &&
        Number.isSafeInteger((row as Partial<ScannedSms>).amountFils),
    );
  } catch {
    return [];
  }
}

/**
 * Persist before ack: a killed background task causes a retry, never loss.
 *
 * Returns the rows that were NOT already in the queue. A retry is the normal
 * case here — the task is killed between the write and the ack often enough
 * that the design depends on it — and the server re-sends everything it never
 * saw acknowledged. Writing a row twice is harmless because the key collapses
 * it; ANNOUNCING it twice is not, so the banner is built from this list rather
 * than from everything the sync returned.
 */
async function appendDurable(rows: ScannedSms[]): Promise<ScannedSms[]> {
  if (rows.length === 0) return [];
  const existing = parseQueue(await backgroundRelayStorage.getItem(QUEUE_KEY));
  const merged = new Map(existing.map((row) => [rowKey(row), row]));
  const fresh: ScannedSms[] = [];
  for (const row of rows) {
    const key = rowKey(row);
    if (!merged.has(key)) fresh.push(row);
    merged.set(key, row);
  }
  const value = [...merged.values()]
    .sort((a, b) => (a.smsTs ?? 0) - (b.smsTs ?? 0))
    .slice(-MAX_LOCAL_ROWS);
  await backgroundRelayStorage.setItem(QUEUE_KEY, JSON.stringify(value));
  return fresh;
}

/**
 * Whether the user wants a banner when a charge syncs, and which language to
 * write it in.
 *
 * The language is stored beside the switch because the code that needs it runs
 * in a headless task. i18n's language is module state set during hydrate, and
 * a background wake can execute before StoreProvider has ever mounted — so an
 * Arabic user would get English banners at exactly the times they never opened
 * the app. `enableRelayBackgroundSync` refreshes this on every foreground
 * launch, which is where the answer is actually known.
 */
export interface ChargeAlertPreference {
  enabled: boolean;
  lang: Lang;
}

async function readAlertPreference(): Promise<ChargeAlertPreference> {
  // ON until the user turns it off, which is the opposite of Android's
  // InstantAlert.isEnabled, and the reason is the delivery and not a change of
  // mind. Android's banner is a heads-up over whatever is on screen, so it
  // defaults off because it is an interruption. This one is posted `passive`
  // on a device that iOS setup only ever asked for PROVISIONAL authorization —
  // it lands quietly in Notification Center with no banner and no sound. An
  // interruption is worth an opt-in; a quiet line in a list the user chose to
  // open is not, and defaulting it off would leave the iOS half of the product
  // with no per-charge alert at all for everyone who never found the switch.
  const fallback: ChargeAlertPreference = { enabled: true, lang: detectLanguage() };
  try {
    const raw = await backgroundRelayStorage.getItem(ALERT_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as { on?: unknown; lang?: unknown };
    return {
      // Only an explicit `false` turns it off, so a blob written by an older
      // build that carried no switch keeps working rather than going silent.
      enabled: value.on !== false,
      lang: value.lang === 'ar' ? 'ar' : value.lang === 'en' ? 'en' : fallback.lang,
    };
  } catch {
    return fallback;
  }
}

export async function getChargeAlertPreference(): Promise<ChargeAlertPreference> {
  return readAlertPreference();
}

/** The Settings switch. Captures the current UI language along with it. */
export async function setChargeAlertsEnabled(enabled: boolean, lang: Lang = getLanguage()): Promise<void> {
  await backgroundRelayStorage.setItem(ALERT_KEY, JSON.stringify({ on: enabled, lang }));
}

/** Keep the stored language in step without touching the switch. */
async function refreshAlertLanguage(): Promise<void> {
  const current = await readAlertPreference();
  if (current.lang === getLanguage()) return;
  await setChargeAlertsEnabled(current.enabled);
}

/**
 * The banner for the charges this wake just collected.
 *
 * iOS only, and not because of a platform check for its own sake: Android
 * already posts this banner from InstantAlert.kt at SMS-delivery time, and a
 * second one from here would be the same charge announced twice.
 *
 * Never throws. A banner is not worth failing a sync for — the rows are
 * already durably written by the time this runs, and the ack that follows it
 * is what stops the server re-sending them forever.
 */
async function announceCharges(rows: ScannedSms[]): Promise<void> {
  if (Platform.OS !== 'ios' || rows.length === 0) return;
  try {
    const pref = await readAlertPreference();
    if (!pref.enabled) return;
    ensureNotificationHandler();
    if (!notificationsAllowed(await Notifications.getPermissionsAsync())) return;
    const alert = buildChargeAlert(rows, Date.now(), pref.lang);
    if (!alert) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: alert.title,
        ...(alert.body.length > 0 && { body: alert.body }),
        // Silent, and passive so it never lights the screen. These arrive
        // several times a day; the Kotlin channel makes the same two choices
        // for the same reason. No `data`, because the notification carries no
        // payload it needs and a bank-derived one has no business in one.
        sound: false,
        interruptionLevel: 'passive',
      },
      // Immediately — there is nothing to schedule, the charge already
      // happened.
      trigger: null,
    });
  } catch {
    // Deliberately silent, as InstantAlert.post is.
  }
}

export async function readBackgroundRelayRows(): Promise<ScannedSms[]> {
  return parseQueue(await backgroundRelayStorage.getItem(QUEUE_KEY));
}

/** Call only after StoreProvider has durably written the imported ledger. */
export async function clearBackgroundRelayRows(): Promise<void> {
  await backgroundRelayStorage.removeItem(QUEUE_KEY);
}

export async function syncRelayInBackground(): Promise<number> {
  const cfg = await getBackgroundRelayConfig();
  if (!cfg || cfg.setupState === 'paired') return 0;
  const { parsed, ids, testIds } = await syncRelay(cfg);
  const fresh = await appendDurable(parsed);
  // The only thing on this phone that will tell the user a card was just used.
  // Between the durable write and the ack on purpose: the rows survive a kill
  // either way, and a banner must never be the reason a sync stops short of
  // acknowledging what it stored.
  await announceCharges(fresh);
  // Email/PDF imports share this wake channel, but they prove nothing about
  // Apple's Message automation. Only an alert entering through /v1/ingest may
  // activate the "Shortcut connected" claim on Home.
  if (parsed.some((row) => row.captureSource === 'shortcut')) {
    await recordRelayAutomationProof();
  }
  // A later real bank alert can wake the app while a setup probe is still in
  // the same queue. Never let that wake consume the proof marker; the setup
  // screen is the only place allowed to acknowledge it.
  const reserved = new Set(testIds);
  const acknowledge = ids.filter((id) => !reserved.has(id));
  if (acknowledge.length > 0) await ackRelay(cfg, acknowledge);
  return parsed.length;
}

if (Platform.OS !== 'web') {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    TASK_NAME,
    async ({ data, error }) => {
      if (error || !isWake(data)) return Notifications.BackgroundNotificationTaskResult.NoData;
      try {
        const count = await syncRelayInBackground();
        return count > 0
          ? Notifications.BackgroundNotificationTaskResult.NewData
          : Notifications.BackgroundNotificationTaskResult.NoData;
      } catch {
        return Notifications.BackgroundNotificationTaskResult.Failed;
      }
    },
  );
}

function projectId(): string | null {
  const configured = process.env.EXPO_PUBLIC_WAFRA_PROJECT_ID;
  const fromBuild = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  const value = configured ?? fromBuild;
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

/**
 * Register or refresh the wake address. The Worker expires registrations
 * after 30 days, so this is safe to call on setup and each foreground launch.
 */
export async function enableRelayBackgroundSync(setupConfig?: RelayConfig): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  const cfg = setupConfig ?? (await getRelayConfig());
  const id = projectId();
  // A paired config is accepted only when setup explicitly passes it. Normal
  // foreground refreshes must not register a Shortcut the user never finished.
  if (!cfg || (!setupConfig && cfg.setupState === 'paired') || !id) return false;

  // Provisional counts, which is the whole point of the setup flow's quiet
  // permission request. See notificationsAllowed for what `granted` misses.
  if (!notificationsAllowed(await Notifications.getPermissionsAsync())) return false;

  await Notifications.registerTaskAsync(TASK_NAME);
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  await registerRelayPush(cfg, token, id);
  // This runs on every foreground launch, which makes it the one place that
  // reliably knows the user's language while a background wake never does.
  await refreshAlertLanguage().catch(() => {});
  return true;
}

export async function disableRelayBackgroundSync(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const cfg = await getRelayConfig();
  if (cfg) await unregisterRelayPush(cfg);
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (registered) await Notifications.unregisterTaskAsync(TASK_NAME);
}
