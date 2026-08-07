/**
 * Wafra iOS relay.
 *
 * iOS gives no app access to SMS, so the Android design — scan the inbox
 * on-device, never touch the network — cannot exist there. What iOS does allow
 * is a Shortcuts personal automation the USER creates: "when I get a message
 * from my bank, send it to Wafra". A Shortcut cannot hand data to a sleeping
 * app; it can only make an HTTP request. That is the entire reason this
 * service exists. Android's alert-capture path does not use this relay.
 *
 * The rule this file is built around: the message text is parsed and dropped.
 * It is never written to D1, never logged, never returned. What persists is
 * the parsed row, sealed to the device that will collect it, deleted the
 * moment that device acknowledges it.
 *
 * The parser is the SAME MODULE the app uses — imported from ../../src/lib,
 * not reimplemented. Every parser fix and corpus case therefore covers both
 * capture paths.
 */
import { parseSms } from '@/lib/sms-parser';
import { RELAY_TEST_MESSAGE } from '@/lib/relay-protocol';

import {
  b64encode,
  canSealTo,
  hashToken,
  keyedFingerprint,
  randomToken,
  seal,
  type SealedBlob,
  timingSafeEqual,
} from './crypto';
import {
  extractPdfStatementRows,
  normalizeEmailContent,
  parseRawEmail,
  parseStatementText,
} from './imports';
import { relaySender } from './ingest-row';
import {
  decryptPushToken,
  encryptPushToken,
  isExpoProjectId,
  isExpoPushToken,
  PUSH_REGISTRATION_TTL_SECONDS,
  sendWakePush,
  type PushEnv,
} from './push';

export interface Env extends PushEnv {
  DB: D1Database;
  /** Domain routed to this Email Worker, for token@domain forwarding. */
  EMAIL_DOMAIN?: string;
}

/** Longer than any real bank SMS; anything bigger is abuse or a mistake. */
const MAX_BODY_BYTES = 8_192;
const MAX_PAIR_BYTES = 256;
const MAX_ACK_BYTES = 16_384;
const MAX_PUSH_BYTES = 1_024;
const MAX_EMAIL_BYTES = 128 * 1_024;
const MAX_RAW_EMAIL_BYTES = 6 * 1024 * 1024;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_IMPORT_ROWS = 200;
const INVITE_TTL_SECONDS = 10 * 60;
const MAX_VAULT_DEVICES = 8;
/** Global backstop; edge rate limiting remains the production first line. */
const PAIR_PER_MINUTE = 60;
/** Per-device ingest ceiling. UAE banks send tens of alerts a day, not hundreds. */
const INGEST_PER_HOUR = 300;
/** Retry idempotency window; exact repeat purchases remain possible later. */
const REPLAY_WINDOW_SECONDS = 15 * 60;
/** Bounded abuse without making a normal long-offline phone lose history. */
const MAX_QUEUED_ROWS = 10_000;
const textEncoder = new TextEncoder();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function headers(contentType?: string): HeadersInit {
  return {
    ...(contentType ? { 'content-type': contentType } : {}),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: headers('application/json'),
  });
}

function empty(status: number): Response {
  return new Response(null, { status, headers: headers() });
}

function secureTransport(url: URL): boolean {
  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
  );
}

async function readBody(
  req: Request,
  maxBytes: number,
): Promise<{ text: string; tooLarge: boolean }> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { text: '', tooLarge: true };
  const text = await req.text();
  return { text, tooLarge: textEncoder.encode(text).byteLength > maxBytes };
}

async function readBytes(
  req: Request,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; tooLarge: boolean }> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { bytes: new Uint8Array(), tooLarge: true };
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  return { bytes, tooLarge: bytes.byteLength > maxBytes };
}

interface Device {
  id: string;
  vault_id: string;
  role: 'owner' | 'member';
  public_key: string;
  /** Present only for this request; never written, returned, sealed or logged. */
  requestSecret: string;
}

/**
 * Resolve a scope-specific bearer token. The Shortcut receives ingest-only
 * authority; it cannot read, acknowledge, or delete the user's queue.
 */
async function authenticate(
  req: Request,
  env: Env,
  scope: 'ingest' | 'email' | 'sync' | 'admin',
): Promise<Device | null> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  return authenticateSecret(token, env, scope);
}

async function authenticateSecret(
  token: string,
  env: Env,
  scope: 'ingest' | 'email' | 'sync' | 'admin',
): Promise<Device | null> {
  const digest = await hashToken(token);
  const column =
    scope === 'ingest'
      ? 'ingest_token_hash'
      : scope === 'email'
        ? 'email_token_hash'
        : scope === 'sync'
          ? 'sync_token_hash'
          : 'admin_token_hash';
  const row = await env.DB.prepare(
    `SELECT id, vault_id, role, public_key, ${column} AS token_hash FROM devices WHERE ${column} = ?1`,
  )
    .bind(digest)
    .first<{
      id: string;
      vault_id: string;
      role: 'owner' | 'member';
      public_key: string;
      token_hash: string;
    }>();
  if (!row || !timingSafeEqual(row.token_hash, digest)) return null;
  // Shortcut traffic is not proof the app still exists: an automation can
  // survive an uninstall. Only an app-admin operation refreshes last_seen.
  if (scope === 'admin' || scope === 'sync') {
    await env.DB.prepare('UPDATE devices SET last_seen = unixepoch() WHERE id = ?1')
      .bind(row.id)
      .run();
  }
  return {
    id: row.id,
    vault_id: row.vault_id,
    role: row.role,
    public_key: row.public_key,
    requestSecret: token,
  };
}

