'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const { createLaunchAlertSession, inspectGenericBankEventForReview } = load('@/lib/launch-alert-parser');
const transfers = require('../fixtures/enbd-transfer-capture.js');
const { corpusMessages } = require('../instant-alert-reader.cjs');
const at = Date.parse('2026-10-13T12:00:00Z');
function session(currency, home = 'AE') {
  const activeMarket = home === 'AE' || home === 'SA' ? home : 'ZZ';
  country.setActiveCountry(home);
  markets.setActiveMarket(activeMarket);
  markets.setLedgerCurrency(currency, currency === 'JOD' ? 3 : 2);
  return createLaunchAlertSession({ overrides: {}, activeMarket, pinnedCurrency: currency,
    fxLookup: () => null, bestEffort: { enabled: true, country: home } });
}
function parse(api, reader, source, sender) {
  const inspection = reader.inspect(source, sender);
  return api === 'parse'
    ? reader.parse(source, sender, inspection, undefined, at)
    : reader.parseUnproven(source, sender, inspection, at);
}
// Synthetic conversations and negations are suppression controls, not real-bank coverage.
const personal = [
  ['USD', 'US', '+12025550190', 'Hi Ann, I have just spent USD 50.00 at Example Market.'],
  ['USD', 'US', 'CHASE', 'Hi Ann, I have just spent USD 50.00 at Example Market.'],
  ['AED', 'AE', '', 'I spent AED 50.00 at Carrefour today.'],
  ['AED', 'AE', 'ENBD', 'I spent AED 50.00 at Carrefour today.'],
  ['USD', 'US', 'Wafra Automation', "I've just spent USD 50.00 at Example Market."],
  ['EUR', 'DE', '+4915112345678', 'Hello! I’ve already deposited EUR 50.00 at Example Market.'],
  ['AED', 'AE', 'Wafra Automation', 'أنا دفعت AED 50.00 at Carrefour today.'],
  ['AED', 'AE', 'ENBD', 'انا حولت AED 50.00 to your account today.'],
];
const refused = [
  ...personal,
  ['AED', 'AE', '', 'AED 1,714.50 has not been transferred to your account 202XXX55XXX02.'],
  ['AED', 'AE', 'ENBD', 'AED 1,714.50 has not been transferred to your account 202XXX55XXX02.'],
  ['AED', 'AE', 'ENBD', "Dear Customer, AED 1,714.50 hasn't been transferred to your account 202XXX55XXX02."],
  ['AED', 'AE', 'ENBD', 'dear customer, aed 1,714.50 wasn’t transferred to your account 202XXX55XXX02.'],
  ['USD', 'US', 'CHASE', 'USD 24.86 has not been debited from your account ending 4421.'],
  ['USD', 'US', 'CHASE', '$24.86 was not charged to your card ending 4421.'],
  ['AED', 'AE', 'ENBD', 'AED 1,714.50 will be transferred to your account 202XXX55XXX02.'],
  ['AED', 'AE', 'ENBD', 'OTP 123456: AED 1,714.50 has been transferred to your account 202XXX55XXX02.'],
  ['USD', 'US', 'CHASE', 'Your balance USD 1,000.00. No funds were transferred.'],
];
for (const [i, [currency, home, sender, body]] of refused.entries()) {
  for (const api of ['parse', 'parseUnproven']) test(`${api} refuses negative source ${i} before posting`, () => {
    const reader = session(currency, home);
    assert.equal(parse(api, reader, body, sender), null);
    assert.equal(reader.detectedMarket(), null, 'a refused source cannot establish a Gulf session');
  });
}
for (const [i, [currency, home, sender, body]] of personal.entries()) test(`personal source ${i} has no parser-owned bank Review`, () => {
  const reader = session(currency, home);
  assert.equal(reader.inspect(body, sender), null);
  assert.equal(inspectGenericBankEventForReview(body, sender), null);
});
for (const sender of ['ENBD', '', 'Wafra Automation']) {
  for (const [i, fixture] of transfers.entries()) test(`ENBD transfer ${i} retains real-derived grammar for ${sender || 'no sender'}`, () => {
    const reader = session('AED');
    const result = parse('parse', reader, fixture.body, sender);
    assert.equal(result?.kind, 'transaction');
    assert.equal(result.type, fixture.type);
    assert.equal(result.amountFils, fixture.minor);
    assert.equal(result.snapshotFils, fixture.balance);
    assert.equal(reader.parseUnproven(fixture.body, sender, reader.inspect(fixture.body, sender), at), null);
  });
}
const compact = corpusMessages().filter(body =>
  body.startsWith('Your Cr.Card XXX2518 was used for AED799.18') ||
  body.startsWith('AED300.00 debited from Acc/Cr.Card XXX7720 for Salik') ||
  body.startsWith('Payment of INR 270 (AED 10.96) was done at Craft docs'));
test('compact real-derived positive bodies remain in the corpus', () => assert.equal(compact.length, 3));
for (const [i, body] of compact.entries()) test(`compact bank source ${i} is still parsed without a bank sender`, () => {
  assert.equal(parse('parse', session('AED'), body, 'Wafra Automation')?.kind, 'transaction');
});
for (const [i, footer] of [
  ' Your planned deposit has not been credited yet.',
  ' If you have not made this transfer, contact your bank.',
].entries()) test(`completed ENBD primary survives secondary negative wording ${i}`, () => {
  const fixture = transfers[i === 0 ? 3 : 2];
  const result = parse('parse', session('AED'), fixture.body + footer, 'ENBD');
  assert.equal(result?.kind, 'transaction');
  assert.equal(result.amountFils, fixture.minor);
  assert.equal(result.type, fixture.type);
});
for (const [i, footer] of [
  ' Your planned deposit has not been credited yet.',
  ' Your balance USD 1,000.00 has not been updated yet.',
  ' A fee of USD 5.00 has not been charged.',
].entries()) {
  for (const api of ['parse', 'parseUnproven']) test(`${api}: a posted primary survives secondary negation ${i}`, () => {
    const body = 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.' + footer;
    const result = parse(api, session('USD', 'US'), body, 'CHASE');
    assert.equal(result?.kind, 'transaction');
    assert.equal(result.amountFils, 2486);
    assert.equal(result.type, 'expense');
  });
}
for (const api of ['parse', 'parseUnproven']) test(`${api} preserves a real-derived HDFC card-payment clause with Rs. money`, () => {
  const body = 'Your payment of Rs. 432.10 towards your Credit Card ending 7642 has been received on 13/10/2026.';
  const result = parse(api, session('INR', 'IN'), body, 'HDFCBK');
  assert.equal(result?.kind, 'cardPayment');
  assert.equal(result.amountFils, 43210);
});
test('Gulf card-payment receipt retains its separate accounting family', () => {
  const body = 'Dear Customer, your payment of AED 42.10 on 13/10/2026 for card ending with **1234 has been credited. Thank you.';
  const result = parse('parse', session('AED'), body, 'ENBD');
  assert.equal(result?.kind, 'cardPayment');
  assert.equal(result.amountFils, 4210);
});
