/**
 * The iOS half of automatic capture.
 *
 * On Android the app reads the SMS inbox itself and never touches a network.
 * iOS gives an app no access to messages at all, so the same feature has to be
 * assembled out of the one thing iOS does allow: a Shortcuts personal
 * automation the USER creates, which can make an HTTP request and nothing else.
 * It POSTs each bank message to the relay (server/), which parses it, throws
 * the text away, and leaves the parsed row sealed to this device. This file is
 * the device end of that: pair, poll, unseal, hand the rows to the caller, and
 * only then tell the relay it can delete them.
 *
 * What comes out of `syncRelay` is deliberately `ScannedSms` — exactly what
 * scanInbox produces on Android — so iOS feeds buildImportPlan through the same
 * dedupe, account-matching and healing logic rather than a parallel path that
 * would drift out of agreement with it within a release or two.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { ScannedSms } from '@/lib/auto-import';
import { toISODate } from '@/lib/format';
import { keypairFromSeed, open, RELAY_KEY_BYTES } from '@/lib/relay-crypto';
import type { SealedBlob } from '@/lib/relay-crypto';
import type { CategoryId, TransactionType } from '@/lib/types';

/**
 * Where the relay lives. `wrangler deploy` prints the real hostname (see
 * server/README.md) and this constant is the single line to change for it —
 * self-hosting is a supported outcome for a service whose whole claim is that
 * it stores nothing, so `pairRelay` also takes an override and the pairing
 * screen should expose one.
 */
export const DEFAULT_RELAY_BASE_URL = 'https://wafra-relay.workers.dev';

/**
 * One keychain entry holds the whole pairing. Splitting the private key from
 * the token would let a half-failed write leave a device that can authenticate
 * but cannot read anything it collects, which looks identical to a broken
 * server from inside the app.
 */
const STORE_KEY = 'wafra.relay.v1';

/**
 * AFTER_FIRST_UNLOCK rather than the WHEN_UNLOCKED default: sync runs from
 * background refresh, and the device is very often locked when it does. The
 * THIS_DEVICE_ONLY variants are deliberately not used — a restored backup that
 * keeps working is better here than one that silently stops collecting, and the
 * relay queue it protects is minutes old at most.
 */