/** A global fixed window prevents unbounded identity creation in the Worker. */
async function overPairRateLimit(env: Env): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / 60_000) * 60;
  const row = await env.DB.prepare(
    `INSERT INTO pair_limits (id, window_start, request_count)
     VALUES ('global', ?1, 1)
     ON CONFLICT(id) DO UPDATE SET
       request_count = CASE
         WHEN pair_limits.window_start = excluded.window_start
         THEN pair_limits.request_count + 1
         ELSE 1
       END,
       window_start = excluded.window_start
     RETURNING request_count`,
  )
    .bind(windowStart)
    .first<{ request_count: number }>();
  return (row?.request_count ?? PAIR_PER_MINUTE + 1) > PAIR_PER_MINUTE;
}

/** Fixed hourly window without retaining an IP address or message fingerprint. */
async function overRateLimit(env: Env, deviceId: string): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / 3_600_000) * 3_600;
  const row = await env.DB.prepare(
    `INSERT INTO ingest_limits (device_id, window_start, request_count)
     VALUES (?1, ?2, 1)
     ON CONFLICT(device_id) DO UPDATE SET
       request_count = CASE
         WHEN ingest_limits.window_start = excluded.window_start
         THEN ingest_limits.request_count + 1
         ELSE 1
       END,
       window_start = excluded.window_start
     RETURNING request_count`,
  )
    .bind(deviceId, windowStart)
    .first<{ request_count: number }>();
  return (row?.request_count ?? INGEST_PER_HOUR + 1) > INGEST_PER_HOUR;
}

async function queueIsFull(env: Env, deviceId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM queue WHERE device_id = ?1')
    .bind(deviceId)
    .first<{ n: number }>();
  return (row?.n ?? MAX_QUEUED_ROWS) >= MAX_QUEUED_ROWS;
}

/**
 * A key is valid here only if the Worker can still seal to it in a month's
 * time. Thirty-two bytes that import cleanly is not that test: every
 * degenerate X25519 point imports, and then fails at agreement. Enrolling one
 * used to be free, and the bill arrived at the next ingest — see `canSealTo`.
 *
 * Both enrollment routes are already capped at PAIR_PER_MINUTE globally, and
 * the added agreement is roughly a tenth of a millisecond, so this is paid
 * once per device rather than once per bank alert.
 */
async function validPublicKey(value: unknown): Promise<boolean> {
  if (typeof value !== 'string' || value.length > 128) return false;
  return canSealTo(value);
}

function friendlyName(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || [...normalized].length > 40) return undefined;
  return normalized;
}

function withoutRaw(parsed: NonNullable<ReturnType<typeof parseSms>>): Record<string, unknown> {
  const { raw: _discard, ...structured } = parsed;
  return structured;
}

async function queueStructuredRow(
  env: Env,
  device: Device,
  row: Record<string, unknown>,
  replayKey: string,
  receiptTtlSeconds: number,
): Promise<string[]> {
  const { results: vaultDevices } = await env.DB.prepare(
    `SELECT d.id, d.public_key
       FROM devices d
      WHERE d.vault_id = ?1
        AND (SELECT COUNT(*) FROM queue q WHERE q.device_id = d.id) < ?2`,
  )
    .bind(device.vault_id, MAX_QUEUED_ROWS)
    .all<{ id: string; public_key: string }>();
  const targets = vaultDevices ?? [];
  if (targets.length === 0) return [];
  // One device is not the vault. Sealing used to be a single Promise.all, so a
  // device whose stored key cannot be agreed with — enrolled before
  // `validPublicKey` tested for that — took every later ingest in its vault
  // down with it: the throw escaped the request as an unhandled exception, and
  // capture stopped dead while devices, sync and invites all still answered
  // 200. Total silent loss for the whole household is strictly worse than no
  // delivery to the one phone that cannot receive anything anyway, so an
  // unsealable device is skipped and the rest of the vault is served.
  //
  // Skipped, but not swallowed: only a key that provably cannot be sealed to
  // is passed over, and `canSealTo` proves that rather than assuming it —
  // a runtime that is failing for its own reasons throws out of here instead
  // of quietly reporting every device in the vault as unreachable. Anything
  // else that made `seal` throw is a bug rather than a bad key, and is
  // rethrown rather than costing someone a row in silence. GET /v1/devices
  // reports `canReceive` so the skip that does happen has a name attached.
  const attempts = await Promise.allSettled(
    targets.map(async (target) => ({ id: target.id, sealed: await seal(target.public_key, row) })),
  );
  const sealedTargets: { id: string; sealed: SealedBlob }[] = [];
  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    if (attempt.status === 'fulfilled') sealedTargets.push(attempt.value);
    else if (await canSealTo(targets[index].public_key)) throw attempt.reason;
  }
  const results = await env.DB.batch([
    ...sealedTargets.map((target) =>
      env.DB.prepare(
        `INSERT INTO queue (id, device_id, epk, iv, ct, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, unixepoch()
          WHERE NOT EXISTS (
            SELECT 1 FROM ingest_receipts
             WHERE device_id = ?6 AND replay_key = ?7 AND expires_at > unixepoch()
          )`,
      ).bind(
        crypto.randomUUID(),
        target.id,
        target.sealed.epk,
        target.sealed.iv,
        target.sealed.ct,
        device.id,
        replayKey,
      ),
    ),
    env.DB.prepare(
      `INSERT INTO ingest_receipts (device_id, replay_key, created_at, expires_at)
       VALUES (?1, ?2, unixepoch(), unixepoch() + ?3)
       ON CONFLICT(device_id, replay_key) DO UPDATE SET
         created_at = excluded.created_at,
         expires_at = excluded.expires_at`,
    ).bind(device.id, replayKey, receiptTtlSeconds),
  ]);
  return sealedTargets
    .filter((_, index) => (results[index].meta.changes ?? 0) > 0)
    .map((target) => target.id);
}

