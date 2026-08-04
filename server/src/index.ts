/**
 * Wafra iOS relay.
 *
 * iOS gives no app access to SMS, so the Android design — scan the inbox
 * on-device, never touch the network — cannot exist there. What iOS does allow
 * is a Shortcuts personal automation the USER creates: "when I get a message
 * from my bank, send it to Wafra". A Shortcut cannot hand data to a sleeping
 * app; it can only make an HTTP request. That is the entire reason this
 * service exists, and it is why the Android build still has no server.
 *
 * The rule this file is built around: the message text is parsed and dropped.
 * It is never written to D1, never logged, never returned. What persists is
 * the parsed row, sealed to the device that will collect it, deleted the
 * moment that device acknowledges it.
 *
 * The parser is the SAME MODULE the app uses — imported from ../../src/lib,
 * not reimplemented. Every fix from the Android side applies here the day it
 * lands, and its 190 tests cover this service too.
 */
import { MARKETS, setActiveMarket } from '@/lib/markets';
import { parseSms } from '@/lib/sms-parser';

import { b64decode, b64url, hashToken, randomToken, seal, timingSafeEqual } from './crypto';

export interface Env {
  DB: D1Database;
}

/** Longer than any real bank SMS; anything bigger is abuse or a mistake. */
const MAX_BODY_BYTES = 8_192;
/** A device that has not synced in this long has its queue dropped. */
const QUEUE_TTL_HOURS = 72;
/** Per-device ingest ceiling. UAE banks send tens of alerts a day, not hundreds. */
const INGEST_PER_HOUR = 300;
/** Sender IDs are short by definition ("ADIB", "Emirates NBD", "ae.wio.personal"). */
const MAX_SENDER_CHARS = 64;
/** Fallback market when a device paired before market selection existed. */
const DEFAULT_MARKET = 'AE';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

interface Device {
  id: string;
  public_key: string;
  /** Market pack id this device parses under — 'AE', 'SA', … */
  market: string;
}

/** Resolve the bearer token to a device, or null. */
async function authenticate(req: Request, env: Env): Promise<Device | null> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const digest = await hashToken(token);
  const row = await env.DB.prepare(
    'SELECT id, public_key, token_hash, market FROM devices WHERE token_hash = ?1',
  )
    .bind(digest)
    .first<{ id: string; public_key: string; token_hash: string; market: string | null }>();
  if (!row || !timingSafeEqual(row.token_hash, digest)) return null;
  await env.DB.prepare('UPDATE devices SET last_seen = unixepoch() WHERE id = ?1')
    .bind(row.id)
    .run();
  return { id: row.id, public_key: row.public_key, market: row.market || DEFAULT_MARKET };
}

/** Sliding-window counter, so one device cannot fill the database. */
async function overRateLimit(env: Env, deviceId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM queue WHERE device_id = ?1 AND created_at > unixepoch() - 3600',
  )
    .bind(deviceId)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= INGEST_PER_HOUR;
}

/** A market id the app actually ships a pack for, or null. */
function validMarket(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const up = id.trim().toUpperCase();
  return MARKETS.some((m) => m.id === up) ? up : null;
}

/**
 * The SMS sender ID, which is the ONLY thing that says which bank sent a
 * message — no UAE bank but HSBC names itself in the body. Without it an iOS
 * card is grey and nameless where the same card on Android is branded, and
 * three sender-gated parser rules (islamic / ownPot / brand) never fire.
 *
 * It is normalised here and nowhere else: trimmed, collapsed to one line, and
 * capped. A sender is a short handle, so anything longer is either a mistake in
 * the user's Shortcut or someone trying to smuggle a payload through a field
 * that gets sealed and handed to the phone.
 */
function sanitizeSender(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_SENDER_CHARS);
  return s || undefined;
}

/**
 * When the message arrived, according to the Shortcut.
 *
 * This matters more than it looks: the app's strong duplicate guard is a
 * fingerprint of the message TIMESTAMP and amount (`smsKey` in auto-import.ts).
 * Defaulting to `new Date()` — as this route used to — gives a re-POST of the
 * same message a different fingerprint, so a Shortcut that fires twice writes
 * the charge twice.
 *
 * A timestamp is only honoured if it is sane. A clock-skewed or hand-edited
 * value further out than a day ahead or a year behind would either park a row
 * in the future or trip the 45-day stale-due cutoff, so those fall back to now.
 */