const KEYCHAIN: SecureStore.SecureStoreOptions = {
  keychainService: 'wafra.relay',
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** A stalled request must not hold the sync loop open forever. */
const REQUEST_TIMEOUT_MS = 15_000;
/** The Worker's own page size; ack accepts the same 200 in one call. */
const SYNC_PAGE = 200;
/**
 * lastSyncAt moves on every poll, and a keychain write per poll is a lot of
 * churn for a timestamp nobody reads to the second. It is exact in memory and
 * flushed on this interval, or immediately whenever rows actually arrive.
 */
const CLOCK_PERSIST_MS = 5 * 60_000;

export type RelayStatus =
  /** No pairing on this device — the Shortcut cannot have been set up. */
  | 'unpaired'
  /** Paired; the token works as far as we know. */
  | 'paired'
  /** The relay rejected our token. Only re-pairing fixes it. */
  | 'revoked';

/**
 * Everything a screen needs to answer "is iOS capture configured, and when did
 * it last collect anything?". The private key is not part of it and never
 * leaves this module.
 */
export interface RelayState {
  status: RelayStatus;
  deviceId: string | null;
  /** The URL the user's Shortcut posts to. Shown on the pairing screen. */
  ingestUrl: string | null;
  /** The Shortcut's bearer token. Shown on the pairing screen. */
  token: string | null;
  /** Relay origin this device paired against. */
  baseUrl: string | null;
  pairedAt: string | null;
  /** Last successful /v1/sync, rows or not. Null until the first one lands. */
  lastSyncAt: string | null;
  /** Last sync that actually returned something — "capture is working". */
  lastItemAt: string | null;
  /** Rows collected since pairing. Zero means the Shortcut has never fired. */
  itemsCollected: number;
}

export type RelayOutcome =
  /** Synced. `rows` may still be empty; that is the normal case. */
  | 'ok'
  /** Nothing is paired, so there was nothing to ask. */
  | 'unpaired'
  /** The request never completed — no network, DNS, timeout. */
  | 'offline'
  /** 401: the device row is gone from the relay. Re-pair to recover. */
  | 'revoked'
  /** 429 from the relay or whatever sits in front of it. Back off. */
  | 'rate_limited'
  /** A 5xx, a malformed response, or a commit callback that threw. */
  | 'error';

export interface RelaySyncResult {
  outcome: RelayOutcome;
  /** Ready for buildImportPlan. Empty unless outcome is 'ok'. */
  rows: ScannedSms[];
  /** Items this device could not open. See the note on ackIds below. */
  corruptCount: number;
  /** Whether the relay was told it may delete what it just sent. */
  acked: boolean;
  state: RelayState;
  /** HTTP status when there was one, for diagnostics only. */
  status?: number;
  /** Failure detail, when there is something worth showing. */
  error?: string;
}

/**
 * Called with the collected rows before anything is acknowledged. Whatever it
 * does must be durable by the time it resolves — the ack that follows is what
 * deletes the relay's only copy. If it throws, nothing is acked and the same
 * rows come back on the next sync.
 */
export type RelayCommit = (rows: ScannedSms[]) => void | Promise<void>;

/** What the pairing screen shows the user so they can build the Shortcut. */
export interface RelayShortcutSetup {
  url: string;
  method: 'POST';
  authorization: string;
  contentType: 'application/json';
  /** The one JSON field the relay reads: `{"text": <Shortcut Input>}`. */
  bodyField: 'text';
}

interface StoredPairing {
  deviceId: string;
  token: string;
  baseUrl: string;
  ingestUrl: string;
  privateKey: string;
  publicKey: string;
  pairedAt: string;
  lastSyncAt: string | null;
  lastItemAt: string | null;
  itemsCollected: number;
  revoked?: boolean;
}

/** What the Worker seals: a ParsedSms without `raw`, plus arrival time. */
interface RelayPayload {
  kind: 'transaction' | 'billDue' | 'cardStatement' | 'cardPayment';
  type: TransactionType;
  amountFils: number;
  merchant: string;
  date: string | null;
  dueDay: number | null;
  minDueFils: number | null;
  card: { last4: string; kind: 'credit' | 'debit' | 'account' } | null;
  transferHint: boolean;
  snapshotFils: number | null;
  snapshotKind: 'balance' | 'limit' | 'outstanding' | null;
  categoryGuess: CategoryId;
  receivedAt: string;
}

const UNPAIRED: RelayState = {
  status: 'unpaired',
  deviceId: null,
  ingestUrl: null,
  token: null,
  baseUrl: null,
  pairedAt: null,
  lastSyncAt: null,
  lastItemAt: null,
  itemsCollected: 0,
};

/** `undefined` = the keychain has not been read yet; `null` = read, nothing there. */
let cached: StoredPairing | null | undefined;
let lastPersistMs = 0;

/**
 * Relay capture exists because of iOS, but nothing about it is iOS-only, and an
 * Android user who declines the SMS permission can still pair a Shortcut-like
 * sender. Web is the real exclusion: there is no keychain to put the key in.
 */
export function isRelayAvailable(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function publicState(p: StoredPairing | null): RelayState {
  if (!p) return UNPAIRED;
  return {
    status: p.revoked ? 'revoked' : 'paired',
    deviceId: p.deviceId,
    ingestUrl: p.ingestUrl,
    token: p.token,
    baseUrl: p.baseUrl,
    pairedAt: p.pairedAt,
    lastSyncAt: p.lastSyncAt,
    lastItemAt: p.lastItemAt,
    itemsCollected: p.itemsCollected,
  };
}

async function readStored(): Promise<StoredPairing | null> {
  if (cached !== undefined) return cached;
  if (!isRelayAvailable()) {
    cached = null;
    return null;
  }
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY, KEYCHAIN);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    // A record missing either key half is useless and would otherwise produce
    // a permanently "paired" device that can never open a row.
    cached =
      parsed && typeof parsed === 'object' &&
      typeof (parsed as StoredPairing).privateKey === 'string' &&
      typeof (parsed as StoredPairing).token === 'string'
        ? (parsed as StoredPairing)
        : null;
  } catch {
    // A keychain read can fail while the device is locked. Treating that as
    // "unpaired" forever would be wrong, so the cache is left unset and the
    // next call tries again.
    return null;
  }
  return cached;
}

