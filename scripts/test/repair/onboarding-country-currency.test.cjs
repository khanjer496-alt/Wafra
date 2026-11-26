'use strict';
// #269 (QA F6): onboarding defaulted Country and Currency from the phone's
// Region, and correcting the country left the currency behind (Canada/CAD on
// the reporter's phone). An unchosen currency now follows the country; an
// explicit currency choice, or a ledger that already has a currency, never
// changes. The real gate and Name step run through the journey harness, whose
// phone Region is AE with an AED suggestion.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { gate } = require('../ios-journey/onboarding-extreme-navigation.test.cjs');
const { walk } = require('./reference-harness.cjs');
const { countryFlag, COUNTRY_CODES } = require('../build/country.js');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const calls = (h, name) => h.events.filter((event) => event[0] === name);
/** What the Name step's currency row (and its sheet) holds. */
const currencyShown = (h) => walk(h.tree).find((node) => node.type === 'LedgerCurrencySheet').props.value;
async function chooseCountry(h, code) {
  await h.tap('onboarding-country-confirm');
  const sheet = walk(h.tree).find((node) => node.props?.testID === 'onboarding-country-sheet');
  assert.equal(sheet.props.visible, true);
  const option = walk(sheet).find((node) => node.props?.accessibilityRole === 'radio' &&
    walk(node).some((child) => child.props?.children === countryFlag(code)));
  assert.ok(option, `${code} is offered`);
  option.props.onPress();
  await h.flush();
}
async function chooseCurrency(h, code) {
  await h.tap('onboarding-currency-confirm');
  walk(h.tree).find((node) => node.type === 'LedgerCurrencySheet').props.onSelect(code);
  await h.flush();
}

for (const language of ['en', 'ar']) {
  test(`${language}: an unchosen currency follows the country the person picks`, async () => {
    const h = await gate({ language });
    await h.press('getStarted');
    assert.equal(currencyShown(h), 'AED', 'the phone Region suggests the first currency');
    await chooseCountry(h, 'CA');
    assert.equal(currencyShown(h), 'CAD');
    await chooseCountry(h, 'GB');
    assert.equal(currencyShown(h), 'GBP');
    await chooseCountry(h, 'JP');
    assert.equal(currencyShown(h), 'JPY');
    await chooseCountry(h, 'DE');
    assert.equal(currencyShown(h), 'EUR');
    // A place with no currency of its own keeps the phone's suggestion.
    await chooseCountry(h, 'AQ');
    assert.equal(currencyShown(h), 'AED');
    // Following is a suggestion only: nothing is written to the ledger.
    assert.equal(h.state.ledgerMoney, null);
    assert.equal(calls(h, 'setLedgerMoney').length, 0);
    assert.deepEqual(calls(h, 'setCountry').map((event) => event[1]), ['CA', 'GB', 'JP', 'DE', 'AQ']);
  });

  test(`${language}: a currency the person picked stays when the country changes`, async () => {
    const h = await gate({ language });
    await h.press('getStarted');
    await chooseCountry(h, 'GB');
    assert.equal(currencyShown(h), 'GBP');
    await chooseCurrency(h, 'USD');
    assert.equal(currencyShown(h), 'USD');
    await chooseCountry(h, 'FR');
    assert.equal(currencyShown(h), 'USD');
    assert.equal(h.state.ledgerMoney.currency, 'USD');
    assert.deepEqual(calls(h, 'setLedgerMoney').map((event) => event[1]), ['USD']);
  });

  test(`${language}: a ledger that already has a currency is never relabelled by a country change`, async () => {
    const h = await gate({ language, ledger: { ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } } });
    await h.press('getStarted');
    await chooseCountry(h, 'GB');
    assert.equal(currencyShown(h), 'AED');
    assert.equal(h.state.ledgerMoney.currency, 'AED');
    assert.equal(calls(h, 'setLedgerMoney').length, 0);
  });

  test(`${language}: a country chosen earlier in setup still decides the suggestion when setup resumes`, async () => {
    const h = await gate({ language, profile: { v: 1, stage: 'welcome', focus: null, tracking: null, country: 'IN',
      startedAt: 1_800_000_000_000 } });
    await h.press('getStarted');
    assert.equal(currencyShown(h), 'INR');
  });

  test(`${language}: a limit dialled in the old currency is cleared when the country moves the currency`, async () => {
    const h = await gate({ language });
    await h.press('getStarted');
    await h.press('onboardNameSkip');
    await h.press('skipForNow');
    await h.tap('onboarding-watch-dining');
    await h.tap('onboarding-watch-limit-quick-1');
    assert.equal(h.byTestID('onboarding-watch-continue').props.accessibilityLabel, h.eWords.watchSave(1));
    await h.press('back'); await h.press('back');
    await chooseCountry(h, 'KW');
    assert.equal(currencyShown(h), 'KWD');
    await h.press('onboardNameSkip');
    await h.press('skipForNow');
    // 500 AED in fils is not 500 KWD in fils (three decimals): nothing carries over.
    assert.equal(h.byTestID('onboarding-watch-continue').props.accessibilityLabel, h.eWords.skipForNow);
    await h.tap('onboarding-watch-continue');
    assert.deepEqual(h.state.budgets, []);
    assert.equal(h.state.ledgerMoney, null);
  });
}

test('every country this build lists maps to a currency the ledger can record, except Antarctica', () => {
  const ledgerMoney = require('../build/ledger-money.js');
  const { ledgerCurrencyForCountry } = load(path.join(root, 'src/lib/country-currency.ts'), { '@/lib/ledger-money': ledgerMoney });
  const missing = COUNTRY_CODES.filter((code) => ledgerCurrencyForCountry(code) === null);
  assert.deepEqual(missing, ['AQ']);
  for (const code of COUNTRY_CODES.filter((value) => value !== 'AQ')) {
    assert.ok(ledgerMoney.ledgerMoneySpec(ledgerCurrencyForCountry(code)), code);
  }
  // Agrees with the region tables the app already ships.
  const regions = { AE: 'AED', SA: 'SAR', US: 'USD', GB: 'GBP', FR: 'EUR', DE: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR',
    IN: 'INR', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR', EG: 'EGP', JO: 'JOD', CA: 'CAD', AU: 'AUD', BR: 'BRL',
    MX: 'MXN', SG: 'SGD', CO: 'COP', PE: 'PEN', NZ: 'NZD', HK: 'HKD', JP: 'JPY', CN: 'CNY', SE: 'SEK', NO: 'NOK',
    DK: 'DKK', IS: 'ISK', PK: 'PKR', LK: 'LKR', NP: 'NPR', BG: 'EUR', HR: 'EUR' };
  for (const [country, currency] of Object.entries(regions)) assert.equal(ledgerCurrencyForCountry(country), currency, country);
  assert.equal(ledgerCurrencyForCountry(' ca '), 'CAD');
  assert.equal(ledgerCurrencyForCountry('ZZ'), null);
  assert.equal(ledgerCurrencyForCountry(null), null);
});
