/**
 * iOS capture.
 *
 * iOS gives no app any access to SMS, so the Android design — scan the inbox
 * on-device, never touch the network — cannot exist on iPhone. What iOS does
 * allow is a Shortcuts personal automation the user builds themselves: "when I
 * get a message from my bank, send it to Wafra". A Shortcut cannot hand data
 * to a sleeping app; it can only make an HTTP request. That is the entire
 * reason `server/` exists, and this is the phone side of it.
 *
 * What crosses the network is one bank message at a time, from the Shortcut
 * straight to the Worker. The Worker parses it, drops the text, and seals the
 * parsed row to this device's public key. This file collects those rows,
 * opens them, and hands them to the SAME `buildImportPlan` the Android scan
 * uses — there is one import path, and iOS is a different way of filling it.
 *
 * The private key never leaves the keychain and is never sent anywhere; the
 * Worker only ever sees the public half. Losing the phone loses the queue,
 * which is the correct outcome for a service designed to hold nothing.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { toISODate } from '@/lib/format';
import { b64decode, b64encode, open, publicKeyFor, type SealedBlob } from '@/lib/relay-crypto';
import type { ParsedSms } from '@/lib/sms-parser';
import type { CategoryId } from '@/lib/types';

/**
 * Where the Worker lives. Set at build time, per profile, in eas.json — it is
 * not a secret (the bearer token is what protects a queue), but it is
 * deployment-specific, so it must never be hardcoded here.
 */
const BASE_URL = (process.env.EXPO_PUBLIC_WAFRA_RELAY_URL ?? '').replace(/\/+$/, '');

const KEY_PRIVATE = 'wafra.relay.privateKey';
const KEY_TOKEN = 'wafra.relay.token';
const KEY_DEVICE = 'wafra.relay.deviceId';

/** One sync pulls at most this many rows; the Worker caps at 200 as well. */
const SYNC_LIMIT = 200;
const TIMEOUT_MS = 15_000;

export interface Pairing {
  deviceId: string;
  /** Bearer token. Shown once on the pairing screen so it can be pasted into the Shortcut. */
  token: string;
  /** The URL the Shortcut posts to. */
  ingestUrl: string;
}

/** The shape the Worker seals: a parsed row with the raw message removed. */
type RelayRow = Omit<ParsedSms, 'raw'> & { receivedAt?: string; sender?: string };

export type RelaySms = ParsedSms & { smsTs?: number; sender?: string };

/**
 * True where the relay can work at all. Android has the inbox and needs none
 * of this; web has no Shortcuts.
 *
 * The placeholder check is not paranoia: eas.json ships REPLACE-ME so that
 * forgetting to point a build at a Worker is visible. Without it the build
 * would look configured and fail on the first request with a DNS error, which
 * reads to the user as "this feature is broken" rather than "this build was
 * never set up".
 */
export function isRelayConfigured(): boolean {
  return BASE_URL.length > 0 && !BASE_URL.includes('REPLACE-ME');
}

export function isRelayAvailable(): boolean {
  return Platform.OS === 'ios' && isRelayConfigured();
}

export function relayBaseUrl(): string {
  return BASE_URL;
}

async function readSecret(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    // A locked or unavailable keychain reads as "not paired" rather than
    // throwing through the caller — the app has to keep working either way.
    return null;
  }
}

/** The stored pairing, or null if this device has never paired. */
export async function getPairing(): Promise<Pairing | null> {
  if (!isRelayAvailable()) return null;
  const [deviceId, token] = await Promise.all([readSecret(KEY_DEVICE), readSecret(KEY_TOKEN)]);
  if (!deviceId || !token) return null;
  return { deviceId, token, ingestUrl: `${BASE_URL}/v1/ingest` };
}

