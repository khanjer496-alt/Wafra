/**
 * Opening what the relay sealed.
 *
 * `server/src/crypto.ts` is the other half of this file, and the two have to
 * agree byte for byte: X25519 ECDH → HKDF-SHA256, salt = the RAW ephemeral
 * public key and info = utf8 "wafra/v1/seal" → AES-256-GCM with a 12-byte iv
 * and the tag appended to the ciphertext. A mismatch anywhere along that chain
 * does not announce itself. Pairing still works, ingest still returns 202, sync
 * still returns items — every row just fails to open, forever, on every iPhone.
 * That is why scripts/test/relay.test.js opens the Worker's real `seal()` with
 * this module instead of with a second copy of the same reasoning.
 *
 * Everything here is pure JS because Hermes ships no crypto.subtle at all, so
 * the WebCrypto the Worker uses is simply not available on the device. @noble
 * runs unchanged under Hermes and under Node, which is also what lets the test
 * harness transpile this file and require it from plain Node.
 *
 * Nothing from React Native or Expo may be imported here for that same reason —
 * the moment it is, the test suite that proves the two halves agree stops being
 * able to load the file. `@/lib/types` is safe: it is types only, so it leaves
 * nothing behind after transpilation.
 *
 * The wire contract is more than the bytes, so the rest of it lives here too:
 * the shape the Worker seals, whether this build understands a given row, and
 * what instant a row is fingerprinted by. Those decisions are the ones that
 * lose transactions when they are wrong, and relay-client.ts cannot be loaded
 * outside a device — it imports expo-secure-store — so anything asserted about
 * them has to be assertable from here.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import type { CategoryId, TransactionType } from '@/lib/types';

/** One queued row as the Worker stores and returns it. */
export interface SealedBlob {
  /** Ephemeral X25519 public key, base64. */
  epk: string;
  /** AES-GCM nonce, base64. */
  iv: string;
  /** Ciphertext with the GCM tag appended, base64. */
  ct: string;
}

export interface RelayKeypair {
  /** X25519 secret scalar, base64. Never leaves the device. */
  privateKey: string;
  /** X25519 public key, base64 — the only half the relay is given. */
  publicKey: string;
}

/** X25519 secret length; also what the relay validates a public key against. */
export const RELAY_KEY_BYTES = 32;

/**
 * The HKDF info string, spelled out as bytes rather than through TextEncoder.
 * It is pure ASCII, and one hard-coded array is one less global this file has
 * to assume exists in whichever of the three runtimes it happens to be in.
 */
const SEAL_INFO = Uint8Array.from(
  'wafra/v1/seal'.split('').map((c) => c.charCodeAt(0)),
);

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = {};
for (let i = 0; i < B64_ALPHABET.length; i++) B64_INDEX[B64_ALPHABET[i]] = i;
// The Worker emits standard base64, but a value that has been through a URL or
// a Shortcut may come back url-safe. Accepting both costs two lines and turns a
// class of silent decode failures into no failure at all.
B64_INDEX['-'] = 62;
B64_INDEX['_'] = 63;

/**
 * Base64 by hand. Hermes has no atob/btoa and React Native does not polyfill
 * them, so the Worker's `btoa` implementation cannot simply be mirrored here.
 */
export function b64encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const c = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64_ALPHABET[a >> 2];
    out += B64_ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64_ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64_ALPHABET[c & 0x3f];
  }
  return out;
}

