const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const filename = path.join(root, 'src/lib/bank-logo-resolver.ts');

function load({ fetchImpl = async () => ({ ok: false }), storage } = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const map = new Map();
  const memoryStorage = storage ?? {
    async getItem(k) { return map.has(k) ? map.get(k) : null; },
    async setItem(k, v) { map.set(k, v); },
    async removeItem(k) { map.delete(k); },
  };
  vm.runInNewContext(output, {
    exports,
    require(id) {
      if (id === '@react-native-async-storage/async-storage') return { default: memoryStorage };
      if (id === '@/lib/markets') return {
        bankBrandForName(name) {
          const known = {
            FAB: { name: 'FAB', color: '#000', domain: 'bankfab.com' },
            'Emirates NBD': { name: 'Emirates NBD', color: '#000', domain: 'emiratesnbd.com' },
            'Al Rajhi': { name: 'Al Rajhi', color: '#000', domain: 'alrajhibank.com.sa' },
          };
          return known[name] ?? null;
        },
      };
      throw new Error(`unexpected require: ${id}`);
    },
    process: { env: { EXPO_PUBLIC_WAFRA_BRANDFETCH_CLIENT_ID: 'bank-test-client' } },
    fetch: fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    encodeURIComponent,
  }, { filename });
  return exports;
}

(async () => {
  {
    let calls = 0;
    const m = load({ fetchImpl: async () => { calls++; throw new Error('must not search known bank'); } });
    const fab = await m.resolveBankLogo('FAB');
    assert.equal(fab.domain, 'bankfab.com');
    assert.equal(fab.source, 'market');
    assert.equal(calls, 0);
    const rajhi = await m.resolveBankLogo('Al Rajhi');
    assert.equal(rajhi.domain, 'alrajhibank.com.sa');
  }

  {
    let calls = 0;
    const m = load({ fetchImpl: async (url) => {
      calls++;
      assert.match(String(url), /search\/Monzo/);
      return { ok: true, async json() { return [
        { name: 'Monzo', domain: 'monzo.com', claimed: true },
        { name: 'Monzo Design', domain: 'monzodesign.example', claimed: true },
      ]; } };
    } });
    const first = await m.resolveBankLogo('Monzo');
    const second = await m.resolveBankLogo('Monzo');
    assert.equal(first.domain, 'monzo.com');
    assert.equal(first.source, 'brandfetch');
    assert.equal(second.domain, 'monzo.com');
    assert.equal(calls, 1, 'verified global bank mapping is cached');
  }

  {
    const m = load({ fetchImpl: async () => ({ ok: true, async json() { return [
      { name: 'Chase Plumbing', domain: 'chaseplumbing.example', claimed: true },
      { name: 'Another Bank', domain: 'anotherbank.example', claimed: true },
    ]; } }) });
    assert.equal(await m.resolveBankLogo('Chase'), null, 'ambiguous search must fall back instead of guessing');
    assert.equal(await m.resolveBankLogo(undefined), null, 'no institution identity means no network lookup');
  }

  console.log('✓ bank logos prefer verified market domains, resolve exact global institutions, cache, and reject ambiguity');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
