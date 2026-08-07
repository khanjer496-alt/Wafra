/**
 * Sealing parsed transactions to a device.
 *
 * The Worker sees each message for as long as it takes to parse it and never
 * writes it down. What it does write — the parsed row — is sealed to the
 * device that will collect it, so a dump of the D1 database is ciphertext and
 * nothing else. The Worker cannot read back what it stored: it throws away the
 * ephemeral private key the moment the row is sealed.
 *
 * ECIES over X25519: ephemeral ECDH → HKDF-SHA256 → AES-256-GCM. All of it is
 * WebCrypto, which Workers implement natively; the app side is @noble/curves
 * and @noble/ciphers, which are pure JS and run under Hermes unchanged.
 */

const enc = new TextEncoder();

export interface SealedBlob {
  /** Ephemeral X25519 public key, base64. */
  epk: string;
  /** AES-GCM nonce, base64. */
  iv: string;
  /** Ciphertext including the GCM tag, base64. */
  ct: string;
}

export function b64encode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s);
}

export function b64decode(s: string): Uint8Array<ArrayBuffer> {
  if (
    s.length === 0 ||
    s.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)
  ) {
    throw new Error('Invalid base64');
  }
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Wrangler's generated runtime type currently escapes this WebCrypto field as
 * `$public`; the runtime follows the standard and requires `public`. Keep the
 * unavoidable cast on this one boundary instead of weakening the types for the
 * rest of the crypto module.
 */
function agreementWith(recipient: CryptoKey): Parameters<SubtleCrypto['deriveBits']>[0] {
  return {
    name: 'X25519',
    public: recipient,
  } as unknown as Parameters<SubtleCrypto['deriveBits']>[0];
}

/**
 * The two refusals that are statements about these particular bytes rather
 * than about the health of the runtime: `DataError` for bytes WebCrypto will
 * not take as a key at all, `OperationError` for an agreement that came out
 * all zero. Everything else — no entropy, an unsupported curve, an internal
 * fault — is the platform failing, and must never be read as a verdict on a
 * user's key.
 */
function unusableKeyError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return name === 'DataError' || name === 'OperationError';
}

/**
 * Whether a public key can actually receive a sealed row.
 *
 * `importKey` is not this test, which is the trap this function exists to
 * close. WebCrypto accepts any 32 bytes as an X25519 public key — all-zero,
 * 1, either order-8 point, p-1, p — because the refusal belongs to key
 * agreement rather than to import: WebCrypto requires `deriveBits` to throw
 * `OperationError` when the shared secret comes out all zero, which is what
 * RFC 7748 §6.1 permits an implementation to abort on. A key that passes
 * import and fails agreement is therefore accepted at pairing time and
 * explodes later, inside the seal, where nothing expects to fail.
 *
 * So the only honest check is to try the agreement, against a throwaway key
 * whose output is discarded. That answers exactly the question that matters —
 * "will `seal` work?" — without a hard-coded blocklist to keep in step with
 * the curve.
 *
 * It is a decision, not a coin flip. X25519 clamps the scalar to a multiple of
 * eight, so every point of low order multiplies to the identity and no
 * full-order point does; the same key gives the same answer against every
 * ephemeral key. One agreement costs about a tenth of a millisecond.
 *
 * `false` means the key is bad, and nothing else. A caller acts on that by
 * refusing an enrollment or passing a device over, so a runtime failure
 * returned as `false` would strand every device at once, quietly. Those throw.
 */
export async function canSealTo(recipientPublicKeyB64: unknown): Promise<boolean> {
  if (typeof recipientPublicKeyB64 !== 'string') return false;
  let decoded: ReturnType<typeof b64decode>;
  try {
    decoded = b64decode(recipientPublicKeyB64);
  } catch {
    return false;
  }
  if (decoded.length !== 32) return false;
  // Outside the guard below on purpose. A runtime that cannot generate a key
  // pair has told us nothing about the caller's key.
  const probe = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
  if (!('privateKey' in probe)) throw new Error('X25519 did not return a keypair');
  try {
    const recipient = await crypto.subtle.importKey('raw', decoded, { name: 'X25519' }, false, []);
    await crypto.subtle.deriveBits(agreementWith(recipient), probe.privateKey, 256);
    return true;
  } catch (error) {
    if (unusableKeyError(error)) return false;
    throw error;
  }
}

/** Seal a JSON payload to a device's X25519 public key. */
export async function seal(recipientPublicKeyB64: string, payload: unknown): Promise<SealedBlob> {
  const recipient = await crypto.subtle.importKey(
    'raw',
    b64decode(recipientPublicKeyB64),
    { name: 'X25519' },
    false,
    [],
  );
  const generated = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  if (!('publicKey' in generated)) throw new Error('X25519 did not return a keypair');
  const ephemeral = generated;

  const shared = await crypto.subtle.deriveBits(
    agreementWith(recipient),
    ephemeral.privateKey,
    256,
  );
  // HKDF over the ECDH output — the raw shared secret is not uniformly random
  // and must never be used as a key directly.
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const exported = await crypto.subtle.exportKey('raw', ephemeral.publicKey);
  if (!(exported instanceof ArrayBuffer)) throw new Error('X25519 raw export was not bytes');
  const epkRaw = exported;
  const aes = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(epkRaw), info: enc.encode('wafra/v1/seal') },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aes,
    enc.encode(JSON.stringify(payload)),
  );
  return { epk: b64encode(epkRaw), iv: b64encode(iv), ct: b64encode(ct) };
}

/**
 * Bearer tokens are stored as a SHA-256 digest, so a leaked database still
 * cannot be used to impersonate a device or push rows into someone's queue.
 */
export async function hashToken(token: string): Promise<string> {
  return b64encode(await crypto.subtle.digest('SHA-256', enc.encode(token)));
}

/**
 * A keyed, one-way replay identifier. Unlike a plain message hash, a D1 dump
 * cannot be searched against a guessed bank alert without the ingest token,
 * and that token is never stored by the Worker.
 */
export async function keyedFingerprint(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64encode(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}

export function randomToken(): string {
  return b64encode(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Constant-time compare, so token lookup cannot be timed character by character. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
