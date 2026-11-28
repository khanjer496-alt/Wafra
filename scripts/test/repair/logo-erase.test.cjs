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
  // Set to a promise to hold Brand Search responses until a test releases them.
  const searches = { gate: null };
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
    'expo-constants': { __esModule: true, default: { expoConfig: { extra: { privacyPolicyUrl: 'https://wafra-app-azg.pages.dev/privacy' } } } },
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
      exports, require: load, process: { env: { EXPO_PUBLIC_WAFRA_BRANDFETCH_CLIENT_ID: 'fixture-client' } }, URL,
      fetch: async url => {
        fetchCalls++;
        if (searches.gate) await searches.gate;
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
  // The hydrated store allows lookups on every platform unless local-only mode is on.
  load('@/lib/logo-cache-lifecycle').setLogoLookupsAllowed(true);
  const state = load(platform !== 'web' ? '@/lib/state-storage.native' : '@/lib/state-storage').stateStorage;
  return {
    data, storage, state, load, searches,
    get databaseDeletes() { return databaseDeletes; },
    get storageReads() { return storageReads; },
    get fetchCalls() { return fetchCalls; },
    resolvers() {
      return [
        { resolve: load('@/lib/merchant-logo-resolver').resolveRemoteMerchantLogo, name: 'Aseer Time', key: MERCHANT_KEY, record: MERCHANT_RECORD, domain: 'aseertime.com' },
        { resolve: load('@/lib/bank-logo-resolver').resolveBankLogo, name: 'Bank of America', key: BANK_KEY, record: BANK_RECORD, domain: 'bankofamerica.com' },
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

  test(`${platform}: lookups keep results in session memory only and never touch device storage`, async () => {
    const h = harness(platform);
    const resolvers = h.resolvers();
    for (const entry of resolvers) assert.equal((await entry.resolve(entry.name)).domain, entry.domain);
    for (const entry of resolvers) assert.equal((await entry.resolve(entry.name)).domain, entry.domain);
    assert.equal(h.fetchCalls, 2, 'one search per name per session');
    assert.equal(h.storageReads, 0, 'Brand Search results are never read from storage');
    assert.deepEqual([...h.data.keys()], [], 'Brand Search results are never written to storage');
  });

  test(`${platform}: erase invalidates merchant and bank memory entries`, async () => {
    const h = harness(platform);
    const resolvers = h.resolvers();
    for (const entry of resolvers) await entry.resolve(entry.name);
    assert.equal(h.fetchCalls, 2);
    await h.state.destroy(LEDGER);
    for (const entry of resolvers) assert.equal((await entry.resolve(entry.name)).domain, entry.domain);
    assert.equal(h.fetchCalls, 4, 'post-erase lookups search again: erased memory is not reused');
  });

  test(`${platform}: records persisted by older builds are ignored and not reused`, async () => {
    const h = harness(platform);
    h.data.set(MERCHANT_KEY, MERCHANT_RECORD);
    h.data.set(BANK_KEY, BANK_RECORD);
    for (const entry of h.resolvers()) assert.equal((await entry.resolve(entry.name)).domain, entry.domain);
    assert.equal(h.fetchCalls, 2, 'a stored record is never a substitute for this session\'s search');
    assert.equal(h.storageReads, 0);
  });

  for (const kind of [0, 1]) {
    test(`${platform}: a ${kind ? 'bank' : 'merchant'} search in flight during erase cannot publish or repopulate memory`, async () => {
      const h = harness(platform);
      const entry = h.resolvers()[kind];
      const release = deferred();
      h.searches.gate = release.promise;
      const lookup = entry.resolve(entry.name);
      await turn();
      await h.state.destroy(LEDGER);
      release.resolve();
      assert.equal(await lookup, null, 'an erased lookup must not publish its result');
      h.searches.gate = null;
      assert.equal((await entry.resolve(entry.name)).domain, entry.domain);
      assert.equal(h.fetchCalls, 2, 'the erased result was not kept in memory');
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

  test(`${platform}: upgrade cleanup deletes stored search results from older builds, preserving unrelated keys`, async () => {
    const h = harness(platform);
    for (const key of [MERCHANT_KEY, 'wafra:merchant-logo:v1:old']) h.data.set(key, MERCHANT_RECORD);
    for (const key of [BANK_KEY, 'wafra:bank-logo:v0:old']) h.data.set(key, BANK_RECORD);
    for (const key of [LEDGER, 'other-app:key', 'wafra:bank-logo-preference']) h.data.set(key, 'keep');
    await h.load('@/lib/logo-cache-lifecycle').removeStoredLogoSearchResults();
    assert.deepEqual([...h.data.keys()].sort(), [LEDGER, 'other-app:key', 'wafra:bank-logo-preference'].sort());
    h.storage.getAllKeys = async () => { throw new Error('storage unavailable'); };
    await h.load('@/lib/logo-cache-lifecycle').removeStoredLogoSearchResults();
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

  test(`${platform}: a stale lookup finishing cannot remove a new generation's pending search`, async () => {
    const h = harness(platform);
    const entry = h.resolvers()[0];
    const oldSearch = deferred();
    h.searches.gate = oldSearch.promise;
    const oldLookup = entry.resolve(entry.name);
    await turn();
    await h.state.destroy(LEDGER);
    const newSearch = deferred();
    h.searches.gate = newSearch.promise;
    const newLookup = entry.resolve(entry.name);
    await turn();
    oldSearch.resolve();
    assert.equal(await oldLookup, null);
    const sameNewLookup = entry.resolve(entry.name);
    await turn();
    assert.equal(h.fetchCalls, 2, 'the new lookup must remain deduplicated');
    newSearch.resolve();
    assert.equal((await newLookup).domain, entry.domain);
    assert.equal((await sameNewLookup).domain, entry.domain);
  });
}

test('Android resolves merchant and bank logos like iPhone', async () => {
  const h = harness('android');
  assert.equal((await h.load('@/lib/merchant-logo-resolver').resolveRemoteMerchantLogo('Aseer Time')).domain, 'aseertime.com');
  assert.equal((await h.load('@/lib/bank-logo-resolver').resolveBankLogo('Bank of America')).domain, 'bankofamerica.com');
  assert.equal(h.fetchCalls, 2);
});

test('turning lookups off (local-only mode) on Android skips memory, known domains and searches', async () => {
  const h = harness('android');
  h.load('@/lib/logo-cache-lifecycle').setLogoLookupsAllowed(false);
  h.data.set(MERCHANT_KEY, MERCHANT_RECORD);
  h.data.set(BANK_KEY, BANK_RECORD);
  for (const [module, resolve, name] of [
    ['merchant-logo-resolver', 'resolveRemoteMerchantLogo', 'Aseer Time'],
    ['merchant-logo-resolver', 'resolveRemoteMerchantLogo', 'Starbucks'],
    ['merchant-logo-resolver', 'resolveRemoteMerchantLogo', 'New Merchant'],
    ['bank-logo-resolver', 'resolveBankLogo', 'Bank of America'],
    ['bank-logo-resolver', 'resolveBankLogo', 'New Bank'],
  ]) assert.equal(await h.load('@/lib/' + module)[resolve](name), null);
  assert.equal(h.storageReads, 0);
  assert.equal(h.fetchCalls, 0);
});
