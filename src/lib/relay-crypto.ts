/**
 * The device half of the relay's seal.
 *
 * `server/src/crypto.ts` seals every parsed row to the phone with ECIES over
 * X25519 — ephemeral ECDH → HKDF-SHA256 → AES-256-GCM — using WebCrypto, which
 * Cloudflare Workers implement natively. React Native has no WebCrypto and no
 * SubtleCrypto, so the counterpart here is pure JS (@noble). The two halves are
 * asserted against each other in scripts/test/worker.test.js: the real `seal()`
 * runs, and `openSealed()` below opens what it produced. A mismatch here would
 * look exactly like a working service right up until a user tried to sync.
 *
 * Three details are load-bearing and were read out of crypto.ts rather than
 * assumed:
 *   • the HKDF SALT is the raw 32 ephemeral public-key bytes, not empty;
 *   • the HKDF INFO is the literal "wafra/v1/seal";
 *   • WebCrypto appends the 16-byte GCM tag to the ciphertext, so `ct` is
 *     ciphertext‖tag — which is exactly the layout noble's gcm() expects.
 *
 * This module deliberately imports nothing from expo, react-native or `@/`, so
 * the Node test harness can load it directly and prove the round-trip without a
 * simulator. It also contains NO randomness: opening is fully deterministic,
 * and the one place entropy is needed (the device secret key) takes its 32
 * bytes as an argument. That is not a stylistic choice — React Native defines
 * no `crypto.getRandomValues`, so noble's own key generation throws. The caller
 * (src/lib/relay.ts) supplies bytes from expo-crypto instead, which is why this
 * app needs no crypto polyfill at all.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64 } from '@scure/base';

/** Domain separation string, byte-identical to the Worker's. */
const INFO = /* @__PURE__ */ new TextEncoder().encode('wafra/v1/seal');

const EPK_BYTES = 32;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** One row as it sits in the relay's queue: nothing here is readable. */
export interface SealedBlob {
  /** Ephemeral X25519 public key, base64. */
  epk: string;
  /** AES-GCM nonce, base64. */
  iv: string;
  /** Ciphertext including the GCM tag, base64. */
  ct: string;
}

export interface DeviceKeypair {
  /** Never leaves the phone. Never sent, never logged, never backed up off-device. */
  secretKey: Uint8Array;
  /** The half that goes to POST /v1/pair. */
  publicKey: Uint8Array;
}

/**
 * `random32` must be real entropy — on device that is
 * `Crypto.getRandomValues(new Uint8Array(32))` from expo-crypto. X25519 clamps
 * the scalar internally, so any 32 uniformly random bytes are a valid key.
 */
export function deviceKeypair(random32: Uint8Array): DeviceKeypair {
  if (random32.length !== 32) throw new Error('relay: device key needs exactly 32 random bytes');
  // Copy: the caller's buffer may be reused, and a mutated secret key would
  // silently start failing to decrypt rather than throwing.
  const secretKey = Uint8Array.from(random32);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export function encodeKey(bytes: Uint8Array): string {
  return base64.encode(bytes);
}

export function decodeKey(s: string): Uint8Array {
  return base64.decode(s);
}

/**
 * Open one sealed row. Throws on anything that is not authentically ours —
 * a malformed blob, a blob sealed to a different device, or a tampered
 * ciphertext. Callers must treat a throw as "this row is not openable and
 * never will be", not as "retry later": the key does not change.
 */
export function openSealed<T>(secretKey: Uint8Array, blob: SealedBlob): T {
  const epk = base64.decode(blob.epk);
  const iv = base64.decode(blob.iv);
  const ct = base64.decode(blob.ct);
  // Checked before any crypto runs so a corrupt row fails cheaply and with a
  // message that says which field was wrong.
  if (epk.length !== EPK_BYTES) throw new Error('relay: bad ephemeral key length');
  if (iv.length !== IV_BYTES) throw new Error('relay: bad nonce length');
  if (ct.length <= GCM_TAG_BYTES) throw new Error('relay: ciphertext shorter than its tag');
  // Throws on a low-order/all-zero epk rather than deriving an all-zero shared
  // secret, which is the difference between rejecting a forged row and
  // accepting one anybody could have written.
  const shared = x25519.getSharedSecret(secretKey, epk);
  const key = hkdf(sha256, shared, epk, INFO, 32);
  const plaintext = gcm(key, iv).decrypt(ct);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
