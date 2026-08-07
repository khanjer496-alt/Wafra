/**
 * Wake-only push delivery for iOS relay sync.
 *
 * Expo SDK 55 supports headless iOS notifications when `_contentAvailable`
 * is true and the app has registered a background notification task. The
 * payload below deliberately says only "sync now". Transaction data remains
 * in the device-sealed D1 queue and is collected with the admin credential.
 */

const PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_AAD = new TextEncoder().encode('wafra/v1/push-token');
const WAKE_TTL_SECONDS = 300;

// A phone should not silently stop waking just because its owner has not
// opened a finance app this month. Expo/APNs invalidation still removes dead
// tokens immediately; the longer ceiling is only a stale-registration guard.
export const PUSH_REGISTRATION_TTL_SECONDS = 180 * 24 * 60 * 60;

export interface PushEnv {
  /** 32 random bytes, standard base64, configured with `wrangler secret put`. */
  PUSH_TOKEN_KEY?: string;
  /** Expo access token used when EAS enhanced push security is enabled. */
  EXPO_ACCESS_TOKEN?: string;
  /** EAS project id whose SDK 55 token is accepted by the registration route. */
  EXPO_PROJECT_ID?: string;
}

export interface EncryptedPushToken {
  iv: string;
  ct: string;
}

export interface WakePushResult {
  accepted: boolean;
  unregistered: boolean;
}

function b64encode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64decode(value: string): Uint8Array<ArrayBuffer> {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error('Invalid base64');
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pushKey(encoded: string): Promise<CryptoKey> {
  const raw = b64decode(encoded);
  if (raw.length !== 32) throw new Error('PUSH_TOKEN_KEY must contain 32 bytes');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptPushToken(
  keyB64: string,
  token: string,
): Promise<EncryptedPushToken> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: PUSH_AAD },
    await pushKey(keyB64),
    new TextEncoder().encode(token),
  );
  return { iv: b64encode(iv), ct: b64encode(ct) };
}

export async function decryptPushToken(
  keyB64: string,
  encrypted: EncryptedPushToken,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(encrypted.iv), additionalData: PUSH_AAD },
    await pushKey(keyB64),
    b64decode(encrypted.ct),
  );
  return new TextDecoder().decode(plaintext);
}

/** Accept both names Expo has issued while rejecting arbitrary destinations. */
export function isExpoPushToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 256 &&
    /^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,220}\]$/.test(value)
  );
}

export function isExpoProjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
}

/** Public for tests and for making the privacy boundary reviewable. */
export function wakePayload(to: string): Record<string, unknown> {
  return {
    to,
    _contentAvailable: true,
    data: { kind: 'wafra.sync', v: 1 },
    ttl: WAKE_TTL_SECONDS,
    priority: 'normal',
    collapseId: 'wafra-relay-sync',
  };
}

/**
 * Ask Expo to wake one device. Delivery remains best-effort: APNs may defer a
 * background notification, and the durable encrypted queue remains the source
 * of truth. A failed wake must never make `/v1/ingest` lose its accepted row.
 */
export async function sendWakePush(
  token: string,
  accessToken?: string,
  send: typeof fetch = fetch,
): Promise<WakePushResult> {
  const response = await send(PUSH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(wakePayload(token)),
  });
  if (!response.ok) return { accepted: false, unregistered: false };

  const body = (await response.json().catch(() => null)) as {
    data?: { status?: unknown; details?: { error?: unknown } } | Array<{
      status?: unknown;
      details?: { error?: unknown };
    }>;
  } | null;
  const ticket = Array.isArray(body?.data) ? body.data[0] : body?.data;
  return {
    accepted: ticket?.status === 'ok',
    unregistered: ticket?.details?.error === 'DeviceNotRegistered',
  };
}
