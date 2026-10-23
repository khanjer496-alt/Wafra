// Network edge for shared alert shapes (src/lib/shared-alert-format-sync.ts).
// Run: node --test scripts/test/shared-alert-format-sync.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('../universal-test/load-ts.cjs');

const load = createLoader();
const L = load('@/lib/learned-alert-formats');
const S = load('@/lib/shared-alert-formats');
const Sync = load('@/lib/shared-alert-format-sync');
const NOW = Date.parse('2026-09-25T10:00:00Z');

const TAUPE = 'Taupe Bank: Rs 450.00 debited from A/c XX1234 on 03-09-2026 at SWIGGY BANGALORE. Avl Bal Rs 9,550.00.';
const learned = L.learnFromConfirmation({ source: TAUPE, sender: 'TAUPEB', now: NOW, context: { country: 'IN' },
  confirmed: { amountMinor: 45000, currency: 'INR', exponent: 2, direction: 'debit', merchant: 'SWIGGY BANGALORE', date: '2026-09-03' } });
assert.equal(learned.ok, true);
const made = S.toSharedAlertShape(learned.template);
assert.equal(made.ok, true);
const format = { hash: made.hash, shape: made.shape };
const clone = (value) => JSON.parse(JSON.stringify(value));

const reply = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const recorder = (responder) => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return responder(url, init); };
  return { calls, fetch };
};

test('download: 200 returns the validated list and the etag, and sends If-None-Match', async () => {
  const { calls, fetch } = recorder(() => reply(200, { formats: [format] }, { etag: '"v2"' }));
  const out = await Sync.fetchPublishedSharedFormats('https://relay.example/', '"v1"', { fetch });
  assert.equal(out.kind, 'updated');
  assert.equal(out.etag, '"v2"');
  assert.deepEqual(out.formats, [format]);
  assert.equal(calls[0].url, 'https://relay.example/v1/formats/published');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers['if-none-match'], '"v1"');
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test('download: no etag sends no If-None-Match; missing ETag header gives null', async () => {
  const { calls, fetch } = recorder(() => reply(200, { formats: [] }));
  const out = await Sync.fetchPublishedSharedFormats('https://relay.example', null, { fetch });
  assert.deepEqual(out, { kind: 'updated', etag: null, formats: [] });
  assert.equal('if-none-match' in calls[0].init.headers, false);
});

test('download: 304 is not-modified', async () => {
  const { fetch } = recorder(() => reply(304, null));
  assert.deepEqual(await Sync.fetchPublishedSharedFormats('https://relay.example', '"v1"', { fetch }), { kind: 'not-modified' });
});

test('download: network errors, non-2xx and malformed bodies resolve to failed, never throw', async () => {
  const boom = recorder(() => { throw new Error('offline'); });
  assert.deepEqual(await Sync.fetchPublishedSharedFormats('https://relay.example', null, { fetch: boom.fetch }), { kind: 'failed' });
  const down = recorder(() => reply(503, { error: 'x' }));
  assert.deepEqual(await Sync.fetchPublishedSharedFormats('https://relay.example', null, { fetch: down.fetch }), { kind: 'failed' });
  const junk = recorder(() => reply(200, '<html>not json'));
  assert.deepEqual(await Sync.fetchPublishedSharedFormats('https://relay.example', null, { fetch: junk.fetch }), { kind: 'failed' });
  const shapeless = recorder(() => reply(200, { formats: 'nope' }));
  assert.deepEqual(await Sync.fetchPublishedSharedFormats('https://relay.example', null, { fetch: shapeless.fetch }), { kind: 'failed' });
  assert.deepEqual(await Sync.fetchPublishedSharedFormats('', null, { fetch: down.fetch }), { kind: 'failed' });
});

test('download: invalid, tampered and duplicate entries are filtered out', async () => {
  const tamperedShape = clone(format.shape);
  tamperedShape.tokens.unshift({ k: 'L', v: 'Account 12345678' });
  const extraKey = { ...clone(format.shape), owner: 'someone' };
  const { fetch } = recorder(() => reply(200, { formats: [
    format,
    { hash: format.hash, shape: format.shape },
    { hash: 'f'.repeat(64), shape: format.shape },
    { hash: format.hash, shape: tamperedShape },
    { hash: format.hash, shape: extraKey },
    { shape: format.shape },
    null,
  ] }, { etag: '"e"' }));
  const out = await Sync.fetchPublishedSharedFormats('https://relay.example', null, { fetch });
  assert.equal(out.kind, 'updated');
  assert.deepEqual(out.formats, [format]);
});

test('download: a hung request is aborted by the timeout', async () => {
  const fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const out = await Sync.fetchPublishedSharedFormats('https://relay.example', null, { fetch, timeoutMs: 10 });
  assert.deepEqual(out, { kind: 'failed' });
});

test('submit: posts only the shape with the sync token and reports the status', async () => {
  for (const status of ['pending', 'published', 'blocked']) {
    const { calls, fetch } = recorder(() => reply(200, { status }));
    const out = await Sync.submitSharedAlertShape({ baseUrl: 'https://relay.example/', syncToken: 'tok' }, format.shape, { fetch });
    assert.deepEqual(out, { ok: true, status });
    assert.equal(calls[0].url, 'https://relay.example/v1/formats/submit');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(calls[0].init.body), { shape: format.shape });
    assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)), ['shape']);
  }
});