export function b64decode(s: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '=' || ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') continue;
    const v = B64_INDEX[ch];
    // Garbage in the queue must throw rather than decode to something shorter,
    // because a short-but-plausible key or nonce is the kind of input that
    // produces a wrong answer instead of an error.
    if (v === undefined) throw new Error('relay: not base64');
    acc = ((acc << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/**
 * Derive this device's identity from 32 random bytes.
 *
 * The seed is a parameter rather than something this module generates, because
 * the only trustworthy source of randomness on the device is native (Expo's
 * `getRandomBytesAsync`) and importing that here would break the purity this
 * file depends on. It also means the caller cannot accidentally end up on a
 * `Math.random` fallback without having typed it out.
 */
export function keypairFromSeed(seed: Uint8Array): RelayKeypair {
  if (seed.length !== RELAY_KEY_BYTES) {
    throw new Error(`relay: seed must be ${RELAY_KEY_BYTES} bytes, got ${seed.length}`);
  }
  const kp = x25519.keygen(seed);
  return { privateKey: b64encode(kp.secretKey), publicKey: b64encode(kp.publicKey) };
}

/** Recover the public half, for a device that stored only its private key. */
export function publicKeyFor(privateKeyB64: string): string {
  return b64encode(x25519.getPublicKey(b64decode(privateKeyB64)));
}

/**
 * Unseal one queued row.
 *
 * Throws on every failure mode there is — malformed base64, a blob sealed to a
 * different device, a flipped bit, a plaintext that is not JSON. Callers are
 * expected to catch per item: one unopenable row in a batch of two hundred is a
 * row to drop, not a sync to abandon.
 */
export function open<T = unknown>(privateKeyB64: string, blob: SealedBlob): T {
  const epk = b64decode(blob.epk);
  // getSharedSecret rejects the low-order points that would drive the ECDH
  // output to zero, which is the one case where a wrong key still "works".
  const shared = x25519.getSharedSecret(b64decode(privateKeyB64), epk);
  // Salting with the raw epk is what binds the derived key to this exact
  // ephemeral exchange; the Worker passes the same bytes, pre-base64.
  const key = hkdf(sha256, shared, epk, SEAL_INFO, 32);
  const plaintext = gcm(key, b64decode(blob.iv)).decrypt(b64decode(blob.ct));
  return JSON.parse(utf8(plaintext)) as T;
}

/**
 * Merchant names arrive in Arabic often enough that a fromCharCode shortcut
 * would corrupt real data. TextDecoder is present in all three runtimes this
 * file runs in: Node has had it for years, and Expo's WinterCG runtime installs
 * it on Hermes at startup.
 */
function utf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * What the Worker seals into one queue row: the parsed message with `raw`
 * removed, plus what the relay itself knows about it.
 *
 * `sender` is optional because the Shortcut the user built may predate the
 * field, and because a Worker that does not send it must not make every row
 * unopenable on a device that expects it. Optional is what lets the two halves
 * ship on their own schedules, which they do — the Worker is deployed with
 * `wrangler deploy` and the app goes through review.
 */
export interface RelayPayload {
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
  /** The bank's sender id, when the user's Shortcut was built to send one. */
  sender?: string;
}

/**
 * Whether THIS BUILD can turn a decrypted row into a transaction.
 *
 * Read it as a version gate, not as a corruption check: `kind` is a closed set
 * here and an open one in sms-parser.ts, so a Worker deployed after this app
 * binary was signed can legitimately produce a row that fails this. That is why
 * `openPage` treats a false here completely differently from a decrypt failure.
 */
export function isRelayPayload(v: unknown): v is RelayPayload {
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

/** One page of the queue, sorted into what the caller may keep and may delete. */
export interface OpenedPage {
  /** Rows this build understands, in queue order, each with its queue id. */
  rows: { id: string; payload: RelayPayload }[];
  /**
   * Ids the relay may delete. Acking is destructive — the queue holds the only
   * copy of a transaction — so an id is only in here once the row behind it has
   * either been handed over or been proven impossible to ever open.
   */
  ackIds: string[];
  /** Rows that did not decrypt. Acked and dropped; see `openPage`. */
  sealedCount: number;
  /** Rows that decrypted into a shape this build does not know. Left queued. */
  unsupportedCount: number;
}

/**
 * Decide, per row, between "this device can never open this" and "this device
 * does not understand this yet". They look identical from the outside and have
 * opposite correct answers.
 *
 * A row that fails to DECRYPT is sealed to a key this device does not have and
 * never will — a queue left over from a previous pairing, a flipped bit, a
 * truncated blob. No future version of anything recovers it, so it is acked
 * with the rest; leaving it queued only guarantees it is re-downloaded and
 * re-fails on every sync until the 72-hour sweep takes it.
 *
 * A row that decrypts and then fails `isRelayPayload` is the opposite case: the
 * bytes are intact and readable, this build simply does not know the shape.
 * Acking it deletes a real transaction the user was told the app would capture.
 * It is left on the relay, and the cost of that is bounded by the relay's own
 * QUEUE_TTL_HOURS — 72 hours of being re-downloaded and re-rejected, after
 * which the Worker sweeps it regardless of what this device does. Within that
 * window an app update turns it into a transaction; outside it, nothing could
 * have. The count is returned so a screen can say so out loud, because "update
 * Wafra" is the only action that spends that window.
 */
export function openPage(privateKeyB64: string, items: unknown[], limit: number): OpenedPage {
  const page: OpenedPage = { rows: [], ackIds: [], sealedCount: 0, unsupportedCount: 0 };
  for (const item of items.slice(0, limit)) {
    const blob = item as Partial<SealedBlob> & { id?: unknown };
    // No id means no way to ack it, so there is nothing useful to do with it.
    if (typeof blob.id !== 'string' || !blob.id) continue;
    let value: unknown;
    try {
      value = open<unknown>(privateKeyB64, {
        epk: String(blob.epk),
        iv: String(blob.iv),
        ct: String(blob.ct),
      });
    } catch {
      page.sealedCount++;
      page.ackIds.push(blob.id);
      continue;
    }
    if (!isRelayPayload(value)) {
      page.unsupportedCount++;
      continue;
    }
    page.rows.push({ id: blob.id, payload: value });
    page.ackIds.push(blob.id);
  }
  return page;
}

/** The Worker's QUEUE_TTL_HOURS, in ms. Nothing outlives it server-side. */
export const RELAY_QUEUE_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Timestamps this service could not have produced. A value outside the range is
 * treated as absent rather than clamped: clamping a bad clock to "now" would
 * hand back a different answer on every sync, which is precisely the property
 * the fingerprint depends on not doing.
 */
const TS_FLOOR_MS = Date.UTC(2020, 0, 1);
/** Enough slack for a phone whose clock is a day fast; more is not a timestamp. */
const TS_FUTURE_SLACK_MS = 26 * 60 * 60 * 1000;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;
/** "28 Jul 2026 at 09:14" — how Shortcuts renders Current Date in en-GB. */
const DMY_RE =
  /^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})(?:[,\s]+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?m\.?)?)?$/i;
/** "Jul 28, 2026 at 9:14 AM" — the same thing in en-US. */
const MDY_RE =
  /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[,\s]+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?m\.?)?)?$/i;

