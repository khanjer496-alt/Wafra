'use strict';
// Maven Central answers 429 to shared CI runners, and once 404 for a jar it serves. The native Play-billing
// test downloads four public jars from two mirrors each; the helper retries only transient failures with
// backoff, drops a mirror on a final error, and the script verifies the
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
  const fetchImpl = async (url) => { calls.push(url); const next = replies.shift(); if (next instanceof Error) throw next; return next; };
  return { fetchImpl, calls };
};
const EXTERNAL = /^External download failed: public native test dependency .+ This is a network or mirror problem, not a code failure; re-run the job\.$/;
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
      (error) => error.message.startsWith(`External download failed: public native test dependency x.jar (${code})`) && EXTERNAL.test(error.message));
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  }
});

test('persistent 503 gives up after the initial try and four retries with 2, 4, 8, 16 s waits', async () => {
  const { fetchImpl, calls } = sequence(...Array.from({ length: 5 }, () => status(503)));
  const { waits, sleep } = clock();
  await assert.rejects(fetchBytesWithRetry({ url: 'u', name: 'x.jar', fetchImpl, sleep }),
    (error) => /x\.jar \(503\) after 5 attempts/.test(error.message) && EXTERNAL.test(error.message));
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
    (error) => /junit-4\.13\.2\.jar \(429\) retry budget exhausted/.test(error.message) && EXTERNAL.test(error.message));
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

test('resolveDependency writes the cache through a temp file, never a partial file under the final name', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wafra-deps-'));
  const good = Buffer.from('the pinned jar');
  await resolveDependency({ name: 'a.jar', urls: ['u'], sha256: sha(good), cacheDir: dir, fetchBytes: async () => good });
  assert.deepEqual(fs.readdirSync(dir), ['a.jar'], 'only the final file remains');
  const source = fs.readFileSync(path.join(root, 'scripts/test/download-with-retry.cjs'), 'utf8');
  assert.match(source, /writeFileSync\(partial, bytes[\s\S]{0,40}renameSync\(partial, cached\)/);
  assert.doesNotMatch(source, /writeFileSync\(cached,/);
});

test('resolveDependency without a cache directory just downloads and verifies', async () => {
  const good = Buffer.from('jar');
  assert.equal((await resolveDependency({ name: 'a.jar', url: 'u', sha256: sha(good), cacheDir: undefined, fetchBytes: async () => good })).toString(), 'jar');
});

test('the script is wired to the helpers, downloads sequentially and keeps all four hashes pinned', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/test/wafra-play-billing-native.cjs'), 'utf8');
  assert.match(script, /require\('\.\/download-with-retry\.cjs'\)/);
  assert.doesNotMatch(script, /Promise\.all\(dependencies/, 'downloads are sequential, not four parallel requests');
  assert.match(script, /await resolveDependency\(\{ name, urls, sha256, cacheDir: libs, fetchBytes/);
  assert.match(script, /fetchBytesWithRetry\(\{ urls, name, deadlineAt/);
  assert.match(script, /const dependencies = require\('\.\/wafra-play-billing-deps\.json'\);/);
  const pins = JSON.parse(fs.readFileSync(path.join(root, 'scripts/test/wafra-play-billing-deps.json'), 'utf8'));
  assert.deepEqual(pins.map((pin) => pin.name), ['billing-8.0.0.aar', 'junit-4.13.2.jar', 'hamcrest-core-1.3.jar', 'json-20250517.jar']);
  for (const pin of pins) {
    assert.match(pin.sha256, /^[0-9a-f]{64}$/, `${pin.name} stays pinned`);
    assert.equal(pin.urls.length, 2, `${pin.name} has two mirrors`);
    assert.equal(new Set(pin.urls.map((url) => new URL(url).host)).size, 2, `${pin.name}: two different hosts`);
    for (const url of pin.urls) {
      assert.match(url, /^https:\/\//);
      assert.ok(url.endsWith('/' + pin.name), `${url} is ${pin.name}`);
    }
  }
});

test('mirrors: a 404 on the first drops it and the second serves the file without waiting', async () => {
  const { fetchImpl, calls } = sequence(status(404), body('junit'));
  const { waits, sleep } = clock();
  const logs = [];
  const bytes = await fetchBytesWithRetry({ urls: ['https://a.example/j.jar', 'https://b.example/j.jar'], name: 'j.jar', fetchImpl, sleep, log: (l) => logs.push(l) });
  assert.equal(bytes.toString(), 'junit');
  assert.deepEqual(calls, ['https://a.example/j.jar', 'https://b.example/j.jar']);
  assert.deepEqual(waits, []);
  assert.match(logs.join('\n'), /a\.example answered 404; using the next mirror/);
});

test('mirrors: a 429 on the first and a success on the second returns in the same attempt', async () => {
  const { fetchImpl, calls } = sequence(status(429), body('ok'));
  const { waits, sleep } = clock();
  assert.equal((await fetchBytesWithRetry({ urls: ['https://a.example/x', 'https://b.example/x'], name: 'x.jar', fetchImpl, sleep })).toString(), 'ok');
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, []);
});

test('mirrors: a dropped mirror is never asked again; a transient one is retried after the backoff', async () => {
  const { fetchImpl, calls } = sequence(status(404), status(503), status(503), body('ok'));
  const { waits, sleep } = clock();
  assert.equal((await fetchBytesWithRetry({ urls: ['https://a.example/x', 'https://b.example/x'], name: 'x.jar', fetchImpl, sleep })).toString(), 'ok');
  assert.deepEqual(calls, ['https://a.example/x', 'https://b.example/x', 'https://b.example/x', 'https://b.example/x']);
  assert.deepEqual(waits, [2000, 4000]);
});

test('mirrors: when every mirror gives a final status it fails at once with an external-download message naming each', async () => {
  const { fetchImpl, calls } = sequence(status(404), status(403));
  const { waits, sleep } = clock();
  await assert.rejects(fetchBytesWithRetry({ urls: ['https://a.example/x', 'https://b.example/x'], name: 'junit-4.13.2.jar', fetchImpl, sleep }),
    (error) => error.message.startsWith('External download failed: public native test dependency junit-4.13.2.jar (a.example: 404; b.example: 403)') &&
      EXTERNAL.test(error.message));
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, []);
});

test('CI caches the jars under a key made only of their pinned hashes, and saves them even when other tests fail', () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
  const steps = workflow.jobs.check.steps;
  const named = (name) => steps.find((step) => step.name === name);
  const keyStep = named('Key native billing test dependencies by their pinned SHA-256');
  const restore = named('Restore native billing test dependencies');
  const complete = named('Check native billing test dependencies are complete');
  const save = named('Save native billing test dependencies');
  const test = steps.find((step) => /^\s*npm test\b/m.test(step.run || ''));
  assert.ok(keyStep && restore && complete && save && test);
  assert.match(restore.uses, /^actions\/cache\/restore@/);
  assert.match(save.uses, /^actions\/cache\/save@/);
  for (const step of [restore, save]) {
    assert.equal(step.with.key, '${{ steps.billing-deps.outputs.key }}');
    assert.match(step.with.path, /wafra-play-billing-libs$/);
  }
  assert.match(test.env?.WAFRA_PLAY_BILLING_TEST_LIBS || '', /wafra-play-billing-libs$/);
  const order = [keyStep, restore, test, complete, save].map((step) => steps.indexOf(step));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'key, restore, test, completeness check, save');
  assert.equal(complete.if, "always() && steps.billing-deps-cache.outputs.cache-hit != 'true'");
  assert.equal(save.if, "always() && steps.billing-deps-complete.outputs.complete == 'true'");

  // The key step's own shell: a key of the names and hashes only, so a URL edit keeps it and a pin change moves it.
  const keyFor = (pins) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-billing-key-'));
    try {
      fs.mkdirSync(path.join(dir, 'scripts/test'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'scripts/test/wafra-play-billing-deps.json'), JSON.stringify(pins));
      const out = path.join(dir, 'out');
      const run = spawnSync('bash', ['-c', keyStep.run], { cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: out } });
      assert.equal(run.status, 0, run.stderr);
      return fs.readFileSync(out, 'utf8').trim();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  const pins = JSON.parse(fs.readFileSync(path.join(root, 'scripts/test/wafra-play-billing-deps.json'), 'utf8'));
  const key = keyFor(pins);
  assert.match(key, /^key=wafra-play-billing-libs-v2-[0-9a-f]{32}$/);
  assert.equal(keyFor(pins.map((pin) => ({ ...pin, urls: ['https://elsewhere.example/' + pin.name] }))), key, 'mirror edits keep the cache');
  assert.notEqual(keyFor(pins.map((pin, i) => (i === 1 ? { ...pin, sha256: '0'.repeat(64) } : pin))), key, 'a new pin replaces it');

  // The completeness check, run with its own pin file: only all four files with their pinned bytes may be saved.
  const check = (files, pinFor) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-billing-libs-'));
    try {
      const libs = path.join(dir, 'libs');
      fs.mkdirSync(path.join(dir, 'scripts/test'), { recursive: true });
      fs.mkdirSync(libs);
      fs.writeFileSync(path.join(dir, 'scripts/test/wafra-play-billing-deps.json'),
        JSON.stringify(pins.map((pin) => ({ ...pin, sha256: sha(Buffer.from(pinFor(pin.name))) }))));
      for (const [name, bytes] of files) fs.writeFileSync(path.join(libs, name), bytes);
      const out = path.join(dir, 'out');
      const run = spawnSync('bash', ['-c', complete.run], { cwd: dir, encoding: 'utf8', env: { ...process.env, LIBS: libs, GITHUB_OUTPUT: out } });
      assert.equal(run.status, 0, run.stderr);
      return fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim() : '';
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  const content = (name) => `bytes of ${name}`;
  const all = pins.map((pin) => [pin.name, content(pin.name)]);
  assert.equal(check(all, content), 'complete=true');
  assert.equal(check(all.slice(0, 3), content), '', 'three of four is not complete');
  assert.equal(check(all.map(([name, bytes], i) => [name, i === 2 ? bytes.slice(0, 5) : bytes]), content), '',
    'a truncated file (a cancelled job) is never saved');
  assert.equal(check(all.map(([name]) => [name, 'x']), content), '', 'names alone are not enough');
});
