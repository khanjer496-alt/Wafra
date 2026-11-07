// Presentation-only regional dates: changing locale must never change a
// ledger's civil day or the instant used for transaction matching.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

let language = 'en';
let omitDateTimeParts = false;
let ignoreHourCycle = false;
const nativeDateTimeFormat = Intl.DateTimeFormat;
// Model an en-US device default; all actual formatting is the real ICU Intl.
function DeviceDateTimeFormat(locales, options) {
  const effective = options && ignoreHourCycle ? { ...options, hourCycle: undefined } : options;
  const value = new nativeDateTimeFormat(locales ?? 'en-US', effective);
  if (!omitDateTimeParts) return value;
  return new Proxy(value, { get(target, key) {
    if (key === 'formatToParts') return undefined;
    const result = Reflect.get(target, key, target);
    return typeof result === 'function' ? result.bind(target) : result;
  } });
}
DeviceDateTimeFormat.supportedLocalesOf = nativeDateTimeFormat.supportedLocalesOf;
const deviceIntl = Object.create(Intl);
deviceIntl.DateTimeFormat = DeviceDateTimeFormat;
const cache = new Map();
function load(name) {
  if (name === 'markets') return {
    ledgerCurrencyCode: () => 'USD', ledgerCurrencyDisplay: () => 'USD',
    ledgerCurrencyExponent: () => 2,
  };
  if (name === 'i18n') return {
    getLanguage: () => language,
    t: (key) => ({ today: language === 'ar' ? 'اليوم' : 'Today', yesterday: language === 'ar' ? 'أمس' : 'Yesterday' }[key] ?? key),
  };
  if (cache.has(name)) return cache.get(name);
  assert.ok(['format', 'date-time-locale', 'country-names', 'ledger-money', 'currency-metadata', 'arabic-sms'].includes(name), name);
  const filename = path.join(__dirname, '../../src/lib', `${name}.ts`);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText;
  const exports = {};
  cache.set(name, exports);
  vm.runInNewContext(output, { exports, Intl: deviceIntl, Date, require: id => {
    assert.ok(id.startsWith('@/lib/'), id);
    return load(id.slice('@/lib/'.length));
  } }, { filename });
  return exports;
}

const format = load('format');
// This fails on the former hard-coded day-first English formatting.
assert.equal(format.shortDate('2026-11-07'), 'Nov 7', 'default follows Intl device region');
const locale = load('date-time-locale');
const choose = (tag, region, clock24, uiLanguage = 'en') => {
  language = uiLanguage;
  locale.setDateTimeLocale({ languageTag: tag, regionCode: region, uses24hourClock: clock24 });
};
const clock = () => new Date(2026, 10, 7, 14, 32, 0).getTime();
const normalized = value => value.replace(/[\u200e\u200f\u061c]/g, '').replace(/[\u00a0\u202f]/g, ' ');

choose('en-US', 'US', false);
assert.equal(format.shortDate('2026-11-07'), 'Nov 7');
assert.equal(format.shortDateWithYear('2025-11-07', new Date(2026, 0, 1)), 'Nov 7, 2025');
assert.equal(normalized(format.clockTime({ ts: clock() })), '2:32 PM');
assert.equal(normalized(format.fullDateTime({ date: '2026-11-07', ts: clock() })), 'Nov 7, 2026, 2:32 PM');
choose('en-US', 'US', true);
assert.equal(format.clockTime({ ts: clock() }), '14:32', 'explicit system 24-hour setting wins');
assert.equal(format.clockTime({ ts: new Date(2026, 10, 7, 0, 4).getTime() }), '00:04', 'midnight never becomes 24:04');

choose('en-US', 'GB', true);
assert.equal(format.shortDate('2026-11-07'), '7 Nov', 'device region overrides language-region');
assert.equal(format.fullDateTime({ date: '2026-11-07' }), '7 Nov 2026');
assert.equal(format.monthLabel('2026-11'), 'November 2026');
assert.match(format.friendlyDate('2026-11-07', '2026-11-10'), /^Saturday,? 7 Nov$/);
assert.equal(format.friendlyDate('2026-11-10', '2026-11-10'), 'Today');
assert.equal(format.friendlyDate('2026-11-09', '2026-11-10'), 'Yesterday');

choose('ja-JP', 'JP', true, 'ja');
assert.equal(format.shortDate('2026-11-07'), '11月7日');
assert.equal(format.shortDateWithYear('2025-11-07', new Date(2026, 0, 1)), '2025年11月7日');
assert.equal(format.monthLabel('2026-11'), '2026年11月');
assert.equal(format.weekdayName(0), '日曜日');
assert.equal(format.weekdayShort(0), '日');
choose('ja-JP', 'JP', true, 'en');
assert.equal(format.shortDate('2026-11-07'), '11-07', 'English labels never get Japanese suffixes');
assert.equal(format.fullDateTime({ date: '2026-11-07' }), '2026-11-07', 'regional YMD survives English fallback');
assert.equal(format.monthLabel('2026-11'), '2026-11');