/**
 * Parse a timestamp the relay sealed, or return null.
 *
 * `Date.parse` is deliberately not used. Everything it accepts beyond ISO 8601
 * is implementation-defined, so the same string can produce one number in the
 * test suite under Node and another under Hermes — or NaN on one and a value on
 * the other. A fingerprint that depends on which JS engine read it is not a
 * fingerprint.
 *
 * The two long forms are here because they are what a Shortcut actually sends
 * when the user wires "Current Date" into the request body: recovering the real
 * instant is strictly better than falling back to when this device happened to
 * look. Ambiguous numeric forms (03/07/26) are refused rather than guessed —
 * day-first and month-first cannot be told apart, and a wrong guess dates the
 * transaction to a different month.
 *
 * A value with no zone is read as device-local. That is what the user meant by
 * it, and it is what keeps `toISODate` landing on the day they saw the message.
 */
export function parseRelayInstant(value: unknown, nowMs: number): number | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  const ms = parseIsoInstant(s) ?? parseLongInstant(s);
  if (ms === null || !Number.isFinite(ms)) return null;
  if (ms < TS_FLOOR_MS || ms > nowMs + TS_FUTURE_SLACK_MS) return null;
  return ms;
}

function parseIsoInstant(s: string): number | null {
  const m = ISO_RE.exec(s);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, zone] = m;
  if (!inRange(+mo, 1, 12) || !inRange(+d, 1, 31)) return null;
  // Date-only lands at local midday, not midnight: a date rendered back through
  // toISODate has to survive a timezone that is hours either side of UTC, and
  // midnight does not.
  if (hh === undefined) return new Date(+y, +mo - 1, +d, 12).getTime();
  if (!inRange(+hh, 0, 23) || !inRange(+mi, 0, 59)) return null;
  const sec = ss === undefined ? 0 : +ss;
  if (!zone) return new Date(+y, +mo - 1, +d, +hh, +mi, sec).getTime();
  const offset = zone.toUpperCase() === 'Z' ? 0 : offsetMinutes(zone);
  return Date.UTC(+y, +mo - 1, +d, +hh, +mi, sec) - offset * 60_000;
}

