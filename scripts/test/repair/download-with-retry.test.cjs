'use strict';
// Maven Central answers 429 to shared CI runners. The native Play-billing test downloads four public jars;
// the helper retries only transient failures with backoff, never a final error, and the script verifies the
// pinned SHA-256 of every byte it uses (downloaded or cached) before anything is written or compiled.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');
const { fetchBytesWithRetry, retryableStatus, DELAYS_MS } = require('../download-with-retry.cjs');

const root = path.resolve(__dirname, '../../..');
const body = (text) => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from(text) });
const status = (code, headers = {}) => ({ ok: false, status: code, headers: { get: (key) => headers[key.toLowerCase()] ?? null } });
const sequence = (...replies) => {
  const calls = [];
  const fetchImpl = async () => { calls.push(1); const next = replies.shift(); if (next instanceof Error) throw next; return next; };
  return { fetchImpl, calls };
};
const clock = () => { const waits = []; return { waits, sleep: async (ms) => { waits.push(ms); } }; };

test('the backoff is 2, 4, 8 and 16 seconds, and only 429 and 5xx are transient', () => {
  assert.deepEqual([...DELAYS_MS], [2000, 4000, 8000, 16000]);
  for (const code of [429, 500, 502, 503, 504, 599]) assert.equal(retryableStatus(code), true, String(code));
  for (const code of [400, 401, 403, 404, 410, 451]) assert.equal(retryableStatus(code), false, String(code));
});

test('429 twice then success returns the bytes after waiting 2 s and 4 s', async () => {
  const { fetchImpl, calls } = sequence(status(429), status(429), body('junit'));
  const { waits, sleep } = clock();
  const bytes = await fetchBytesWithRetry({ url: 'u', name: 'junit-4.13.2.jar', fetchImpl, sleep });
  assert.equal(bytes.toString(), 'junit');
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [2000, 4000]);
});

test('a final status is not retried: 404 and 403 fail at once, naming the file and the status', async () => {
  for (const code of [404, 403]) {
    const { fetchImpl, calls } = sequence(status(code));
    const { waits, sleep } = clock();
    await assert.rejects(fetchBytesWithRetry({ url: 'u', name: 'x.jar', fetchImpl, sleep }),
      (error) => error.message === `Public native test dependency failed: x.jar (${code})`);
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  }
});

test('persistent 503 gives up after the initial try and four retries with 2, 4, 8, 16 s waits', async () => {
  const { fetchImpl, calls } = sequence(...Array.from({ length: 5 }, () => status(503)));
  const { waits, sleep } = clock();
  await assert.rejects(fetchBytesWithRetry({ url: 'u', name: 'x.jar', fetchImpl, sleep }),
    (error) => /x\.jar \(503\) after 5 attempts/.test(error.message));
  assert.equal(calls.length, 5);
  assert.deepEqual(waits, [2000, 4000, 8000, 16000]);
});

test('network errors and timeouts are retried like 429', async () => {
  const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
  const reset = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
  const { fetchImpl, calls } = sequence(timeout, reset, body('ok'));
  const { waits, sleep } = clock();
  assert.equal((await fetchBytesWithRetry({ url: 'u', name: 'x.jar', fetchImpl, sleep })).toString(), 'ok');
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [2000, 4000]);
});

test('Retry-After may lengthen a wait but never beyond the 30 s cap, and never shorten the backoff', async () => {
  const { fetchImpl } = sequence(status(429, { 'retry-after': '10' }), status(429, { 'retry-after': '3600' }), status(429, { 'retry-after': '1' }), body('ok'));
  const { waits, sleep } = clock();
  await fetchBytesWithRetry({ url: 'u', name: 'x.jar', fetchImpl, sleep });
  assert.deepEqual(waits, [10000, 30000, 8000]);
});

test('the script verifies every byte against its pinned SHA-256 before using or caching it', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/test/wafra-play-billing-native.cjs'), 'utf8');
  assert.match(script, /require\('\.\/download-with-retry\.cjs'\)/);
  assert.doesNotMatch(script, /Promise\.all\(dependencies/, 'downloads are sequential, not four parallel requests');
  // cached bytes and downloaded bytes both pass through verified(); the cache is written only from the verified value
  assert.match(script, /bytes = verified\(fs\.readFileSync\(local\), name, expected\)/);
  assert.match(script, /bytes = verified\(await fetchBytesWithRetry\(/);
  assert.ok(script.indexOf('bytes = verified(await fetchBytesWithRetry(') < script.indexOf('fs.writeFileSync(local, bytes'),
    'the cache file is written after verification');
  assert.match(script, /integrity check failed/);
  for (const hash of script.match(/'[0-9a-f]{64}'/g) ?? []) assert.match(hash, /^'[0-9a-f]{64}'$/);
  assert.equal((script.match(/'[0-9a-f]{64}'/g) ?? []).length, 4, 'all four dependencies stay pinned');
});

test('CI caches the jars keyed on the script that pins them and points the test at that directory', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
  const steps = workflow.jobs.check.steps;
  const cache = steps.find((step) => /actions\/cache@/.test(step.uses || '') && /wafra-play-billing-libs/.test(step.with?.path || ''));
  assert.ok(cache, 'a cache step for the native billing test jars exists in the check job');
  assert.match(cache.with.key, /hashFiles\('scripts\/test\/wafra-play-billing-native\.cjs'\)/, 'the key follows the pinned versions and hashes');
  const test = steps.find((step) => step.run === 'npm test');
  assert.match(test.env?.WAFRA_PLAY_BILLING_TEST_LIBS || '', /wafra-play-billing-libs/);
  assert.ok(steps.indexOf(cache) < steps.indexOf(test), 'the cache is restored before the tests run');
});
