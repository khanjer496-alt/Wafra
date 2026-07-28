/**
 * The iOS half of capture.
 *
 * Android reads the inbox directly and never needs a network (src/lib/auto-import.ts).
 * iOS cannot: Apple gives no app access to SMS, and any capture that is not
 * user-initiated fails App Review. What iOS does allow is a Shortcuts personal
 * automation the USER creates — "when I get a message from ENBD, send it to
 * Wafra" — and a Shortcut can only make an HTTP request. So the message goes
 * to the relay (server/src/index.ts), which parses it, drops the text, seals
 * the parsed row to this device's public key, and holds it until the app
 * collects it.
 *
 * The device identity is a keypair this file generates and a bearer token the
 * relay issues once. Both live in expo-secure-store — the Keychain on iOS —
 * and the private half is never transmitted. There is no account, no email and
 * no password: losing the phone loses the queue, which is the correct outcome
 * for a service designed to hold nothing.
 *
 * Sync deliberately does not delete on read. Rows are acknowledged only after
 * the app has actually written them to the ledger, so a request that dies
 * mid-flight costs a retry rather than a transaction.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import type { ScannedSms } from '@/lib/auto-import';
import { openSealed, generateKeypair, type SealedBlob } from '@/lib/relay-crypto';
import type { ParsedSms } from '@/lib/sms-parser';

/** Where a build points when the user has not entered their own relay. */
export const DEFAULT_RELAY_URL = 'https://relay.wafra.app';

const KEY = 'wafra.relay.v1';
/** A phone on hotel wifi should fail fast and retry, not hang the sync. */
const TIMEOUT_MS = 15_000;
/** Matches the Worker's `LIMIT 200` page and its `/v1/ack` ceiling. */
const PAGE = 200;

export interface RelayConfig {
  baseUrl: string;
  deviceId: string;
  /** Bearer token. The Shortcut carries a copy of this. */
  token: string;
  /** base64 X25519 private key. Never leaves the device. */
  privateKey: string;
  /** The URL the user's Shortcut POSTs to. */
  ingestUrl: string;
  pairedAt: number;
}

/** iOS is the only platform that needs the relay; Android reads the inbox. */
export function isRelayPlatform(): boolean {
  return Platform.OS === 'ios';
}

export async function getRelayConfig(): Promise<RelayConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as RelayConfig;
    return cfg.token && cfg.privateKey && cfg.baseUrl ? cfg : null;
  } catch {
    // A Keychain read can fail on a locked device. Treat it as "not paired
    // yet" rather than throwing into whatever screen asked.
    return null;
  }
}

