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

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Seal a JSON payload to a device's X25519 public key. */
export async function seal(recipientPublicKeyB64: string, payload: unknown): Promise<SealedBlob> {
  const recipient = await crypto.subtle.importKey(
    'raw',
    b64decode(recipientPublicKeyB64) as BufferSource,
    { name: 'X25519' },
    false,
    [],
  );
  // generateKey is typed as CryptoKey | CryptoKeyPair; X25519 always yields a
  // pair, but the DOM lib cannot narrow it from the algorithm name.
  const ephemeral = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const shared = await crypto.subtle.deriveBits(
    { name: 'X25519', public: recipient },
    ephemeral.privateKey,
    256,
  );
  // HKDF over the ECDH output — the raw shared secret is not uniformly random
  // and must never be used as a key directly.
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const epkRaw = await crypto.subtle.exportKey('raw', ephemeral.publicKey);
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
