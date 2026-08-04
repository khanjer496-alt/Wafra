/**
 * The iOS relay client.
 *
 * Android reads SMS on-device and never touches the network. iOS cannot: Apple
 * gives no app access to messages, so the only path is a Shortcuts personal
 * automation the user builds, which POSTs each bank message to the relay
 * (server/). The relay parses it, drops the text, and queues the parsed row
 * SEALED to this device's public key. This file is the other end of that: it
 * generates the keypair, pairs, collects the sealed rows, opens them, and
 * hands them to the app's existing importer.
 *
 * Four things here are load-bearing and easy to get wrong:
 *
 * 1. THE SECRET KEY IS REUSED ACROSS REINSTALLS, deliberately. On iOS a
 *    keychain item survives app deletion, and the bearer token also lives
 *    inside the user's Shortcut, which uninstalling does not touch. If a
 *    reinstall minted a fresh keypair and re-paired, the Shortcut would keep
 *    POSTing under the old token: capture would be dead while the app looked
 *    perfectly healthy. `pairRelay` therefore reuses whatever is in the
 *    keychain and only mints a key when there is none.
 *
 * 2. THE KEYCHAIN ITEM MUST BE READABLE WHILE THE PHONE IS LOCKED. The
 *    expo-secure-store default is WHEN_UNLOCKED, and a sync that fires while
 *    the phone is in a pocket is nearly every sync. Under the default it would
 *    fail silently — no crash, no log, just a ledger that is always stale.
 *
 * 3. BACKGROUND SYNC MUST NOT WRITE THE LEDGER. `importBatch` is a method on
 *    the React store, and persistence runs in a `useEffect` inside
 *    StoreProvider with an in-memory chunk cache. Anything that writes
 *    `wafra/state/v1` behind the provider's back is overwritten on the next
 *    foreground save. So `syncRelay` only STAGES rows; `runRelayImport` is the
 *    foreground half that imports and acknowledges.
 *
 * 4. ACK ONLY AFTER THE LEDGER COMMIT. The relay deletes on acknowledgement
 *    rather than on read precisely so a crash between the two costs nothing:
 *    the row is still in the queue for 72 hours and the next sync fetches it
 *    again. Acking early is the one way to actually lose a transaction.
 *
 * There is no second ingestion path. Rows go through the same
 * `buildImportPlan` → `importBatch` pipeline as an Android inbox scan, so
 * every dedupe, healing and account-auto-creation rule applies unchanged.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { buildImportPlan, type ImportPlan, type ScannedSms } from '@/lib/auto-import';
import { toISODate } from '@/lib/format';
import { deviceKeypair, encodeKey, decodeKey, openSealed, type SealedBlob } from '@/lib/relay-crypto';
import { isProActive } from '@/lib/purchases';
import type { ParsedSms } from '@/lib/sms-parser';
import type { ImportBatchInput } from '@/lib/store';
import type { AppState } from '@/lib/types';

/* ─────────────────────────── Storage keys ─────────────────────────── */

/** One keychain item holds the whole pairing: ~200 bytes, one read per sync. */
const SECURE_KEY = 'wafra.relay.v1';
const KEYCHAIN_SERVICE = 'app.wafra.relay';
/** Staging area between a background fetch and a foreground ledger write. */
const INBOX_KEY = 'wafra/relay/inbox/v1';

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: KEYCHAIN_SERVICE,
  // See note 2 above. Without this, background sync cannot read the key.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  // `true` would demand Face ID from a headless task, which cannot present UI.
  // The app-lock feature (expo-local-authentication) is entirely separate.
  requireAuthentication: false,
};

/** How many message digests to remember for duplicate suppression. */
const SEEN_MSG_LIMIT = 500;
/** Network calls are bounded so a hung relay cannot wedge a background task. */
const REQUEST_TIMEOUT_MS = 15_000;
/** A relay row can only be acked in batches this size — matches the server. */
const ACK_LIMIT = 200;

/* ─────────────────────────── Shapes ─────────────────────────── */

/** What the keychain holds. Everything but `sk` is safe to show the user. */
interface StoredIdentity {
  v: 1;
  /** X25519 secret key, base64. Never sent, never logged, never exported. */
  sk: string;
  token: string;
  deviceId: string;
  ingestUrl: string;
  /** Base URL this device paired against; sync must use it, not current config. */
  baseUrl: string;
  market: string;
  pairedAt: number;
}

