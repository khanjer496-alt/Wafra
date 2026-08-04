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

/** Persist before ack: a killed background task causes a retry, never loss. */
async function appendDurable(rows: ScannedSms[]): Promise<void> {
  if (rows.length === 0) return;
  const existing = parseQueue(await backgroundRelayStorage.getItem(QUEUE_KEY));
  const merged = new Map(existing.map((row) => [rowKey(row), row]));
  for (const row of rows) merged.set(rowKey(row), row);
  const value = [...merged.values()]
    .sort((a, b) => (a.smsTs ?? 0) - (b.smsTs ?? 0))
    .slice(-MAX_LOCAL_ROWS);
  await backgroundRelayStorage.setItem(QUEUE_KEY, JSON.stringify(value));
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