function resolveReceivedAt(value: unknown, nowMs: number): number {
  if (typeof value !== 'string' && typeof value !== 'number') return nowMs;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return nowMs;
  if (ms > nowMs + 86_400_000) return nowMs;
  if (ms < nowMs - 365 * 86_400_000) return nowMs;
  return ms;
}

/**
 * A stable identity for a message, computed from its text and sealed with the
 * row. It never touches the database in the clear and never leaves this
 * function as anything but ciphertext, so it is not an index into the user's
 * messages — it is a dedupe key the phone can compare against itself.
 *
 * It exists because `receivedAt` is whatever the Shortcut sent: a retry can
 * carry a drifted clock, and the timestamp fingerprint then fails to collapse.
 * The digest does not drift.
 */
async function messageId(text: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // ── Pairing: the app posts its X25519 public key, gets a bearer token ──
    //
    // No email, no password, no account. Identity is a key the phone generated
    // and never sends again. Losing the phone loses the queue, which is the
    // correct outcome for a service that is meant to hold nothing.
    if (req.method === 'POST' && url.pathname === '/v1/pair') {
      const body = await req.json<{ publicKey?: string; market?: string }>().catch(() => null);
      const pk = body?.publicKey;
      if (typeof pk !== 'string' || pk.length > 128) return json({ error: 'bad_public_key' }, 400);
      try {
        if (b64decode(pk).length !== 32) return json({ error: 'bad_public_key' }, 400);
      } catch {
        return json({ error: 'bad_public_key' }, 400);
      }
      // The device tells the relay which market pack to parse under. It is the
      // only thing the phone knows that the Worker cannot infer: an SA user's
      // "SAR 45.00 at PANDA" is not a UAE message, and parsing it under the
      // hardcoded AE pack found no currency at all and dropped the row.
      const market = validMarket(body?.market) ?? DEFAULT_MARKET;
      const id = crypto.randomUUID();
      const token = randomToken();
      await env.DB.prepare(
        'INSERT INTO devices (id, public_key, token_hash, market, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, unixepoch(), unixepoch())',
      )
        .bind(id, pk, await hashToken(token), market)
        .run();
      return json({ deviceId: id, token, market, ingestUrl: `${url.origin}/v1/ingest` });
    }

    // ── Ingest: one message from the user's Shortcut ──
    if (req.method === 'POST' && url.pathname === '/v1/ingest') {
      // Checked before the body is read, so an oversized POST is refused
      // without buffering it.
      const declared = Number(req.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        return json({ error: 'too_large' }, 413);
      }
      const device = await authenticate(req, env);
      if (!device) return json({ error: 'unauthorized' }, 401);
      if (await overRateLimit(env, device.id)) return json({ error: 'rate_limited' }, 429);

      const raw = await req.text();
      if (raw.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413);
      const body = ((): { text?: unknown; sender?: unknown; receivedAt?: unknown } | null => {
        try {
          return JSON.parse(raw);
        } catch {
          // Shortcuts is fiddly about JSON; accept a bare text body too.
          return { text: raw };
        }
      })();
      const text = body?.text;
      if (typeof text !== 'string' || !text.trim()) return json({ error: 'empty' }, 400);

      const sender = sanitizeSender(body?.sender);
      const receivedAtMs = resolveReceivedAt(body?.receivedAt, Date.now());

      // Selecting the pack and parsing is ONE synchronous block on purpose.
      // `setActiveMarket` sets module-level state that every isolate shares, so
      // an `await` between these two lines would let a concurrent request for a
      // different market change the pack out from under this parse. There is no
      // await here, and a Workers isolate runs JavaScript on one thread, so no
      // interleaving is possible.
      setActiveMarket(device.market);
      const parsed = parseSms(text, undefined, { sender });
      // Not a transaction — an OTP, a promo, a delivery notice. Nothing is
      // stored and nothing is echoed back: the Shortcut fires on every message
      // matching the user's filter, and most of them are none of our business.
      if (!parsed) return new Response(null, { status: 204 });

      const msgId = await messageId(text);
      // `raw` is deliberately dropped here. It is the one field the app's own
      // importer keeps for its "unrecognised format" report, and keeping it
      // server-side would turn this database into a readable archive of the
      // user's bank messages — the thing this design exists to avoid.
      const { raw: _discard, ...row } = parsed;
      const sealed = await seal(device.public_key, {
        ...row,
        // Everything below is sealed with the row and exists nowhere else.
        sender,
        smsTs: receivedAtMs,
        receivedAt: new Date(receivedAtMs).toISOString(),
        msgId,
        market: device.market,
      });
      await env.DB.prepare(
        'INSERT INTO queue (id, device_id, epk, iv, ct, created_at) VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())',
      )
        .bind(crypto.randomUUID(), device.id, sealed.epk, sealed.iv, sealed.ct)
        .run();
      return new Response(null, { status: 202 });
    }

    // ── Sync: the app collects and acknowledges ──
    //
    // Delivery is acknowledged separately rather than deleted on read, so a
    // dropped response loses nothing: the app asks again and the row is still
    // there. Rows only disappear once the phone confirms it has them.
    if (req.method === 'GET' && url.pathname === '/v1/sync') {
      const device = await authenticate(req, env);
      if (!device) return json({ error: 'unauthorized' }, 401);
      await env.DB.prepare(
        'DELETE FROM queue WHERE device_id = ?1 AND created_at < unixepoch() - ?2',
      )
        .bind(device.id, QUEUE_TTL_HOURS * 3600)
        .run();
      const { results } = await env.DB.prepare(
        'SELECT id, epk, iv, ct FROM queue WHERE device_id = ?1 ORDER BY created_at ASC LIMIT 200',
      )
        .bind(device.id)
        .all<{ id: string; epk: string; iv: string; ct: string }>();
      return json({ items: results ?? [] });
    }

    if (req.method === 'POST' && url.pathname === '/v1/ack') {
      const device = await authenticate(req, env);
      if (!device) return json({ error: 'unauthorized' }, 401);
      const body = await req.json<{ ids?: string[] }>().catch(() => null);
      const ids = body?.ids;
      if (!Array.isArray(ids) || ids.length === 0) return json({ error: 'no_ids' }, 400);
      if (ids.length > 200) return json({ error: 'too_many' }, 400);
      const marks = ids.map((_, i) => `?${i + 2}`).join(',');
      await env.DB.prepare(`DELETE FROM queue WHERE device_id = ?1 AND id IN (${marks})`)
        .bind(device.id, ...ids)
        .run();
      return new Response(null, { status: 204 });
    }

    // ── Market: the user changed country in Settings ──
    //
    // Separate from pairing because re-pairing would invalidate the token that
    // is baked into the user's Shortcut, and the Shortcut is the one piece of
    // this system the app cannot repair for them.
    if (req.method === 'PATCH' && url.pathname === '/v1/device') {
      const device = await authenticate(req, env);
      if (!device) return json({ error: 'unauthorized' }, 401);
      const body = await req.json<{ market?: string }>().catch(() => null);
      const market = validMarket(body?.market);
      if (!market) return json({ error: 'bad_market' }, 400);
      await env.DB.prepare('UPDATE devices SET market = ?2 WHERE id = ?1')
        .bind(device.id, market)
        .run();
      return json({ market });
    }

    // ── Unpair: the user's delete button ──
    if (req.method === 'DELETE' && url.pathname === '/v1/device') {
      const device = await authenticate(req, env);
      if (!device) return json({ error: 'unauthorized' }, 401);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM queue WHERE device_id = ?1').bind(device.id),
        env.DB.prepare('DELETE FROM devices WHERE id = ?1').bind(device.id),
      ]);
      return new Response(null, { status: 204 });
    }

    if (req.method === 'GET' && url.pathname === '/v1/health') {
      return json({ ok: true });
    }

    return json({ error: 'not_found' }, 404);
  },

  /**
   * Nightly sweep. Queue rows expire on sync too, but a device that is never
   * opened again would otherwise leave its rows sitting there forever.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await env.DB.prepare('DELETE FROM queue WHERE created_at < unixepoch() - ?1')
      .bind(QUEUE_TTL_HOURS * 3600)
      .run();
    // A device silent for a year is gone. Its queue is already empty by then;
    // this drops the public key and token hash as well.
    await env.DB.prepare('DELETE FROM devices WHERE last_seen < unixepoch() - 31536000').run();
  },
};
