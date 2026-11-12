'use strict';
// Maven Central answers 429 to shared CI runners. The native Play-billing test downloads four public jars;
// the helper retries only transient failures with backoff, never a final error, and the script verifies the
// pinned SHA-256 of every byte it uses (downloaded or cached) before anything is written or compiled.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');
const crypto = require('node:crypto');
const { fetchBytesWithRetry, resolveDependency, retryableStatus, DELAYS_MS } = require('../download-with-retry.cjs');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

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

test('one shared retry budget ends the retrying with the clear error before the outer test timeout', async () => {
  let t = 0;
  const now = () => t;
  const sleep = async (ms) => { t += ms; };
  // a sustained 429 with Retry-After 30: each wait is 30 s, so a 100 s budget runs out before the 4th wait
  // (the real shared budget is 150 s across all four jars, so an earlier jar's retries shorten later ones)
  const { fetchImpl, calls } = sequence(...Array.from({ length: 10 }, () => status(429, { 'retry-after': '30' })));
  await assert.rejects(fetchBytesWithRetry({ url: 'u', name: 'junit-4.13.2.jar', fetchImpl, sleep, now, deadlineAt: 100_000 }),
    (error) => /junit-4\.13\.2\.jar \(429\) retry budget exhausted/.test(error.message));
  assert.ok(t <= 100_000, `never sleeps past the budget (${t} ms)`);
  assert.equal(calls.length, 4, `${calls.length} attempts: three waits of 30 s, then the budget is exhausted`);
  // an already exhausted budget fails without a request
  const none = sequence(body('x'));
  await assert.rejects(fetchBytesWithRetry({ url: 'u', name: 'x.jar', fetchImpl: none.fetchImpl, sleep, now, deadlineAt: 0 }), /retry budget exhausted/);
  assert.equal(none.calls.length, 0);
});

test('the shared budget leaves room for the Kotlin provisioning inside the 290 s outer timeout', () => {
  const { TOTAL_BUDGET_MS } = require('../download-with-retry.cjs');
  assert.ok(TOTAL_BUDGET_MS <= 160_000, 'the retry budget must leave most of the 290 s for the compiler and the JUnit run');
  const wrapper = fs.readFileSync(path.join(root, 'scripts/test/repair/wafra-play-billing-native.test.cjs'), 'utf8');
  assert.match(wrapper, /timeout: 290_000/);
});

test('resolveDependency: a good cached file is used without any request', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wafra-deps-'));
  const good = Buffer.from('the pinned jar');
  fs.writeFileSync(path.join(dir, 'a.jar'), good);
  let fetched = 0;
  const bytes = await resolveDependency({ name: 'a.jar', url: 'u', sha256: sha(good), cacheDir: dir, fetchBytes: async () => { fetched += 1; return good; } });
  assert.equal(bytes.toString(), 'the pinned jar');
  assert.equal(fetched, 0);
});

test('resolveDependency: a corrupt cached file is deleted and replaced by one verified download', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wafra-deps-'));
  const good = Buffer.from('the pinned jar');
  fs.writeFileSync(path.join(dir, 'a.jar'), Buffer.from('truncat'));
  const logs = [];
  let fetched = 0;
  const bytes = await resolveDependency({ name: 'a.jar', url: 'u', sha256: sha(good), cacheDir: dir, log: (l) => logs.push(l),
    fetchBytes: async () => { fetched += 1; return good; } });
  assert.equal(bytes.toString(), 'the pinned jar');
  assert.equal(fetched, 1, 'exactly one download');
  assert.equal(fs.readFileSync(path.join(dir, 'a.jar')).toString(), 'the pinned jar', 'the cache now holds the verified bytes');
  assert.equal(logs.length, 1);
});

test('resolveDependency: a wrong download fails loudly, is never retried here, and never reaches the cache', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wafra-deps-'));
  let fetched = 0;
  await assert.rejects(resolveDependency({ name: 'a.jar', url: 'u', sha256: sha(Buffer.from('expected')), cacheDir: dir,
    fetchBytes: async () => { fetched += 1; return Buffer.from('tampered'); } }),
  /Native test dependency integrity check failed: a\.jar/);
  assert.equal(fetched, 1);
  assert.equal(fs.existsSync(path.join(dir, 'a.jar')), false, 'nothing unverified is cached');
  // a corrupt cache AND a wrong download: still fails, the bad file stays deleted, nothing cached
  fs.writeFileSync(path.join(dir, 'a.jar'), Buffer.from('bad'));
  await assert.rejects(resolveDependency({ name: 'a.jar', url: 'u', sha256: sha(Buffer.from('expected')), cacheDir: dir,
    fetchBytes: async () => Buffer.from('also wrong') }), /integrity check failed/);
  assert.equal(fs.existsSync(path.join(dir, 'a.jar')), false);
  // oversize bytes are refused even if the hash were right
  await assert.rejects(resolveDependency({ name: 'big.jar', url: 'u', sha256: sha(Buffer.alloc(2_000_001)), cacheDir: null,
    fetchBytes: async () => Buffer.alloc(2_000_001) }), /integrity check failed: big\.jar/);
});

test('resolveDependency without a cache directory just downloads and verifies', async () => {
  const good = Buffer.from('jar');
  assert.equal((await resolveDependency({ name: 'a.jar', url: 'u', sha256: sha(good), cacheDir: undefined, fetchBytes: async () => good })).toString(), 'jar');
});

test('the script is wired to the helpers, downloads sequentially and keeps all four hashes pinned', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/test/wafra-play-billing-native.cjs'), 'utf8');
  assert.match(script, /require\('\.\/download-with-retry\.cjs'\)/);
  assert.doesNotMatch(script, /Promise\.all\(dependencies/, 'downloads are sequential, not four parallel requests');
  assert.match(script, /await resolveDependency\(\{ name, url, sha256, cacheDir: libs, fetchBytes/);
  assert.match(script, /deadlineAt/);
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