/** The public half of a pairing — what a setup screen may display. */
export interface RelayPairing {
  deviceId: string;
  /** Goes into the user's Shortcut. A live credential: do not log it. */
  token: string;
  ingestUrl: string;
  baseUrl: string;
  market: string;
  pairedAt: number;
}

/**
 * A parsed row as the relay seals it: the app's own `ParsedSms` minus `raw`
 * (the message text is dropped server-side and never sent back), plus the
 * attribution and dedupe fields the relay adds.
 */
export interface SealedRow extends Omit<ParsedSms, 'raw'> {
  /** SMS sender id — the only thing that says which bank sent the message. */
  sender?: string;
  /** Message timestamp in epoch ms, from the Shortcut. */
  smsTs: number;
  receivedAt: string;
  /** SHA-256 of the message text, base64url. Stable across Shortcut retries. */
  msgId: string;
  market: string;
}

interface StagedRow {
  /** Queue id, for the ack. */
  id: string;
  row: SealedRow;
}

interface Inbox {
  v: 1;
  rows: StagedRow[];
  /** Digests already staged or imported, newest last. */
  seen: string[];
  /** Queue ids that could never be opened; acked so they stop re-downloading. */
  unopenable: string[];
  lastSyncAt: number;
  lastRowAt: number;
  lastError: string | null;
}

const EMPTY_INBOX: Inbox = {
  v: 1,
  rows: [],
  seen: [],
  unopenable: [],
  lastSyncAt: 0,
  lastRowAt: 0,
  lastError: null,
};

export interface RelaySyncResult {
  /** Rows newly staged for the foreground to import. */
  staged: number;
  /** Rows the queue held that were already known (a Shortcut that fired twice). */
  duplicates: number;
  /** Rows that could not be opened — a key mismatch, and permanent. */
  unopenable: number;
  /** Total rows waiting for the foreground after this sync. */
  pending: number;
  error: string | null;
}

export interface RelayImportResult {
  /** Why nothing happened, when nothing happened. */
  skipped: 'unsupported' | 'not-paired' | 'not-pro' | null;
  sync: RelaySyncResult | null;
  plan: ImportPlan | null;
  /** Transaction ids created, for the undo affordance. */
  ids: string[];
  acked: number;
}

export interface RelayStatus {
  supported: boolean;
  paired: boolean;
  deviceId: string | null;
  market: string | null;
  pairedAt: number | null;
  /** Rows sitting in staging, waiting for a foreground import. */
  pending: number;
  lastSyncAt: number;
  /** When the newest captured message arrived, per its own timestamp. */
  lastRowAt: number;
  lastError: string | null;
  /**
   * The automation looks broken: paired long enough that a real user would
   * have spent money, synced successfully, and still nothing has ever arrived.
   * This is what a "your automation may still be asking before it runs" repair
   * card hangs off — the silent failure mode of Shortcuts is a run mode left on
   * "Run After Confirmation", and nothing else signals it.
   */
  looksUnconfigured: boolean;
}

/** After this long with a healthy sync and zero rows, the setup is suspect. */
const UNCONFIGURED_AFTER_MS = 48 * 3_600_000;

/* ─────────────────────────── Platform gate ─────────────────────────── */

/**
 * The relay exists for iOS and only for iOS. Android reads SMS natively and
 * must keep its no-server promise; web has no expo-secure-store at all, and
 * this project builds web.
 */
export function isRelaySupported(): boolean {
  return Platform.OS === 'ios';
}

/**
 * The relay base URL from app config (`expo.extra.relayUrl`). Absent in a
 * checkout that has not been pointed at a deployment — pairing then has to be
 * given one explicitly rather than guessing a hostname.
 */
export function configuredRelayUrl(): string | null {
  const extra = Constants.expoConfig?.extra as { relayUrl?: unknown } | undefined;
  const url = typeof extra?.relayUrl === 'string' ? extra.relayUrl.trim() : '';
  return url ? url.replace(/\/+$/, '') : null;
}

/* ─────────────────────────── Identity ─────────────────────────── */

