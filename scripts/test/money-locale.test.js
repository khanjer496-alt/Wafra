// Locale-aware money display and input, pinned for six device locales and
// three ledger exponents. Every figure stays an exact integer of minor units:
// the locale only chooses separators, grouping and the currency label.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Compile the shipping modules in memory; never touch the shared test build.
let currency = 'AED';
let exponent = 2;
let language = 'en';
const cache = new Map();
function load(name) {
  if (name === 'markets') return {
    ledgerCurrencyCode: () => currency,
    ledgerCurrencyDisplay: () => currency,
    ledgerCurrencyExponent: () => exponent,
  };
  if (name === 'i18n') return { getLanguage: () => language, t: (key) => key };
  if (cache.has(name)) return cache.get(name);
  assert.ok(['format', 'ledger-money', 'currency-metadata', 'arabic-sms'].includes(name), name);
  const filename = path.join(__dirname, '../../src/lib', `${name}.ts`);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const exports = {};
  cache.set(name, exports);
  vm.runInNewContext(output, {
    exports,
    require: (id) => {
      assert.ok(id.startsWith('@/lib/'));
      return load(id.slice('@/lib/'.length));
    },
  }, { filename });
  return exports;
}
const money = load('ledger-money');
const display = load('format');

const NNBSP = '\u202F';
const spec = (code) => money.ledgerMoneySpec(code);
const AED = spec('AED');
const SAR = spec('SAR');
const JPY = spec('JPY');
const KWD = spec('KWD');
const INR = spec('INR');
const EUR = spec('EUR');

/* ── conventions derived from a device locale ───────────────────────────── */
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify({ decimal: b.decimal, group: b.group, grouping: b.grouping }), m);
const conv = (locale, extra = {}) => money.numberConventionsForLocale({ locale, ...extra });
same(conv('en-US'), { decimal: '.', group: ',', grouping: 'thousands' });
same(conv('de-DE'), { decimal: ',', group: '.', grouping: 'thousands' });
assert.equal(conv('fr-FR').decimal, ',');
assert.ok([' ', '\u00A0', NNBSP].includes(conv('fr-FR').group), 'fr-FR groups with a space');
same(conv('en-IN'), { decimal: '.', group: ',', grouping: 'indian' });
same(conv('ar-AE'), { decimal: '.', group: ',', grouping: 'thousands' });
same(conv('ja-JP'), { decimal: '.', group: ',', grouping: 'thousands' });
same(conv('ar-SA'), { decimal: '.', group: ',', grouping: 'thousands' },
  'Arabic separators map onto the Latin digits the Arabic UI already shows');
same(conv('en-US', { decimalSeparator: ',', groupSeparator: '.' }),
  { decimal: ',', group: '.', grouping: 'thousands' },
  "the device's own separator settings outrank the language tag");
same(conv('en-US', { decimalSeparator: ',', groupSeparator: ',' }),
  { decimal: ',', group: '.', grouping: 'thousands' },
  'a group separator equal to the decimal is never accepted');
same(conv('xx-invalid-@@'), money.CANONICAL_NUMBER_CONVENTIONS);
same(conv(null), money.CANONICAL_NUMBER_CONVENTIONS);
same(conv('en-US', { decimalSeparator: 'x' }), money.CANONICAL_NUMBER_CONVENTIONS,
  'an unusable decimal separator falls back to canonical, never a guess');

