'use strict';

// TEST ONLY: package the existing, normally compiled pure parser closure and
// execute it inside macOS JavaScriptCore. No production parser is rewritten,
// no native/RN/network/storage shim is supplied, and no ledger is opened.
// Run scripts/test/build.sh first, then this script with Node 22 on macOS.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const BUILD = path.join(__dirname, 'build');
const MAX_MODULES = 64;
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
const OBSERVED_AT = Date.parse('2026-10-13T12:00:00Z');
const modules = new Map();

function visit(id) {
  assert.match(id, /^[a-z0-9.-]+$/i, 'only bounded sibling module names are admitted');
  if (modules.has(id)) return;
  assert.ok(modules.size < MAX_MODULES, 'pure parser closure is bounded');
  const file = path.join(BUILD, `${id}.js`);
  assert.ok(fs.existsSync(file), 'normal compiled parser modules are required');
  const shippingSource = path.resolve(__dirname, '../..', 'src/lib', `${id}.ts`);
  assert.ok(fs.existsSync(shippingSource), 'each bundled module must have an ordinary shipping source');
  assert.ok(fs.statSync(file).mtimeMs >= fs.statSync(shippingSource).mtimeMs,
    `normal build is stale for ${id}; run scripts/test/build.sh before the probe`);
  assert.ok(!/(?:^|[-.])stub(?:[-.]|$)/i.test(id), 'native stubs cannot enter this probe');
  const source = fs.readFileSync(file, 'utf8');
  modules.set(id, source);
  for (const match of source.matchAll(/\brequire\(\s*(["'])([^"']+)\1\s*\)/g)) {
    assert.match(match[2], /^\.\/([a-z0-9.-]+)$/i, 'no external, native, RN, or Node dependency is allowed');
    visit(match[2].slice(2));
  }
}

// All examples are controlled synthetic cases. ENBD grammar comes from the
// anonymized synthetic equivalents already kept in the ordinary test corpus.
function fixtures() {
  const positive = (id, currency, country, sender, body, amount, extra = {}) => ({
    id, currency, country, sender, body, exponent: currency === 'JOD' ? 3 : 2,
    observedAt: OBSERVED_AT,
    expected: { kind: 'transaction', type: 'expense', amountFils: amount, currency, ...extra },
  });
  const gulf = require('./fixtures/enbd-transfer-capture.js').map((row, index) =>
    positive(`enbd-transfer-${index + 1}`, 'AED', 'AE', 'ENBD', row.body, row.minor, {
      type: row.type, snapshotFils: row.balance,
      ...(index !== 1 ? { card: null } : {}),
    }));
  const rows = [
    ...gulf,
    positive('saudi-purchase', 'SAR', 'SA', 'ALRAJHI',
      'POS purchase of SAR 125.50 at JARIR BOOKSTORE using Mada Card ending 1234. Available balance SAR 2,500.00.',
      12550, { snapshotFils: 250000 }),
    positive('uk-purchase', 'GBP', 'GB', 'BARCLAYS',
      'Barclays: Your card ending 1234 was charged GBP 12.34 at SAMPLE MARKET.', 1234),
    positive('us-purchase', 'USD', 'US', 'CHASE',
      'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.', 2486),
    positive('us-refund', 'USD', 'US', 'CHASE',
      'Chase: Refund of USD 24.86 from NORTH STAR MARKET credited to card ending 4421.', 2486, { type: 'income' }),
    positive('eu-german-purchase', 'EUR', 'DE', 'DEUTSCHEBANK',
      'Deutsche Bank: Kartenzahlung EUR 28,40 wurde belastet bei NORD MARKT.', 2840),
    positive('jordan-three-decimal', 'JOD', 'JO', 'ARABBANKJO',
      'Arab Bank: Your card ending 1234 was charged JOD 24.501 at SAMPLE MARKET.', 24501),
    positive('jordan-arabic-three-decimal', 'JOD', 'JO', 'ARABBANKJO',
      'البنك العربي: تم الخصم د.أ ٢٤٫٥٠١ لشراء بالبطاقة لدى متجر الساحة.', 24501),
    positive('uae-foreign-usd', 'AED', 'AE', 'ENBD',
      'Purchase of USD 24.86 with Debit Card ending 1234 at SAMPLE STORE.', 9130,
      { originalCurrency: 'USD', originalExponent: 2, originalAmountMinor: 2486 }),
  ];
  for (const [id, body, sender = 'CHASE'] of [
    ['otp', 'Your OTP for USD 24.86 purchase at NORTH STAR MARKET is 123456. Do not share.'],
    ['declined', 'Chase: Your purchase of USD 24.86 at NORTH STAR MARKET was declined. Card ending 4421.'],
    ['future-charge', 'Chase Bank alert: Your card ending 4421 will be charged USD 24.86 at NORTH STAR MARKET.'],
    ['future-date', 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET on 2026-12-30.'],
    ['balance-only', 'Chase: Your account ending 4421 balance is USD 1,024.86.'],
    ['personal-chat', 'Hi Ann, I have just spent USD 50.00 at Example Market.', '+12025550190'],
    ['personal-transfer', 'Did you get it? You received USD 60 from me on Venmo.', '+12025550190'],
    ['conditional-charge', 'If Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.'],
    ['promotion', 'Get 20% cashback! Spend USD 50.00 at NORTH STAR MARKET this week.'],
  ]) rows.push({ id, currency: 'USD', country: 'US', exponent: 2, sender, body, observedAt: OBSERVED_AT, expected: null });
  for (const [id, body] of [
    ['enbd-future', 'AED 1,714.50 will be transferred to your account 202XXX55XXX02.'],
    ['enbd-negated', 'AED 1,714.50 has not been transferred to your account 202XXX55XXX02.'],
    ['enbd-personal', 'I spent AED 50.00 at Carrefour today.'],
  ]) rows.push({ id, currency: 'AED', country: 'AE', exponent: 2, sender: '', body, observedAt: OBSERVED_AT, expected: null });
  return rows;
}

// The adapter only supplies documented parser settings and summarizes its
// return values. It does not implement any monetary or classification logic.
function probeCase(row, load) {
  const markets = load('markets');
  const country = load('country');
  const parser = load('launch-alert-parser');
  const activeMarket = row.country === 'AE' || row.country === 'SA' ? row.country : 'ZZ';
  country.setActiveCountry(row.country);
  markets.setActiveMarket(activeMarket);
  markets.setLedgerCurrency(row.currency, row.exponent);
  const session = parser.createLaunchAlertSession({ overrides: {}, activeMarket,
    pinnedCurrency: row.currency, fxLookup: () => null,
    bestEffort: { enabled: true, country: row.country } });
  const inspected = session.inspect(row.body, row.sender);
  const parsed = session.parse(row.body, row.sender, inspected, undefined, row.observedAt);
  const unproven = session.parseUnproven(row.body, row.sender, inspected, row.observedAt);
  const safeRow = value => {
    if (!value) return null;
    const { raw, ...safe } = value;
    return safe;
  };
  return {
    parsed: safeRow(parsed), unproven: safeRow(unproven), detectedMarket: session.detectedMarket(),
    inspection: inspected ? {
      route: inspected.route,
      review: inspected.review ? {
        market: inspected.review.market, decision: inspected.review.decision,
        status: inspected.review.status, family: inspected.review.family,
        direction: inspected.review.direction,
      } : null,
    } : null,
  };
}

function assertSemantics(row, result) {
  let assertions = 0;
  const check = (got, want) => {
    assert.deepEqual(got, want, `semantic expectation failed for controlled case ${row.id}`);
    assertions += 1;
  };
  if (row.expected === null) {
    check(result.parsed, null);
    check(result.unproven, null);
    return assertions;
  }
  assert.ok(result.parsed, `controlled positive case ${row.id} must parse`);
  assertions += 1;
  for (const [key, want] of Object.entries(row.expected)) check(result.parsed[key], want);
  const gulf = row.country === 'AE' || row.country === 'SA';
  if (gulf) check(result.unproven, null);
  else {
    assert.ok(result.unproven, `controlled global case ${row.id} must use parseUnproven`);
    assertions += 1;
    for (const [key, want] of Object.entries(row.expected)) check(result.unproven[key], want);
    check(result.unproven.bestEffort?.v, 1);
    check(result.inspection?.route.market, row.country);
    check(result.inspection?.review.status, 'posted');
    check(result.inspection?.review.direction, row.expected.type === 'income' ? 'credit' : 'debit');
  }
  return assertions;
}

function bundle() {
  visit('launch-alert-parser');
  const factories = [...modules].sort(([a], [b]) => a.localeCompare(b)).map(([id, source]) =>
    `${JSON.stringify(id)}: function(module, exports, require) {\n${source}\n}`);
  const text = `'use strict';\n(function() {\nconst factories = {\n${factories.join(',\n')}\n};
const cache = Object.create(null);
function load(id) {
  if (!Object.prototype.hasOwnProperty.call(factories, id)) throw new Error('unbundled dependency');
  if (cache[id]) return cache[id].exports;
  const module = { exports: {} }; cache[id] = module;
  factories[id](module, module.exports, request => {
    if (!/^\\.\\/[a-z0-9.-]+$/i.test(request)) throw new Error('external dependency');
    return load(request.slice(2));
  });
  return module.exports;
}
const probeCase = ${probeCase.toString()};
globalThis.wafraProbeJson = input => JSON.stringify(probeCase(JSON.parse(input), load));
})();\n`;
  assert.ok(Buffer.byteLength(text) <= MAX_BUNDLE_BYTES, 'parser bundle is bounded');
  return text;
}

function child(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 512 * 1024 });
  // Never echo compiler or JavaScript error text, which could include a source
  // excerpt. The failing stage and numeric status are sufficient for this test.
  assert.equal(result.error?.code ?? null, null, `probe process failed: ${path.basename(command)}`);
  assert.equal(result.status, 0, `probe stage failed: ${path.basename(command)} (status ${result.status})`);
  return result.stdout.trim();
}

function main() {
  assert.equal(process.platform, 'darwin', 'real Apple JavaScriptCore is required');
  assert.ok(Number(process.versions.node.split('.')[0]) >= 22, 'Node 22 or newer is required');
  const rows = fixtures();
  const source = bundle();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-javascriptcore-probe-'));
  try {
    const bundlePath = path.join(temporary, 'pure-parser.js');
    const fixturePath = path.join(temporary, 'synthetic-cases.json');
    const nativeResultPath = path.join(temporary, 'native-results.json');
    const executable = path.join(temporary, 'native-parser-probe');
    fs.writeFileSync(bundlePath, source, { mode: 0o600 });
    fs.writeFileSync(fixturePath, JSON.stringify(rows), { mode: 0o600 });
    const nodeResults = [];
    let nodeSemanticAssertions = 0;
    const started = performance.now();
    for (const row of rows) {
      const result = probeCase(row, id => require(path.join(BUILD, `${id}.js`)));
      nodeSemanticAssertions += assertSemantics(row, result);
      nodeResults.push(result);
    }
    const nodeElapsedMs = performance.now() - started;
    child('/usr/bin/xcrun', ['swiftc', '-parse-as-library', '-framework', 'JavaScriptCore',
      path.join(__dirname, 'native-parser-javascriptcore.swift'), '-o', executable]);
    child(executable, [bundlePath, fixturePath, nativeResultPath]);
    const native = JSON.parse(fs.readFileSync(nativeResultPath, 'utf8'));
    assert.equal(native.results.length, rows.length, 'JavaScriptCore executes every controlled case');
    let parityAssertions = 0;
    let nativeSemanticAssertions = 0;
    rows.forEach((row, index) => {
      nativeSemanticAssertions += assertSemantics(row, native.results[index]);
      assert.deepEqual(native.results[index], nodeResults[index], `Node/JavaScriptCore output differs for controlled case ${row.id}`);
      parityAssertions += 1;
    });
    const receipt = {
      testOnly: true, ledgerAccess: false, networkAccess: false, nativeHostBindings: false,
      fixtureProvenance: 'controlled synthetic cases; anonymized synthetic ENBD grammar equivalents',
      physicalIphoneProof: false, shortcutBannerProof: false, productionIntegration: false,
      caseCount: rows.length, positiveCases: rows.filter(row => row.expected !== null).length,
      negativeCases: rows.filter(row => row.expected === null).length,
      nodeSemanticAssertions, nativeSemanticAssertions, swiftSemanticAssertions: native.semanticAssertions,
      parityAssertions, failed: 0, moduleCount: modules.size,
      bundleBytes: Buffer.byteLength(source), bundleSha256: crypto.createHash('sha256').update(source).digest('hex'),
      nodeVersion: process.versions.node, platform: { os: os.platform(), arch: os.arch(), release: os.release(), ...native.platform },
      latencyMs: { nodeTotal: Math.round(nodeElapsedMs * 1000) / 1000, ...native.latencyMs },
    };
    const outputIndex = process.argv.indexOf('--output');
    if (outputIndex >= 0) {
      assert.ok(process.argv[outputIndex + 1], '--output requires a receipt path');
      fs.writeFileSync(process.argv[outputIndex + 1], JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    }
    console.log(JSON.stringify(receipt));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

try { main(); }
catch (error) {
  // Our assertions use only fixed stage labels and controlled case IDs.
  // Suppress the AssertionError's actual/expected dump and stack.
  console.error(String(error.message).split('\n')[0]);
  process.exitCode = 1;
}
