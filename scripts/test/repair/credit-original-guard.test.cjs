'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const guard = load('@/lib/credit-settlement-guards');
const tokens = require('./credit-unsettled-tokens.json');
test('the final guard reads every CEO unsettled token in the unmasked original', () => {
  for (const token of tokens) {
    assert.equal(guard.hasUnsettledCreditToken(`AED 250.00 has been refunded by ${token.toUpperCase()} LTD.`), true, token);
    assert.equal(guard.hasUnsettledCreditToken(`تم استرداد مبلغ AED 250.00 من شركة ${token}.`), true, token);
  }
  assert.equal(guard.hasUnsettledCreditToken('AED 250.00 has been refunded to your card.'), false);
  assert.equal(guard.hasUnsettledCreditToken('Payment from MAYFAIR CANDY WILLIS.'), false);
});
test('a request note cannot turn a completed debit into income', () => {
  load('@/lib/markets').setActiveMarket('AE'); load('@/lib/markets').setLedgerCurrency('AED', 2);
  const { parseSms } = load('@/lib/sms-parser');
  const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
  const body = 'AED 250.00 was debited from your card ending 1234 at NOON.COM. Your charge-back request is scheduled.';
  const session = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED' });
  for (const p of [parseSms(body, {}, { sender: 'ENBD' }), session.parse(body, 'ENBD', session.inspect(body, 'ENBD'))]) {
    assert.equal(p?.type, 'expense'); assert.equal(p?.amountFils, 25000);
  }
});
test('the final guard covers a credit returned by request-note reparsing', () => {
  load('@/lib/markets').setActiveMarket('AE'); load('@/lib/markets').setLedgerCurrency('AED', 2);
  const body = 'AED 250.00 has been refunded to your card. Your other chargeback request is scheduled.';
  assert.equal(load('@/lib/sms-parser').parseSms(body, {}, { sender: 'ENBD' }), null);
});