/* ── formatting: exact minor units, locale separators ───────────────────── */
const f = (minor, s, locale, opts) => money.formatMinorUnits(minor, s, { ...opts, conventions: conv(locale) });
const table = [
  // locale     AED 1,234,567.89     JPY 1,234,567     KWD 1,234.567
  ['en-US', '1,234,567.89', '1,234,567', '1,234.567'],
  ['de-DE', '1.234.567,89', '1.234.567', '1.234,567'],
  ['fr-FR', `1${conv('fr-FR').group}234${conv('fr-FR').group}567,89`, `1${conv('fr-FR').group}234${conv('fr-FR').group}567`, `1${conv('fr-FR').group}234,567`],
  ['en-IN', '12,34,567.89', '12,34,567', '1,234.567'],
  ['ar-AE', '1,234,567.89', '1,234,567', '1,234.567'],
  ['ja-JP', '1,234,567.89', '1,234,567', '1,234.567'],
];
for (const [locale, aed, jpy, kwd] of table) {
  assert.equal(f(123456789, AED, locale), aed, `${locale} AED`);
  assert.equal(f(1234567, JPY, locale), jpy, `${locale} JPY`);
  assert.equal(f(1234567, KWD, locale), kwd, `${locale} KWD`);
  assert.equal(f(-5, KWD, locale), locale === 'de-DE' || locale === 'fr-FR' ? '-0,005' : '-0.005');
}
assert.equal(f(12345678901, INR, 'en-IN'), '12,34,56,789.01', 'lakh/crore grouping');
assert.equal(f(99999, INR, 'en-IN'), '999.99');
assert.equal(f(100000, INR, 'en-IN'), '1,000');
assert.equal(money.formatMinorUnits(123456, AED), '1,234.56', 'default conventions stay canonical');

/* ── input: locale decimal separator, refuse what cannot be read ────────── */
// Through the typed-input wrapper, so Arabic digits and marks and stray
// symbols are handled exactly as an amount field hands them over.
const p = (text, s, locale) => {
  money.setDisplayMoneyLocale({ locale });
  try { return display.parseAmountWithMoneySpec(text, s); } finally { money.setDisplayMoneyLocale(null); }
};
assert.equal(money.parseLocalizedMajorToMinor("1.234,5", AED, conv("de-DE")), 123450);
const inputs = [
  // [locale, spec, text, expected minor units or null]
  ['en-US', AED, '12.50', 1250],
  ['en-US', AED, '1,234.56', 123456],
  ['en-US', AED, '12,50', null],
  ['en-US', AED, '1,234', 123400],
  ['en-US', KWD, '1,234', null], // 1,234 or 1.234 KWD: a 1,000x ambiguity
  ['en-US', KWD, '1,234.5', 1234500],
  ['en-US', KWD, '1,234,567', 1234567000],
  ['en-US', JPY, '1,234', 1234],
  ['en-US', JPY, '12.5', null],
  ['de-DE', AED, '12,50', 1250],
  ['de-DE', AED, '1.234,56', 123456],
  ['de-DE', AED, '1.234', 123400],
  ['de-DE', AED, '1,234', null], // three decimals cannot be AED minor units
  ['de-DE', KWD, '1,234', 1234],
  // Android numeric pads often offer only ".": a lone "." that cannot be a
  // group is this phone's decimal, whatever the Region.
  ['de-DE', AED, '12.50', 1250],
  ['de-DE', AED, '12.5', 1250],
  ['de-DE', AED, '12.505', 1250500], // a valid German group; 12.505 AED cannot exist
  ['de-DE', KWD, '1.234', null], // 1,234 or 1.234 KWD: refused
  ['de-DE', KWD, '1.23', 1230],
  ['de-DE', AED, '1.234.56', null],
  ['de-DE', AED, '1.234.567,8', 123456780],
  ['de-DE', JPY, '1.234', 1234],
  ['de-DE', JPY, '12,5', null],
  ['de-DE', EUR, '0,01', 1],
  ['fr-FR', AED, '12,50', 1250],
  ['fr-FR', AED, `1${NNBSP}234,56`, 123456],
  ['fr-FR', AED, '1 234,56', 123456],
  ['fr-FR', AED, '1\u00A0234,56', 123456],
  ['fr-FR', AED, '12.50', 1250],
  ['fr-FR', AED, '1.234', null], // "." is not a French group mark
  ['fr-FR', KWD, '1.234', null],
  ['fr-FR', AED, '1 234.5', 123450],
  ['fr-FR', KWD, '1,234', 1234],
  ['en-IN', INR, '1,23,456.78', 12345678],
  ['en-IN', INR, '123,456.78', 12345678],
  ['en-IN', INR, '12,50', null],
  ['en-IN', INR, '1,2,3', null],
  ['ar-AE', AED, '12.50', 1250],
  ['ar-AE', AED, '١٢٫٥٠', 1250],
  ['ar-AE', AED, '١٬٢٣٤٫٥٦', 123456],
  ['ar-AE', AED, '12,50', null],
  ['ja-JP', JPY, '1,234', 1234],
  ['ja-JP', JPY, '１２３４', null], // full-width digits are not silently read
  ['ja-JP', JPY, '1234.5', null],
  ['ja-JP', KWD, '1.2345', null],
  ['de-DE', AED, '١٢٫٥٠', 1250], // Arabic decimal mark is always a decimal
  ['en-US', AED, '0', null],
  ['en-US', AED, '', null],
  ['de-DE', AED, '900.719.925.474.099,99', null],
];
for (const [locale, s, text, expected] of inputs) {
  assert.equal(p(text, s, locale), expected, `${locale} ${s.currency} ${JSON.stringify(text)}`);
}
// Whatever the locale prints, it reads back to the same integer.
for (const [locale] of table) {
  for (const [s, minor] of [[AED, 123456789], [JPY, 1234567], [KWD, 1234567], [INR, 12345678901], [SAR, 1]]) {
    assert.equal(p(f(minor, s, locale), s, locale), minor, `${locale} ${s.currency} round-trip`);
    assert.equal(p(money.formatMinorUnitsForInput(minor, s, conv(locale)), s, locale), minor,
      `${locale} ${s.currency} input round-trip`);
  }
}
assert.equal(money.formatMinorUnitsForInput(123456, AED, conv('de-DE')), '1234,56');
assert.equal(money.formatMinorUnitsForInput(123400, AED, conv('de-DE')), '1234');
assert.equal(money.formatMinorUnitsForInput(123400, AED, conv('de-DE'), { decimals: true }), '1234,00');
assert.equal(money.formatMinorUnitsForInput(1234567, JPY, conv('en-US'), { decimals: true }), '1234567');