async function putRelayConfig(cfg: RelayConfig): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(cfg), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function request(url: string, init: RequestInit & { token?: string }): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.headers ?? {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        'content-type': 'application/json',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export class RelayError extends Error {
  constructor(
    message: string,
    /** True when retrying later is the right move (offline, 5xx, timeout). */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}

/**
 * Register this device and return the details the onboarding flow bakes into
 * the user's Shortcut. Safe to call again: a second pair issues a second
 * identity, so callers should check getRelayConfig() first.
 */
export async function pairDevice(baseUrl: string = DEFAULT_RELAY_URL): Promise<RelayConfig> {
  const base = baseUrl.replace(/\/+$/, '');
  const keys = generateKeypair();
  let res: Response;
  try {
    res = await request(`${base}/v1/pair`, {
      method: 'POST',
      body: JSON.stringify({ publicKey: keys.publicKey }),
    });
  } catch {
    throw new RelayError('Could not reach Wafra. Check your connection.', true);
  }
  if (!res.ok) {
    throw new RelayError(`Pairing failed (${res.status}).`, res.status >= 500);
  }
  const body = (await res.json()) as { deviceId?: string; token?: string; ingestUrl?: string };
  if (!body.deviceId || !body.token) {
    throw new RelayError('Pairing returned an unexpected response.', false);
  }
  const cfg: RelayConfig = {
    baseUrl: base,
    deviceId: body.deviceId,
    token: body.token,
    privateKey: keys.privateKey,
    ingestUrl: body.ingestUrl ?? `${base}/v1/ingest`,
    pairedAt: Date.now(),
  };
  await putRelayConfig(cfg);
  return cfg;
}

export interface RelaySyncResult {
  /** Parsed rows, oldest first, shaped exactly like an Android inbox scan. */
  parsed: ScannedSms[];
  /** Queue ids to acknowledge once the rows are safely in the ledger. */
  ids: string[];
  /** Rows the client could not open — a key mismatch, not a transient fault. */
  unreadable: number;
}

/**
 * Collect whatever the Shortcut has pushed since last time. Returns rows in
 * the same shape scanInbox() produces, so buildImportPlan() — deduplication,
 * card mapping, transfer detection, rescan healing — applies unchanged.
 */
export async function syncRelay(cfg: RelayConfig): Promise<RelaySyncResult> {
  let res: Response;
  try {
    res = await request(`${cfg.baseUrl}/v1/sync`, { method: 'GET', token: cfg.token });
  } catch {
    throw new RelayError('Could not reach Wafra.', true);
  }
  if (res.status === 401) throw new RelayError('This device is no longer paired.', false);
  if (!res.ok) throw new RelayError(`Sync failed (${res.status}).`, res.status >= 500);

  const body = (await res.json()) as { items?: (SealedBlob & { id: string })[] };
  const items = body.items ?? [];
  const parsed: ScannedSms[] = [];
  const ids: string[] = [];
  let unreadable = 0;

  for (const item of items) {
    let row: ParsedSms & { receivedAt?: string };
    try {
      row = openSealed<ParsedSms & { receivedAt?: string }>(cfg.privateKey, item);
    } catch {
      // Sealed to a previous identity — reinstalling the app makes a new
      // keypair and orphans anything still queued. Acknowledge it so the row
      // does not sit in the queue being retried until its TTL expires.
      unreadable += 1;
      ids.push(item.id);
      continue;
    }
    const ts = row.receivedAt ? Date.parse(row.receivedAt) : NaN;
    parsed.push({ ...row, smsTs: Number.isFinite(ts) ? ts : Date.now() });
    ids.push(item.id);
  }

  // Oldest first, the order buildImportPlan() expects so that account
  // auto-creation sees a card's earliest appearance first.
  parsed.sort((a, b) => (a.smsTs ?? 0) - (b.smsTs ?? 0));
  return { parsed, ids, unreadable };
}

/** Drop collected rows from the queue. Call only after they are persisted. */
export async function ackRelay(cfg: RelayConfig, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += PAGE) {
    const slice = ids.slice(i, i + PAGE);
    if (slice.length === 0) continue;
    const res = await request(`${cfg.baseUrl}/v1/ack`, {
      method: 'POST',
      token: cfg.token,
      body: JSON.stringify({ ids: slice }),
    });
    // An un-acked row is re-delivered and deduplicated by smsKey on the next
    // sync, so a failure here is not worth surfacing to the user.
    if (!res.ok && res.status !== 204) return;
  }
}

/**
 * Forget this device, server-side and locally. The queue goes with it; so does
 * the public key, so anything the Shortcut sends afterwards is rejected.
 */
export async function unpairDevice(cfg: RelayConfig): Promise<void> {
  try {
    await request(`${cfg.baseUrl}/v1/device`, { method: 'DELETE', token: cfg.token });
  } catch {
    // Deleting locally is the part the user asked for and can see. A relay
    // that never hears about it drops the device after a year of silence.
  }
  await SecureStore.deleteItemAsync(KEY);
}

/** Liveness probe for the "send a test message" onboarding step. */
export async function relayHealthy(baseUrl: string = DEFAULT_RELAY_URL): Promise<boolean> {
  try {
    const res = await request(`${baseUrl.replace(/\/+$/, '')}/v1/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
