'use strict';
// Deterministic randomness for the alert lab. Nothing here may depend on
// Math.random, the clock or object identity: the same seed must yield the same
// alerts on every machine so a failing case can be named and replayed.

/** 32-bit FNV-1a of a string; the stable identity behind every split. */
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Short hex fingerprint, used for template ids and row keys. */
const shortHash = (text) => fnv1a(text).toString(16).padStart(8, '0');

/** mulberry32: small, fast, good enough for test-data composition. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded generator with the few helpers composition needs. */
function rngFor(...parts) {
  const next = mulberry32(fnv1a(parts.join('␟')));
  const rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    weighted: (pairs) => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [value, w] of pairs) { r -= w; if (r < 0) return value; }
      return pairs[pairs.length - 1][0];
    },
    shuffle: (list) => {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return rng;
}

/**
 * Which half of every slot inventory an item belongs to. The split is a pure
 * function of the item's own id (never its position), so adding or deleting
 * another item can never move an existing HOLDOUT item into DEV.
 */
const splitOf = (id) => ((fnv1a(`alert-lab-split:${id}`) & 1) ? 'holdout' : 'dev');

module.exports = { fnv1a, shortHash, rngFor, splitOf };
