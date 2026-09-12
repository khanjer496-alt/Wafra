const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
function load({ fetchImpl = async () => ({ ok: false }), data = new Map() } = {}) {
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

(async () => {
  let calls = 0;
  const data = new Map();
  const m = load({ data, fetchImpl: async () => { calls++; return { ok: false }; } });
  for (const title of ['Fixture Health Clinic Dubai', 'Household savings 1234', 'Monzo Design', 'Unknown Shop Dubai']) {
    assert.equal(await m.resolveRemoteMerchantLogo(title), null, title);
  }
  assert.equal(calls, 0, 'unknown merchant names must never start an external search, including without an env key');
  assert.equal(data.size, 0, 'unknown transaction strings must not become cache identities');

  for (const [title, domain] of [
    ['Choithrams Dubai', 'choithrams.com'], ['Nesto Hypermarket Sharjah', 'nestogroup.com'],
    ['Sharaf DG Dubai', 'sharafdg.com'], ['Starbucks Riyadh', 'starbucks.com'],
  ]) {
    const value = await m.resolveRemoteMerchantLogo(title);
    assert.equal(value?.domain, domain, title);
    assert.equal(value?.logoUrl, `https://cdn.brandfetch.io/domain/${domain}?c=1idPBg9EKr252UlBUPZ`);
  }
  assert.equal(calls, 0, 'fixed identities resolve locally; only rendering their CDN image can make a request');
  for (const title of ['Nesto Plumbing', 'Choithrams Health Clinic', 'Starbucks Secret Donation', 'https://secret.invalid/path']) {
    assert.equal(await m.resolveRemoteMerchantLogo(title), null, `unknown suffix or unsafe text: ${title}`);
  }

  const hostile = { expiresAt: Date.now() + 60_000, value: {
    id: 'brandfetch:attacker.invalid', domain: 'attacker.invalid', canonicalName: 'Secret clinic',
    logoUrl: 'https://attacker.invalid/secret-account-1234', confidence: 1, source: 'brandfetch',
  } };
  const poisoned = new Map([
    ['wafra:merchant-logo:v2:fixture%20health%20clinic', JSON.stringify(hostile)],
    ['wafra:merchant-logo:v2:starbucks', JSON.stringify(hostile)],
  ]);
  const p = load({ data: poisoned, fetchImpl: async () => { calls++; return { ok: false }; } });
  assert.equal(await p.resolveRemoteMerchantLogo('Fixture Health Clinic'), null, 'legacy unknown mappings cannot authorize an image');
  const fixed = await p.resolveRemoteMerchantLogo('Starbucks');
  assert.equal(fixed.domain, 'starbucks.com', 'cached identities cannot replace the fixed domain');
  assert.equal(fixed.logoUrl, 'https://cdn.brandfetch.io/domain/starbucks.com?c=1idPBg9EKr252UlBUPZ');
  const wrongUrl = { expiresAt: Date.now() + 60_000, value: { ...fixed, logoUrl: 'https://attacker.invalid/private-name' } };
  const wrongUrlResolver = load({ data: new Map([['wafra:merchant-logo:v2:starbucks', JSON.stringify(wrongUrl)]]) });
  assert.equal((await wrongUrlResolver.resolveRemoteMerchantLogo('Starbucks')).logoUrl, fixed.logoUrl,
    'even a cache record with the correct domain cannot choose an arbitrary image URL');
  assert.equal(calls, 0, 'untrusted cache records never trigger network repair');
  console.log('✓ merchant logos use fixed local identities, reject unknown names and untrusted cached URLs, and never search remotely');
})().catch(error => { console.error(error); process.exitCode = 1; });