async function request(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const { token, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...rest.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate this device's key and register the public half.
 *
 * Randomness comes from expo-crypto rather than @noble's own helper: that
 * helper reaches for a global `crypto.getRandomValues` which Hermes does not
 * provide, and a key generated from a weak source would be undetectable from
 * the outside and catastrophic.
 */
export async function pair(): Promise<Pairing> {
  if (!isRelayAvailable()) throw new Error('relay_unavailable');
  const existing = await getPairing();
  if (existing) return existing;

  const privateKey = Crypto.getRandomBytes(32);
  const publicKey = b64encode(publicKeyFor(privateKey));

  const res = await request('/v1/pair', {
    method: 'POST',
    body: JSON.stringify({ publicKey }),
  });
  if (!res.ok) throw new Error(`pair_failed_${res.status}`);
  const body = (await res.json()) as Partial<Pairing>;
  if (!body.deviceId || !body.token) throw new Error('pair_malformed');

  // The key is written first: a token stored without the key that opens its
  // rows would leave the device collecting ciphertext it can never read.
  await SecureStore.setItemAsync(KEY_PRIVATE, b64encode(privateKey));
  await SecureStore.setItemAsync(KEY_DEVICE, body.deviceId);
  await SecureStore.setItemAsync(KEY_TOKEN, body.token);

  return { deviceId: body.deviceId, token: body.token, ingestUrl: `${BASE_URL}/v1/ingest` };
}

/** Forget this device here and on the Worker. Best-effort remotely, certain locally. */
export async function unpair(): Promise<void> {
  const pairing = await getPairing();
  if (pairing) {
    try {
      await request('/v1/device', { method: 'DELETE', token: pairing.token });
    } catch {
      // The queue expires on its own within 72 hours and the device row within
      // a year. Local erasure is what the user actually asked for, so it
      // happens whether or not the network cooperated.
    }
  }
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_PRIVATE).catch(() => {}),
    SecureStore.deleteItemAsync(KEY_TOKEN).catch(() => {}),
    SecureStore.deleteItemAsync(KEY_DEVICE).catch(() => {}),
  ]);
}

const CATEGORY_FALLBACK: CategoryId = 'other';

/** The rows come from our own Worker, but they are still parsed JSON. Check before trusting. */
function asRelayRow(value: unknown): RelayRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.amountFils !== 'number' || !Number.isFinite(r.amountFils)) return null;
  if (typeof r.merchant !== 'string' || !r.merchant) return null;
  if (r.kind !== 'transaction' && r.kind !== 'billDue' && r.kind !== 'cardStatement' && r.kind !== 'cardPayment') {
    return null;
  }
  if (r.type !== 'expense' && r.type !== 'income') return null;
  return value as RelayRow;
}

export interface RelayPull {
  parsed: RelaySms[];
  /** Ids to acknowledge once the rows are safely in the ledger. */
  ids: string[];
}

/**
 * Collect and open whatever the Worker is holding.
 *
 * Nothing is acknowledged here. Rows are deleted only after `importBatch` has
 * committed them, so a crash between the two costs a duplicate sync, not a
 * lost transaction.
 */
export async function pullRelay(overrides: Record<string, CategoryId> = {}): Promise<RelayPull> {
  const pairing = await getPairing();
  if (!pairing) return { parsed: [], ids: [] };
  const privateKeyB64 = await readSecret(KEY_PRIVATE);
  if (!privateKeyB64) return { parsed: [], ids: [] };
  const privateKey = b64decode(privateKeyB64);

  const res = await request('/v1/sync', { method: 'GET', token: pairing.token });
  if (!res.ok) throw new Error(`sync_failed_${res.status}`);
  const body = (await res.json()) as { items?: (SealedBlob & { id: string })[] };
  const items = (body.items ?? []).slice(0, SYNC_LIMIT);

  const parsed: RelaySms[] = [];
  const ids: string[] = [];
  for (const item of items) {
    let row: RelayRow | null;
    try {
      row = asRelayRow(open(privateKey, item));
    } catch {
      // Sealed to a previous installation of the app, or corrupted. It can
      // never be opened, so acknowledge it — leaving it would wedge every
      // future sync behind a row that will never succeed.
      ids.push(item.id);
      continue;
    }
    if (!row) {
      ids.push(item.id);
      continue;
    }
    const receivedTs = row.receivedAt ? Date.parse(row.receivedAt) : NaN;
    const smsTs = Number.isFinite(receivedTs) ? receivedTs : Date.now();
    parsed.push({
      ...row,
      // The Worker never stores the message, so there is no raw text to carry.
      // That costs the "unrecognised format" report on iOS and nothing else.
      raw: '',
      date: row.date ?? toISODate(new Date(smsTs)),
      categoryGuess: overrides[row.merchant.toLowerCase()] ?? row.categoryGuess ?? CATEGORY_FALLBACK,
      smsTs,
      sender: row.sender,
    });
    ids.push(item.id);
  }

  // Oldest first, matching the inbox scan, so account auto-creation sees the
  // earliest occurrence of a card first.
  parsed.sort((a, b) => (a.smsTs ?? 0) - (b.smsTs ?? 0));
  return { parsed, ids };
}

/** Delete collected rows from the Worker. Called only after they are committed. */
export async function ackRelay(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const pairing = await getPairing();
  if (!pairing) return;
  await request('/v1/ack', {
    method: 'POST',
    token: pairing.token,
    body: JSON.stringify({ ids: ids.slice(0, SYNC_LIMIT) }),
  });
}

/** Cheap reachability check for the pairing screen. */
export async function relayHealthy(): Promise<boolean> {
  if (!isRelayAvailable()) return false;
  try {
    const res = await request('/v1/health', { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
