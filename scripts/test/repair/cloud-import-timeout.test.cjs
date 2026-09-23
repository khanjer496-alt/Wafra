'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const contract = load(path.join(root, 'src/lib/cloud-import-contract.ts'));
const config = { baseUrl: 'https://relay.example.invalid', adminToken: 'fixture-token' };
const capabilities = {
  email: { enabled: true, accepts: ['message/rfc822'], maxBytes: 1000 },
  pdf: { enabled: true, accepts: ['application/pdf'], maxBytes: 1000, maxRows: 100,
    maxPages: 10, parser: 'fixture', note: '' },
  csv: { enabled: true, accepts: ['text/csv'], maxBytes: 1000, maxRows: 100,
    parser: 'fixture', note: '' },
};
const money = { currency: 'AED', exponent: 2 };
const flush = () => new Promise(resolve => setImmediate(resolve));
const pending = () => new Promise(() => {});
const response = (body, status = 200) => ({
  status, ok: status >= 200 && status < 300,
  text: typeof body === 'function' ? body : async () => JSON.stringify(body),
});

function harness(fetch) {
  let nextTimer = 0;
  const timers = new Map();
  const requests = [];
  const api = load(path.join(root, 'src/lib/cloud-import.ts'), {
    'expo/fetch': { fetch: async (url, init) => {
      requests.push({ url, ...init });
      return fetch(url, init);
    } },
    'expo-file-system': { File: class { exists = true; size = 20; } },
    '@/lib/cloud-import-contract': contract,
  }, {
    AbortController,
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
  });
  return {
    api, requests, timers,
    expire() {
      assert.equal(timers.size, 1, 'the request deadline must remain armed');
      const [id, timer] = [...timers][0];
      assert.equal(timer.delay, 60_000);
      timers.delete(id);
      timer.callback();
    },
  };
}

function observe(operation) {
  const result = { settled: false };
  operation.then(value => Object.assign(result, { settled: true, value }),
    error => Object.assign(result, { settled: true, error }));
  return result;
}

function assertNetworkFailure(result) {
  assert.equal(result.settled, true, 'UI operation must settle even if native abort leaves its promise pending');
  assert.ok(result.error instanceof contract.CloudImportError);
  assert.equal(result.error.code, 'network');
}

const operations = {
  capabilities: api => api.getImportCapabilities(config),
  'PDF upload': api => api.uploadPdfStatement(config,
    { uri: 'file:///fixture.pdf', name: 'fixture.pdf', size: 20 }, capabilities, money),
  'CSV upload': api => api.uploadCsvStatement(config,
    { uri: 'file:///fixture.csv', name: 'fixture.csv', size: 20 }, capabilities, money),
};

for (const [name, run] of Object.entries(operations)) {
  test(`${name}: stalled response body times out even when abort cannot settle the native stream`, async () => {
    let bodyRead = false;
    const h = harness(async () => response(() => { bodyRead = true; return pending(); }));
    const outcome = observe(run(h.api));
    await flush();
    assert.equal(bodyRead, true);
    assert.equal(outcome.settled, false);
    h.expire();
    await flush();
    assertNetworkFailure(outcome);
    assert.equal(h.requests[0].signal.aborted, true);
    assert.equal(h.requests.length, 1, 'transport must never retry a write automatically');
    assert.equal(h.timers.size, 0);
  });
}

test('request stalled before headers also settles at its deadline without native abort completion', async () => {
  const h = harness(pending);
  const outcome = observe(h.api.getImportCapabilities(config));
  h.expire();
  await flush();
  assertNetworkFailure(outcome);
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test('request rejection before headers maps to network and releases its deadline', async () => {
  const h = harness(async () => { throw new Error('offline'); });
  await assert.rejects(h.api.getImportCapabilities(config), error =>
    error instanceof contract.CloudImportError && error.code === 'network');
  assert.equal(h.timers.size, 0);
  assert.equal(h.requests.length, 1);
});

test('body transport rejection maps to network and releases its deadline', async () => {
  const h = harness(async () => response(async () => { throw new Error('stream disconnected'); }));
  await assert.rejects(h.api.getImportCapabilities(config), error =>
    error instanceof contract.CloudImportError && error.code === 'network');
  assert.equal(h.timers.size, 0);
});

test('successful JSON still uses the capability contract and releases its deadline', async () => {
  const h = harness(async () => response(capabilities));
  assert.equal(JSON.stringify(await h.api.getImportCapabilities(config)), JSON.stringify(capabilities));
  assert.equal(h.timers.size, 0);
  assert.equal(h.requests[0].signal.aborted, false);
});

test('HTTP errors and malformed JSON retain their contract errors', async () => {
  for (const [body, status, code] of [[{}, 401, 'unauthorized'], [() => Promise.resolve('{'), 200, 'unexpected']]) {
    const h = harness(async () => response(body, status));
    await assert.rejects(h.api.getImportCapabilities(config), error =>
      error instanceof contract.CloudImportError && error.code === code);
    assert.equal(h.timers.size, 0);
  }
});

test('successful DELETE 204 finishes without trying to consume a response body', async () => {
  const h = harness(async () => response(() => { throw new Error('204 has no body'); }, 204));
  await h.api.revokeEmailForwardingAddress(config);
  assert.equal(h.requests[0].method, 'DELETE');
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
});
