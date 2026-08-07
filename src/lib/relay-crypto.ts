/**
 * The device half of the iOS relay seal.
 *
 * server/src/crypto.ts seals each parsed row to this device's X25519 public
 * key with ECIES: ephemeral ECDH → HKDF-SHA256 → AES-256-GCM. This file is
 * the only thing that can open it, and it must agree with that file byte for
 * byte — the salt is the raw ephemeral public key and the info string is
 * `wafra/v1/seal`. scripts/test/worker.test.js seals with the real Worker code
 * and opens it with this module, so a drift between the two halves fails the
 * suite rather than surfacing as an empty sync on someone's phone.
 *
 * Why @noble rather than WebCrypto: Workers implement X25519 in crypto.subtle,
 * Hermes does not implement crypto.subtle at all. @noble/curves is pure JS and
 * runs unchanged under Hermes.
 *
 * Nothing here touches the network or storage — that is src/lib/relay.ts —
 * which is what lets this module be transpiled and tested under plain Node.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** One sealed queue row as the Worker stores and returns it. */
export interface SealedBlob {
  /** Ephemeral X25519 public key, base64. */
  epk: string;
  /** AES-GCM nonce, base64. */
  iv: string;
  /** Ciphertext including the GCM tag, base64. */
  ct: string;
}

export interface DeviceKeypair {
  /** base64 — sent to the Worker once, at pairing. */
  publicKey: string;
  /** base64 — never leaves the phone. */
  privateKey: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Hand-rolled rather than atob/btoa: Hermes has shipped both at various times
// and neither is guaranteed by the RN version floor this app supports.
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

export function b64decode(s: string): Uint8Array<ArrayBuffer> {
  if (
    s.length === 0 ||
    s.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)
  ) {
    throw new Error('Invalid base64');
  }
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = B64.indexOf(clean[i + 2]);
    const d = B64.indexOf(clean[i + 3]);
    out[p++] = (a << 2) | (b >> 4);
    if (c >= 0) out[p++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[p++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, p);
}

/** A fresh device identity. The private half is the only copy that exists. */
export function generateKeypair(): DeviceKeypair {
  const sk = x25519.utils.randomSecretKey();
  return {
    privateKey: b64encode(sk),
    publicKey: b64encode(x25519.getPublicKey(sk)),
  };
}

/**
 * Open one sealed row. Throws if the blob was sealed to a different device or
 * has been tampered with — GCM authenticates, so a modified ciphertext fails
 * rather than decrypting to garbage.
 */
export function openSealed<T>(privateKeyB64: string, blob: SealedBlob): T {
  const epk = b64decode(blob.epk);
  const shared = x25519.getSharedSecret(b64decode(privateKeyB64), epk);
  // HKDF over the ECDH output. The raw shared secret is a curve point and is
  // not uniformly random, so it must never be used as an AES key directly.
  const key = hkdf(sha256, shared, epk, utf8('wafra/v1/seal'), 32);
  const plaintext = gcm(key, b64decode(blob.iv)).decrypt(b64decode(blob.ct));
  return JSON.parse(utf8decode(plaintext)) as T;
}

function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    let cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
  }
  return new Uint8Array(out);
}

function utf8decode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    if (b < 0x80) {
      s += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      s += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63));
      i += 2;
    } else if (b < 0xf0) {
      s += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63));
      i += 3;
    } else {
      const cp =
        ((b & 7) << 18) |
        ((bytes[i + 1] & 63) << 12) |
        ((bytes[i + 2] & 63) << 6) |
        (bytes[i + 3] & 63);
      s += String.fromCodePoint(cp);
      i += 4;
    }
  }
  return s;
}