test('submit: 401, 429, 400, 5xx, odd bodies and network errors never throw', async () => {
  const cfg = { baseUrl: 'https://relay.example', syncToken: 'tok' };
  const run = (responder) => Sync.submitSharedAlertShape(cfg, format.shape, { fetch: recorder(responder).fetch });
  assert.deepEqual(await run(() => reply(401, {})), { ok: false, reason: 'unauthorized' });
  assert.deepEqual(await run(() => reply(429, {})), { ok: false, reason: 'rate-limited' });
  assert.deepEqual(await run(() => reply(400, {})), { ok: false, reason: 'rejected' });
  assert.deepEqual(await run(() => reply(500, {})), { ok: false, reason: 'rejected' });
  assert.deepEqual(await run(() => reply(200, { status: 'weird' })), { ok: false, reason: 'rejected' });
  assert.deepEqual(await run(() => { throw new Error('offline'); }), { ok: false, reason: 'unavailable' });
});

test('submit: a shape that fails the strict validator is never sent', async () => {
  const { calls, fetch } = recorder(() => reply(200, { status: 'pending' }));
  const bad = clone(format.shape);
  bad.tokens.push({ k: 'L', v: 'call 0501234567' });
  const out = await Sync.submitSharedAlertShape({ baseUrl: 'https://relay.example', syncToken: 'tok' }, bad, { fetch });
  assert.deepEqual(out, { ok: false, reason: 'invalid-shape' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await Sync.submitSharedAlertShape({ baseUrl: 'https://relay.example', syncToken: '' }, format.shape, { fetch }),
    { ok: false, reason: 'invalid-shape' });
});

test('state normalizer: garbage becomes empty, bad shapes are dropped, etag/fetchedAt are sanity-checked', () => {
  const empty = { etag: null, fetchedAt: null, formats: [] };
  for (const junk of [undefined, null, 5, 'x', [], { formats: 7 }]) assert.deepEqual(Sync.normalizeSharedAlertFormatState(junk), empty);
  const good = Sync.normalizeSharedAlertFormatState({ etag: '"e"', fetchedAt: 123, formats: [format, { hash: 'bad', shape: format.shape }] });
  assert.deepEqual(good, { etag: '"e"', fetchedAt: 123, formats: [format] });
  assert.equal(Sync.normalizeSharedAlertFormatState({ etag: 5, fetchedAt: -1, formats: [format] }).fetchedAt, null);
  assert.equal(Sync.normalizeSharedAlertFormatState({ etag: 5, fetchedAt: 1, formats: [] }).etag, null);
});

test('refresh is due at most once per 24 hours', () => {
  const day = Sync.SHARED_FORMAT_REFRESH_MS;
  assert.equal(Sync.sharedAlertFormatsDue({ fetchedAt: null }, 1_000_000), true);
  assert.equal(Sync.sharedAlertFormatsDue(undefined, 1_000_000), true);
  assert.equal(Sync.sharedAlertFormatsDue({ fetchedAt: 1_000_000 }, 1_000_000 + day - 1), false);
  assert.equal(Sync.sharedAlertFormatsDue({ fetchedAt: 1_000_000 }, 1_000_000 + day), true);
  assert.equal(Sync.sharedAlertFormatsDue({ fetchedAt: 9_000_000 }, 1_000_000), true, 'a future stamp (clock change) does not block forever');
});
