'use strict';
// Fetch one public test dependency, retrying only what is worth retrying. Maven Central rate-limits
// shared CI runners (HTTP 429), and a retry-free single attempt turned that into a failing check job.
// This helper only fetches bytes: the caller still verifies the pinned SHA-256, and a checksum mismatch
// is never retried (a changed artifact must fail loudly, not be re-downloaded until it passes).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DELAYS_MS = [2_000, 4_000, 8_000, 16_000];
const MAX_RETRY_AFTER_MS = 30_000;
// One shared budget for ALL downloads of a run, so the clear "retry budget exhausted" error always arrives
// before the outer test timeout (290 s, which also has to cover the Kotlin compiler provisioning).
const TOTAL_BUDGET_MS = 150_000;

/** 429 and 5xx are transient; every other status (404, 403, ...) is final. */
const retryableStatus = (status) => status === 429 || (status >= 500 && status <= 599);

/** Retry-After in seconds, capped; the server's wish may only lengthen the wait, never exceed the cap. */
function retryAfterMs(response) {
  const seconds = Number(response?.headers?.get?.('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS) : 0;
}

async function fetchBytesWithRetry({
  url, name, fetchImpl = fetch, delaysMs = DELAYS_MS, timeoutMs = 30_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log = () => {},
  now = Date.now, deadlineAt = Infinity,
}) {
  let last = 'no attempt';
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    let wait = 0;
    const remaining = deadlineAt - now();
    if (remaining <= 0) throw Error(`Public native test dependency failed: ${name} (${last}) retry budget exhausted`);
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)) });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      last = String(response.status);
      if (!retryableStatus(response.status)) throw Object.assign(Error(`Public native test dependency failed: ${name} (${last})`), { final: true });
      wait = retryAfterMs(response);
    } catch (error) {
      if (error.final) throw error;
      last = error?.name === 'TimeoutError' ? 'timeout' : (error?.cause?.code || error?.message || 'network error');
    }
    if (attempt === delaysMs.length) break;
    const delay = Math.max(delaysMs[attempt], wait);
    if (now() + delay >= deadlineAt) throw Error(`Public native test dependency failed: ${name} (${last}) retry budget exhausted after ${attempt + 1} attempts`);
    log(`${name}: ${last}, retrying in ${delay / 1000}s (${attempt + 1}/${delaysMs.length})`);
    await sleep(delay);
  }
  throw Error(`Public native test dependency failed: ${name} (${last}) after ${delaysMs.length + 1} attempts`);
}

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/**
 * The bytes of one pinned dependency, verified. A file in the cache directory is used if its size and SHA-256
 * match; a cached file that does NOT match (a truncated restore, disk damage) is deleted and replaced by one
 * verified download, so a bad cache entry cannot fail every later run. Downloaded bytes are verified too:
 * a mismatch throws (never retried, never written), and only verified bytes are written to the cache (0600).
 */
async function resolveDependency({ name, url, sha256, cacheDir, fetchBytes, log = () => {} }) {
  const verified = (bytes) => {
    if (bytes.length > 2_000_000 || digest(bytes) !== sha256) throw Error(`Native test dependency integrity check failed: ${name}`);
    return bytes;
  };
  const cached = cacheDir && path.join(cacheDir, name);
  if (cached && fs.existsSync(cached)) {
    try { return verified(fs.readFileSync(cached)); } catch {
      log(`${name}: cached copy failed its checksum; discarding it and downloading once`);
      fs.rmSync(cached, { force: true });
    }
  }
  const bytes = verified(await fetchBytes({ url, name }));
  if (cached) fs.writeFileSync(cached, bytes, { mode: 0o600 });
  return bytes;
}

module.exports = { fetchBytesWithRetry, resolveDependency, retryableStatus, DELAYS_MS, TOTAL_BUDGET_MS };