function parseLongInstant(s: string): number | null {
  const dmy = DMY_RE.exec(s);
  const mdy = dmy ? null : MDY_RE.exec(s);
  if (!dmy && !mdy) return null;
  const [day, name] = dmy ? [dmy[1], dmy[2]] : [mdy![2], mdy![1]];
  const m = dmy ?? mdy!;
  const month = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  if (month < 0 || !inRange(+day, 1, 31)) return null;
  let hour = m[4] === undefined ? 12 : +m[4];
  const minute = m[5] === undefined ? 0 : +m[5];
  const sec = m[6] === undefined ? 0 : +m[6];
  if (!inRange(hour, 0, 23) || !inRange(minute, 0, 59)) return null;
  const meridiem = m[7]?.toLowerCase();
  if (meridiem === 'p' && hour < 12) hour += 12;
  if (meridiem === 'a' && hour === 12) hour = 0;
  return new Date(+m[3], month, +day, hour, minute, sec).getTime();
}

function offsetMinutes(zone: string): number {
  const sign = zone[0] === '-' ? -1 : 1;
  const digits = zone.slice(1).replace(':', '');
  return sign * (+digits.slice(0, 2) * 60 + +digits.slice(2));
}

function inRange(n: number, lo: number, hi: number): boolean {
  return Number.isInteger(n) && n >= lo && n <= hi;
}

/**
 * The instant a row is fingerprinted by, from the sealed payload alone.
 *
 * Sealed is the point: both candidates are inside the ciphertext, so the same
 * queue row yields the same number on every redelivery. The importer builds
 * `smsKey` as `s<smsTs>-<amountFils>`, and a lost ack — which this client
 * correctly treats as harmless — replays the row; if the number moved, so does
 * the key, and the user sees the purchase twice.
 *
 * The parsed date is the second choice rather than the first because it is only
 * accurate to the day and is absent from most purchase alerts. A due date in
 * the future fails the range check and falls through, which is what stops a
 * statement reminder from dragging lastScanTs forward past today and blinding
 * the Android inbox scan.
 */
export function payloadTimestampMs(p: RelayPayload, nowMs: number): number | null {
  return parseRelayInstant(p.receivedAt, nowMs) ?? parseRelayInstant(p.date, nowMs);
}

/**
 * First-sighting times for rows whose sealed timestamp was unusable.
 *
 * Only that residue is kept — a row with a good `receivedAt` needs nothing
 * remembered — so this is normally empty and costs nothing. When it is not, it
 * is the only thing that makes a redelivered undated row fingerprint the same
 * way twice, so it has to reach the keychain before the ack does.
 */
export interface RelayRowClock {
  /** Hashed queue id → ms this device first saw that row. */
  seen: Record<string, number>;
  /** Set once `seen` holds something that is not on disk yet. */
  dirty: boolean;
}

/**
 * iOS has historically refused keychain values much past 2 KB, and a rejected
 * write here is a write that never becomes durable. Hashed ids keep an entry to
 * about 25 bytes; this cap keeps the whole record inside a kilobyte. A hash
 * collision costs two undated rows the same first-seen time, which only matters
 * if they also share an amount — in which case they were going to dedupe
 * against each other anyway.
 */
const CLOCK_MAX_ENTRIES = 48;

export function makeRowClock(stored: unknown, nowMs: number): RelayRowClock {
  const seen: Record<string, number> = {};
  if (stored && typeof stored === 'object') {
    for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      // Past the relay's TTL the row it describes has been swept and can never
      // be redelivered, so the entry is dead weight. Entries from the future are
      // dropped too: a clock that jumped backwards would otherwise leave them
      // pinned there forever.
      if (v > nowMs || nowMs - v > RELAY_QUEUE_TTL_MS) continue;
      seen[k] = v;
    }
  }
  return { seen, dirty: false };
}

/** First time this device saw `queueId`, recording it if this is that time. */
export function rowFirstSeenMs(clock: RelayRowClock, queueId: string, nowMs: number): number {
  const key = hashId(queueId);
  const prior = clock.seen[key];
  if (prior !== undefined) return prior;
  clock.seen[key] = nowMs;
  clock.dirty = true;
  const keys = Object.keys(clock.seen);
  if (keys.length > CLOCK_MAX_ENTRIES) {
    // Evict oldest first: the oldest entry is the one closest to being swept
    // server-side, so it is the one whose loss can least become a duplicate.
    let oldest = keys[0];
    for (const k of keys) if (clock.seen[k] < clock.seen[oldest]) oldest = k;
    delete clock.seen[oldest];
  }
  return nowMs;
}

/** FNV-1a, for length rather than for secrecy — see CLOCK_MAX_ENTRIES. */
function hashId(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