async function writeStored(p: StoredPairing): Promise<void> {
  cached = p;
  lastPersistMs = Date.now();
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(p), KEYCHAIN);
}

/** Read the pairing from the keychain. Call once on mount, then use relayState(). */
export async function loadRelayState(): Promise<RelayState> {
  return publicState(await readStored());
}

/** Last known state without touching the keychain — safe to call while rendering. */
export function relayState(): RelayState {
  return publicState(cached ?? null);
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) throw new Error('relay: base URL must start with http(s)://');
  return trimmed;
}

interface RelayResponse {
  /** 0 means the request never completed at all. */
  status: number;
  body: unknown;
}

async function call(
  baseUrl: string,
  path: string,
  init: { method: string; token?: string; body?: unknown },
): Promise<RelayResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    // 204 is a normal answer here (ack, unpair) and has no body to parse.
    const text = res.status === 204 ? '' : await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate this device's key, register the public half, and store the pairing.
 *
 * Re-pairing is how a revoked device recovers, so this overwrites whatever was
 * there. The old device row is left for the relay's own sweep rather than
 * deleted first: if the token is dead, DELETE would fail anyway, and if the
 * network is down we still want the new pairing to complete.
 */
export async function pairRelay(baseUrl: string = DEFAULT_RELAY_BASE_URL): Promise<RelayState> {
  if (!isRelayAvailable()) throw new Error('relay: not available on this platform');
  const origin = normalizeBaseUrl(baseUrl);
  // getRandomBytesAsync is the native CSPRNG. getRandomBytes falls back to
  // Math.random in development, and a private key drawn from Math.random would
  // be indistinguishable from a working one right up until it mattered.
  const seed = await Crypto.getRandomBytesAsync(RELAY_KEY_BYTES);
  const keys = keypairFromSeed(seed);

  const res = await call(origin, '/v1/pair', {
    method: 'POST',
    body: { publicKey: keys.publicKey },
  });
  if (res.status === 0) throw new Error('relay: could not reach the relay');
  if (res.status !== 200) throw new Error(`relay: pairing failed (${res.status})`);
  const body = res.body as { deviceId?: string; token?: string; ingestUrl?: string } | null;
  if (!body?.deviceId || !body.token || !body.ingestUrl) {
    throw new Error('relay: pairing response was incomplete');
  }

  const pairing: StoredPairing = {
    deviceId: body.deviceId,
    token: body.token,
    baseUrl: origin,
    ingestUrl: body.ingestUrl,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    pairedAt: new Date().toISOString(),
    lastSyncAt: null,
    lastItemAt: null,
    itemsCollected: 0,
  };
  await writeStored(pairing);
  return publicState(pairing);
}

/**
 * Delete the device server-side and wipe the local key.
 *
 * The local wipe happens even if the DELETE fails: the user pressed unpair, and
 * a device that keeps its key because the network was down is not what they
 * asked for. Anything still queued becomes unopenable ciphertext and is swept
 * within 72 hours.
 */
export async function unpairRelay(): Promise<RelayState> {
  const p = await readStored();
  if (p && !p.revoked) {
    await call(p.baseUrl, '/v1/device', { method: 'DELETE', token: p.token });
  }
  cached = null;
  try {
    await SecureStore.deleteItemAsync(STORE_KEY, KEYCHAIN);
  } catch {
    // Already gone, or the keychain is locked. The in-memory cache is cleared
    // either way, and a stale entry is overwritten by the next pairing.
  }
  return UNPAIRED;
}

