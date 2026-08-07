/**
 * The device half of the relay's sealing scheme.
 *
 * The Worker seals every parsed row to the phone's X25519 public key and
 * throws away the ephemeral private key as it does, so it cannot read back
 * what it stored. This file is the only thing that can open those rows.
 *
 * It is deliberately free of React Native and Expo imports: the seal and the
 * open have to agree exactly, and the way to prove that is to run this module
 * and `server/src/crypto.ts` against each other in Node, which
 * `scripts/test/worker.test.js` does. Anything needing a device — the
 * keychain, the network — lives in `relay.ts` instead.
 *
 * ECIES over X25519: ephemeral ECDH -> HKDF-SHA256 -> AES-256-GCM. The Worker
 * side is WebCrypto; this side is @noble, which is pure JS and runs under
 * Hermes with no native module and no polyfill.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** Must match `info` in server/src/crypto.ts. Changing it breaks every queued row. */
const SEAL_INFO = 'wafra/v1/seal';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export interface SealedBlob {
  /** Ephemeral X25519 public key, base64. */
  epk: string;
  /** AES-GCM nonce, base64. */
  iv: string;
  /** Ciphertext including the GCM tag, base64. */
  ct: string;
}

// Base64 is hand-rolled rather than taken from atob/btoa or Buffer: Hermes and
// Node disagree about which of those exist, and this module has to behave
// identically in both or the test proves nothing.

export function b64encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

export function b64decode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let n = 0;
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

/** The public key to hand the Worker at pairing time. */
export function publicKeyFor(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

/**
 * Open one sealed row. Throws if the row was sealed to a different device or
 * has been tampered with — GCM's whole job, and the reason a failed open must
 * never be swallowed into a silent empty result.
 */
export function open(privateKey: Uint8Array, blob: SealedBlob): unknown {
  const epk = b64decode(blob.epk);
  const shared = x25519.getSharedSecret(privateKey, epk);
  // HKDF over the ECDH output. The raw shared secret is not uniformly random
  // and must never be used as a key directly. Salt is the ephemeral public
  // key, which is what the Worker uses.
  const key = hkdf(sha256, shared, epk, new TextEncoder().encode(SEAL_INFO), 32);
  const plaintext = gcm(key, b64decode(blob.iv)).decrypt(b64decode(blob.ct));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
