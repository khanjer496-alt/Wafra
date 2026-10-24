'use strict';
// Anonymous sharing credential: single pairing, own key, back-off, erase.
// Needs the shared build: bash scripts/test/build.sh. Run:
//   node --test scripts/test/shared-alert-format-identity.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const { createSharingIdentity, SHARING_CREDENTIAL_KEY, SHARING_BACKOFF_MS } = require('./build/shared-alert-format-identity.cjs');

const DEVICE = '123e4567-e89b-42d3-a456-426614174000';
const TOKEN = 'T'.repeat(48);
const make = (over = {}) => {
  const store = new Map(); const calls = []; let clock = 1_000_000;
  const deps = {
    baseUrl: 'https://relay.example/', readSecret: async (k) => store.get(k) ?? null,
    writeSecret: async (k, v) => { store.set(k, v); }, removeSecret: async (k) => { store.delete(k); },
    entropy: () => new Uint8Array(32).fill(9), now: () => clock,
    transport: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ deviceId: DEVICE, syncToken: TOKEN, ingestToken: 'x', adminToken: 'y' }), { status: 200 });
    },
    ...over,
  };
  return { deps, store, calls, advance: (ms) => { clock += ms; }, id: createSharingIdentity(deps) };
};

test('pairs once through /v1/pair, stores only baseUrl/deviceId/syncToken under its own key, then reuses it', async () => {
  const t = make();
  const [a, b] = await Promise.all([t.id.ensure(), t.id.ensure()]);
  assert.equal(t.calls.length, 1, 'single-flight');
  assert.equal(t.calls[0].url, 'https://relay.example/v1/pair');
  assert.equal(typeof t.calls[0].body.publicKey, 'string');
  assert.deepEqual(a, { baseUrl: 'https://relay.example', deviceId: DEVICE, syncToken: TOKEN });
  assert.deepEqual(b, a);
  assert.deepEqual(JSON.parse(t.store.get(SHARING_CREDENTIAL_KEY)), a);
  assert.deepEqual([...t.store.keys()], [SHARING_CREDENTIAL_KEY]);
  assert.deepEqual(await t.id.ensure(), a);
  assert.equal(t.calls.length, 1, 'reused afterwards');
});

test('failures are silent and back off for 24 hours', async () => {
  let fail = true;
  const t = make({ transport: async (url, init) => {
    if (fail) return new Response('{}', { status: 429 });
    return new Response(JSON.stringify({ deviceId: DEVICE, syncToken: TOKEN }), { status: 200 });
  } });
  assert.equal(await t.id.ensure(), null);
  fail = false;
  assert.equal(await t.id.ensure(), null, 'inside the back-off nothing is attempted');
  t.advance(SHARING_BACKOFF_MS + 1);
  assert.ok(await t.id.ensure(), 'pairs after the back-off');
});

test('thrown transport, bad response and missing relay never throw', async () => {
  assert.equal(await make({ transport: async () => { throw new Error('offline'); } }).id.ensure(), null);
  assert.equal(await make({ transport: async () => new Response('{"deviceId":"nope"}', { status: 200 }) }).id.ensure(), null);
  assert.equal(await make({ baseUrl: null }).id.ensure(), null);
});

test('erase removes the credential', async () => {
  const t = make();
  await t.id.ensure();
  await t.id.erase();
  assert.equal(t.store.has(SHARING_CREDENTIAL_KEY), false);
});