/** Everything the user has to type into Shortcuts, in one object. */
export function relayShortcutSetup(state: RelayState = relayState()): RelayShortcutSetup | null {
  if (!state.ingestUrl || !state.token) return null;
  return {
    url: state.ingestUrl,
    method: 'POST',
    authorization: `Bearer ${state.token}`,
    contentType: 'application/json',
    bodyField: 'text',
  };
}

function isPayload(v: unknown): v is RelayPayload {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<RelayPayload>;
  return (
    typeof p.amountFils === 'number' &&
    Number.isFinite(p.amountFils) &&
    typeof p.merchant === 'string' &&
    (p.type === 'expense' || p.type === 'income') &&
    (p.kind === 'transaction' ||
      p.kind === 'billDue' ||
      p.kind === 'cardStatement' ||
      p.kind === 'cardPayment')
  );
}

/**
 * A sealed payload becomes the same shape scanInbox produces on Android.
 *
 * Two fields are synthesised rather than carried:
 *
 * `smsTs` is the relay's receivedAt. It is the dedupe fingerprint the importer
 * builds `smsKey` from, and because it is sealed inside the payload it is
 * identical on every redelivery — an ack that gets lost cannot turn into a
 * duplicate transaction.
 *
 * `raw` is the empty string, because the relay never had the message text to
 * give back: it parses and drops it, which is the guarantee the whole service
 * is built on. buildImportPlan calls `.slice()` on this field for
 * low-confidence rows, so it must be a string and not undefined. Empty also
 * keeps these rows out of Settings → Improve accuracy, which is correct — we
 * cannot ask the user to report text we deliberately never stored.
 */
function toScanned(p: RelayPayload): ScannedSms {
  const ts = Date.parse(p.receivedAt);
  const smsTs = Number.isFinite(ts) ? ts : Date.now();
  return {
    ...p,
    dueDay: p.dueDay ?? null,
    minDueFils: p.minDueFils ?? null,
    card: p.card ?? null,
    transferHint: p.transferHint === true,
    snapshotFils: p.snapshotFils ?? null,
    snapshotKind: p.snapshotKind ?? null,
    date: p.date ?? toISODate(new Date(smsTs)),
    raw: '',
    smsTs,
    // The Shortcut posts the message body and nothing else, so there is no
    // sender to learn the bank's name from. Accounts auto-created from iOS rows
    // are named after the card's last four digits alone.
    sender: undefined,
  };
}

async function markRevoked(p: StoredPairing): Promise<void> {
  if (p.revoked) return;
  try {
    await writeStored({ ...p, revoked: true });
  } catch {
    // The in-memory record is already flagged, so the UI shows "re-pair" for
    // this session. A keychain that refused the write must not turn a 401 into
    // a thrown sync.
    cached = { ...p, revoked: true };
  }
}

/**
 * Collect, unseal, hand over, then acknowledge.
 *
 * The order matters: the relay deletes a row only when this device says it has
 * it, so `commit` has to finish before the ack goes out. Without a commit
 * callback the rows are acked immediately and the caller owns them from the
 * moment this resolves — pass one if "owning them" means writing them to the
 * store, because a crash between the ack and that write loses the transaction
 * with no way to ask for it again.
 */
