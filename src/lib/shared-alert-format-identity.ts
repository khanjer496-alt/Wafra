import { deviceKeypair, encodeKey } from '@/lib/relay-crypto';

/**
 * A dedicated, anonymous credential used ONLY to submit shared alert shapes on
 * phones that have no iPhone-capture pairing (Android, or an iPhone that never
 * set up capture). It pairs once through the same /v1/pair contract the relay
 * client uses, with its own fresh keypair, and keeps only
 * { baseUrl, deviceId, syncToken } under its own secure-store key. It never
 * touches the capture credential, the capture UI or sync, and the private key
 * is generated only to satisfy the contract and is discarded.
 *
 * Entropy: the 32 key bytes come from `deps.entropy()` (expo-crypto on device),
 * never from a global, exactly as relay.ts does; the native bridge that Noble
 * needs under Hermes is installed by the caller's `prepare()`.
 *
 * Silent by design: nothing here throws or logs. A failed pairing backs off 24h.
 */

export interface SharingCredential { baseUrl: string; deviceId: string; syncToken: string }

export interface SharingIdentityDeps {
  baseUrl: string | null;
  readSecret: (key: string) => Promise<string | null>;
  writeSecret: (key: string, value: string) => Promise<void>;
  removeSecret: (key: string) => Promise<void>;
  transport: (url: string, init: RequestInit) => Promise<Response>;
  entropy: () => Uint8Array;
  /** Installs the native getRandomValues bridge; a no-op in tests. */
  prepare?: () => void;
  now: () => number;
  timeoutMs?: number;
}

export const SHARING_CREDENTIAL_KEY = 'wafra.sharing.v1';
export const SHARING_BACKOFF_MS = 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f-]{36}$/i;
const TOKEN = /^[A-Za-z0-9_-]{40,128}$/;

interface Stored extends SharingCredential { failedAt?: number }

const parse = (raw: string | null): Stored | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Stored>;
    if (typeof v.failedAt === 'number' && !v.syncToken) return { baseUrl: '', deviceId: '', syncToken: '', failedAt: v.failedAt };
    if (typeof v.baseUrl === 'string' && typeof v.deviceId === 'string' && UUID.test(v.deviceId) &&
      typeof v.syncToken === 'string' && TOKEN.test(v.syncToken)) {
      return { baseUrl: v.baseUrl, deviceId: v.deviceId, syncToken: v.syncToken };
    }
  } catch { /* fall through */ }
  return null;
};

export function createSharingIdentity(deps: SharingIdentityDeps) {
  let inflight: Promise<SharingCredential | null> | null = null;

  const pairOnce = async (): Promise<SharingCredential | null> => {
    const base = deps.baseUrl?.replace(/\/+$/, '') ?? '';
    if (!base) return null;
    const stored = parse(await deps.readSecret(SHARING_CREDENTIAL_KEY).catch(() => null));
    if (stored?.syncToken) return stored.baseUrl === base ? stored : null;
    if (stored?.failedAt !== undefined && deps.now() - stored.failedAt < SHARING_BACKOFF_MS) return null;
    const fail = async (): Promise<null> => {
      await deps.writeSecret(SHARING_CREDENTIAL_KEY, JSON.stringify({ failedAt: deps.now() })).catch(() => {});
      return null;
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15_000);
    try {
      deps.prepare?.();
      const keys = deviceKeypair(deps.entropy());
      const res = await deps.transport(`${base}/v1/pair`, {
        method: 'POST',
        signal: controller.signal,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey: encodeKey(keys.publicKey), market: 'AE' }),
      });
      if (!res.ok) return await fail();
      const body = (await res.json().catch(() => null)) as { deviceId?: unknown; syncToken?: unknown } | null;
      if (!body || typeof body.deviceId !== 'string' || !UUID.test(body.deviceId) ||
        typeof body.syncToken !== 'string' || !TOKEN.test(body.syncToken)) return await fail();
      const credential = { baseUrl: base, deviceId: body.deviceId, syncToken: body.syncToken };
      await deps.writeSecret(SHARING_CREDENTIAL_KEY, JSON.stringify(credential));
      return credential;
    } catch {
      return await fail();
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    /** The stored credential, pairing once if needed. Single-flight; null on any failure or backoff. */
    ensure(): Promise<SharingCredential | null> {
      inflight ??= pairOnce().catch(() => null).finally(() => { inflight = null; });
      return inflight;
    },
    /** Erase-all: forget the credential (the relay vault holds no personal data). */
    async erase(): Promise<void> {
      try { await deps.removeSecret(SHARING_CREDENTIAL_KEY); } catch { /* silent */ }
    },
  };
}