/* ── currency placement follows the locale's own currency pattern ───────── */
const place = (code, locale) => JSON.stringify({ ...money.currencyPlacement(code, locale) });
const at = (label, position, spaced) => JSON.stringify({ label, position, spaced });
assert.equal(place('EUR', 'de-DE'), at('€', 'after', true), 'de-DE: 1.234,56 €');
assert.equal(place('EUR', 'fr-FR'), at('€', 'after', true), 'fr-FR: 1 234,56 €');
assert.equal(place('USD', 'en-US'), at('$', 'before', false), 'en-US: $1,234.56');
assert.equal(place('INR', 'en-IN'), at('₹', 'before', false));
assert.equal(place('JPY', 'ja-JP'), at('￥', 'before', false));
assert.equal(place('CAD', 'en-US'), at('CA$', 'before', false));
for (const [code, locale] of [['AED', 'en-AE'], ['AED', 'ar-AE'], ['SAR', 'ar-SA'], ['SAR', 'en-SA'], ['AED', 'de-DE'], ['KWD', 'fr-FR'], ['USD', null]]) {
  assert.equal(place(code, locale), at(code, 'before', true), `${code} in ${locale} keeps "CODE 1,234"`);
}
const text = (minor, s, locale) => money.formatMoneyText(minor, s, { conventions: conv(locale), locale });
assert.equal(text(123456, EUR, 'de-DE'), '1.234,56\u00A0€');
assert.equal(text(123456, EUR, 'fr-FR'), `1${conv('fr-FR').group}234,56\u00A0€`);
assert.equal(text(123456, spec('USD'), 'en-US'), '$1,234.56');
assert.equal(text(-123456, spec('USD'), 'en-US'), '-$1,234.56');
assert.equal(text(-123456, EUR, 'de-DE'), '-1.234,56\u00A0€');
assert.equal(text(1234567, KWD, 'de-DE'), 'KWD 1.234,567');
assert.equal(text(123456, AED, 'ar-AE'), 'AED 1,234.56');
assert.equal(text(123456, AED, null), 'AED 1,234.56');

