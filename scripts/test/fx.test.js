const fx = require('./build/fx');
const fmt = require('./build/format');

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}\n    got ${a}\n    want ${e}`); }
}
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
}
function near(name, actual, expected, tolerance) {
  ok(name, Math.abs(actual - expected) <= tolerance, `got ${actual}, want ~${expected}`);
}

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 28, 12);
/** Hand-built tables keep every expectation an exact decimal. */
const table = (rates, asOf = NOW) => ({ base: 'USD', rates, asOf, origin: 'network' });

// ── currency definitions ───────────────────────────────────────────────────
eq('AED is two decimals', fx.minorDigits('AED'), 2);
eq('KWD is three decimals', fx.minorDigits('KWD'), 3);
eq('BHD and OMR are three too', [fx.minorDigits('BHD'), fx.minorDigits('OMR')], [3, 3]);
eq('JPY has no minor unit', fx.minorDigits('JPY'), 0);
eq('unknown code has no exponent (never defaulted to 2)', fx.minorDigits('XYZ'), null);
eq('lookup is case-insensitive', fx.getCurrency('aed').code, 'AED');

// The parser can hand us any code from its own UNITS_PER_USD table; a code it
// reads out of an SMS and we cannot define would be dropped at conversion.
const PARSER_CODES = ['USD', 'AED', 'SAR', 'EUR', 'GBP', 'QAR', 'KWD', 'BHD', 'OMR',
  'INR', 'PKR', 'PHP', 'EGP', 'CAD', 'AUD', 'JPY', 'CNY', 'CHF', 'TRY'];
eq('every currency the SMS parser knows is defined here',
  PARSER_CODES.filter((c) => !fx.isSupported(c)), []);

// ── minor units in and out ─────────────────────────────────────────────────
eq('toMinor AED', fx.toMinor(42, 'AED'), 4200);
eq('toMinor KWD is thousandths', fx.toMinor(1.234, 'KWD'), 1234);
eq('toMinor JPY is whole yen', fx.toMinor(1500, 'JPY'), 1500);
eq('toMinor unknown currency', fx.toMinor(1, 'XYZ'), null);
eq('toMajor KWD', fx.toMajor(1234, 'KWD'), 1.234);
// 1.005 * 100 is 100.49999999999999 in binary floating point; the decimal
// value is exactly on the boundary and must round up.
eq('toMinor survives float representation error', fx.toMinor(1.005, 'AED'), 101);
eq('toMinor rounds half away from zero', [fx.toMinor(0.125, 'AED'), fx.toMinor(-0.125, 'AED')], [13, -13]);
eq('parseMoney honours the exponent', fx.parseMoney('12.345', 'KWD'), { code: 'KWD', minor: 12345 });
eq('parseMoney AED rounds to fils', fx.parseMoney('AED 12.345', 'AED'), { code: 'AED', minor: 1235 });
eq('parseMoney negative', fx.parseMoney('-40', 'AED'), { code: 'AED', minor: -4000 });
eq('parseMoney junk', fx.parseMoney('abc', 'AED'), null);

// ── formatting ─────────────────────────────────────────────────────────────
eq('formatMoney AED', fx.formatMoney({ code: 'AED', minor: 123456 }), 'AED 1,234.56');
eq('formatMoney drops empty decimals', fx.formatMoney({ code: 'AED', minor: 120000 }), 'AED 1,200');
eq('formatMoney KWD keeps three', fx.formatMoney({ code: 'KWD', minor: 1234 }), 'KWD 1.234');
eq('formatMoney KWD pads', fx.formatMoney({ code: 'KWD', minor: 1004 }), 'KWD 1.004');
eq('formatMoney JPY never shows decimals',
  fx.formatMoney({ code: 'JPY', minor: 15000 }, { decimals: true }), 'JPY 15,000');
eq('formatMoney negative', fx.formatMoney({ code: 'AED', minor: -50000 }), 'AED -500');
eq('formatMoney symbol', fx.formatMoney({ code: 'USD', minor: 4200 }, { symbol: true }), '$ 42');
eq('formatMoney bare', fx.formatMoney({ code: 'USD', minor: 4200 }, { prefix: false }), '42');
// The app-wide AED formatter and this one must never disagree, or the same
// amount would render two ways on two screens.
ok('formatMoney agrees with formatAED on dirhams',
  [123456, 120000, -50000, 1, 999999999].every(
    (n) => fx.formatMoney({ code: 'AED', minor: n }) === fmt.formatAED(n)));

// ── the peg ────────────────────────────────────────────────────────────────
eq('the dirham peg', fx.AED_PER_USD, 3.6725);
const emptyTable = { base: 'USD', rates: {}, asOf: 0, origin: 'peg' };
const usdToAed = fx.convert({ code: 'USD', minor: 10000 }, 'AED', emptyTable, NOW);
eq('peg converts with no rates at all', usdToAed.amount, { code: 'AED', minor: 36725 });
eq('a pegged pair is never stale', usdToAed.quote.basis, 'peg');
eq('reverse peg', fx.convertMinor(36725, 'AED', 'USD', emptyTable, NOW), 10000);
// AED 367.25 = USD 100 = SAR 375, through two constants and no feed.
eq('GCC cross via two pegs', fx.convertMinor(36725, 'AED', 'SAR', emptyTable, NOW), 37500);
eq('peg holds with a table that predates the app',
  fx.convert({ code: 'USD', minor: 10000 }, 'AED', table({ AED: 3.9 }, 0), NOW).quote.basis, 'peg');
eq('a provider cannot move the peg',
  fx.rateFor('USD', 'AED', table({ USD: 1, AED: 3.9 }), NOW).rate, 3.6725);

// ── rounding at the boundary ───────────────────────────────────────────────
// USD 42.00 at the peg is 154.245 dirhams — exactly on the half. Every UAE
// statement prints AED 154.25, and sms-parser.ts reads that same pair out of
// a single message, so the two must land on the same fil.
eq('half rounds away from zero (the bank\'s answer)',
  fx.convertMinor(4200, 'USD', 'AED', fx.PEG_TABLE, NOW), 15425);
eq('a refund converts to the same magnitude',
  fx.convertMinor(-4200, 'USD', 'AED', fx.PEG_TABLE, NOW), -15425);
ok('a charge and its refund net to zero',
  fx.convertMinor(4200, 'USD', 'AED', fx.PEG_TABLE, NOW)
  + fx.convertMinor(-4200, 'USD', 'AED', fx.PEG_TABLE, NOW) === 0);
// 2 AED per USD makes USD 0.025 out of AED 0.05: 2.5 minor units, on the half.
const half = table({ USD: 1, INR: 2 });
eq('half up on a tiny amount', fx.convertMinor(5, 'INR', 'USD', half, NOW), 3);
eq('just below the half rounds down', fx.convertMinor(499, 'INR', 'USD', table({ USD: 1, INR: 1000 }), NOW), 0);
eq('exactly the half rounds up', fx.convertMinor(500, 'INR', 'USD', table({ USD: 1, INR: 1000 }), NOW), 1);
eq('just above the half rounds up', fx.convertMinor(501, 'INR', 'USD', table({ USD: 1, INR: 1000 }), NOW), 1);

// ── cross rates through the base ───────────────────────────────────────────
const cross = table({ USD: 1, EUR: 0.5, INR: 100 });
eq('EUR to INR via USD', fx.rateFor('EUR', 'INR', cross, NOW).rate, 200);
eq('EUR 10.00 is INR 2000.00', fx.convertMinor(1000, 'EUR', 'INR', cross, NOW), 200000);
eq('and back again', fx.convertMinor(200000, 'INR', 'EUR', cross, NOW), 1000);
eq('identity needs no rate at all', fx.rateFor('INR', 'INR', emptyTable, NOW).rate, 1);
eq('identity conversion is exact', fx.convertMinor(12345, 'INR', 'INR', emptyTable, NOW), 12345);
eq('unknown source currency is refused', fx.convert({ code: 'XYZ', minor: 100 }, 'AED', cross, NOW), null);
eq('unknown target currency is refused', fx.convert({ code: 'AED', minor: 100 }, 'XYZ', cross, NOW), null);
eq('a currency missing from the table is refused, not guessed',
  fx.convert({ code: 'THB', minor: 100 }, 'AED', cross, NOW), null);
eq('a non-USD-based table is refused',
  fx.rateFor('EUR', 'INR', { base: 'EUR', rates: { INR: 100 }, asOf: NOW, origin: 'network' }, NOW), null);

// ── non-2-decimal currencies across the conversion ─────────────────────────
const gulf = table({ USD: 1, KWD: 0.3, JPY: 150 });
eq('USD 100.00 to KWD carries the exponent', fx.convert({ code: 'USD', minor: 10000 }, 'KWD', gulf, NOW).amount,
  { code: 'KWD', minor: 30000 });
eq('KWD 30.000 back to USD', fx.convertMinor(30000, 'KWD', 'USD', gulf, NOW), 10000);
eq('USD 100.00 to JPY drops to whole yen', fx.convertMinor(10000, 'USD', 'JPY', gulf, NOW), 15000);
eq('JPY 15,000 back to USD', fx.convertMinor(15000, 'JPY', 'USD', gulf, NOW), 10000);
eq('three decimals to none', fx.convertMinor(30000, 'KWD', 'JPY', gulf, NOW), 15000);
// One yen is worth more than one fils: the smallest JPY unit must not vanish.
eq('one yen is not zero dirhams', fx.convertMinor(1, 'JPY', 'AED', table({ USD: 1, JPY: 150 }), NOW), 2);

// ── staleness ──────────────────────────────────────────────────────────────
const fresh = table({ USD: 1, INR: 100 }, NOW - 2 * 3600_000);
const old = table({ USD: 1, INR: 100 }, NOW - 10 * DAY);
eq('a table inside the window is not stale', fx.isStale(fresh, NOW), false);
eq('a ten-day-old table is stale', fx.isStale(old, NOW), true);
eq('36 hours is still fresh', fx.isStale(table({}, NOW - 36 * 3600_000), NOW), false);
eq('37 hours is not', fx.isStale(table({}, NOW - 37 * 3600_000), NOW), true);
eq('fresh floating quote', fx.rateFor('USD', 'INR', fresh, NOW).basis, 'live');
eq('stale floating quote is labelled, not withheld', fx.rateFor('USD', 'INR', old, NOW).basis, 'stale');
eq('a stale rate still converts', fx.convertMinor(100, 'USD', 'INR', old, NOW), 10000);
eq('the stale quote reports its age', fx.rateFor('USD', 'INR', old, NOW).ageMs, 10 * DAY);
// Offline degradation: the same ancient table still answers a pegged pair
// with a fresh, exact rate.
eq('the peg does not age with the table it sits in', fx.rateFor('AED', 'USD', old, NOW).basis, 'peg');
eq('shouldRefresh only when stale', [fx.shouldRefresh(fresh, NOW), fx.shouldRefresh(old, NOW)], [false, true]);
eq('the peg-only table converts every GCC pair',
  ['SAR', 'QAR', 'OMR', 'BHD', 'JOD', 'USD'].filter(
    (c) => fx.convertMinor(10000, 'AED', c, fx.PEG_TABLE, NOW) === null), []);

// ── merging a fetched table into the cache ─────────────────────────────────
const cached = { base: 'USD', rates: { USD: 1, AED: 3.6725, INR: 90, PKR: 280 }, asOf: NOW - 5 * DAY, origin: 'seed' };
const merged = fx.mergeRateTable(cached, table({ USD: 1, INR: 95 }, NOW));
eq('a newer rate wins', merged.rates.INR, 95);
eq('the merged table takes the new timestamp', merged.asOf, NOW);
eq('a code the feed skipped keeps its cached value', merged.rates.PKR, 280);
eq('an older response is ignored', fx.mergeRateTable(cached, table({ INR: 1 }, NOW - 9 * DAY)).rates.INR, 90);
eq('a response with the same timestamp is ignored', fx.mergeRateTable(cached, table({ INR: 1 }, cached.asOf)).rates.INR, 90);
eq('a broken provider peg is overwritten by the real one',
  fx.mergeRateTable(cached, table({ AED: 3.9, INR: 95 }, NOW)).rates.AED, 3.6725);
eq('null, zero, negative and non-numeric rates are dropped',
  fx.mergeRateTable(cached, table({ INR: null, PKR: 0, EUR: -1, GBP: 'x', THB: 33 }, NOW)).rates,
  { USD: 1, AED: 3.6725, INR: 90, PKR: 280, THB: 33, SAR: 3.75, QAR: 3.64, OMR: 0.3845, BHD: 0.376, JOD: 0.709 });
eq('currencies we do not carry are not stored',
  'XYZ' in fx.mergeRateTable(cached, table({ XYZ: 5, INR: 95 }, NOW)).rates, false);
// A payload we understood nothing from must not mark the cache fresh.
eq('an empty response leaves the cache untouched', fx.mergeRateTable(cached, table({}, NOW)).asOf, cached.asOf);
eq('a null response leaves the cache untouched', fx.mergeRateTable(cached, null), cached);
eq('a non-USD response is refused',
  fx.mergeRateTable(cached, { base: 'EUR', rates: { INR: 1 }, asOf: NOW, origin: 'network' }).rates.INR, 90);
eq('no cache at all falls back to the seed', fx.mergeRateTable(null, null), fx.SEED_RATES);
ok('merging never mutates the cached table', cached.rates.INR === 90 && cached.asOf === NOW - 5 * DAY);

// ── reading a provider payload ─────────────────────────────────────────────
const erApi = {
  result: 'success',
  base_code: 'USD',
  time_last_update_unix: 1785196951,
  rates: { USD: 1, AED: 3.6725, INR: 95.938043, XYZ: 4, BTC: 0.00001 },
};
eq('open.er-api.com shape', fx.parseRateResponse(erApi, NOW).rates.INR, 95.938043);
eq('and its publish time, not our fetch time', fx.parseRateResponse(erApi, NOW).asOf, 1785196951000);
eq('unknown tickers are stripped on the way in',
  Object.keys(fx.parseRateResponse(erApi, NOW).rates).sort(), ['AED', 'INR', 'USD']);
eq('currency-api shape (the fallback endpoint)',
  fx.parseRateResponse({ date: '2026-07-28', usd: { aed: 3.6725, inr: 95.5 } }, NOW).rates,
  { AED: 3.6725, INR: 95.5 });
eq('currency-api date', fx.parseRateResponse({ date: '2026-07-28', usd: { aed: 3.6725 } }, NOW).asOf,
  Date.UTC(2026, 6, 28));
eq('a payload with no publish time is dated on arrival',
  fx.parseRateResponse({ base_code: 'USD', rates: { AED: 3.6725 } }, NOW).asOf, NOW);
eq('an error envelope', fx.parseRateResponse({ result: 'error', 'error-type': 'unsupported-code' }, NOW), null);
eq('a wrong base', fx.parseRateResponse({ base_code: 'EUR', rates: { AED: 3.6725 } }, NOW), null);
eq('an HTML error page', fx.parseRateResponse('<!doctype html>', NOW), null);
eq('nothing at all', [fx.parseRateResponse(null, NOW), fx.parseRateResponse(undefined, NOW)], [null, null]);
eq('a payload with no code we recognise', fx.parseRateResponse({ rates: { BTC: 1 } }, NOW), null);

// ── the injected fetcher ───────────────────────────────────────────────────
const cache = table({ USD: 1, INR: 90 }, NOW - 5 * DAY);
(async () => {
  const offline = await fx.fetchRateTable(() => Promise.reject(new Error('Network request failed')), cache, NOW);
  eq('offline returns the cached table untouched', offline, cache);
  const garbage = await fx.fetchRateTable(async () => '<html>502</html>', cache, NOW);
  eq('a garbage response returns the cached table', garbage, cache);
  const thrower = await fx.fetchRateTable(() => { throw new Error('boom'); }, cache, NOW);
  eq('a fetcher that throws synchronously is caught too', thrower, cache);
  const live = await fx.fetchRateTable(async () => erApi, cache, NOW);
  eq('a good response merges', live.rates.INR, 95.938043);
  eq('and is marked as coming from the network', live.origin, 'network');
  const noCache = await fx.fetchRateTable(() => Promise.reject(new Error('x')), null, NOW);
  eq('offline with no cache lands on the seed', noCache, fx.SEED_RATES);
  // The floor of the whole degradation chain: whatever happened, a dollar
  // purchase still converts to the right dirham figure.
  eq('the offline floor still converts USD to AED', fx.convertMinor(4200, 'USD', 'AED', offline, NOW), 15425);

  // ── what the bank actually charged ───────────────────────────────────────
  // "Purchase of USD 42.00 ... AED 154.25" — one message, both legs.
  const markup = fx.fxMarkup({ code: 'USD', minor: 4200 }, { code: 'AED', minor: 15425 }, fx.PEG_TABLE, NOW);
  near('implied rate from a settled pair', markup.impliedRate, 3.672619, 1e-5);
  near('a peg-rate settlement shows no markup', markup.markupPct, 0, 0.01);
  const gouged = fx.fxMarkup({ code: 'USD', minor: 4200 }, { code: 'AED', minor: 15900 }, fx.PEG_TABLE, NOW);
  near('a marked-up settlement is measured', gouged.markupPct, 3.08, 0.01);
  eq('markup against a peg is never stale', gouged.basis, 'peg');
  eq('a zero foreign leg has no implied rate',
    fx.impliedRate({ code: 'USD', minor: 0 }, { code: 'AED', minor: 100 }), null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
