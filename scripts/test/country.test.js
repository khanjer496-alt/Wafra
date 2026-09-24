// The user's country, kept apart from the parser market pack.
//
// Every country is a first-class choice: it defaults from the device Region,
// can be changed in onboarding and Settings, and decides how an ambiguous
// numeric date reads. Only AE and SA have launch-tested parser packs; every
// other country gets the neutral pack, and an AE/SA user must see exactly the
// behaviour they had before.
const fs = require('fs');
const path = require('path');
const country = require('./build/country');
const markets = require('./build/markets');
const knownBanks = require('./build/known-banks');
const { inspectUniversalBankEvent } = require('./build/universal-parser');
const { inspectGenericBankEventForReview } = require('./build/launch-alert-parser');

let pass = 0;
let fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}\n    expected ${e}\n    actual   ${a}`);
  }
}
const ok = (name, condition) => eq(name, !!condition, true);

/* ── Defaults from the device Region ── */
eq('en-US defaults to the United States', country.countryFromDeviceRegions(['en-US']), 'US');
eq('de-DE defaults to Germany', country.countryFromDeviceRegions(['de-DE']), 'DE');
eq('a bare Region code wins', country.countryFromDeviceRegions(['FR', 'en-US']), 'FR');
eq('a missing Region falls through to the locale tag', country.countryFromDeviceRegions([null, 'pt-BR']), 'BR');
eq('a script subtag is skipped', country.countryFromDeviceRegions(['zh-Hant-TW']), 'TW');
eq('an unknown locale is ZZ, never AE', country.countryFromDeviceRegions(['en']), 'ZZ');
eq('a UN M49 region is not a country', country.countryFromDeviceRegions(['es-419']), 'ZZ');
eq('no Region at all is ZZ', country.countryFromDeviceRegions([]), 'ZZ');
eq('the UAE stays the UAE', country.countryFromDeviceRegions(['ar-AE']), 'AE');
eq('Saudi Arabia stays Saudi Arabia', country.countryFromDeviceRegions(['ar-SA']), 'SA');
ok('every ISO 3166-1 country is choosable', country.COUNTRY_CODES.length === 249 &&
  ['US', 'DE', 'BR', 'NG', 'PK', 'VN', 'NZ', 'AE', 'SA'].every((code) => country.COUNTRY_CODES.includes(code)));
ok('every country has an English and an Arabic name', country.COUNTRY_CODES.every((code) =>
  country.countryDisplayName(code, 'en') !== code && country.countryDisplayName(code, 'ar') !== code &&
  /[؀-ۿ]/.test(country.countryDisplayName(code, 'ar'))));
eq('codes normalize', country.normalizeCountryCode(' de '), 'DE');
eq('ZZ is a storable answer', country.normalizeCountryCode('zz'), 'ZZ');
for (const bad of ['XX', 'DEU', '', null, 7, 'EU']) {
  eq(`not a country: ${JSON.stringify(bad)}`, country.normalizeCountryCode(bad), null);
}
eq('a flag is drawn from the code', country.countryFlag('DE'), '\u{1F1E9}\u{1F1EA}');
eq('an unknown country gets a globe', country.countryFlag('ZZ'), '\u{1F30D}');

/* ── Date order per country ── */
for (const [code, order] of [
  ['US', 'MDY'], ['PH', 'MDY'], ['PR', 'MDY'],
  ['GB', 'DMY'], ['DE', 'DMY'], ['FR', 'DMY'], ['IN', 'DMY'], ['BR', 'DMY'], ['AE', 'DMY'], ['SA', 'DMY'],
  ['JP', 'YMD'], ['CN', 'YMD'], ['KR', 'YMD'],
  ['CA', null], ['IR', null], ['ZZ', null], [null, null], ['XX', null],
]) {
  eq(`date order for ${code}`, country.dateOrderForCountry(code), order);
}
eq('statement hint for a month-first country', country.statementDateOrderForCountry('US'), 'month-first');
eq('statement hint for a day-first country', country.statementDateOrderForCountry('DE'), 'day-first');
eq('a year-first country leaves statements undecided', country.statementDateOrderForCountry('JP'), null);
eq('an unknown country leaves statements undecided', country.statementDateOrderForCountry('ZZ'), null);

/* ── Parser pack follows the country, never away from AED/SAR money ── */
eq('Germany gets the neutral pack', country.parserMarketForCountry('DE'), 'ZZ');
eq('the UAE gets the UAE pack', country.parserMarketForCountry('AE'), 'AE');
eq('Saudi Arabia gets the Saudi pack', country.parserMarketForCountry('SA'), 'SA');
eq('an unknown country gets the neutral pack', country.parserMarketForCountry('ZZ'), 'ZZ');
eq('an AED ledger keeps the UAE pack whatever country is picked',
  country.parserMarketForCountry('GB', { marketId: 'AE', ledgerCurrency: 'AED' }), 'AE');
eq('an SAR ledger keeps the Saudi pack whatever country is picked',
  country.parserMarketForCountry('US', { marketId: 'SA', ledgerCurrency: 'SAR' }), 'SA');
eq('an SAR ledger with no pack yet gets the Saudi one',
  country.parserMarketForCountry('US', { marketId: '', ledgerCurrency: 'SAR' }), 'SA');
eq('a USD ledger in the UAE still uses the UAE pack',
  country.parserMarketForCountry('AE', { marketId: 'AE', ledgerCurrency: 'USD' }), 'AE');

/* ── Migration of ledgers written before `country` existed ── */
const migrate = country.migrateCountryState;
eq('an AE user with an AED ledger stays exactly AE',
  migrate({ marketId: 'AE', ledgerCurrency: 'AED', deviceCountry: 'US' }), { country: 'AE', marketId: 'AE' });
eq('an SA user with an SAR ledger stays exactly SA',
  migrate({ marketId: 'SA', ledgerCurrency: 'SAR', deviceCountry: 'GB' }), { country: 'SA', marketId: 'SA' });
eq('an AE user on a UAE phone with no money yet stays AE',
  migrate({ marketId: 'AE', ledgerCurrency: null, deviceCountry: 'AE' }), { country: 'AE', marketId: 'AE' });
eq('an AE pack with no money and no device Region stays AE',
  migrate({ marketId: 'AE', ledgerCurrency: null, deviceCountry: 'ZZ' }), { country: 'AE', marketId: 'AE' });
eq('the silent AE fallback on a US phone with a USD ledger becomes US and neutral',
  migrate({ marketId: 'AE', ledgerCurrency: 'USD', deviceCountry: 'US' }), { country: 'US', marketId: 'ZZ' });
eq('the silent AE fallback on a German phone with no money becomes DE and neutral',
  migrate({ marketId: 'AE', ledgerCurrency: null, deviceCountry: 'DE' }), { country: 'DE', marketId: 'ZZ' });
eq('a fresh install takes the device Region',
  migrate({ marketId: '', ledgerCurrency: null, deviceCountry: 'BR' }), { country: 'BR', marketId: 'ZZ' });
eq('a fresh install with no Region is ZZ, to be asked',
  migrate({ marketId: '', ledgerCurrency: null, deviceCountry: 'ZZ' }), { country: 'ZZ', marketId: 'ZZ' });
eq('a fresh install in Saudi Arabia gets the Saudi pack',
  migrate({ marketId: '', ledgerCurrency: null, deviceCountry: 'SA' }), { country: 'SA', marketId: 'SA' });
eq('a country picked during onboarding wins over the device',
  migrate({ marketId: 'AE', ledgerCurrency: null, onboardingCountry: 'GB', deviceCountry: 'US' }),
  { country: 'GB', marketId: 'ZZ' });
eq('an onboarding country never moves an AED ledger off its pack',
  migrate({ marketId: 'AE', ledgerCurrency: 'AED', onboardingCountry: 'GB', deviceCountry: 'GB' }),
  { country: 'GB', marketId: 'AE' });
eq('an onboarding "somewhere else" does not override the device',
  migrate({ marketId: 'AE', ledgerCurrency: null, onboardingCountry: 'ZZ', deviceCountry: 'FR' }),
  { country: 'FR', marketId: 'ZZ' });
eq('an already-migrated ledger keeps its country and its pack',
  migrate({ country: 'AE', marketId: 'SA', ledgerCurrency: null, deviceCountry: 'US' }),
  { country: 'AE', marketId: 'SA' });
eq('an already-migrated neutral ledger is left alone',
  migrate({ country: 'DE', marketId: 'ZZ', ledgerCurrency: 'EUR', deviceCountry: 'US' }),
  { country: 'DE', marketId: 'ZZ' });

/* ── The neutral pack carries no Gulf bank identities ── */
eq('MARKETS still lists only the two launch packs', markets.MARKETS.map((m) => m.id), ['AE', 'SA']);
ok('the neutral pack is selectable', markets.canSelectMarket('ZZ'));
ok('an unknown id is not', !markets.canSelectMarket('DE'));
const previous = markets.getActiveMarket().id;
ok('selecting the neutral pack works', markets.setActiveMarket('ZZ'));
eq('it has no bank registry', markets.getActiveMarket().banks.length, 0);
eq('so a Gulf sender is not claimed as the user\'s bank', markets.bankFromSender('ADCB'), null);
ok('its category vocabulary is the shared one the UAE pack uses',
  JSON.stringify(markets.getActiveMarket().keywords.map(([re, cat]) => [re.source, cat])) ===
    JSON.stringify(markets.globalCategoryKeywords().map(([re, cat]) => [re.source, cat])));
eq('and its unpinned currency lexicon is unchanged from the old silent AE default',
  markets.getActiveMarket().currency.code, 'AED');
markets.setActiveMarket('AE');
eq('the UAE pack still claims its own senders', markets.bankFromSender('ADCB')?.name, 'ADCB');
markets.setActiveMarket(previous);
eq('no UAE banks are offered as "your bank" outside the launch packs', knownBanks.knownBankOptions('ZZ'), []);
ok('the UAE and Saudi pickers are unchanged',
  knownBanks.knownBankOptions('AE').some((bank) => bank.name === 'ADCB') &&
    knownBanks.knownBankOptions('SA').some((bank) => bank.name === 'Al Rajhi'));

{
  const RealIntl = global.Intl;
  const withLocale = (locale, run) => {
    global.Intl = { ...RealIntl, DateTimeFormat: () => ({ resolvedOptions: () => ({ locale }) }) };
    try { return run(); } finally { global.Intl = RealIntl; }
  };
  eq('detectMarketId: en-US is the neutral pack, not AE', withLocale('en-US', markets.detectMarketId), 'ZZ');
  eq('detectMarketId: en-AE is the UAE pack', withLocale('en-AE', markets.detectMarketId), 'AE');
  eq('detectMarketId: ar-SA is the Saudi pack', withLocale('ar-SA', markets.detectMarketId), 'SA');
  eq('detectMarketId: no Region is the neutral pack', withLocale('en', markets.detectMarketId), 'ZZ');
}

/* ── Ambiguous alert dates resolve by country, and only by country ── */
{
  const alert = 'Your credit card ending 1234 was charged USD 12.00 at AMAZON on 03/04/2026.';
  const dateOf = (context) => inspectUniversalBankEvent(alert, context).transactionDate;
  eq('without a country a 03/04 date stays ambiguous', dateOf({}).value, null);
  eq('month-first reads it as 4 March', dateOf({ dateOrder: 'MDY' }).value, '2026-03-04');
  eq('day-first reads it as 3 April', dateOf({ dateOrder: 'DMY' }).value, '2026-04-03');

  const generic = (code) => {
    country.setActiveCountry(code);
    try { return inspectGenericBankEventForReview(alert)?.transactionDate.value ?? null; } finally { country.setActiveCountry(null); }
  };
  eq('the review path reads a US user\'s date month-first', generic('US'), '2026-03-04');
  eq('the review path reads a UK user\'s date day-first', generic('GB'), '2026-04-03');
  eq('the review path reads a UAE user\'s date day-first', generic('AE'), '2026-04-03');
  eq('an unknown country leaves it unresolved', generic('ZZ'), null);
  eq('Canada, which uses both orders, leaves it unresolved', generic('CA'), null);
  eq('an unambiguous 13/04 date is read the same everywhere',
    inspectUniversalBankEvent(alert.replace('03/04', '13/04'), {}).transactionDate.value, '2026-04-13');
}

/* ── Source wiring the transpiled suites cannot execute ── */
{
  const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
  const store = read('src/lib/store.tsx');
  ok('hydration migrates the country and mirrors it into the parsers',
    /migrateCountryState\(\{/.test(store) && /setActiveCountry\(next\.country\)/.test(store));
  ok('the store exposes a country setter that never moves an AED\/SAR ledger',
    /case 'setCountry'/.test(store) && /parserMarketForCountry\(country, \{/.test(store));
  const autoImport = read('src/lib/auto-import.ts');
  ok('a routed foreign institution prints its own country\'s dates',
    /dateOrder: dateOrderForCountry\(globalMarket\)/.test(autoImport));
  const importSms = read('src/app/import-sms.tsx');
  ok('pasted alerts use the user\'s country', /inspectUniversalBankEvent\(source, \{ dateOrder: activeCountryDateOrder\(\) \}\)/.test(importSms));
  const settings = read('src/app/settings.tsx');
  ok('Settings offers the country', /settingsCountryTitle/.test(settings) && /<CountryPickerSheet/.test(settings));
  const gate = read('src/components/onboarding-gate.tsx');
  ok('onboarding writes the country it asks for, except in the preview',
    /if \(!previewMode\) setLedgerCountry\(next\)/.test(gate));
  const upload = read('src/components/supplement-imports.tsx');
  ok('statement uploads send the country date order',
    /statementDateOrderForCountry\(state\.country\)/.test(upload));
  const cloud = read('src/lib/cloud-import.ts');
  ok('the date order travels as its own header', /'x-wafra-date-order'/.test(cloud));
}

/* ── Second-wave review packs share the country model's ISO codes ── */
{
  // A routed review-pack market is keyed by the same ISO code as the country,
  // so the capture path's dateOrderForCountry(routedMarket) applies each
  // country's own convention. Canada stays undecided.
  eq('Canada-routed alerts keep ambiguous dates undecided', country.dateOrderForCountry('CA'), null);
  for (const code of ['AU', 'BR', 'MX', 'SG']) {
    eq(`${code}-routed alerts read numeric dates day-first`, country.dateOrderForCountry(code), 'DMY');
  }
  // A review pack is not a launch pack: choosing one of these countries never
  // adds bank-registry coverage or changes the neutral parser pack.
  for (const code of ['CA', 'AU', 'BR', 'MX', 'SG']) {
    eq(`${code} keeps the neutral parser pack`, country.parserMarketForCountry(code), 'ZZ');
  }
  const mx = inspectUniversalBankEvent(
    'Banorte: compra MXN 1,250.00 SUPERMERCADO el 03/04/2026. Tarjeta terminación 1234.',
    { market: 'MX', sender: 'BANORTE', dateOrder: country.dateOrderForCountry('MX') ?? undefined },
  );
  eq('a Mexican numeric date resolves day-first', mx.transactionDate.value, '2026-04-03');
  const ca = inspectUniversalBankEvent(
    'Interac e-Transfer: CAD 250.00 has been deposited to your account on 03/04/2026.',
    { market: 'CA', dateOrder: country.dateOrderForCountry('CA') ?? undefined },
  );
  ok('an ambiguous Canadian numeric date is never guessed', ca.transactionDate.evidence !== 'explicit');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
