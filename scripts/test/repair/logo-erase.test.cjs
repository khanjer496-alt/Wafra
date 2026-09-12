'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '../../..');
const LEDGER = 'wafra/erase-fixture';
const MERCHANT_KEY = 'wafra:merchant-logo:v2:choithrams';
const BANK_KEY = 'wafra:bank-logo:v1:fab';
const cachedRecord = value => JSON.stringify({ value, expiresAt: Date.now() + 60_000 });
const MERCHANT_RECORD = cachedRecord({
  id: 'brandfetch:choithrams.com',
  domain: 'choithrams.com',
  canonicalName: 'Choithrams',
  logoUrl: 'https://cdn.brandfetch.io/domain/choithrams.com?c=fixture-client',
  confidence: 1,
  source: 'verified',
});
const BANK_RECORD = cachedRecord({
  id: 'bank:bankfab.com',
  domain: 'bankfab.com',
  canonicalName: 'FAB',
  logoUrl: 'https://cdn.brandfetch.io/domain/bankfab.com?c=fixture-client',
  source: 'market',
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const turn = () => new Promise(resolve => setImmediate(resolve));

// Run real source in one isolated module graph. Only native storage, market
// lookup and fetch are replaced. Only reviewed brand strings are used.
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
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
    '@/lib/markets': { bankBrandForName(name) { return name === 'FAB' ? { name: 'FAB', domain: 'bankfab.com' } : null; } },
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
      fetch: () => { fetchCalls++; throw new Error('logo resolver must never fetch'); }, AbortController, setTimeout, clearTimeout, console,
    }, { filename: file });
    return exports;
  }
  const state = load(platform === 'native' ? '@/lib/state-storage.native' : '@/lib/state-storage').stateStorage;
  return {
    data, storage, state, load,
    get databaseDeletes() { return databaseDeletes; },
    get storageReads() { return storageReads; },
    get fetchCalls() { return fetchCalls; },
    resolvers() {
      return [
        { resolve: load('@/lib/merchant-logo-resolver').resolveRemoteMerchantLogo, name: 'Choithrams', key: MERCHANT_KEY, record: MERCHANT_RECORD, domain: 'choithrams.com' },
        { resolve: load('@/lib/bank-logo-resolver').resolveBankLogo, name: 'FAB', key: BANK_KEY, record: BANK_RECORD, domain: 'bankfab.com' },
      ];
    },
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

  test(`${platform}: erase invalidates merchant and bank memory entries`, async () => {
    const h = harness(platform);
    const resolvers = h.resolvers();
    for (const entry of resolvers) h.data.set(entry.key, entry.record);
    for (const entry of resolvers) assert.equal((await entry.resolve(entry.name)).domain, entry.domain);
    const reads = h.storageReads;
    for (const entry of resolvers) await entry.resolve(entry.name);
    assert.equal(h.storageReads, reads, 'warm identities use memory');
    await h.state.destroy(LEDGER);
    for (const entry of resolvers) assert.equal((await entry.resolve(entry.name)).domain, entry.domain);
    assert.equal(h.storageReads, reads + 2, 'fresh post-erase identities must not reuse erased memory');
    assert.equal(h.fetchCalls, 0);
  });

  for (const kind of [0, 1]) {
    for (const cached of [false, true]) {
      test(`${platform}: pending ${kind ? 'bank' : 'merchant'} ${cached ? 'cached identity' : 'cache miss'} cannot repopulate after erase`, async () => {
        const h = harness(platform);
        const entry = h.resolvers()[kind];
        const read = deferred();
        h.storage.getItem = () => read.promise;
        const lookup = entry.resolve(entry.name);
        await turn();
        await h.state.destroy(LEDGER);
        read.resolve(cached ? entry.record : null);
        assert.equal(await lookup, null, 'an erased lookup must not publish its old result');
        assert.equal(h.data.has(entry.key), false);
        assert.equal(h.fetchCalls, 0);
      });
    }

    test(`${platform}: erase drains an already-started ${kind ? 'bank' : 'merchant'} write before removing its key`, async () => {
      const h = harness(platform);
      const entry = h.resolvers()[kind];
      const write = deferred();
      const started = deferred();
      h.storage.setItem = async (key, value) => { started.resolve(); await write.promise; h.data.set(key, value); };
      const lookup = entry.resolve(entry.name);
      await started.promise;
      const erase = h.state.destroy(LEDGER);
      await turn();
      write.resolve();
      await Promise.all([lookup, erase]);
      assert.equal(h.data.has(entry.key), false, 'late storage completion must be removed');
    });
  }

  test(`${platform}: lookups requested while erase is running never publish artwork`, async () => {
    const h = harness(platform);
    const entries = h.resolvers();
    const keys = deferred();
    h.storage.getAllKeys = () => keys.promise;
    const erase = h.state.destroy(LEDGER);
    await turn();
    for (const entry of entries) assert.equal(await entry.resolve(entry.name), null);
    assert.equal(h.fetchCalls, 0);
    assert.equal(h.storageReads, 0);
    keys.resolve([]);
    await erase;
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

  test(`${platform}: a stale lookup finishing cannot remove a new generation's pending read`, async () => {
    const h = harness(platform);
    const entry = h.resolvers()[0];
    const oldRead = deferred();
    const newRead = deferred();
    let reads = 0;
    h.storage.getItem = () => ++reads === 1 ? oldRead.promise : newRead.promise;
    const oldLookup = entry.resolve(entry.name);
    await turn();
    await h.state.destroy(LEDGER);
    const newLookup = entry.resolve(entry.name);
    await turn();
    oldRead.resolve(entry.record);
    assert.equal(await oldLookup, null);
    const sameNewLookup = entry.resolve(entry.name);
    await turn();
    assert.equal(reads, 2, 'the new lookup must remain deduplicated');
    newRead.resolve(null);
    assert.equal((await newLookup).domain, entry.domain);
    assert.equal((await sameNewLookup).domain, entry.domain);
    assert.equal(h.fetchCalls, 0);
  });
}
