/**
 * Opt-in shared bank-alert formats (server half).
 *
 * A "shape" is a value-free template of a bank alert: literal wording plus slot
 * kinds. It never carries an amount, name, card digit, date or message text.
 * The validator below is deliberately strict and mirrors the app's
 * src/lib/shared-alert-formats.ts: the relay never trusts the client's own
 * sanitising. A shape is published once >= PUBLISH_THRESHOLD distinct vaults
 * submitted the identical shape (k-anonymity).
 *
 * Nothing in this module logs. Shape content must never reach a log line.
 */
/** The slice of the Worker's Env this module reads. Declared here rather than
 * imported from './index' because the app test build renames index.ts. */
interface Env {
  DB: D1Database;
  FORMATS_SALT?: string;
  FORMATS_ADMIN_TOKEN?: string;
}

export const PUBLISH_THRESHOLD = 3;
export const SUBMISSIONS_PER_DAY = 20;
export const MAX_PUBLISHED = 2000;
export const MAX_SHAPE_BYTES = 8192;
export const MAX_SUBMIT_BYTES = 16 * 1024;

export type SharedFormatStatus = 'pending' | 'published' | 'blocked';

export type SharedShape = {
  v: 1;
  sender: string;
  direction: 'debit' | 'credit';
  currency: string;
  aliases: Record<string, string>;
  dateOrder: 'DMY' | 'MDY' | 'YMD' | null;
  tokens: Array<Record<string, unknown>>;
  advisory: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** True when the object has exactly the allowed keys (required + optional). */
function onlyKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => key in value) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

const countDigits = (text: string): number => (text.match(/[0-9]/g) ?? []).length;
const ISO = /^[A-Z]{3}$/;
// The same rules as the app's validator, so the relay never stores a vote no
// phone could use.
const SENDER = /^[A-Z0-9][A-Z0-9 ._&-]*$/;
const MAX_LITERAL = 64;
/** Kept equal to SHAREABLE_FLAGGED in src/lib/shared-alert-formats.ts. */
const SHAREABLE_FLAGGED = new Set([
  'account', 'accounts', 'acct', 'alert', 'amount', 'atm', 'available', 'avail', 'avl', 'balance',
  'bank', 'banking', 'card', 'cards', 'cash', 'charge', 'charged', 'cheque', 'clear', 'cleared',
  'credit', 'credited', 'customer', 'debit', 'debited', 'deposit', 'deposited', 'dear', 'limit',
  'merchant', 'mobile', 'online', 'paid', 'payment', 'pos', 'purchase', 'received', 'refund',
  'refunded', 'reversal', 'reversed', 'salary', 'sent', 'spent', 'thank', 'thanks', 'total',
  'transaction', 'transfer', 'transferred', 'upi', 'used', 'wallet', 'withdrawal', 'withdrawn',
  'your', 'from', 'with', 'info', 'details', 'ending', 'debitcard', 'creditcard', 'neft', 'imps', 'rtgs',
  'bal', 'ac', 'acc', 'txn', 'amt', 'avbl', 'ref', 'dr', 'cr', 'vpa', 'ltd', 'sms', 'call', 'block',
  'not', 'you', 'please', 'pls', 'is', 'has', 'been', 'was', 'on', 'at', 'to', 'by', 'for', 'of', 'the',
  'and', 'in', 'a', 'an', 'if', 'or', 'via', 'new', 'now', 'helpline', 'support', 'service',
]);
export const PENDING_TTL_SECONDS = 30 * 86400;
export const VAULT_MIN_AGE_SECONDS = 86400;
/** The published list stays well under the 8M-character download cap in the app. */
export const MAX_PUBLISHED_BYTES = 4 * 1024 * 1024;