choose('ar-AE', 'AE', true, 'ar');
assert.equal(normalized(format.shortDate('2026-11-07')), '7 نوفمبر');
assert.equal(format.weekdayName(0), 'الأحد');
assert.equal(format.clockTime({ ts: clock() }), '14:32');
choose('ar-SA-u-ca-islamic', 'SA', true, 'ar');
assert.equal(normalized(format.fullDateTime({ date: '2026-11-07' })), '7 نوفمبر 2026', 'stored dates always stay Gregorian');
choose('ar-US', 'US', false, 'ar');
assert.equal(normalized(format.shortDate('2026-11-07')), '11/7', 'US regional order with Arabic UI stays unambiguous');
assert.equal(normalized(format.fullDateTime({ date: '2026-11-07' })), '11/7/2026');
assert.match(normalized(format.clockTime({ ts: clock() })), /^2:32\sم$/);

choose('fr-FR', 'FR', true, 'fr');
assert.equal(format.shortDate('2026-11-07'), '7 nov.', 'month names follow a future canonical UI language');
choose('en-GB', null, null);
assert.equal(format.shortDate('2026-11-07'), '7 Nov', 'missing explicit region uses the device language tag');
choose('en-GB', 'ZZ', null);
assert.equal(format.shortDate('2026-11-07'), '7 Nov', 'unknown region does not inject another country');
choose('not-a-valid-@@', 'XX', null);
assert.equal(format.shortDate('2026-11-07'), 'Nov 7', 'invalid preferences safely use Intl device default');
if (!Intl.DateTimeFormat.supportedLocalesOf(['tvl-TV']).length) {
  choose('en-US', 'TV', true);
  assert.equal(format.fullDateTime({ date: '2026-11-07' }), '2026-11-07', 'an unavailable regional convention language cannot silently become US ordering');
}

for (const invalid of ['999999999999-11-07', '2026-02-30', '0000-01-01', 'not-a-date']) {
  assert.equal(format.shortDate(invalid), invalid, 'invalid civil dates are not normalized into another day');
}
assert.equal(format.clockTime({ ts: Infinity }), '');
assert.equal(format.weekdayName(-1), '');
assert.equal(format.weekdayShort(7), '');
const priorZone = process.env.TZ;
try {
  for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles']) {
    process.env.TZ = zone;
    choose('en-US', 'US', true);
    assert.equal(format.shortDate('2026-11-07'), 'Nov 7', `${zone} preserves civil day`);
    assert.equal(format.clockTime({ ts: new Date(2026, 10, 7, 14, 32).getTime() }), '14:32', `${zone} uses local transaction clock`);
  }
} finally { if (priorZone === undefined) delete process.env.TZ; else process.env.TZ = priorZone; }
locale.setDateTimeLocale(null);
assert.equal(format.shortDate('2026-11-07'), 'Nov 7', 'reset restores Intl device date defaults');
assert.equal(normalized(format.clockTime({ ts: clock() })), '2:32 PM', 'reset removes the explicit 24-hour preference');

// Hermes exposes DateTimeFormat.format but does not guarantee Intl.Locale or
// DateTimeFormat.formatToParts. Test those real formatting surfaces with the
// newer optional APIs absent; neither English regions nor Arabic may fall
// back to ISO labels everywhere.
for (const capability of ['without-locale', 'minimal-native-intl', 'locale-without-maximize']) {
  deviceIntl.Locale = capability === 'locale-without-maximize'
    ? function Locale() { throw new Error('Locale must not be required'); } : undefined;
  deviceIntl.getCanonicalLocales = capability === 'minimal-native-intl' ? undefined : Intl.getCanonicalLocales;
  omitDateTimeParts = capability === 'minimal-native-intl';
  ignoreHourCycle = capability === 'minimal-native-intl';
  locale.setDateTimeLocale(null);
  for (const [tag, region, ui, want] of [
    ['en-US', 'US', 'en', 'Nov 7'],
    ['en-US', 'GB', 'en', '7 Nov'],
    ['en-AE', 'AE', 'en', '7 Nov'],
    ['ja-JP', 'JP', 'en', '11-07'],
    ['ja-JP', 'JP', 'ja', '11月7日'],
    ['ar-AE', 'AE', 'ar', '7 نوفمبر'],
    ['ar-US', 'US', 'ar', '11/7'],
    ['en-GB', null, 'en', '7 Nov'],
    ['en-GB', 'ZZ', 'en', '7 Nov'],
  ]) {
    choose(tag, region, true, ui);
    assert.equal(normalized(format.shortDate('2026-11-07')), want, `${capability}: ${ui}/${region}`);
  }
  choose('en-US', 'US', true);
  assert.equal(format.clockTime({ ts: clock() }), '14:32', `${capability}: explicit 24h preference`);
  assert.equal(format.clockTime({ ts: new Date(2026, 10, 7, 0, 4).getTime() }), '00:04', `${capability}: midnight`);
  choose('en-US', 'US', false);
  assert.equal(normalized(format.clockTime({ ts: clock() })), '2:32 PM', `${capability}: explicit 12h preference`);
  choose('ar-AE', 'AE', true, 'ar');
  assert.equal(format.weekdayName(0), 'الأحد', `${capability}: Arabic weekday preserved`);
  assert.equal(format.monthLabel('2026-11'), 'نوفمبر 2026', `${capability}: Arabic month preserved`);
  choose('en-US', 'GB', true);
  assert.equal(format.monthLabel('2026-11'), 'November 2026', `${capability}: English month preserved`);
}
console.log('✓ regional civil dates, UI-language names, Gregorian calendar, system hour-cycle and timezone safety');