/* ── device Region comes from expo-localization, not the language tag ──── */
{
  const uaeInEnglish = money.deviceMoneyLocale({
    languageTag: 'en-US', languageCode: 'en', languageRegionCode: 'US', regionCode: 'AE',
    decimalSeparator: '.', digitGroupingSeparator: ',',
  });
  assert.equal(uaeInEnglish.locale, 'en-AE');
  assert.equal(uaeInEnglish.region, 'AE');
  assert.equal(money.deviceMoneyLocale({ languageTag: 'de-DE', languageCode: 'de', languageRegionCode: 'DE' }).region, 'DE');
  assert.equal(money.deviceMoneyLocale({ languageTag: 'en', languageCode: 'en' }).region, null);
  assert.equal(money.deviceMoneyLocale(undefined), null);
  try {
    money.setDisplayMoneyLocale(uaeInEnglish);
    assert.equal(money.displayRegion(), 'AE');
  } finally {
    money.setDisplayMoneyLocale(null);
  }
  assert.equal(money.displayRegion(), null);
}

/* ── currency label: symbol only when the locale makes it unambiguous ───── */
const label = (code, locale) => money.currencyDisplayLabel(code, locale);
assert.equal(label('AED', 'en-AE'), 'AED', 'AED keeps its ISO code');
assert.equal(label('AED', 'ar-AE'), 'AED', 'Arabic-script symbols keep the current code label');
assert.equal(label('SAR', 'ar-SA'), 'SAR');
assert.equal(label('SAR', 'en-US'), 'SAR');
assert.equal(label('USD', 'en-US'), '$');
assert.equal(label('CAD', 'en-US'), 'CA$', 'a shared narrow $ is never used for a non-local dollar');
assert.equal(label('EUR', 'de-DE'), '€');
assert.equal(label('EUR', 'fr-FR'), '€');
assert.equal(label('INR', 'en-IN'), '₹');
assert.equal(label('JPY', 'ja-JP'), '￥');
assert.equal(label('KWD', 'en-US'), 'KWD');
assert.equal(label('CHF', 'de-DE'), 'CHF');
assert.equal(label('USD', null), 'USD', 'no device locale, no symbol');
assert.equal(label('ZZZ', 'en-US'), 'ZZZ');

/* ── format.ts wrappers follow the device conventions once set ──────────── */
try {
  money.setDisplayMoneyLocale({ locale: 'de-DE', decimalSeparator: ',', groupSeparator: '.' });
  currency = 'EUR'; exponent = 2;
  assert.equal(display.formatAmount(123456), '1.234,56');
  assert.equal(display.formatAED(123456), 'EUR 1.234,56', 'text and screen-reader strings keep the code');
  assert.equal(display.ledgerCurrencyLabel(), '€', 'the visual prefix uses the symbol');
  assert.equal(display.parseAmountToFils('1.234,56'), 123456);
  assert.equal(display.parseAmountToFils('12,5'), 1250);
  assert.equal(display.parseAmountToFils('12.50'), 1250, 'a dot-only keyboard still works');
  assert.equal(display.formatAmountForInput(123456), '1234,56');
  assert.equal(display.formatAmount(123456, { canonical: true }), '1,234.56', 'support exports stay canonical');
  assert.equal(display.formatCompactAED(123_456), '≈1,2k');
  assert.equal(display.formatCompactAED(110_000_000), '1,1M');
  currency = 'AED';
  assert.equal(display.formatAED(123456), 'AED 1.234,56');
  assert.equal(display.ledgerCurrencyLabel(), 'AED');

  money.setDisplayMoneyLocale({ locale: 'en-IN', decimalSeparator: '.', groupSeparator: ',' });
  currency = 'INR';
  assert.equal(display.formatAED(12345678901), 'INR 12,34,56,789.01');
  assert.equal(display.ledgerCurrencyLabel(), '₹');
  assert.equal(display.parseAmountToFils('₹ 1,23,456.78'), 12345678);

  money.setDisplayMoneyLocale({ locale: 'ja-JP', decimalSeparator: '.', groupSeparator: ',' });
  currency = 'JPY'; exponent = 0;
  assert.equal(display.formatAED(1234567), 'JPY 1,234,567');
  assert.equal(display.ledgerCurrencyLabel(), '￥');
  assert.equal(display.parseAmountToFils('1,234'), 1234);
  assert.equal(display.parseAmountToFils('1.5'), null);

  money.setDisplayMoneyLocale({ locale: 'ar-AE', decimalSeparator: '.', groupSeparator: ',' });
  currency = 'AED'; exponent = 2; language = 'ar';
  assert.equal(display.formatAED(123456), 'AED 1,234.56', 'Arabic UI in the UAE is unchanged');
  assert.equal(display.parseAmountToFils('١٬٢٣٤٫٥٦'), 123456);
} finally {
  money.setDisplayMoneyLocale(null);
  language = 'en';
}
currency = 'AED'; exponent = 2;
assert.equal(display.formatAED(123456), 'AED 1,234.56', 'reset restores canonical display');

