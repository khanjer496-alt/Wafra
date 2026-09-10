const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const filename = path.join(root, 'src/lib/merchant-logo-resolver.ts');

function load({ clientId = '', fetchImpl = async () => ({ ok: false }), storage } = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const memoryStorage = storage ?? (() => {
    const map = new Map();
    return {
      async getItem(k) { return map.has(k) ? map.get(k) : null; },
      async setItem(k, v) { map.set(k, v); },
      async removeItem(k) { map.delete(k); },
    };
  })();
  vm.runInNewContext(output, {
    exports,
    require(id) {
      if (id === '@react-native-async-storage/async-storage') return { default: memoryStorage };
      throw new Error(`unexpected require: ${id}`);
    },
    process: { env: { EXPO_PUBLIC_WAFRA_BRANDFETCH_CLIENT_ID: clientId } },
    fetch: fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    URL,
    encodeURIComponent,
  }, { filename });
  return exports;
}

{
  const m = load();
  const cases = new Map([
    ['POS PURCHASE LULU HYPERMARKET 137 DUBAI', 'LULU HYPERMARKET'],
    ['Card purchase Starbucks #4821 Riyadh', 'Starbucks'],
    ['PAYMENT: Zara London', 'Zara'],
    ['Amazon AED 149.00 Dubai', 'Amazon'],
    ['Purchase at Local Bakery Ajman', 'Local Bakery'],
  ]);
  for (const [raw, expected] of cases) assert.equal(m.merchantBrandCandidate(raw), expected, raw);
  for (const unsafe of ['', '123456', 'https://secret.example/path', 'merchant', 'AED 120.00', 'x'.repeat(200)]) {
    assert.equal(m.merchantBrandCandidate(unsafe), null, `reject ${unsafe}`);
  }
  assert.equal(m.merchantBrandConfidence('Starbucks', 'Starbucks', 'starbucks.com'), 1);
  assert.ok(m.merchantBrandConfidence('Lulu Hypermarket', 'LuLu Hypermarket', 'luluhypermarket.com') >= 0.94);
  assert.ok(m.merchantBrandConfidence('Apple Cafe', 'Apple', 'apple.com') < 0.94, 'ambiguous suffix must not get Apple logo');
  assert.ok(m.merchantBrandConfidence('Noon Saloon', 'noon', 'noon.com') < 0.94, 'substring must not become a brand');
}

(async () => {
  let calls = 0;
  let requested = '';
  const m = load({
    clientId: 'public-test-client',
    fetchImpl: async (url) => {
      calls++;
      requested = String(url);
      return { ok: true, async json() { return [
        { name: 'Starbucks', domain: 'starbucks.com', claimed: true },
        { name: 'Star Bakery', domain: 'starbakery.example' },
      ]; } };
    },
  });
  const [a, b] = await Promise.all([
    m.resolveRemoteMerchantLogo('Starbucks Dubai'),
    m.resolveRemoteMerchantLogo('Starbucks Dubai'),
  ]);
  assert.equal(calls, 1, 'same merchant lookup is deduplicated while in flight');
  assert.equal(a.domain, 'starbucks.com');
  assert.equal(a.logoUrl, 'https://cdn.brandfetch.io/domain/starbucks.com?c=public-test-client');
  assert.equal(a.source, 'brandfetch');
  assert.ok(a.confidence >= 0.94);
  assert.equal(b.domain, a.domain);
  assert.match(requested, /^https:\/\/api\.brandfetch\.io\/v2\/search\/Starbucks\?c=public-test-client$/,
    'only the cleaned merchant candidate reaches Brandfetch');

  const again = await m.resolveRemoteMerchantLogo('Starbucks Dubai');
  assert.equal(again.domain, 'starbucks.com');
  assert.equal(calls, 1, 'resolved mapping is cached');

  const noKey = load({ clientId: '', fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(await noKey.resolveRemoteMerchantLogo('Unknown Shop Dubai'), null);
  console.log('✓ merchant logo resolver sanitizes, confidence-gates, deduplicates and caches remote brand identities');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
