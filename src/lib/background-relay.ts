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
/**
 * How full the staged inbox may get before a background wake stops draining
 * the relay. A ceiling on what a wake is asked to read and rewrite — NOT a
 * count of rows we are willing to throw away. See `syncRelayInBackground`.
 */
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
 * Nothing handed to this function is ever discarded. It used to keep the newest
 * MAX_LOCAL_ROWS and drop the rest — see `syncRelayInBackground` for why that
 * deleted the user's transactions from the relay and the phone at once.
 */
async function appendDurable(rows: ScannedSms[]): Promise<void> {
  if (rows.length === 0) return;
  const existing = parseQueue(await backgroundRelayStorage.getItem(QUEUE_KEY));
  const merged = new Map(existing.map((row) => [rowKey(row), row]));
  for (const row of rows) merged.set(rowKey(row), row);
  const value = [...merged.values()].sort((a, b) => (a.smsTs ?? 0) - (b.smsTs ?? 0));
  await backgroundRelayStorage.setItem(QUEUE_KEY, JSON.stringify(value));
}

export async function readBackgroundRelayRows(): Promise<ScannedSms[]> {
  return parseQueue(await backgroundRelayStorage.getItem(QUEUE_KEY));
}

/** Call only after StoreProvider has durably written the imported ledger. */
export async function clearBackgroundRelayRows(): Promise<void> {
  await backgroundRelayStorage.removeItem(QUEUE_KEY);
}

/**
 * The local inbox is bounded by not COLLECTING, never by discarding.
 *
 * What this used to do: `appendDurable` merged the incoming rows, kept the
 * newest 1,000 and dropped the oldest, and then this function acknowledged
 * every id the sync returned. An id acknowledged here is DELETED from the relay
 * queue. So each row the slice discarded was gone from the device and gone from
 * the server in the same wake — permanent, silent loss of the user's
 * transactions, arriving exactly when there was a backlog to lose.
 *
 * Three repairs were available and two of them have holes:
 *
 *   - Remove the cap. The table then grows without limit, and every wake
 *     re-reads, re-merges, re-serialises and rewrites the WHOLE blob through
 *     SQLCipher inside iOS's hard background time budget. A wake killed
 *     part-way through commits nothing, so past some size the inbox stops
 *     making progress and stays stuck — with the battery cost of trying.
 *   - Acknowledge only the rows that survived the merge. `syncRelay` returns
 *     `parsed` sorted independently of `ids`, and `ids` also covers probe and
 *     unreadable rows that produce no row at all, so there is no row→queue-id
 *     map to filter by; building one would still leave rows dropped locally.
 *   - Stop draining while the inbox is full. Chosen.
 *
 * A wake that finds a full inbox does not sync at all. It collects nothing, so
 * it acknowledges nothing, so the rows stay in the relay queue under the
 * server's own 30-day retention — the retention the privacy policy states — and
 * the next foreground import empties the inbox and lets collection resume.
 * "A row is never acknowledged unless it is durably stored" is then true by
 * construction rather than by bookkeeping, and the work each wake does is
 * bounded. The inbox can overshoot MAX_LOCAL_ROWS by at most the one sync page
 * that was already in flight, which is the point: overshooting is cheap,
 * dropping is not.
 */
export async function syncRelayInBackground(): Promise<number> {
  const cfg = await getBackgroundRelayConfig();
  if (!cfg || cfg.setupState === 'paired') return 0;
  // Checked BEFORE the sync, not after it: a row this wake pulls down is a row
  // the server is waiting to be told about, and the only way to be sure we
  // never tell it about a row we did not keep is to not pull the row.
  if ((await readBackgroundRelayRows()).length >= MAX_LOCAL_ROWS) return 0;
  const { parsed, ids, testIds } = await syncRelay(cfg);
  await appendDurable(parsed);
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

  const permission = await Notifications.getPermissionsAsync();
  const allowed =
    permission.granted ||
    permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!allowed) return false;

  await Notifications.registerTaskAsync(TASK_NAME);
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  await registerRelayPush(cfg, token, id);
  return true;
}

export async function disableRelayBackgroundSync(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const cfg = await getRelayConfig();
  if (cfg) await unregisterRelayPush(cfg);
  const registered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (registered) await Notifications.unregisterTaskAsync(TASK_NAME);
}
