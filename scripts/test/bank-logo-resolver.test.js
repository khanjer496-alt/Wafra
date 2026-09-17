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
  return {
    ...requireModule('@/lib/bank-logo-resolver'),
    marketBanks: requireModule('@/lib/markets').MARKETS.flatMap(market => market.banks),
    onboardingBanks: requireModule('@/lib/onboarding-bank-examples'),
    onboardingAlerts: requireModule('@/lib/onboarding-alert-examples'),
    verifiedLogoUrl: requireModule('@/lib/verified-logo-identities').verifiedLogoUrl,
  };
}

const response = rows => ({ ok: true, json: async () => rows });

(async () => {
  const data = new Map();
  const calls = [];
  const m = load({
    data,
    fetchImpl: async url => {
      calls.push(url);
      if (url.includes('Bank%20of%20America')) return response([
        { name: 'Bank of America', domain: 'bankofamerica.com', claimed: true },
        { name: 'Bank of America Private Bank', domain: 'privatebank.bankofamerica.com', claimed: false },
      ]);
      if (url.includes('Lloyds%20Bank')) return response([
        { name: 'Lloyds Bank', domain: 'lloydsbank.com', claimed: true },
      ]);
      if (url.includes('Societe%20Generale')) return response([
        { name: 'Société Générale', domain: 'societegenerale.com', claimed: true },
      ]);
      if (url.includes('Chase%20Savings')) return response([
        { name: 'Chase', domain: 'chase.com', claimed: true },
      ]);
      return response([]);
    },
  });

  for (const [name, domain] of [['FAB', 'bankfab.com'], ['Emirates NBD', 'emiratesnbd.com'], ['Al Rajhi', 'alrajhibank.com.sa']]) {
    const logo = await m.resolveBankLogo(name);
    assert.equal(logo.domain, domain);
    assert.equal(logo.source, 'market');
    assert.equal(logo.logoUrl, `https://cdn.brandfetch.io/domain/${domain}?c=1idPBg9EKr252UlBUPZ`);
  }
  for (const bank of m.marketBanks.filter(bank => bank.domain)) {
    assert.equal((await m.resolveBankLogo(bank.name))?.domain, bank.domain, `preserve market bank ${bank.name}`);
  }
  assert.equal(calls.length, 0, 'known launch-market banks stay on the local fast path');

  // The animated onboarding must never regress to UAE examples for global
  // users. Every country Wafra currently carries as a first-class preview gets
  // three real bank domains plus local grocery and utility artwork.
  const onboardingRegions = ['AE', 'SA', 'US', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'IN', 'QA', 'KW', 'BH', 'OM', 'EG', 'JO'];
  for (const regionId of onboardingRegions) {
    const region = m.onboardingBanks.onboardingBankRegion(null, regionId);
    assert.ok(region, `onboarding preview exists for ${regionId}`);
    assert.equal(region.id, regionId);
    assert.ok(region.currency, `onboarding currency exists for ${regionId}`);
    assert.equal(region.banks.length, 3, `onboarding carries exactly three bank examples for ${regionId}`);
    assert.equal(new Set(region.banks.map(bank => bank.domain)).size, 3, `onboarding bank domains stay distinct for ${regionId}`);
    for (const bank of region.banks) {
      assert.match(bank.domain, /^(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,24}$/i, `valid bank domain for ${bank.name}`);
      assert.ok(m.verifiedLogoUrl(bank.domain)?.startsWith('https://cdn.brandfetch.io/domain/'),
        `bank logo has a verified Brandfetch path for ${bank.name}`);
    }

    const alerts = m.onboardingAlerts.onboardingAlertExamples(region, {
      grocery: 'Grocery store', electricity: 'Electricity', salary: 'Salary',
    });
    assert.equal(alerts.length, 3);
    assert.ok(alerts[0].merchant.domain, `local grocery artwork exists for ${regionId}`);
    assert.ok(alerts[1].merchant.domain, `local utility artwork exists for ${regionId}`);
    assert.ok(m.verifiedLogoUrl(alerts[0].merchant.domain), `grocery logo domain is safe for ${regionId}`);
    assert.ok(m.verifiedLogoUrl(alerts[1].merchant.domain), `utility logo domain is safe for ${regionId}`);
    assert.ok(alerts.every(alert => alert.amount.includes(region.currency)), `sample money uses ${region.currency}`);
  }
  assert.equal(m.onboardingBanks.onboardingBankRegion(null, 'ZZ'), null,
    'an unsupported country stays neutral instead of borrowing another country’s banks');

  const boa = await m.resolveBankLogo('Bank of America');
  assert.equal(boa?.domain, 'bankofamerica.com');
  assert.equal(boa?.source, 'search');
  assert.match(calls[0], /\/v2\/search\/Bank%20of%20America\?c=1idPBg9EKr252UlBUPZ$/);

  const lloyds = await m.resolveBankLogo('Lloyds Bank');
  assert.equal(lloyds?.domain, 'lloydsbank.com');
  assert.equal((await m.resolveBankLogo('Societe Generale'))?.domain, 'societegenerale.com',
    'accent differences do not block a confident global bank match');
  assert.equal(await m.resolveBankLogo('Chase Savings'), null,
    'a claimed bank result still cannot replace a more specific unmatched account label');

  const afterFirstPass = calls.length;
  assert.equal((await m.resolveBankLogo('Bank of America'))?.domain, 'bankofamerica.com');
  assert.equal(await m.resolveBankLogo('Chase Savings'), null);
  assert.equal(calls.length, afterFirstPass, 'bank search hits and misses are cached');

  for (const name of ['Household savings 1234', 'Card **8575', 'Bank\u202e', undefined]) {
    assert.equal(await m.resolveBankLogo(name), null, `unsafe/private account label: ${name}`);
  }
  assert.equal(calls.length, afterFirstPass, 'account/card tails and unsafe strings never become bank searches');

  const cached = {
    query: 'bank of america', expiresAt: Date.now() + 60_000, value: {
      id: 'bank:bankofamerica.com', domain: 'bankofamerica.com', canonicalName: 'Bank of America',
      logoUrl: 'https://attacker.invalid/account', source: 'search',
    },
  };
  const cachedResolver = load({
    data: new Map([['wafra:bank-logo:v2:bank%20of%20america', JSON.stringify(cached)]]),
    fetchImpl: async () => { throw new Error('cache should satisfy this lookup'); },
  });
  assert.equal((await cachedResolver.resolveBankLogo('Bank of America')).logoUrl,
    'https://cdn.brandfetch.io/domain/bankofamerica.com?c=1idPBg9EKr252UlBUPZ',
    'cached data cannot choose an arbitrary image host');

  let failures = 0;
  const failing = load({ fetchImpl: async () => { failures++; throw new Error('offline'); } });
  assert.equal(await failing.resolveBankLogo('Worldwide Example Bank'), null);
  assert.equal(await failing.resolveBankLogo('Worldwide Example Bank'), null);
  assert.equal(failures, 2, 'transient failures remain retryable instead of becoming cached misses');

  console.log('✓ bank logos keep known local domains and onboarding stays country-localized');
})().catch(error => { console.error(error); process.exitCode = 1; });
