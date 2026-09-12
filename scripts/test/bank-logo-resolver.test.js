const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
function load({ fetchImpl = async () => ({ ok: false }), data = new Map() } = {}) {
  const storage = { async getItem(k) { return data.get(k) ?? null; }, async setItem(k,v) { data.set(k,v); }, async removeItem(k) { data.delete(k); } };
  const modules = new Map();
  function requireModule(id) {
    if (id === '@react-native-async-storage/async-storage') return storage;
    if (modules.has(id)) return modules.get(id);
    assert.ok(id.startsWith('@/lib/'), id);
    const filename = path.join(root, 'src/lib', id.slice(6) + '.ts');
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const exports = {};
    modules.set(id, exports);
    vm.runInNewContext(output, { exports, require: requireModule, process: { env: {} },
      fetch: fetchImpl, AbortController, setTimeout, clearTimeout, console }, { filename });
    return exports;
  }
  return { ...requireModule('@/lib/bank-logo-resolver'), marketBanks: requireModule('@/lib/markets').MARKETS.flatMap(market => market.banks) };
}
(async () => {
  let calls = 0;
  const data = new Map();
  const m = load({ data, fetchImpl: async () => { calls++; return { ok: false }; } });
  for (const name of ['Fixture Bank', 'Household savings 1234', 'FAB Plumbing', 'Emirates NBD Secret Account', undefined]) {
    assert.equal(await m.resolveBankLogo(name), null, 'unknown institutions stay local');
  }
  assert.equal(calls, 0, 'unknown bank names must not be searched remotely');
  assert.equal(data.size, 0, 'unknown institution strings must not become cache identities');
  for (const [name, domain] of [['FAB', 'bankfab.com'], ['Emirates NBD', 'emiratesnbd.com'], ['Al Rajhi', 'alrajhibank.com.sa']]) {
    const logo = await m.resolveBankLogo(name);
    assert.equal(logo.domain, domain);
    assert.equal(logo.source, 'market');
    assert.equal(logo.logoUrl, `https://cdn.brandfetch.io/domain/${domain}?c=1idPBg9EKr252UlBUPZ`);
  }
  for (const bank of m.marketBanks.filter(bank => bank.domain)) {
    assert.equal((await m.resolveBankLogo(bank.name))?.domain, bank.domain, `preserve market bank ${bank.name}`);
  }
  const hostile = JSON.stringify({ expiresAt: Date.now() + 60_000, value: {
    id: 'bank:attacker.invalid', domain: 'attacker.invalid', canonicalName: 'Fixture Bank',
    logoUrl: 'https://attacker.invalid/account-1234', source: 'brandfetch',
  } });
  const poisoned = load({ data: new Map([['wafra:bank-logo:v1:fixture%20bank', hostile], ['wafra:bank-logo:v1:fab', hostile]]) });
  assert.equal(await poisoned.resolveBankLogo('Fixture Bank'), null, 'legacy unknown mapping cannot authorize a remote image');
  assert.equal((await poisoned.resolveBankLogo('FAB')).domain, 'bankfab.com', 'cache cannot replace verified market domain');
  assert.equal(calls, 0, 'known bank identity needs no search');
  console.log('✓ bank logos keep fixed market domains, reject unknown/cache identities, and never search remotely');
})().catch(error => { console.error(error); process.exitCode = 1; });