function validToken(token: unknown): boolean {
  if (!isObject(token) || typeof token.k !== 'string') return false;
  switch (token.k) {
    case 'L': {
      if (!onlyKeys(token, ['k', 'v'], ['m'])) return false;
      if (token.m !== undefined && token.m !== 1) return false;
      const v = token.v;
      return (
        typeof v === 'string' &&
        v.length >= 1 &&
        v.length <= MAX_LITERAL &&
        !/[0-9]/.test(v) &&
        !v.includes('@') &&
        !/(?:http|www\.)/i.test(v) &&
        v.split(/\s+/).every((word) => word.length < 24) &&
        (token.m !== 1 ||
          v.split(/[^\p{L}]+/u).every((word) => word === '' || SHAREABLE_FLAGGED.has(word.toLowerCase())))
      );
    }
    case 'AMT':
    case 'MER':
      return onlyKeys(token, ['k']);
    case 'BAL':
      return onlyKeys(token, ['k', 'iso']) && typeof token.iso === 'string' && ISO.test(token.iso);
    case 'DATE':
    case 'DATEX':
    case 'TIME':
    case 'CARD':
    case 'NUM':
      return onlyKeys(token, ['k', 'f']) && typeof token.f === 'string' && token.f.length <= 32;
    case 'ALNUM':
      return (
        onlyKeys(token, ['k', 'n']) &&
        typeof token.n === 'number' &&
        Number.isInteger(token.n) &&
        token.n >= 1 &&
        token.n <= 64
      );
    default:
      return false;
  }
}

/** Canonical JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateSharedShape(input: unknown): SharedShape | null {
  if (!isObject(input)) return null;
  if (!onlyKeys(input, ['v', 'sender', 'direction', 'currency', 'aliases', 'dateOrder', 'tokens', 'advisory'])) {
    return null;
  }
  if (input.v !== 1) return null;
  const { sender, direction, currency, aliases, dateOrder, tokens, advisory } = input;
  if (typeof sender !== 'string' || sender.length < 1 || sender.length > 32) return null;
  if (!SENDER.test(sender) || sender.includes('@') || countDigits(sender) >= 7) return null;
  if (direction !== 'debit' && direction !== 'credit') return null;
  if (typeof currency !== 'string' || !ISO.test(currency)) return null;
  if (!isObject(aliases)) return null;
  const aliasKeys = Object.keys(aliases);
  if (aliasKeys.length > 16) return null;
  for (const key of aliasKeys) {
    if (key.length < 1 || key.length > 8 || aliases[key] !== currency) return null;
  }
  if (dateOrder !== null && dateOrder !== 'DMY' && dateOrder !== 'MDY' && dateOrder !== 'YMD') return null;
  if (typeof advisory !== 'boolean') return null;
  if (!Array.isArray(tokens) || tokens.length < 1 || tokens.length > 160) return null;
  if (!tokens.every(validToken)) return null;
  if (tokens.filter((token) => (token as { k: string }).k === 'AMT').length !== 1) return null;
  if (new TextEncoder().encode(canonicalJson(input)).length > MAX_SHAPE_BYTES) return null;
  return input as unknown as SharedShape;
}

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export const shapeHash = (shape: SharedShape): Promise<string> => sha256Hex(canonicalJson(shape));

/**
 * Production MUST set FORMATS_SALT (wrangler secret put FORMATS_SALT). The
 * fallback is a fixed, domain-separated constant so tests and unconfigured
 * deployments still work; it makes vault_hash a deterministic function of the
 * vault id, which a keyed deployment avoids.
 */
const FALLBACK_SALT = 'wafra/v1/shared-formats/vault-hash/unkeyed-fallback';

export async function vaultHash(env: Env, vaultId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.FORMATS_SALT || FALLBACK_SALT),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(vaultId)));
}