export async function syncRelay(commit?: RelayCommit): Promise<RelaySyncResult> {
  const p = await readStored();
  if (!p) return { outcome: 'unpaired', rows: [], corruptCount: 0, acked: false, state: UNPAIRED };
  if (p.revoked) {
    return { outcome: 'revoked', rows: [], corruptCount: 0, acked: false, state: publicState(p) };
  }

  const res = await call(p.baseUrl, '/v1/sync', { method: 'GET', token: p.token });
  const fail = (outcome: RelayOutcome, error?: string): RelaySyncResult => ({
    outcome,
    rows: [],
    corruptCount: 0,
    acked: false,
    state: publicState(cached ?? p),
    status: res.status || undefined,
    error,
  });
  if (res.status === 0) return fail('offline');
  if (res.status === 401) {
    // The device row is gone — unpaired from another install, swept after a
    // year of silence, or the relay was redeployed onto an empty database.
    // Surfacing this as a distinct state is the difference between the user
    // seeing "tap to re-pair" and seeing capture quietly stop.
    await markRevoked(p);
    return fail('revoked');
  }
  if (res.status === 429) return fail('rate_limited');
  if (res.status !== 200) return fail('error', `relay returned ${res.status}`);

  const items = (res.body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return fail('error', 'malformed sync response');

  const rows: ScannedSms[] = [];
  const ackIds: string[] = [];
  let corruptCount = 0;
  for (const item of items.slice(0, SYNC_PAGE)) {
    const blob = item as Partial<SealedBlob> & { id?: string };
    if (typeof blob.id !== 'string') continue;
    try {
      const payload = open<unknown>(p.privateKey, {
        epk: String(blob.epk),
        iv: String(blob.iv),
        ct: String(blob.ct),
      });
      if (!isPayload(payload)) throw new Error('unexpected payload shape');
      rows.push(toScanned(payload));
    } catch {
      // One unopenable row must not strand the other 199. It is sealed to a key
      // this device does not have and never will, so it is acked with the rest:
      // leaving it queued only guarantees it is re-downloaded and re-fails on
      // every sync until the 72-hour sweep takes it.
      corruptCount++;
    }
    ackIds.push(blob.id);
  }

  if (rows.length > 0 && commit) {
    try {
      await commit(rows);
    } catch (e) {
      // Nothing is acked, so the relay still holds every row and the next sync
      // brings them back. The caller gets the rows anyway in case it can do
      // something better with them than we can.
      return {
        outcome: 'error',
        rows,
        corruptCount,
        acked: false,
        state: publicState(cached ?? p),
        status: res.status,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  let acked = false;
  if (ackIds.length > 0) {
    const ack = await call(p.baseUrl, '/v1/ack', {
      method: 'POST',
      token: p.token,
      body: { ids: ackIds },
    });
    // A failed ack is not a failed sync — the rows are already committed, and
    // the redelivery it causes dedupes on smsKey when it arrives.
    acked = ack.status === 204;
  }

  const now = new Date().toISOString();
  const next: StoredPairing = {
    ...p,
    lastSyncAt: now,
    lastItemAt: rows.length > 0 ? now : p.lastItemAt,
    itemsCollected: p.itemsCollected + rows.length,
  };
  cached = next;
  if (rows.length > 0 || Date.now() - lastPersistMs > CLOCK_PERSIST_MS) {
    try {
      await writeStored(next);
    } catch {
      // The counters are cosmetic; losing them to a locked keychain must not
      // fail a sync whose rows were already handed over.
    }
  }

  return {
    outcome: 'ok',
    rows,
    corruptCount,
    acked,
    state: publicState(next),
    status: res.status,
  };
}

/**
 * Poll until something arrives — the "send yourself a test message" step of
 * onboarding, where the user needs to see their Shortcut actually fire before
 * they will believe the setup took.
 *
 * Transport failures keep the loop alive because a phone that has just been
 * fiddled with in Settings is exactly where a flaky first request happens. A
 * dead pairing ends it immediately: no amount of waiting fixes a revoked token.
 */
export async function waitForRelayRows(
  commit?: RelayCommit,
  opts: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<RelaySyncResult> {
  const { timeoutMs = 120_000, intervalMs = 4_000, signal } = opts;
  const deadline = Date.now() + timeoutMs;
  let last = await syncRelay(commit);
  while (
    last.rows.length === 0 &&
    last.outcome !== 'unpaired' &&
    last.outcome !== 'revoked' &&
    !signal?.aborted &&
    Date.now() + intervalMs < deadline
  ) {
    await sleep(intervalMs, signal);
    if (signal?.aborted) break;
    last = await syncRelay(commit);
  }
  return last;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });
}

/**
 * Drop the in-memory copy of the pairing so the next call re-reads the
 * keychain. The cache lives for the life of the process — that is what lets a
 * screen that pairs and a screen that syncs agree without passing anything
 * between them — so it needs an explicit way out when the record changes
 * underneath it (a restore, a wipe, a test).
 */
export function resetRelayCache(): void {
  cached = undefined;
  lastPersistMs = 0;
}
