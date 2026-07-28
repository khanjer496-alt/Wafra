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
 * able to load the file.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

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
