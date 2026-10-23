import {
  SHARED_FORMATS_MAX_LIST,
  validateSharedAlertFormatList,
  validateSharedAlertShape,
  type SharedAlertFormat,
  type SharedAlertShape,
} from '@/lib/shared-alert-formats';

/**
 * Network edge for shared alert shapes. Every function resolves, never throws:
 * a relay that is down, slow, old or hostile must not affect teaching,
 * capture or the foreground. Only a validated SHAPE is ever sent; nothing here
 * sees message text.
 */

/** Same ceiling as relay.ts requests: fail fast on bad networks. */
export const SHARED_FORMAT_TIMEOUT_MS = 15_000;
/** Refresh at most once a day. */
export const SHARED_FORMAT_REFRESH_MS = 24 * 60 * 60 * 1000;
/** Defensive cap on the response body we are willing to parse. */
const MAX_BODY_CHARS = 8 * 1024 * 1024;

export type SharedFormatTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface SharedFormatSyncOptions {
  /** Injected in tests; defaults to the same expo/fetch transport relay.ts uses. */
  fetch?: SharedFormatTransport;
  timeoutMs?: number;
}

export type SubmitSharedShapeResult =
  | { ok: true; status: 'pending' | 'published' | 'blocked' }
  | { ok: false; reason: 'invalid-shape' | 'unauthorized' | 'rate-limited' | 'rejected' | 'unavailable' };

export type PublishedFormatsResult =
  | { kind: 'updated'; etag: string | null; formats: SharedAlertFormat[] }
  | { kind: 'not-modified' }
  | { kind: 'failed' };

// Loaded lazily so the pure module (and its host tests) never needs the native
// package; production passes no transport and gets the same expo/fetch relay.ts uses.
declare const require: (id: string) => { fetch: (url: string, init: unknown) => Promise<unknown> };
const defaultTransport: SharedFormatTransport = async (url, init) =>
  (await require('expo/fetch').fetch(url, init)) as Response;

async function send(
  url: string,
  init: RequestInit,
  options: SharedFormatSyncOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SHARED_FORMAT_TIMEOUT_MS);
  try {
    return await (options.fetch ?? defaultTransport)(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const trimBase = (base: string): string => base.replace(/\/+$/, '');

/** Submit one shape (the paired sync token authenticates the vault). */
export async function submitSharedAlertShape(
  cfg: { baseUrl: string; syncToken: string },
  shape: SharedAlertShape,
  options: SharedFormatSyncOptions = {},
): Promise<SubmitSharedShapeResult> {
  try {
    // Re-check at the network edge: nothing that fails the strict validator leaves the phone.
    const checked = validateSharedAlertShape(shape);
    if (!checked || !cfg.baseUrl || !cfg.syncToken) return { ok: false, reason: 'invalid-shape' };
    const res = await send(`${trimBase(cfg.baseUrl)}/v1/formats/submit`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.syncToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ shape: checked }),
    }, options);
    if (res.status === 401) return { ok: false, reason: 'unauthorized' };
    if (res.status === 429) return { ok: false, reason: 'rate-limited' };
    if (!res.ok) return { ok: false, reason: 'rejected' };
    const body = (await res.json().catch(() => null)) as { status?: unknown } | null;
    const status = body?.status;
    return status === 'pending' || status === 'published' || status === 'blocked'
      ? { ok: true, status } : { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** Download the public list. `etag` makes an unchanged list a cheap 304. */
export async function fetchPublishedSharedFormats(
  base: string | null | undefined,
  etag: string | null | undefined,
  options: SharedFormatSyncOptions = {},
): Promise<PublishedFormatsResult> {
  try {
    if (!base) return { kind: 'failed' };
    const res = await send(`${trimBase(base)}/v1/formats/published`, {
      method: 'GET',
      headers: { accept: 'application/json', ...(etag ? { 'if-none-match': etag } : {}) },
    }, options);
    if (res.status === 304) return { kind: 'not-modified' };
    if (!res.ok) return { kind: 'failed' };
    const text = await res.text();
    if (text.length > MAX_BODY_CHARS) return { kind: 'failed' };
    const body = JSON.parse(text) as { formats?: unknown } | null;
    const formats = validateSharedAlertFormatList(body?.formats, SHARED_FORMATS_MAX_LIST);
    if (!formats) return { kind: 'failed' };
    const header = res.headers?.get?.('etag');
    return { kind: 'updated', etag: typeof header === 'string' && header.length > 0 && header.length <= 256 ? header : null, formats };
  } catch {
    return { kind: 'failed' };
  }
}

/* ── persisted state ─────────────────────────────────────────────────── */

/** What the store keeps: the downloaded, re-validated list and its cache marker. */
export interface SharedAlertFormatState {
  etag: string | null;
  fetchedAt: number | null;
  formats: SharedAlertFormat[];
}

export const emptySharedAlertFormatState = (): SharedAlertFormatState => ({ etag: null, fetchedAt: null, formats: [] });

/**
 * Re-validate a persisted or incoming value. Anything malformed becomes the
 * empty state; individual bad shapes are dropped. Never throws.
 */
export function normalizeSharedAlertFormatState(value: unknown): SharedAlertFormatState {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return emptySharedAlertFormatState();
    const row = value as Record<string, unknown>;
    const formats = validateSharedAlertFormatList(row.formats, SHARED_FORMATS_MAX_LIST) ?? [];
    const etag = typeof row.etag === 'string' && row.etag.length > 0 && row.etag.length <= 256 ? row.etag : null;
    const fetchedAt = typeof row.fetchedAt === 'number' && Number.isFinite(row.fetchedAt) && row.fetchedAt >= 0
      ? row.fetchedAt : null;
    // An etag only makes sense alongside the list it describes.
    return { etag: formats.length || fetchedAt !== null ? etag : null, fetchedAt, formats };
  } catch { return emptySharedAlertFormatState(); }
}

/** True when a refresh is due: never fetched, or the last fetch is over a day old (or in the future). */
export const sharedAlertFormatsDue = (state: Pick<SharedAlertFormatState, 'fetchedAt'> | null | undefined, now: number): boolean => {
  const at = state?.fetchedAt;
  return typeof at !== 'number' || at > now || now - at >= SHARED_FORMAT_REFRESH_MS;
};
