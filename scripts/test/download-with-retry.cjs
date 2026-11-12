'use strict';
// Fetch one public test dependency, retrying only what is worth retrying. Maven Central rate-limits
// shared CI runners (HTTP 429), and a retry-free single attempt turned that into a failing check job.
// This helper only fetches bytes: the caller still verifies the pinned SHA-256, and a checksum mismatch
// is never retried (a changed artifact must fail loudly, not be re-downloaded until it passes).

const DELAYS_MS = [2_000, 4_000, 8_000, 16_000];
const MAX_RETRY_AFTER_MS = 30_000;

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
}) {
  let last = 'no attempt';
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    let wait = 0;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
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
    log(`${name}: ${last}, retrying in ${delay / 1000}s (${attempt + 1}/${delaysMs.length})`);
    await sleep(delay);
  }
  throw Error(`Public native test dependency failed: ${name} (${last}) after ${delaysMs.length + 1} attempts`);
}

module.exports = { fetchBytesWithRetry, retryableStatus, DELAYS_MS };