async function queueEmailRows(
  env: Env,
  device: Device,
  normalized: string,
  eventMaterial: string,
): Promise<{ acceptedRows: number; wake: Set<string> }> {
  const alert = parseSms(normalized);
  const parsedRows = alert ? [alert] : parseStatementText(normalized);
  if (parsedRows.length === 0) return { acceptedRows: 0, wake: new Set() };
  if (parsedRows.length > MAX_IMPORT_ROWS) throw new Error('too_many_rows');
  const baseKey = await keyedFingerprint(device.requestSecret, eventMaterial);
  const receivedAt = new Date().toISOString();
  const wake = new Set<string>();
  for (let index = 0; index < parsedRows.length; index++) {
    const inserted = await queueStructuredRow(
      env,
      device,
      { ...withoutRaw(parsedRows[index]), captureSource: 'email', receivedAt },
      `${baseKey}:${index}`,
      REPLAY_WINDOW_SECONDS,
    );
    for (const targetId of inserted) wake.add(targetId);
  }
  return { acceptedRows: parsedRows.length, wake };
}

async function wakeDevice(env: Env, deviceId: string): Promise<void> {
  if (!env.PUSH_TOKEN_KEY) return;
  const row = await env.DB.prepare(
    `SELECT token_iv, token_ct
       FROM push_registrations
      WHERE device_id = ?1 AND expires_at > unixepoch()`,
  )
    .bind(deviceId)
    .first<{ token_iv: string; token_ct: string }>();
  if (!row) return;

  try {
    const token = await decryptPushToken(env.PUSH_TOKEN_KEY, { iv: row.token_iv, ct: row.token_ct });
    const result = await sendWakePush(token, env.EXPO_ACCESS_TOKEN);
    if (result.unregistered) {
      await env.DB.prepare('DELETE FROM push_registrations WHERE device_id = ?1')
        .bind(deviceId)
        .run();
    }
  } catch {
    // The queue is durable and foreground sync remains available. Push token,
    // provider and network errors are deliberately not allowed to reject the
    // user's bank alert or expose it through error logging.
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!secureTransport(url)) return json({ error: 'https_required' }, 400);

    // ── Pairing: the app posts its X25519 public key, gets a bearer token ──
    //
    // No email, no password, no account. Identity is a key the phone generated
    // and never sends again. Losing the phone loses the queue, which is the
    // correct outcome for a service that is meant to hold nothing.
    if (req.method === 'POST' && url.pathname === '/v1/pair') {
      if (await overPairRateLimit(env)) return json({ error: 'rate_limited' }, 429);
      const incoming = await readBody(req, MAX_PAIR_BYTES);
      if (incoming.tooLarge) return json({ error: 'too_large' }, 413);
      const body = (() => {
        try {
          return JSON.parse(incoming.text) as { publicKey?: unknown; deviceName?: unknown };
        } catch {
          return null;
        }
      })();
      const pk = body?.publicKey;
      if (!(await validPublicKey(pk))) return json({ error: 'bad_public_key' }, 400);
      const name = friendlyName(body?.deviceName);
      if (name === undefined) return json({ error: 'bad_device_name' }, 400);
      const id = crypto.randomUUID();
      const vaultId = crypto.randomUUID();
      const ingestToken = randomToken();
      const syncToken = randomToken();
      const adminToken = randomToken();
      await env.DB.batch([
        env.DB.prepare('INSERT INTO vaults (id, created_at) VALUES (?1, unixepoch())')
          .bind(vaultId),
        env.DB.prepare(
          `INSERT INTO devices
            (id, vault_id, role, friendly_name, public_key, ingest_token_hash,
             sync_token_hash, admin_token_hash, created_at, last_seen)
           VALUES (?1, ?2, 'owner', ?3, ?4, ?5, ?6, ?7, unixepoch(), unixepoch())`,
        ).bind(
          id,
          vaultId,
          name,
          pk,
          await hashToken(ingestToken),
          await hashToken(syncToken),
          await hashToken(adminToken),
        ),
      ]);
      return json({
        deviceId: id,
        ingestToken,
        syncToken,
        adminToken,
      });
    }

    // ── Trusted-device enrollment ──
    // The existing phone creates a short-lived, one-use token. The new phone
    // still generates its own X25519 keypair and receives independent scoped
    // credentials, so no private key or long-lived admin secret is copied.
    if (req.method === 'POST' && url.pathname === '/v1/device-invites') {
      const device = await authenticate(req, env, 'admin');
      if (!device) return json({ error: 'unauthorized' }, 401);
      if (device.role !== 'owner') return json({ error: 'owner_required' }, 403);
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE vault_id = ?1')
        .bind(device.vault_id)
        .first<{ n: number }>();
      if ((count?.n ?? MAX_VAULT_DEVICES) >= MAX_VAULT_DEVICES) {
        return json({ error: 'device_limit' }, 409);
      }
      const inviteToken = randomToken();
      await env.DB.prepare(
        `INSERT INTO device_invites (token_hash, vault_id, expires_at, created_at)
         VALUES (?1, ?2, unixepoch() + ?3, unixepoch())`,
      )
        .bind(await hashToken(inviteToken), device.vault_id, INVITE_TTL_SECONDS)
        .run();
      return json({ inviteToken, expiresIn: INVITE_TTL_SECONDS }, 201);
    }

    if (req.method === 'POST' && url.pathname === '/v1/join') {
      if (await overPairRateLimit(env)) return json({ error: 'rate_limited' }, 429);
      const incoming = await readBody(req, MAX_PAIR_BYTES);
      if (incoming.tooLarge) return json({ error: 'too_large' }, 413);
      const body = (() => {
        try {
          return JSON.parse(incoming.text) as {
            publicKey?: unknown;
            inviteToken?: unknown;
            deviceName?: unknown;
          };
        } catch {
          return null;
        }
      })();
      if (!(await validPublicKey(body?.publicKey))) {
        return json({ error: 'bad_public_key' }, 400);
      }
      const name = friendlyName(body?.deviceName);
      if (name === undefined) return json({ error: 'bad_device_name' }, 400);
      if (
        typeof body?.inviteToken !== 'string' ||
        body.inviteToken.length < 40 ||
        body.inviteToken.length > 128
      ) {
        return json({ error: 'bad_invite' }, 400);
      }
      const inviteHash = await hashToken(body.inviteToken);
      const id = crypto.randomUUID();
      const ingestToken = randomToken();
      const syncToken = randomToken();
      const adminToken = randomToken();
      const [joined] = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO devices
            (id, vault_id, role, friendly_name, public_key, ingest_token_hash,
             sync_token_hash, admin_token_hash, created_at, last_seen)
           SELECT ?1, vault_id, 'member', ?2, ?3, ?4, ?5, ?6, unixepoch(), unixepoch()
             FROM device_invites
            WHERE token_hash = ?7 AND expires_at > unixepoch()
              AND (SELECT COUNT(*) FROM devices WHERE devices.vault_id = device_invites.vault_id) < ?8`,
        ).bind(
          id,
          name,
          body.publicKey,
          await hashToken(ingestToken),
          await hashToken(syncToken),
          await hashToken(adminToken),
          inviteHash,
          MAX_VAULT_DEVICES,
        ),
        env.DB.prepare('DELETE FROM device_invites WHERE token_hash = ?1').bind(inviteHash),
      ]);
      if ((joined.meta.changes ?? 0) !== 1) return json({ error: 'bad_invite' }, 400);
      return json({
        deviceId: id,
        ingestToken,
        syncToken,
        adminToken,
      }, 201);
    }

    // ── Vault devices: list, name and revoke ──
    if (req.method === 'GET' && url.pathname === '/v1/devices') {
      const device = await authenticate(req, env, 'admin');
      if (!device) return json({ error: 'unauthorized' }, 401);
      const { results } = await env.DB.prepare(
        `SELECT id, role, friendly_name, created_at, last_seen,
                email_token_hash IS NOT NULL AS email_enabled
           FROM devices WHERE vault_id = ?1
          ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at ASC`,
      )
        .bind(device.vault_id)
        .all<{
          id: string;
          role: 'owner' | 'member';
          friendly_name: string | null;
          created_at: number;
          last_seen: number;
          email_enabled: number;
        }>();
      const rows = results ?? [];
      // A device that cannot be sealed to receives nothing and says nothing:
      // it goes on listing, syncing and looking enrolled. This is the one
      // place the owner can be told which phone that is, so it is reported
      // rather than left to be inferred from an empty ledger. Recomputed per
      // request instead of stored — the keys are already here, there are at
      // most MAX_VAULT_DEVICES of them, and it costs one key agreement each.
      //
      // Deliberately a second read: the list query above stays free of key and
      // token columns by construction, and these keys never leave the Worker.
      const { results: vaultKeys } = await env.DB.prepare(
        'SELECT id, public_key FROM devices WHERE vault_id = ?1',
      )
        .bind(device.vault_id)
        .all<{ id: string; public_key: string }>();
      const canReceive = new Map(
        await Promise.all(
          (vaultKeys ?? []).map(
            async (row) => [row.id, await canSealTo(row.public_key)] as const,
          ),
        ),
      );
      return json({
        devices: rows.map((row) => ({
          id: row.id,
          name: row.friendly_name,
          role: row.role,
          isCurrent: row.id === device.id,
          joinedAt: row.created_at,
          lastSeenAt: row.last_seen,
          emailForwardingEnabled: row.email_enabled === 1,
          canReceive: canReceive.get(row.id) ?? false,
        })),
      });
    }

    const deviceRoute = /^\/v1\/devices\/([^/]+)$/.exec(url.pathname);
    if (deviceRoute && req.method === 'PATCH') {
      const device = await authenticate(req, env, 'admin');
      if (!device) return json({ error: 'unauthorized' }, 401);
      const targetId = deviceRoute[1];
      if (!UUID_RE.test(targetId)) return json({ error: 'bad_device_id' }, 400);
      const target = await env.DB.prepare(
        'SELECT id FROM devices WHERE id = ?1 AND vault_id = ?2',
      )
        .bind(targetId, device.vault_id)
        .first<{ id: string }>();
      if (!target) return json({ error: 'device_not_found' }, 404);
      if (device.role !== 'owner' && target.id !== device.id) {
        return json({ error: 'owner_required' }, 403);
      }
      const incoming = await readBody(req, MAX_PAIR_BYTES);
      if (incoming.tooLarge) return json({ error: 'too_large' }, 413);
      const body = (() => {
        try {
          return JSON.parse(incoming.text) as { name?: unknown };
        } catch {
          return null;
        }
      })();
      const name = friendlyName(body?.name);
      if (name === undefined || name === null) return json({ error: 'bad_device_name' }, 400);
      await env.DB.prepare('UPDATE devices SET friendly_name = ?1 WHERE id = ?2')
        .bind(name, target.id)
        .run();
      return json({ id: target.id, name });
    }

    if (deviceRoute && req.method === 'DELETE') {
      const device = await authenticate(req, env, 'admin');
      if (!device) return json({ error: 'unauthorized' }, 401);
      const targetId = deviceRoute[1];
      if (!UUID_RE.test(targetId)) return json({ error: 'bad_device_id' }, 400);
      const target = await env.DB.prepare(
        'SELECT id, role FROM devices WHERE id = ?1 AND vault_id = ?2',
      )
        .bind(targetId, device.vault_id)
        .first<{ id: string; role: 'owner' | 'member' }>();
      if (!target) return json({ error: 'device_not_found' }, 404);
      if (device.role !== 'owner' && target.id !== device.id) {
        return json({ error: 'owner_required' }, 403);
      }
      if (target.role === 'owner') {
        const owners = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM devices WHERE vault_id = ?1 AND role = 'owner'`,
        )
          .bind(device.vault_id)
          .first<{ n: number }>();
        if ((owners?.n ?? 0) <= 1) return json({ error: 'last_owner' }, 409);
      }
      await env.DB.batch([
        env.DB.prepare('DELETE FROM push_registrations WHERE device_id = ?1').bind(target.id),
        env.DB.prepare('DELETE FROM ingest_receipts WHERE device_id = ?1').bind(target.id),
        env.DB.prepare('DELETE FROM queue WHERE device_id = ?1').bind(target.id),
        env.DB.prepare('DELETE FROM ingest_limits WHERE device_id = ?1').bind(target.id),
        env.DB.prepare('DELETE FROM devices WHERE id = ?1').bind(target.id),
      ]);
      return empty(204);
    }

    if (req.method === 'DELETE' && url.pathname === '/v1/vault') {
      const device = await authenticate(req, env, 'admin');
      if (!device) return json({ error: 'unauthorized' }, 401);
      if (device.role !== 'owner') return json({ error: 'owner_required' }, 403);
      await env.DB.batch([
        env.DB.prepare(
          'DELETE FROM push_registrations WHERE device_id IN (SELECT id FROM devices WHERE vault_id = ?1)',
        ).bind(device.vault_id),
        env.DB.prepare(
          'DELETE FROM ingest_receipts WHERE device_id IN (SELECT id FROM devices WHERE vault_id = ?1)',
        ).bind(device.vault_id),
        env.DB.prepare(
          'DELETE FROM queue WHERE device_id IN (SELECT id FROM devices WHERE vault_id = ?1)',
        ).bind(device.vault_id),
        env.DB.prepare(
          'DELETE FROM ingest_limits WHERE device_id IN (SELECT id FROM devices WHERE vault_id = ?1)',
        ).bind(device.vault_id),
        env.DB.prepare('DELETE FROM device_invites WHERE vault_id = ?1').bind(device.vault_id),
        env.DB.prepare('DELETE FROM devices WHERE vault_id = ?1').bind(device.vault_id),
        env.DB.prepare('DELETE FROM vaults WHERE id = ?1').bind(device.vault_id),
      ]);
      return empty(204);
    }

    // ── Ingest: one message from the user's Shortcut ──
    if (req.method === 'POST' && url.pathname === '/v1/ingest') {
      const device = await authenticate(req, env, 'ingest');
      if (!device) return json({ error: 'unauthorized' }, 401);
      if (await overRateLimit(env, device.id)) return json({ error: 'rate_limited' }, 429);
      if (await queueIsFull(env, device.id)) return json({ error: 'queue_full' }, 429);

      const incoming = await readBody(req, MAX_BODY_BYTES);
      if (incoming.tooLarge) return json({ error: 'too_large' }, 413);
      const body = ((): { text?: string; eventId?: unknown; sender?: unknown } | null => {
        try {
          const parsed = JSON.parse(incoming.text) as unknown;
          if (typeof parsed === 'string') return { text: parsed };
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed as { text?: string; eventId?: unknown; sender?: unknown };
          }
          return null;
        } catch {
          // Shortcuts is fiddly about JSON; accept a bare text body too.
          return { text: incoming.text };
        }
      })();
      const text = body?.text;
      if (typeof text !== 'string' || !text.trim()) return json({ error: 'empty' }, 400);
      const eventId = body?.eventId;
      if (
        eventId !== undefined &&
        (typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(eventId))
      ) {
        return json({ error: 'bad_event_id' }, 400);
      }
      // Optional, so a Shortcut built against the older two-field contract and
      // the manual setup test both keep working unchanged.
      const sender = relaySender(body?.sender);
      // The rejected value is never echoed: an error that quotes what it
      // refused is a way to read data back out of a write-only endpoint.
      if (sender === undefined) return json({ error: 'bad_sender' }, 400);

      const isTest = text.trim() === RELAY_TEST_MESSAGE;
      const parsed = isTest ? null : parseSms(text);
      // Not a transaction — an OTP, a promo, a delivery notice. Nothing is
      // stored and nothing is echoed back: the Shortcut fires on every message
      // from the sender, and most of them are none of our business.
      if (!parsed && !isTest) return empty(204);

      // `raw` is deliberately dropped here. It is the one field the app's own
      // importer keeps for its "unrecognised format" report, and keeping it
      // server-side would turn this database into a readable archive of the
      // user's bank messages — the thing this design exists to avoid.
      const row = (() => {
        if (isTest) return { relayTest: true as const };
        const { raw: _discard, ...structured } = parsed!;
        return structured;
      })();
      const rowWithReceipt = {
        ...row,
        ...(!isTest && { captureSource: 'shortcut' as const }),
        // Sealed alongside the parsed row and nowhere else. The setup probe is
        // not a bank message, so it gets no bank label.
        ...(!isTest && sender ? { sender } : {}),
        // Relay receipt time is authoritative. Accepting a caller-provided date
        // lets a broken Shortcut place a valid transaction years in the past.
        receivedAt: new Date().toISOString(),
      };
      const replayMaterial =
        typeof eventId === 'string'
          ? `event:${eventId}`
          : // Without an eventId the body is the identity, and the sender is
            // part of that body: two banks can send the same wording for the
            // same amount on the same day, and collapsing those loses a real
            // transaction. Absent sender leaves the old material untouched.
            `body:${sender ? `${sender}:` : ''}${text.trim().replace(/\s+/g, ' ')}`;
      const replayKey = await keyedFingerprint(device.requestSecret, replayMaterial);
      const insertedTargets = await queueStructuredRow(
        env,
        device,
        rowWithReceipt,
        replayKey,
        REPLAY_WINDOW_SECONDS,
      );
      if (insertedTargets.length === 0 && (await queueIsFull(env, device.id))) {
        return json({ error: 'queue_full' }, 429);
      }
      // A setup probe is consumed by the foreground proof screen. Waking the
      // headless collector here could acknowledge the marker before that
      // screen observes it, making a working setup time out at random.
      if (!isTest && insertedTargets.length > 0) ctx.waitUntil(
        Promise.all(insertedTargets.map((targetId) => wakeDevice(env, targetId))),
      );
      return empty(202);
    }

    // ── Forwarded email and PDF statement supplements ──
    if (req.method === 'GET' && url.pathname === '/v1/import/capabilities') {
      const device = await authenticate(req, env, 'admin');
      if (!device) return json({ error: 'unauthorized' }, 401);
      return json({
        email: {
          enabled: !!env.EMAIL_DOMAIN,
          accepts: ['text/plain', 'text/html', 'message/rfc822'],
          maxBytes: MAX_EMAIL_BYTES,
        },
        pdf: {
          enabled: true,
          accepts: ['application/pdf'],
          maxBytes: MAX_PDF_BYTES,
          maxRows: MAX_IMPORT_ROWS,
          maxPages: MAX_PDF_PAGES,
          parser: 'text-explicit-direction-v1',
          note: 'Scans and ambiguous visual debit/credit columns are rejected, not guessed.',
        },
      });
    }

    if (req.method === 'POST' && url.pathname === '/v1/email-token') {
      const device = await authenticate(req, env, 'admin');
      if (!device) return json({ error: 'unauthorized' }, 401);
      if (!env.EMAIL_DOMAIN) return json({ error: 'email_not_configured' }, 503);
      const emailToken = randomToken();
      await env.DB.prepare('UPDATE devices SET email_token_hash = ?1 WHERE id = ?2')
        .bind(await hashToken(emailToken), device.id)
        .run();
      return json({
        emailToken,
        forwardingAddress: `${emailToken}@${env.EMAIL_DOMAIN}`,
      }, 201);
    }

    if (req.method === 'DELETE' && url.pathname === '/v1/email-token') {
      const device = await authenticate(req, env, 'admin');
      if (!device) return json({ error: 'unauthorized' }, 401);
      await env.DB.prepare('UPDATE devices SET email_token_hash = NULL WHERE id = ?1')
        .bind(device.id)
        .run();
      return empty(204);
    }

    if (req.method === 'POST' && url.pathname === '/v1/email/ingest') {
      const device = await authenticate(req, env, 'email');
      if (!device) return json({ error: 'unauthorized' }, 401);
      if (await overRateLimit(env, device.id)) return json({ error: 'rate_limited' }, 429);
      const incoming = await readBody(req, MAX_EMAIL_BYTES);
      if (incoming.tooLarge) return json({ error: 'too_large' }, 413);
      const body = (() => {
        try {
          return JSON.parse(incoming.text) as {
            text?: unknown;
            html?: unknown;
            eventId?: unknown;
          };
        } catch {
          return null;
        }
      })();
      if (
        (body?.text !== undefined && typeof body.text !== 'string') ||
        (body?.html !== undefined && typeof body.html !== 'string')
      ) return json({ error: 'bad_email_content' }, 400);
      if (
        body?.eventId !== undefined &&
        (typeof body.eventId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.eventId))
      ) return json({ error: 'bad_event_id' }, 400);
      const normalized = normalizeEmailContent(body?.text, body?.html);
      if (!normalized) return json({ error: 'empty' }, 400);
      const eventMaterial =
        typeof body?.eventId === 'string' ? `email-event:${body.eventId}` : `email:${normalized}`;
      let imported;
      try {
        imported = await queueEmailRows(env, device, normalized, eventMaterial);
      } catch (error) {
        if (error instanceof Error && error.message === 'too_many_rows') {
          return json({ error: 'too_many_rows' }, 413);
        }
        throw error;
      }
      if (imported.acceptedRows === 0) return empty(204);
      if (imported.wake.size > 0) ctx.waitUntil(
        Promise.all([...imported.wake].map((id) => wakeDevice(env, id))),
      );
      return empty(202);
    }

    if (req.method === 'POST' && url.pathname === '/v1/import/pdf') {
      const device = await authenticate(req, env, 'admin');
      if (!device) return json({ error: 'unauthorized' }, 401);
      if (req.headers.get('content-type')?.split(';', 1)[0].trim() !== 'application/pdf') {
        return json({ error: 'pdf_required' }, 415);
      }
      const incoming = await readBytes(req, MAX_PDF_BYTES);
      if (incoming.tooLarge) return json({ error: 'too_large' }, 413);
      if (
        incoming.bytes.length < 5 ||
        String.fromCharCode(...incoming.bytes.subarray(0, 5)) !== '%PDF-'
      ) return json({ error: 'invalid_pdf' }, 400);

      let extracted: Awaited<ReturnType<typeof extractPdfStatementRows>>;
      try {
        extracted = await extractPdfStatementRows(incoming.bytes);
      } catch {
        return json({ error: 'unreadable_pdf' }, 422);
      }
      if (extracted.pages > MAX_PDF_PAGES) return json({ error: 'too_many_pages' }, 413);
      if (extracted.rows.length === 0) {
        return json({
          error: 'unsupported_statement_format',
          requirement: 'text_pdf_with_explicit_debit_credit_rows',
        }, 422);
      }
      if (extracted.rows.length > MAX_IMPORT_ROWS) return json({ error: 'too_many_rows' }, 413);
      const digest = b64encode(await crypto.subtle.digest('SHA-256', incoming.bytes));
      const baseKey = await keyedFingerprint(device.requestSecret, `pdf:${digest}`);
      const receivedAt = new Date().toISOString();
      const wake = new Set<string>();
      for (let index = 0; index < extracted.rows.length; index++) {
        const inserted = await queueStructuredRow(
          env,
          device,
          {
            ...withoutRaw(extracted.rows[index]),
            categoryDeliberate: true,
            captureSource: 'pdf',
            receivedAt,
          },
          `${baseKey}:${index}`,
          72 * 60 * 60,
        );
        for (const targetId of inserted) wake.add(targetId);
      }
      if (wake.size > 0) ctx.waitUntil(Promise.all([...wake].map((id) => wakeDevice(env, id))));
      return json({ acceptedRows: extracted.rows.length, pages: extracted.pages }, 202);
    }

    // ── Wake-only push registration ──
    // The admin token stays in the app; the ingest-only Shortcut cannot swap
    // the destination or use this endpoint to target another Expo device.
    if (req.method === 'PUT' && url.pathname === '/v1/push') {
      const device = await authenticate(req, env, 'admin');
      if (!device) return json({ error: 'unauthorized' }, 401);
      if (!env.PUSH_TOKEN_KEY || !env.EXPO_PROJECT_ID) {
        return json({ error: 'push_not_configured' }, 503);
      }
      const incoming = await readBody(req, MAX_PUSH_BYTES);
      if (incoming.tooLarge) return json({ error: 'too_large' }, 413);
      const body = (() => {
        try {
          return JSON.parse(incoming.text) as { expoPushToken?: unknown; projectId?: unknown };
        } catch {
          return null;
        }
      })();
      if (!isExpoPushToken(body?.expoPushToken)) return json({ error: 'bad_push_token' }, 400);
      if (
        !isExpoProjectId(body?.projectId) ||
        body.projectId.toLowerCase() !== env.EXPO_PROJECT_ID.toLowerCase()
      ) {
        return json({ error: 'bad_project_id' }, 400);
      }
      let encrypted;
      try {
        encrypted = await encryptPushToken(env.PUSH_TOKEN_KEY, body.expoPushToken);
      } catch {
        return json({ error: 'push_not_configured' }, 503);
      }
      await env.DB.prepare(
        `INSERT INTO push_registrations
          (device_id, token_iv, token_ct, project_id, expires_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, unixepoch() + ?5, unixepoch())
         ON CONFLICT(device_id) DO UPDATE SET
           token_iv = excluded.token_iv,
           token_ct = excluded.token_ct,
           project_id = excluded.project_id,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
      )
        .bind(
          device.id,
          encrypted.iv,
          encrypted.ct,
          body.projectId,
          PUSH_REGISTRATION_TTL_SECONDS,
        )
        .run();
      return empty(204);
    }

    if (req.method === 'DELETE' && url.pathname === '/v1/push') {
      const device = await authenticate(req, env, 'admin');
      if (!device) return json({ error: 'unauthorized' }, 401);
      await env.DB.prepare('DELETE FROM push_registrations WHERE device_id = ?1')
        .bind(device.id)
        .run();
      return empty(204);
    }

    // ── Sync: the app collects and acknowledges ──
    //
    // Delivery is acknowledged separately rather than deleted on read, so a
    // dropped response loses nothing: the app asks again and the row is still
    // there. Rows only disappear once the phone confirms it has them.
    if (req.method === 'GET' && url.pathname === '/v1/sync') {
      const device = await authenticate(req, env, 'sync');
      if (!device) return json({ error: 'unauthorized' }, 401);
      const { results } = await env.DB.prepare(
        'SELECT id, epk, iv, ct FROM queue WHERE device_id = ?1 ORDER BY created_at ASC LIMIT 200',
      )
        .bind(device.id)
        .all<{ id: string; epk: string; iv: string; ct: string }>();
      return json({ items: results ?? [] });
    }

    if (req.method === 'POST' && url.pathname === '/v1/ack') {
      const device = await authenticate(req, env, 'sync');
      if (!device) return json({ error: 'unauthorized' }, 401);
      const incoming = await readBody(req, MAX_ACK_BYTES);
      if (incoming.tooLarge) return json({ error: 'too_large' }, 413);
      const body = (() => {
        try {
          return JSON.parse(incoming.text) as { ids?: unknown };
        } catch {
          return null;
        }
      })();
      const ids = body?.ids;
      if (!Array.isArray(ids) || ids.length === 0) return json({ error: 'no_ids' }, 400);
      if (ids.length > 200) return json({ error: 'too_many' }, 400);
      if (!ids.every((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))) {
        return json({ error: 'bad_ids' }, 400);
      }
      const uniqueIds = [...new Set(ids)];
      const marks = uniqueIds.map((_, i) => `?${i + 2}`).join(',');
      await env.DB.prepare(`DELETE FROM queue WHERE device_id = ?1 AND id IN (${marks})`)
        .bind(device.id, ...uniqueIds)
        .run();
      return empty(204);
    }

    // ── Unpair: the user's delete button ──
    if (req.method === 'DELETE' && url.pathname === '/v1/device') {
      const device = await authenticate(req, env, 'admin');
      if (!device) return json({ error: 'unauthorized' }, 401);
      if (device.role === 'owner') {
        const others = await env.DB.prepare(
          'SELECT COUNT(*) AS n FROM devices WHERE vault_id = ?1 AND id <> ?2',
        )
          .bind(device.vault_id, device.id)
          .first<{ n: number }>();
        if ((others?.n ?? 0) > 0) return json({ error: 'last_owner' }, 409);
      }
      await env.DB.batch([
        env.DB.prepare('DELETE FROM push_registrations WHERE device_id = ?1').bind(device.id),
        env.DB.prepare('DELETE FROM ingest_receipts WHERE device_id = ?1').bind(device.id),
        env.DB.prepare('DELETE FROM queue WHERE device_id = ?1').bind(device.id),
        env.DB.prepare('DELETE FROM ingest_limits WHERE device_id = ?1').bind(device.id),
        env.DB.prepare('DELETE FROM devices WHERE id = ?1').bind(device.id),
      ]);
      await env.DB.prepare(
        `DELETE FROM vaults
          WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM devices WHERE vault_id = ?1)`,
      )
        .bind(device.vault_id)
        .run();
      await env.DB.prepare(
        'DELETE FROM device_invites WHERE vault_id NOT IN (SELECT id FROM vaults)',
      ).run();
      return empty(204);
    }

    if (req.method === 'GET' && url.pathname === '/v1/health') {
      return json({ ok: true });
    }

    return json({ error: 'not_found' }, 404);
  },

  /** Cloudflare Email Routing hook for `<email-token>@EMAIL_DOMAIN`. */
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const separator = message.to.lastIndexOf('@');
    const token = separator > 0 ? message.to.slice(0, separator) : '';
    const domain = separator > 0 ? message.to.slice(separator + 1).toLowerCase() : '';
    if (!env.EMAIL_DOMAIN || domain !== env.EMAIL_DOMAIN.toLowerCase()) {
      message.setReject('Unknown Wafra forwarding destination.');
      return;
    }
    const device = await authenticateSecret(token, env, 'email');
    if (!device) {
      message.setReject('This Wafra forwarding address is no longer active.');
      return;
    }
    if (message.rawSize > MAX_RAW_EMAIL_BYTES || await overRateLimit(env, device.id)) {
      message.setReject('This forwarded email exceeds Wafra import limits.');
      return;
    }

    let parsedEmail: Awaited<ReturnType<typeof parseRawEmail>>;
    try {
      parsedEmail = await parseRawEmail(message.raw);
    } catch {
      message.setReject('Wafra could not read this forwarded email.');
      return;
    }

    const messageId = message.headers.get('message-id')?.slice(0, 512) ?? crypto.randomUUID();
    const wake = new Set<string>();
    if (parsedEmail.text) {
      try {
        const imported = await queueEmailRows(
          env,
          device,
          parsedEmail.text,
          `mime:${messageId}`,
        );
        for (const id of imported.wake) wake.add(id);
      } catch {
        message.setReject('This forwarded email has too many statement rows.');
        return;
      }
    }

    for (let attachmentIndex = 0; attachmentIndex < parsedEmail.pdfAttachments.length; attachmentIndex++) {
      const bytes = parsedEmail.pdfAttachments[attachmentIndex];
      if (bytes.byteLength > MAX_PDF_BYTES) continue;
      let extracted: Awaited<ReturnType<typeof extractPdfStatementRows>>;
      try {
        extracted = await extractPdfStatementRows(bytes);
      } catch {
        continue;
      }
      if (
        extracted.pages > MAX_PDF_PAGES ||
        extracted.rows.length === 0 ||
        extracted.rows.length > MAX_IMPORT_ROWS
      ) continue;
      const digest = b64encode(await crypto.subtle.digest('SHA-256', bytes));
      const baseKey = await keyedFingerprint(
        device.requestSecret,
        `mime-pdf:${messageId}:${attachmentIndex}:${digest}`,
      );
      const receivedAt = new Date().toISOString();
      for (let rowIndex = 0; rowIndex < extracted.rows.length; rowIndex++) {
        const inserted = await queueStructuredRow(
          env,
          device,
          {
            ...withoutRaw(extracted.rows[rowIndex]),
            categoryDeliberate: true,
            captureSource: 'pdf',
            receivedAt,
          },
          `${baseKey}:${rowIndex}`,
          72 * 60 * 60,
        );
        for (const id of inserted) wake.add(id);
      }
    }
    if (wake.size > 0) ctx.waitUntil(Promise.all([...wake].map((id) => wakeDevice(env, id))));
  },

  /**
   * Retry wake-only delivery for retained rows and sweep expiry. APNs delivery
   * is best-effort, so one push at ingest time is not a recovery strategy.
   * The half-hour cadence stays within Apple's background-update guidance.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    // README's retention promise is enforced here, not left to successful
    // client acknowledgements or device cleanup.
    await env.DB.prepare('DELETE FROM queue WHERE created_at < unixepoch() - 2592000').run();
    await env.DB.prepare('DELETE FROM push_registrations WHERE expires_at <= unixepoch()').run();
    await env.DB.prepare('DELETE FROM device_invites WHERE expires_at <= unixepoch()').run();
    await env.DB.prepare(
      'DELETE FROM ingest_receipts WHERE expires_at <= unixepoch()',
    ).run();
    await env.DB.prepare(
      `DELETE FROM devices
       WHERE last_seen < unixepoch() - 31536000
         AND NOT EXISTS (SELECT 1 FROM queue WHERE queue.device_id = devices.id)`,
    ).run();
    await env.DB.prepare(
      'DELETE FROM ingest_limits WHERE device_id NOT IN (SELECT id FROM devices)',
    ).run();
    await env.DB.prepare(
      'DELETE FROM ingest_receipts WHERE device_id NOT IN (SELECT id FROM devices)',
    ).run();
    await env.DB.prepare(
      'DELETE FROM vaults WHERE id NOT IN (SELECT DISTINCT vault_id FROM devices)',
    ).run();
    const { results: pending } = await env.DB.prepare(
      `SELECT DISTINCT q.device_id AS id
         FROM queue q
         JOIN push_registrations p ON p.device_id = q.device_id
        WHERE p.expires_at > unixepoch()`,
    ).all<{ id: string }>();
    await Promise.all((pending ?? []).map((row) => wakeDevice(env, row.id)));
  },
} satisfies ExportedHandler<Env>;