/* ── a ledger whose currency has no ISO metadata is never rendered as AED ── */
currency = 'ZZZ'; exponent = 0;
assert.equal(display.formatAmount(1234), '1,234', 'the persisted exponent, not an AED fallback');
assert.equal(display.parseAmountToFils('12.5'), null);
currency = 'ZZZ'; exponent = 3;
assert.equal(display.formatAmount(1234), '1.234');
currency = 'AED'; exponent = 2;

/* ── currency-aware magnitudes: identical for AED and SAR ───────────────── */
const typical = (s, major) => money.typicalMinorAmount(s, major);
assert.equal(typical(AED, 200), 20_000);
assert.equal(typical(SAR, 50), 5_000);
assert.equal(typical(AED, 1000), 100_000);
assert.equal(typical(KWD, 200), 20_000, 'KWD: 20.000 — a tenth of the nominal size, three decimals');
assert.equal(typical(JPY, 200), 20_000, 'JPY: ¥20,000, no minor units');
assert.equal(typical(INR, 200), 200_000, 'INR: ₹2,000.00');
assert.equal(typical(spec('IDR'), 200), 200_000_000, 'IDR: Rp 2,000,000.00');
assert.equal(typical(spec('KRW'), 50), 50_000);
assert.equal(typical(EUR, 200), 20_000);
assert.equal(typical(spec('USD'), 200), 20_000);
assert.equal(typical(spec('BHD'), 5), 500, 'fractions of a class never become floats');
assert.ok(Number.isSafeInteger(typical(spec('VND'), 1000)));
assert.equal(money.wholeMajorUnits(123456, AED), 1235);
assert.equal(money.wholeMajorUnits(1234, JPY), 1234);
assert.equal(money.wholeMajorUnits(1499, KWD), 1);
assert.equal(money.roundToNiceMinor(123_456, AED), 120_000, 'AED rounds to 100');
assert.equal(money.roundToNiceMinor(4_000, AED), 10_000, 'never below the typical 100');
assert.equal(money.roundToNiceMinor(123_456, JPY), 120_000, 'JPY rounds to ¥10,000');
assert.equal(money.roundToNiceMinor(1_234_567, KWD), 1_230_000, 'KWD rounds to 10.000');

currency = 'AED'; exponent = 2;
assert.equal(display.ledgerTypicalMinor(200), 20_000);
currency = 'JPY'; exponent = 0;
assert.equal(display.ledgerTypicalMinor(200), 20_000);
currency = 'ZZZ'; exponent = 2;
assert.equal(display.ledgerTypicalMinor(200), 20_000, 'unknown currency uses the neutral class');

console.log('✓ locale-aware money display/input for en-US, de-DE, fr-FR, en-IN, ar-AE, ja-JP; currency labels; magnitudes');
