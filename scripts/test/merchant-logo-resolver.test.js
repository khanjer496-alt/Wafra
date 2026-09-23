const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
function load({ fetchImpl = async () => ({ ok: false, json: async () => [] }), data = new Map() } = {}) {
  const storage = {
    async getItem(k) { return data.get(k) ?? null; },
    async setItem(k, v) { data.set(k, v); },
    async removeItem(k) { data.delete(k); },
  };
  const modules = new Map();
  function requireModule(id) {
    if (id === '@react-native-async-storage/async-storage') return storage;
    if (modules.has(id)) return modules.get(id);
    assert.ok(id.startsWith('@/lib/'), id);
    const filename = path.join(root, 'src/lib', id.slice(6) + '.ts');
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const exports = {};
    modules.set(id, exports);
    vm.runInNewContext(output, {
      exports, require: requireModule, process: { env: {} }, fetch: fetchImpl,
      AbortController, setTimeout, clearTimeout, console,
    }, { filename });
    return exports;
  }
  return requireModule('@/lib/merchant-logo-resolver');
}

const response = rows => ({ ok: true, json: async () => rows });

(async () => {
  let calls = [];
  const data = new Map();
  const m = load({
    data,
    fetchImpl: async url => {
      calls.push(url);
      if (url.includes('Aseer%20Time')) return response([
        { name: 'Aseer Time', domain: 'aseertime.com', claimed: false, brandId: 'aseer' },
        { name: 'Discover Aseer', domain: 'discoveraseer.com', claimed: false, brandId: 'other' },
      ]);
      if (url.includes('Cloudflare%20San%20Francisco')) return response([
        { name: 'Cloudflare', domain: 'cloudflare.com', claimed: true, brandId: 'cloudflare' },
        { name: 'Cloudflare', domain: 'cloudflare-quic.com', claimed: false, brandId: 'other' },
      ]);
      if (url.includes('Clemta.%20Lewes') || url.includes('Clemta%20Lewes')) return response([
        { name: 'Clemta', domain: 'clemta.com', claimed: true, brandId: 'clemta' },
        { name: 'Lewes Depot', domain: 'lewesdepot.org', claimed: false, brandId: 'lewes' },
      ]);
      if (url.includes('Torbox%20Sheridan')) return response([
        { name: 'TorBox', domain: 'torbox.app', claimed: true, brandId: 'torbox' },
        { name: 'Sheridan Media', domain: 'sheridanmedia.com', claimed: false, brandId: 'sheridan' },
      ]);
      if (url.includes('Apple%20Cafe')) return response([
        { name: 'Apple', domain: 'apple.com', claimed: true, brandId: 'apple' },
      ]);
      if (url.includes('Tamara%20Restaurant')) return response([
        { name: 'Tamara', domain: 'tamara.co', claimed: true, brandId: 'tamara' },
        { name: 'Tamara Restaurant', domain: 'tamararestaurant.com', claimed: false, brandId: 'restaurant' },
      ]);
      if (url.includes('Starbucks%20Secret%20Donation')) return response([
        { name: 'Starbucks', domain: 'starbucks.com', claimed: true, brandId: 'starbucks' },
      ]);
      if (url.includes('Talabat%20sales')) return response([
        { name: 'Talabat', domain: 'talabat.com', claimed: true, brandId: 'talabat' },
        { name: 'Salesforce', domain: 'salesforce.com', claimed: true, brandId: 'salesforce' },
      ]);
      if (url.includes('Sesame%20Al%20Ja%20Qlub')) return response([
        { name: 'Sesame', domain: 'sesamecare.com', claimed: false, brandId: 'wrong' },
        { name: 'Credit Sesame', domain: 'creditsesame.com', claimed: false, brandId: 'also-wrong' },
      ]);
      return response([]);
    },
  });

  for (const [title, domain] of [
    ['Choithrams Dubai', 'choithrams.com'], ['Nesto Hypermarket Sharjah', 'nestogroup.com'],
    ['Sharaf DG Dubai', 'sharafdg.com'], ['Starbucks Riyadh', 'starbucks.com'],
    ['ENOC', 'enoc.com'], ['Emirates Petroleum Com', 'enoc.com'], ['e& UAE', 'eand.com'],
  ]) {
    const value = await m.resolveRemoteMerchantLogo(title);
    assert.equal(value?.domain, domain, title);
    assert.equal(value?.source, 'verified');
  }
  assert.equal(calls.length, 0, 'known shortcuts stay local and do not spend search requests');
  assert.equal(m.merchantBrandCandidate('PAYPAL *Aseer Time'), 'Aseer Time',
    'known payment-processor prefixes are removed before brand lookup');

  const aseer = await m.resolveRemoteMerchantLogo('Payment: Aseer Time Dubai AED 55.00 card ****1234');
  assert.equal(aseer?.domain, 'aseertime.com');
  assert.equal(aseer?.canonicalName, 'Aseer Time');
  assert.equal(aseer?.source, 'search');
  assert.equal(aseer?.logoUrl, 'https://cdn.brandfetch.io/domain/aseertime.com?c=1idPBg9EKr252UlBUPZ');
  assert.match(calls[0], /\/v2\/search\/Aseer%20Time\?c=1idPBg9EKr252UlBUPZ$/,
    'only the cleaned merchant name reaches Brand Search');
  assert.doesNotMatch(calls[0], /55|1234|Dubai/i, 'amount, account tail and location are removed before lookup');

  const payout = await m.resolveRemoteMerchantLogo('Talabat sales');
  assert.equal(payout?.domain, 'talabat.com', 'claimed brand may match a harmless transaction descriptor suffix');
  assert.equal(payout?.source, 'search');

  const ambiguous = await m.resolveRemoteMerchantLogo('Sesame Al Ja Qlub');
  assert.equal(ambiguous, null, 'a loose first search result must not become the merchant logo');

  for (const [title, domain] of [
    ['Cloudflare San Francisco', 'cloudflare.com'],
    ['Clemta. Lewes', 'clemta.com'],
    ['Torbox Sheridan', 'torbox.app'],
  ]) {
    const value = await m.resolveRemoteMerchantLogo(title);
    assert.equal(value?.domain, domain, `${title}: first claimed brand survives a location/acquirer suffix`);
    assert.equal(value?.source, 'search');
  }

  for (const title of ['Apple Cafe', 'Starbucks Secret Donation']) {
    assert.equal(await m.resolveRemoteMerchantLogo(title), null,
      `${title}: business/category suffix must not impersonate a famous brand`);
  }
  assert.equal((await m.resolveRemoteMerchantLogo('Tamara Restaurant'))?.domain, 'tamararestaurant.com',
    'an exact separate Brandfetch identity remains eligible instead of being rewritten to Tamara');

  const afterFirstPass = calls.length;
  assert.equal((await m.resolveRemoteMerchantLogo('Aseer Time'))?.domain, 'aseertime.com');
  assert.equal(await m.resolveRemoteMerchantLogo('Sesame Al Ja Qlub'), null);
  assert.equal(calls.length, afterFirstPass, 'positive and negative results are cached');

  for (const title of [
    '', 'Incoming transfer', 'ATM withdrawal', 'Credit card payment', 'Salary',
    'https://secret.invalid/path', 'Unknown Shop\u202e',
  ]) {
    assert.equal(await m.resolveRemoteMerchantLogo(title), null, `non-merchant/unsafe title: ${title}`);
  }
  assert.equal(calls.length, afterFirstPass, 'generic financial rows and unsafe strings never start a search');

  // A persisted cache can never choose its own image host. The resolver rebuilds
  // the artwork URL from the cached domain through Brandfetch's fixed CDN.
  const cached = {
    query: 'aseer time', expiresAt: Date.now() + 60_000, value: {
      id: 'brandfetch:aseertime.com', domain: 'aseertime.com', canonicalName: 'Aseer Time',
      logoUrl: 'https://attacker.invalid/private-name', confidence: 0.95, source: 'search',
    },
  };
  const cachedResolver = load({
    data: new Map([['wafra:merchant-logo:v4:aseer%20time', JSON.stringify(cached)]]),
    fetchImpl: async () => { throw new Error('cache should satisfy this lookup'); },
  });
  assert.equal((await cachedResolver.resolveRemoteMerchantLogo('Aseer Time')).logoUrl,
    'https://cdn.brandfetch.io/domain/aseertime.com?c=1idPBg9EKr252UlBUPZ');

  let failures = 0;
  const failing = load({ fetchImpl: async () => { failures++; throw new Error('offline'); } });
  assert.equal(await failing.resolveRemoteMerchantLogo('Global Example Merchant'), null);
  assert.equal(await failing.resolveRemoteMerchantLogo('Global Example Merchant'), null);
  assert.equal(failures, 2, 'transient network failures are not cached as a 24-hour no-logo result');

  const bounded = load({ fetchImpl: async () => response([]) });
  for (let i = 0; i < 180; i++) {
    // Keep the varying token away from the tail: terminal/location cleanup is
    // intentionally allowed to remove trailing numeric POS/store identifiers.
    await bounded.resolveRemoteMerchantLogo(`Synthetic ${i} Merchant`);
  }
  const cache = bounded.getMerchantLogoCacheDiagnostics();
  assert.ok(cache.memoryEntries <= cache.memoryLimit, 'merchant logo metadata cache is bounded');
  assert.equal(cache.memoryLimit, 128);
  assert.ok(cache.peakMemoryEntries <= cache.memoryLimit, 'merchant logo cache never exceeds its ceiling even transiently');
  assert.ok(cache.memoryEvictions > 0, 'older in-memory merchant metadata is evicted while its durable cache remains');

  let releaseSaturated;
  const saturatedGate = new Promise(resolve => { releaseSaturated = resolve; });
  const saturated = load({ fetchImpl: async () => { await saturatedGate; return response([]); } });
  const saturatedJobs = Array.from({ length: 40 }, (_, i) =>
    saturated.resolveRemoteMerchantLogo(`Queued Merchant ${i}`));
  await new Promise(resolve => setImmediate(resolve));
  const duringSaturation = saturated.getMerchantLogoCacheDiagnostics();
  assert.equal(duringSaturation.pendingEntries, duringSaturation.pendingLimit,
    'fast scrolling cannot retain more unresolved merchant jobs than the ceiling');
  assert.equal(duringSaturation.pendingLimit, 24);
  assert.ok(duringSaturation.saturatedResolutionDrops > 0,
    'off-screen enrichment falls back instead of creating an unbounded network backlog');
  releaseSaturated();
  await Promise.all(saturatedJobs);

  console.log('✓ merchant logos search globally from cleaned names, reject ambiguous/non-merchant matches, cache results, and keep artwork on the Brandfetch CDN');
})().catch(error => { console.error(error); process.exitCode = 1; });
