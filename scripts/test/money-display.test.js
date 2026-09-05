const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Compile the shipping modules in memory; never touch the shared test build.
let currency = 'AED';
let exponent = 2;
const cache = new Map();
function load(name) {
  if (name === 'markets') return {
    ledgerCurrencyCode: () => currency,
    ledgerCurrencyDisplay: () => currency,
    ledgerCurrencyExponent: () => exponent,
  };
  if (name === 'i18n') return { getLanguage: () => 'en', t: (key) => key };
  if (cache.has(name)) return cache.get(name);
  assert.ok(['format', 'ledger-money', 'currency-metadata'].includes(name));
  const filename = path.join(__dirname, '../../src/lib', `${name}.ts`);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports,
    require: (id) => {
      assert.ok(id.startsWith('@/lib/'));
      return load(id.slice('@/lib/'.length));
    },
  }, { filename });
  cache.set(name, exports);
  return exports;
}
const display = load('format');
const ledgerMoney = load('ledger-money');

for (const [code, digits, minor, exact, fixedWhole] of [
  ['AED', 2, 123456, '1,234.56', '1.00'],
  ['KWD', 3, 1234567, '1,234.567', '1.000'],
  ['JPY', 0, 1234, '1,234', '1'],
]) {
  currency = code;
  exponent = digits;
  assert.equal(display.formatAmount(minor), exact);
  assert.equal(display.formatAmount(minor, { decimals: false }), exact,
    `${code}: legacy false means optional decimals, never discarded minor units`);
  assert.equal(display.formatAmount(minor, { decimals: true }), exact);
  assert.equal(display.formatAED(-minor, { decimals: false }), `${code} -${exact}`);
  assert.equal(display.formatAmount(10 ** digits), '1');
  assert.equal(display.formatAmount(10 ** digits, { decimals: true }), fixedWhole);
  assert.equal(display.formatAmount(0), '0');
  assert.equal(display.formatAmount(0, { decimals: true }), digits ? `0.${'0'.repeat(digits)}` : '0');
}

currency = 'AED';
exponent = 2;
assert.equal(display.formatAmount(-20, { decimals: false }), '-0.20');
assert.equal(display.formatAmount(120, { decimals: false }), '1.20');
assert.equal(display.formatCompactAED(49), '0.49');
assert.equal(display.formatCompactAED(-49), '0.49', 'compact callers own the sign');
assert.equal(display.formatCompactAED(99_999), '999.99');
assert.equal(display.formatCompactAED(100_000), '1k');
assert.equal(display.formatCompactAED(110_000), '1.1k', 'exact decimal multiples need no approximation marker');
assert.equal(display.formatCompactAED(123_456), '≈1.2k');
assert.equal(display.formatCompactAED(-123_456), '≈1.2k');
assert.equal(display.formatCompactAED(10_010_000), '≈100k');
assert.equal(display.formatCompactAED(100_000_000), '1M');
assert.equal(display.formatCompactAED(110_000_000), '1.1M');
assert.equal(display.formatCompactAED(123_456_789), '≈1.2M');
assert.equal(display.formatCompactAED(10_010_000_000), '≈100M');
assert.equal(display.totalAsShown([49, 49, 2]), 100,
  'category totals preserve minor units before adding');
assert.equal(display.totalAsShown([12345, -2345]), 10000);
assert.equal(display.formatAmount(display.totalAsShown([9389163, 257481])), '96,466.44');
assert.equal(display.totalAsShown([]), 0);
assert.throws(() => display.totalAsShown([Number.MAX_SAFE_INTEGER, 1]), /safe integer/);
assert.throws(() => display.totalAsShown([1.5]), /safe integer/);

currency = 'KWD';
exponent = 3;
assert.equal(display.formatCompactAED(1), '0.001');
assert.equal(display.formatCompactAED(-1), '0.001');
assert.equal(display.formatAED(1, { decimals: false }), 'KWD 0.001');
assert.equal(display.formatAmount(display.totalAsShown([1, 2, 1000])), '1.003');
assert.equal(display.formatCompactAED(1_234_567), '≈1.2k');

currency = 'JPY';
exponent = 0;
assert.equal(display.formatCompactAED(1), '1');
assert.equal(display.formatCompactAED(999), '999');
assert.equal(display.formatCompactAED(1100), '1.1k');
assert.equal(display.formatCompactAED(1234), '≈1.2k');

// Only the display wrapper changes its legacy flag semantics. The lower-level
// rounding API and decimal admission rules remain available unchanged.
const aed = ledgerMoney.ledgerMoneySpec('AED');
assert.equal(ledgerMoney.formatMinorUnits(123456, aed, { decimals: false }), '1,235');
assert.equal(ledgerMoney.parseMajorToMinor('1.234', aed), null);
assert.equal(ledgerMoney.parseMajorToMinor('1.23', aed), 123);

console.log('✓ exact AED/KWD/JPY display, optional precision, compact estimates and checked totals');