async function readIdentity(): Promise<StoredIdentity | null> {
  if (!isRelaySupported()) return null;
  try {
    const raw = await SecureStore.getItemAsync(SECURE_KEY, SECURE_OPTIONS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIdentity;
    if (parsed?.v !== 1 || !parsed.sk || !parsed.token || !parsed.baseUrl) return null;
    return parsed;
  } catch {
    // A keychain read can fail legitimately — first launch after a restore,
    // or a locked device under the wrong accessibility class. Treat it as
    // "not paired" rather than throwing into a background task.
    return null;
  }
}

async function writeIdentity(identity: StoredIdentity): Promise<void> {
  await SecureStore.setItemAsync(SECURE_KEY, JSON.stringify(identity), SECURE_OPTIONS);
}

/** The pairing without the secret key, for the UI. */
export async function getRelayPairing(): Promise<RelayPairing | null> {
  const id = await readIdentity();
  if (!id) return null;
  const { sk: _sk, v: _v, ...rest } = id;
  return rest;
}

/* ─────────────────────────── HTTP ─────────────────────────── */

async function relayFetch(
  baseUrl: string,
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<Response> {
  const { token, headers, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(rest.body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────── Pairing ─────────────────────────── */

export interface PairOptions {
  /** Relay base URL, e.g. https://wafra-relay.example.workers.dev */
  baseUrl?: string;
  /** Market pack the relay should parse this device's messages under. */
  market: string;
}

/**
 * Pair this device, or return the existing pairing unchanged.
 *
 * Re-pairing is never automatic: it would orphan the token baked into the
 * user's Shortcut. `unpairRelay` is the only way to get a new one, and it is
 * the user's explicit choice with an explicit warning.
 */
export async function pairRelay(options: PairOptions): Promise<RelayPairing> {
  if (!isRelaySupported()) throw new Error('relay: iOS only');
  const existing = await readIdentity();
  if (existing) {
    // Already paired. Keep the key, keep the token, just make sure the relay
    // knows which market pack to parse under if that changed since.
    if (existing.market !== options.market) {
      await setRelayMarket(options.market);
      return (await getRelayPairing())!;
    }
    const { sk: _sk, v: _v, ...rest } = existing;
    return rest;
  }

  const baseUrl = (options.baseUrl ?? configuredRelayUrl() ?? '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('relay: no relay URL configured (expo.extra.relayUrl)');

  // The one place entropy is needed. React Native defines no
  // `crypto.getRandomValues`, so noble's own key generation throws — this is
  // why the whole crypto path takes its randomness as an argument instead of
  // reaching for a global, and why this app needs no crypto polyfill.
  const keypair = deviceKeypair(Crypto.getRandomValues(new Uint8Array(32)));

  const res = await relayFetch(baseUrl, '/v1/pair', {
    method: 'POST',
    body: JSON.stringify({ publicKey: encodeKey(keypair.publicKey), market: options.market }),
  });
  if (!res.ok) throw new Error(`relay: pairing failed (${res.status})`);
  const body = (await res.json()) as {
    deviceId?: string;
    token?: string;
    ingestUrl?: string;
    market?: string;
  };
  if (!body?.deviceId || !body?.token || !body?.ingestUrl) {
    throw new Error('relay: pairing response was incomplete');
  }

  const identity: StoredIdentity = {
    v: 1,
    sk: encodeKey(keypair.secretKey),
    token: body.token,
    deviceId: body.deviceId,
    ingestUrl: body.ingestUrl,
    baseUrl,
    market: body.market ?? options.market,
    pairedAt: Date.now(),
  };
  await writeIdentity(identity);
  await writeInbox({ ...EMPTY_INBOX });
  const { sk: _sk, v: _v, ...rest } = identity;
  return rest;
}

/**
 * Tell the relay which market pack to parse under. Separate from pairing
 * because re-pairing would invalidate the token inside the user's Shortcut.
 */
export async function setRelayMarket(market: string): Promise<boolean> {
  const id = await readIdentity();
  if (!id) return false;
  const res = await relayFetch(id.baseUrl, '/v1/device', {
    method: 'PATCH',
    token: id.token,
    body: JSON.stringify({ market }),
  });
  if (!res.ok) return false;
  await writeIdentity({ ...id, market });
  return true;
}

/**
 * Unpair: the relay erases the device and its queue, and the local key goes
 * with it. The caller MUST tell the user that their Shortcut has stopped
 * working — the token is baked into it and nothing in the app can reach in and
 * fix it.
 */
export async function unpairRelay(): Promise<void> {
  const id = await readIdentity();
  if (id) {
    try {
      await relayFetch(id.baseUrl, '/v1/device', { method: 'DELETE', token: id.token });
    } catch {
      // The server may be unreachable. Local state still goes: leaving a key
      // behind that the user asked to delete is the worse failure, and the
      // device row expires server-side on its own.
    }
  }
  await SecureStore.deleteItemAsync(SECURE_KEY, SECURE_OPTIONS).catch(() => {});
  await AsyncStorage.removeItem(INBOX_KEY).catch(() => {});
}

/* ─────────────────────────── Staging ─────────────────────────── */

async function readInbox(): Promise<Inbox> {
  try {
    const raw = await AsyncStorage.getItem(INBOX_KEY);
    if (!raw) return { ...EMPTY_INBOX };
    const parsed = JSON.parse(raw) as Inbox;
    if (parsed?.v !== 1 || !Array.isArray(parsed.rows)) return { ...EMPTY_INBOX };
    return {
      ...EMPTY_INBOX,
      ...parsed,
      seen: Array.isArray(parsed.seen) ? parsed.seen : [],
      unopenable: Array.isArray(parsed.unopenable) ? parsed.unopenable : [],
    };
  } catch {
    return { ...EMPTY_INBOX };
  }
}

async function writeInbox(inbox: Inbox): Promise<void> {
  await AsyncStorage.setItem(INBOX_KEY, JSON.stringify(inbox));
}

/**
 * The blob is authenticated — GCM proves the relay sealed it to this device —
 * but "authentic" is not "well-formed". A future server version, or a row
 * sealed by an older one, must not be able to put a NaN amount or a missing
 * kind into the ledger, so the shape is checked before anything is staged.
 */
function isSealedRow(value: unknown): value is SealedRow {
  const r = value as SealedRow | null;
  return (
    !!r &&
    typeof r === 'object' &&
    typeof r.merchant === 'string' &&
    Number.isFinite(r.amountFils) &&
    (r.kind === 'transaction' ||
      r.kind === 'billDue' ||
      r.kind === 'cardStatement' ||
      r.kind === 'cardPayment') &&
    (r.type === 'expense' || r.type === 'income') &&
    typeof r.msgId === 'string' &&
    Number.isFinite(r.smsTs)
  );
}

/**
 * Collect the queue, open every row, stage what is new. Safe to call from a
 * headless background task: it writes only its own staging key and never
 * touches the ledger (see note 3 at the top of this file).
 */
export async function syncRelay(): Promise<RelaySyncResult> {
  const empty: RelaySyncResult = {
    staged: 0,
    duplicates: 0,
    unopenable: 0,
    pending: 0,
    error: null,
  };
  const id = await readIdentity();
  if (!id) return { ...empty, error: 'not-paired' };

  const inbox = await readInbox();
  let items: { id: string; epk: string; iv: string; ct: string }[] = [];
  try {
    const res = await relayFetch(id.baseUrl, '/v1/sync', { method: 'GET', token: id.token });
    if (res.status === 401) {
      // The relay no longer knows this device — swept after a year silent, or
      // unpaired from another install. Surfacing it is the only way the user
      // learns their Shortcut is now posting into nothing.
      const next = { ...inbox, lastSyncAt: Date.now(), lastError: 'unauthorized' };
      await writeInbox(next);
      return { ...empty, pending: inbox.rows.length, error: 'unauthorized' };
    }
    if (!res.ok) throw new Error(`sync failed (${res.status})`);
    const body = (await res.json()) as { items?: typeof items };
    items = Array.isArray(body?.items) ? body.items : [];
  } catch (e) {
    const message = e instanceof Error ? e.message : 'network';
    await writeInbox({ ...inbox, lastError: message });
    return { ...empty, pending: inbox.rows.length, error: message };
  }

  const secretKey = decodeKey(id.sk);
  const seen = new Set(inbox.seen);
  const stagedIds = new Set(inbox.rows.map((r) => r.id));
  const fresh: StagedRow[] = [];
  const badIds: string[] = [];
  let duplicates = 0;
  let lastRowAt = inbox.lastRowAt;

  for (const item of items) {
    if (stagedIds.has(item.id)) continue;
    let row: unknown;
    try {
      row = openSealed<SealedRow>(secretKey, item as SealedBlob);
    } catch {
      // A row sealed to a key this device does not have can never become
      // readable. Counting and acking it is the only way it stops being
      // re-downloaded on every sync for the next three days.
      badIds.push(item.id);
      continue;
    }
    if (!isSealedRow(row)) {
      badIds.push(item.id);
      continue;
    }
    // The message digest survives a Shortcut retry with a drifted clock, which
    // the timestamp fingerprint downstream does not.
    if (seen.has(row.msgId)) {
      duplicates += 1;
      badIds.push(item.id);
      continue;
    }
    seen.add(row.msgId);
    fresh.push({ id: item.id, row });
    if (row.smsTs > lastRowAt) lastRowAt = row.smsTs;
  }

  const next: Inbox = {
    ...inbox,
    rows: [...inbox.rows, ...fresh],
    seen: [...seen].slice(-SEEN_MSG_LIMIT),
    unopenable: [...new Set([...inbox.unopenable, ...badIds])].slice(-ACK_LIMIT),
    lastSyncAt: Date.now(),
    lastRowAt,
    lastError: null,
  };
  await writeInbox(next);
  return {
    staged: fresh.length,
    duplicates,
    unopenable: badIds.length - duplicates,
    pending: next.rows.length,
    error: null,
  };
}

/** Sealed rows become exactly the shape an Android inbox scan produces. */
function toScanned(rows: StagedRow[]): ScannedSms[] {
  return rows
    .map(({ row }) => ({
      ...row,
      // The relay never sends message text — that is the whole point — so the
      // "report an unrecognised format" affordance has nothing to attach. An
      // empty string is honest; a placeholder would show up in the UI.
      raw: '',
      date: row.date ?? toISODate(new Date(row.smsTs)),
      smsTs: row.smsTs,
      sender: row.sender,
    }))
    .sort((a, b) => a.smsTs - b.smsTs);
}

async function ackRows(id: StoredIdentity, ids: string[]): Promise<number> {
  let acked = 0;
  for (let i = 0; i < ids.length; i += ACK_LIMIT) {
    const chunk = ids.slice(i, i + ACK_LIMIT);
    const res = await relayFetch(id.baseUrl, '/v1/ack', {
      method: 'POST',
      token: id.token,
      body: JSON.stringify({ ids: chunk }),
    });
    if (!res.ok) break;
    acked += chunk.length;
  }
  return acked;
}

/**
 * The foreground half: sync, import through the app's own pipeline, and only
 * then acknowledge. Call it on hydrate, on background→active, and on
 * pull-to-refresh — the same places the Android auto-import runs.
 */
export async function runRelayImport(
  state: AppState,
  importBatch: (input: ImportBatchInput) => string[],
  today: Date = new Date(),
): Promise<RelayImportResult> {
  const base: RelayImportResult = { skipped: null, sync: null, plan: null, ids: [], acked: 0 };
  if (!isRelaySupported()) return { ...base, skipped: 'unsupported' };
  const id = await readIdentity();
  if (!id) return { ...base, skipped: 'not-paired' };
  // Syncing for a lapsed subscriber is a bug, not a courtesy: automatic
  // capture is the paid feature, and the same gate guards the Android scan.
  if (!isProActive(state)) return { ...base, skipped: 'not-pro' };

  const sync = await syncRelay();
  const inbox = await readInbox();
  if (inbox.rows.length === 0 && inbox.unopenable.length === 0) {
    return { ...base, sync };
  }

  const parsed = toScanned(inbox.rows);
  // `lastScanTs` belongs to the Android inbox cursor; the relay has its own
  // queue and must not move it, or the next SMS scan would skip history.
  const plan = buildImportPlan(parsed, state, state.lastScanTs, today);
  const ids = plan.txCount || plan.newAccountCount || plan.dueCount || plan.healedCount
    ? importBatch({ ...plan.batch, lastScanTs: state.lastScanTs })
    : [];

  // Ledger is committed; only now is it safe to let the relay forget.
  const acked = await ackRows(id, [...inbox.rows.map((r) => r.id), ...inbox.unopenable]);
  await writeInbox({ ...inbox, rows: [], unopenable: [] });

  return { skipped: null, sync, plan, ids, acked };
}

/** Everything the UI needs to say whether capture is working. */
export async function relayStatus(now: number = Date.now()): Promise<RelayStatus> {
  const supported = isRelaySupported();
  const id = supported ? await readIdentity() : null;
  const inbox = await readInbox();
  const pairedFor = id ? now - id.pairedAt : 0;
  return {
    supported,
    paired: !!id,
    deviceId: id?.deviceId ?? null,
    market: id?.market ?? null,
    pairedAt: id?.pairedAt ?? null,
    pending: inbox.rows.length,
    lastSyncAt: inbox.lastSyncAt,
    lastRowAt: inbox.lastRowAt,
    lastError: inbox.lastError,
    looksUnconfigured:
      !!id &&
      pairedFor > UNCONFIGURED_AFTER_MS &&
      inbox.lastSyncAt > 0 &&
      inbox.lastError === null &&
      inbox.lastRowAt === 0,
  };
}
