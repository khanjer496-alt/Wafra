'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '../../..');
const LEDGER = 'wafra/erase-fixture';
const MERCHANT_KEY = 'wafra:merchant-logo:v4:aseer%20time';
const BANK_KEY = 'wafra:bank-logo:v2:bank%20of%20america';
const cachedRecord = (query, value) => JSON.stringify({ query, value, expiresAt: Date.now() + 60_000 });
const MERCHANT_RECORD = cachedRecord('aseer time', {
  id: 'brandfetch:aseertime.com',
  domain: 'aseertime.com',
  canonicalName: 'Aseer Time',
  logoUrl: 'https://cdn.brandfetch.io/domain/aseertime.com?c=fixture-client',
  confidence: 0.95,
  source: 'search',
});
const BANK_RECORD = cachedRecord('bank of america', {
  id: 'bank:bankofamerica.com',
  domain: 'bankofamerica.com',
  canonicalName: 'Bank of America',
  logoUrl: 'https://cdn.brandfetch.io/domain/bankofamerica.com?c=fixture-client',
  source: 'search',
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const turn = () => new Promise(resolve => setImmediate(resolve));

// Run real source in one isolated module graph. Only native storage, market
// lookup and Brandfetch are replaced with deterministic fixtures.
function harness(platform) {
  const data = new Map();
  const modules = new Map();
  let fetchCalls = 0;
  let storageReads = 0;
  let databaseDeletes = 0;
  const storage = {
    async getItem(key) { storageReads++; return data.get(key) ?? null; },
    async setItem(key, value) { data.set(key, value); },
    async removeItem(key) { data.delete(key); },
    async getAllKeys() { return [...data.keys()]; },
    async multiRemove(keys) { for (const key of keys) data.delete(key); },
    async multiSet(entries) { for (const [key, value] of entries) data.set(key, value); },
    async multiGet(keys) { return keys.map(key => [key, data.get(key) ?? null]); },
  };
  const dependencies = {
    'react-native': { Platform: { OS: platform === 'native' ? 'ios' : platform } },
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
    '@/lib/markets': { bankBrandForName() { return null; } },
    '@/lib/storage-diagnostics': { recordStorageFailure() {} },
    'expo-crypto': {},
    'expo-secure-store': { async deleteItemAsync() {} },
    'expo-sqlite': { async deleteDatabaseAsync() { databaseDeletes++; } },
  };
  function load(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (modules.has(name)) return modules.get(name);
    assert.ok(name.startsWith('@/lib/'), `Unstubbed boundary: ${name}`);
    const file = path.join(ROOT, 'src/lib', name.slice('@/lib/'.length) + '.ts');
    const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    });
    const exports = {};
    modules.set(name, exports);
    vm.runInNewContext(result.outputText, {
      exports, require: load, process: { env: { EXPO_PUBLIC_WAFRA_BRANDFETCH_CLIENT_ID: 'fixture-client' } },
      fetch: async url => {
        fetchCalls++;
        if (String(url).includes('Aseer%20Time')) return {
          ok: true, json: async () => [{ name: 'Aseer Time', domain: 'aseertime.com', claimed: false }],
        };
        if (String(url).includes('Bank%20of%20America')) return {
          ok: true, json: async () => [{ name: 'Bank of America', domain: 'bankofamerica.com', claimed: true }],
        };
        return { ok: true, json: async () => [] };
      }, AbortController, setTimeout, clearTimeout, console,
    }, { filename: file });
    return exports;
  }
  const state = load(platform !== 'web' ? '@/lib/state-storage.native' : '@/lib/state-storage').stateStorage;
  return {
    data, storage, state, load,
    get databaseDeletes() { return databaseDeletes; },
    get storageReads() { return storageReads; },
    get fetchCalls() { return fetchCalls; },

  };
}

for (const platform of ['web', 'native']) {
  test(`${platform}: erase removes all owned logo versions even before resolvers load, preserving unrelated keys`, async () => {
    const h = harness(platform);
    for (const key of [LEDGER, LEDGER + ':tx:0']) h.data.set(key, 'ledger');
    for (const key of [MERCHANT_KEY, 'wafra:merchant-logo:v1:old']) h.data.set(key, MERCHANT_RECORD);
    for (const key of [BANK_KEY, 'wafra:bank-logo:v0:old']) h.data.set(key, BANK_RECORD);
    for (const key of ['other-app:key', 'wafra:bank-logo-preference', LEDGER + '-other']) h.data.set(key, 'keep');
    await h.state.destroy(LEDGER);
    assert.deepEqual([...h.data.keys()].sort(), ['other-app:key', 'wafra:bank-logo-preference', LEDGER + '-other'].sort());
  });

  test(`${platform}: a failed cache removal rejects erase before deleting ledger data and supports retry`, async () => {
    const h = harness(platform);
    h.data.set(MERCHANT_KEY, MERCHANT_RECORD);
    h.data.set(LEDGER, 'ledger');
    const remove = h.storage.multiRemove;
    h.storage.multiRemove = async keys => {
      if (keys.includes(MERCHANT_KEY)) throw new Error('injected cache removal failure');
      return remove(keys);
    };
    await assert.rejects(h.state.destroy(LEDGER), /injected cache removal failure/);
    assert.equal(h.databaseDeletes, 0);
    assert.equal(h.data.get(LEDGER), 'ledger');
    h.storage.multiRemove = remove;
    await h.state.destroy(LEDGER);
    assert.equal(h.data.size, 0);
  });

}
