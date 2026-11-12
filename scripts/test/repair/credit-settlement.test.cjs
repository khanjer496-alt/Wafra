'use strict';
// The shared "credit is settled to the user's own account" predicate (CEO 080fa431 item 3; design v2, Change Reviewer
// 82667841 / 8f1dcaee): the English table, the veto it applies in parseSms and the session, and the income it must leave
// alone. Synthetic bodies only.
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const sms = load('@/lib/sms-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');

country.setActiveCountry('AE');
markets.setActiveMarket('AE');
markets.setLedgerCurrency('AED', 2);
const at = Date.parse('2026-11-05T10:00:00Z');
const session = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED',
  bestEffort: { enabled: true, country: 'AE' } });
const shape = (p) => (p ? `${p.kind === 'transaction' ? p.type : p.kind} ${p.amountFils}` : 'none');
const both = (body) => {
  const p = shape(sms.parseSms(body, {}, { sender: 'ENBD', observedAt: at }));
  const s = shape(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at));
  return `${p} / ${s}`;
};
const DEBIT = 'AED 250.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026.';

test('English verdicts: completed, headline and coordinated credits are settled', () => {
  for (const body of [
    'AED 250.00 has been refunded to your card.',
    'AED 250.00 was reversed to your account.',
    'AED 250.00 refunded to your card ending 1234.',
    'Refund of AED 250.00 credited to your account.',
    '250.00 AED reversed to your card.',
    'The refund of AED 250.00 has been processed and credited to your card.',
    'NOON.COM has refunded AED 250.00 to your card.',
    'Refund of AED 250.00 has been credited to your card and will appear on your next statement.',
    'Refund for your pending order of AED 250.00 has been credited to your card.',
    'After verification, the refund of AED 250.00 has been credited to your card.',
  ]) assert.equal(both(body), 'income 25000 / income 25000', body);
});

test('English verdicts: conditional, negated, pending, third-party, taken-back and processed-only credits never post', () => {
  for (const body of [
    'If AED 250.00 has been refunded to your card, you will receive an SMS.',
    'Once AED 250.00 has been reversed to your card, you will receive an SMS.',
    'AED 250.00 is not reversed to your card.',
    'AED 250.00 has not been credited to your account.',
    'NOON.COM did not refund AED 250.00 to your card.',
    'AED 250.00 is being refunded to your card.',
    'AED 250.00 will be returned to your card.',
    'NOON.COM will refund AED 250.00 to your card.',
    'NOON.COM is refunding AED 250.00 to your card.',
    'AED 250.00 has been refunded to the merchant.',
    'AED 250.00 has been reversed to your card and was later reversed.',
    'AED 250.00 has been credited to your card in error.',
    'The refund of AED 250.00 has been processed to your card.',
  ]) assert.equal(both(body), 'none / none', body);
});

test('Beside a debit: an unsettled note leaves the expense, a figure of its own or a third party goes to Review', () => {
  assert.equal(both(`${DEBIT} It is not reversed to your card.`), 'expense 25000 / expense 25000');
  assert.equal(both(`${DEBIT} It is being reversed to your card.`), 'expense 25000 / expense 25000');
  assert.equal(both(`${DEBIT} Once it has been reversed to your card, you will receive an SMS.`), 'expense 25000 / expense 25000');
  assert.equal(both(`${DEBIT} It has been reversed to your card.`), 'income 25000 / income 25000');
  // Booked as AED 250.00 income before the predicate: a pending refund footer turned a purchase into a refund.
  assert.equal(both('Purchase of AED 250.00 at NOON.COM with card ending 1234 was successful. Refund will be processed if the order is cancelled.'),
    'expense 25000 / expense 25000');
  assert.equal(sms.parseSms(`${DEBIT} It, AED 100.00, has been refunded to your card.`, {}, { sender: 'ENBD', observedAt: at }), null);
  assert.equal(sms.parseSms(`${DEBIT} If a refund of AED 100.00 has been credited to your card, you will receive an SMS.`, {},
    { sender: 'ENBD', observedAt: at }), null, 'D1 before D2 (oracle v2.1)');
  assert.equal(sms.parseSms(`${DEBIT} It has been refunded to the merchant.`, {}, { sender: 'ENBD', observedAt: at }), null);
});

test('Not a credit clause: adjectives, nouns and rewards are left to the existing rules', () => {
  const clauseless = [
    'A returned cheque fee of AED 50.00 was debited from your account ending 1234.',
    `${DEBIT.replace('12/11/2026.', '12/11/2026 (reversed charges apply).')}`,
    'Your Credit Card ending 1234 was used for AED 250.00 at NOON.COM.',
  ];
  for (const body of clauseless) assert.equal(sms.hasOnlyUnsettledCredit(body), false, body);
  assert.equal(sms.hasOnlyUnsettledCredit('Cashback of AED 12.50 will be credited to your account.'), false);
});

test('Veto only: income from other evidence keeps its own path', () => {
  for (const body of [
    'You have received AED 500.00 from AHMED via Aani to your account ending 1234.',
    'AED 5,000.00 salary transfer received in your account ending 1234.',
    'Your salary of AED 15,000.00 has been credited to your account ending 1234.',
  ]) {
    const p = sms.parseSms(body, {}, { sender: 'ENBD', observedAt: at });
    assert.equal(sms.hasOnlyUnsettledCredit(body), false, body);
    if (p) assert.equal(p.type, 'income', body);
  }
});