/** Constant-time admin check. False (caller answers 404) when unset or wrong. */
export async function adminAuthorized(req: Request, env: Env): Promise<boolean> {
  if (!env.FORMATS_ADMIN_TOKEN) return false;
  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const [a, b] = await Promise.all([sha256Hex(presented), sha256Hex(env.FORMATS_ADMIN_TOKEN)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return presented.length > 0 && diff === 0;
}

export async function overSubmissionLimit(env: Env, vaultHashValue: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM shared_format_votes WHERE vault_hash = ?1 AND created_at > unixepoch() - 86400',
  )
    .bind(vaultHashValue)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= SUBMISSIONS_PER_DAY;
}

/** Records one vault's vote and returns the shape's resulting status. */
export async function recordSubmission(
  env: Env,
  shape: SharedShape,
  hash: string,
  vaultHashValue: string,
  vaultCreatedAt: number,
): Promise<SharedFormatStatus> {
  // Unpublished shapes expire: a layout nobody else taught in 30 days (most
  // likely one carrying something personal) does not stay on the relay.
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM shared_format_votes WHERE shape_hash IN
         (SELECT shape_hash FROM shared_format_shapes WHERE status = 'pending' AND first_seen < unixepoch() - ?1)`,
    ).bind(PENDING_TTL_SECONDS),
    env.DB.prepare(`DELETE FROM shared_format_shapes WHERE status = 'pending' AND first_seen < unixepoch() - ?1`)
      .bind(PENDING_TTL_SECONDS),
  ]);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO shared_format_shapes (shape_hash, shape_json, bank_sender, first_seen)
     VALUES (?1, ?2, ?3, unixepoch())`,
  )
    .bind(hash, canonicalJson(shape), shape.sender)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO shared_format_votes (shape_hash, vault_hash, created_at, counts_after)
     VALUES (?1, ?2, unixepoch(), ?3)`,
  )
    .bind(hash, vaultHashValue, vaultCreatedAt + VAULT_MIN_AGE_SECONDS)
    .run();
  await env.DB.prepare(
    `UPDATE shared_format_shapes
        SET vault_count = (SELECT COUNT(*) FROM shared_format_votes WHERE shape_hash = ?1 AND counts_after <= unixepoch())
      WHERE shape_hash = ?1`,
  )
    .bind(hash)
    .run();
  await env.DB.prepare(
    `UPDATE shared_format_shapes
        SET status = 'published', published_at = unixepoch()
      WHERE shape_hash = ?1 AND status = 'pending' AND vault_count >= ?2`,
  )
    .bind(hash, PUBLISH_THRESHOLD)
    .run();
  const row = await env.DB.prepare('SELECT status FROM shared_format_shapes WHERE shape_hash = ?1')
    .bind(hash)
    .first<{ status: SharedFormatStatus }>();
  return row?.status ?? 'pending';
}

export async function listPublished(env: Env): Promise<Array<{ hash: string; shape: unknown }>> {
  const { results } = await env.DB.prepare(
    `SELECT shape_hash, shape_json FROM shared_format_shapes
      WHERE status = 'published'
      ORDER BY published_at, shape_hash LIMIT ?1`,
  )
    .bind(MAX_PUBLISHED)
    .all<{ shape_hash: string; shape_json: string }>();
  const out: Array<{ hash: string; shape: unknown }> = [];
  let bytes = 0;
  for (const row of results) {
    bytes += row.shape_json.length + 80;
    if (bytes > MAX_PUBLISHED_BYTES) break;
    try {
      out.push({ hash: row.shape_hash, shape: JSON.parse(row.shape_json) as unknown });
    } catch {
      // A corrupt row is skipped rather than failing the whole list.
    }
  }
  return out;
}

export async function listAllForAdmin(env: Env): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    `SELECT shape_hash, shape_json, bank_sender, vault_count, status, first_seen, published_at
       FROM shared_format_shapes ORDER BY first_seen DESC, shape_hash LIMIT 5000`,
  ).all<{
    shape_hash: string;
    shape_json: string;
    bank_sender: string;
    vault_count: number;
    status: string;
    first_seen: number;
    published_at: number | null;
  }>();
  return results.map((row) => ({
    hash: row.shape_hash,
    sender: row.bank_sender,
    status: row.status,
    vaultCount: row.vault_count,
    firstSeen: row.first_seen,
    publishedAt: row.published_at,
    shape: ((): unknown => {
      try {
        return JSON.parse(row.shape_json) as unknown;
      } catch {
        return null;
      }
    })(),
  }));
}

/** True when a row existed and is now blocked. */
export async function blockShape(env: Env, hash: string): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE shared_format_shapes SET status = 'blocked', published_at = NULL WHERE shape_hash = ?1",
  )
    .bind(hash)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
