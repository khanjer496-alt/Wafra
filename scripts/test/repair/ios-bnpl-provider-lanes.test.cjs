'use strict';
// BNPL provider restatements on the two iOS Message lanes.
//
// A Tabby/Tamara instalment arrives twice: the bank's card alert (the real
// outflow) and the provider's own SMS restating it under the shop's name. The
// provider SOURCE is gated in bnpl-providers.ts and consulted by sms-parser,
// the launch session and the refused-alert inspector. These tests pin that the
// iOS live queue (parseLocalMessageRecord) and iOS History import
// (parseHistoricalMessageRecords) honour the same policy as Android: a
// provider sender never posts; its restatement of a bank card charge is
// ignored — never sent to Review — while its own money (Tabby Cash, which no
// bank alert reports) reaches Review; and a bank alert that merely names
// TABBY still posts.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const { parseLocalMessageRecord, preflightLocalMessageRecord } = require(path.join(build, 'local-message-record.js'));
const { parseHistoricalMessageRecords } = require(path.join(build, 'historical-import.js'));
const { createLaunchAlertSession } = require(path.join(build, 'launch-alert-parser.js'));
const { setActiveMarket, setLedgerCurrency } = require(path.join(build, 'markets.js'));
setActiveMarket('AE'); setLedgerCurrency('AED', 2);

const now = new Date('2026-09-19T12:00:00.000Z');
const observedAt = '2026-09-18T10:30:00.000Z';
const PROVIDER_BODY = 'Your order of AED 199.00 at Noon is split into 4 payments. ' +
  'First payment of AED 49.75 charged to your card ending 1234.';
const BANK_BODY = 'Purchase of AED 49.75 to TABBY with Credit Card ending 1234';
const PROVIDER_SENDERS = ['Tabby', 'AD-Tabby', 'Tamara'];
const sessions = () => [
  ['unpinned session', createLaunchAlertSession({ overrides: {} })],
  ['AED-pinned session', createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' })],
];

function localOutcome(sender, text, session) {
  const serialized = JSON.stringify({ v: 1, id: 'a'.repeat(64), text, sender, source: 'message', observedAt });
  const preflight = preflightLocalMessageRecord(serialized, now);
  assert.ok(preflight && preflight.valid, 'the queue record itself is well-formed');
  return parseLocalMessageRecord(serialized, now, preflight.market, session);
}
function history(sender, text) {
  return parseHistoricalMessageRecords([JSON.stringify({ v: 1, id: 'b'.repeat(64), text, sender, receivedAt: observedAt })],
    {}, now);
}

test('iOS live queue: a BNPL provider SMS is ignored, never posted or reviewed', () => {
  for (const sender of PROVIDER_SENDERS) {
    for (const [label, session] of sessions()) {
      const outcome = localOutcome(sender, PROVIDER_BODY, session);
      assert.equal(outcome.kind, 'ignored', `${sender} / ${label}: provider restatement is ignored`);
      assert.equal(Object.hasOwn(outcome, 'row'), false, `${sender} / ${label}: no money row`);
      assert.equal(Object.hasOwn(outcome, 'item'), false, `${sender} / ${label}: no Review item`);
      assert.equal(outcome.milestone, 'none', `${sender} / ${label}: cannot prove the Message automation`);
      assert.equal(JSON.stringify(outcome).includes('Noon'), false, `${sender} / ${label}: source-free`);
    }
  }
});

test('iOS History import: a BNPL provider SMS yields no posted, reviewed or declined row', () => {
  for (const sender of PROVIDER_SENDERS) {
    const result = history(sender, PROVIDER_BODY);
    assert.deepEqual(result.parsed.map(row => row.amountFils), [], `${sender}: nothing posts`);
    assert.equal(result.acceptedCount, 0, `${sender}: nothing accepted`);
    assert.equal(result.reviewCandidates.length, 0, `${sender}: nothing reaches Review`);
    assert.equal(result.declined.length, 0, `${sender}: no decline reconciliation`);
    assert.equal(result.ignoredCount, 1, `${sender}: counted as ignored`);
    assert.equal(result.invalidCount, 0, `${sender}: the record itself is valid`);
  }
});

test('a bank card alert that names TABBY still posts on both iOS lanes', () => {
  for (const [label, session] of sessions()) {
    const outcome = localOutcome('ADCBAlert', BANK_BODY, session);
    assert.equal(outcome.kind, 'parsed', `${label}: the bank alert is the real outflow`);
    assert.equal(outcome.row.kind, 'transaction');
    assert.equal(outcome.row.type, 'expense');
    assert.equal(outcome.row.amountFils, 4975);
    assert.equal(outcome.row.currency, 'AED');
    assert.equal(outcome.row.bankHint, 'ADCB');
    assert.equal(outcome.row.channel, 'inbox');
  }
  const result = history('ADCBAlert', BANK_BODY);
  assert.equal(result.parsed.length, 1, 'History posts the bank alert');
  assert.equal(result.parsed[0].amountFils, 4975);
  assert.equal(result.parsed[0].type, 'expense');
  assert.equal(result.parsed[0].currency, 'AED');
  assert.equal(result.parsed[0].bankHint, 'ADCB');
  assert.equal(result.reviewCandidates.length, 0);
});

// More restatement shapes: a refund of the order to the card, the day-before
// charge preview, a Tamara instalment, and Arabic copy.
const MORE_RESTATEMENTS = [
  'Refund of AED 49.75 for your Noon order has been processed to your card ending 1234.',
  'Your Noon order for AED 49.75 is due tomorrow and will be charged to your default card. Pay it now at https://s.tabby.ai/s3b4DC',
  'We have received your payment of AED 120.00 for your order from Namshi.',
  'تم خصم 49.75 درهم من بطاقتك المنتهية بـ 1234 لطلبك من نون',
];

test('iOS lanes: every recognised restatement shape from a provider is ignored', () => {
  for (const body of MORE_RESTATEMENTS) {
    for (const sender of PROVIDER_SENDERS) {
      for (const [label, session] of sessions()) {
        const outcome = localOutcome(sender, body, session);
        assert.equal(outcome.kind, 'ignored', `${sender} / ${label}: ${body.slice(0, 40)}`);
      }
      const result = history(sender, body);
      assert.equal(result.parsed.length, 0, `${sender}: ${body.slice(0, 40)} never posts`);
      assert.equal(result.reviewCandidates.length, 0, `${sender}: ${body.slice(0, 40)} never reaches Review`);
      assert.equal(result.declined.length, 0, `${sender}: ${body.slice(0, 40)} never reconciles a decline`);
    }
  }
});

// Tabby Cash is a stored-value account in the same brand: its card spends and
// person-to-person transfers have NO bank alert behind them. Dropping them
// lost real money silently; posting them would trust the provider. Review.
const TABBY_CASH = [
  ['a Tabby Cash card spend', 'You spent AED 35.00 at CARREFOUR with your Tabby Cash Card ending 1234.', 'debit', '3500'],
  ['an incoming Tabby Cash transfer', 'You received AED 500.00 from Ahmed. Your Tabby Cash balance is AED 812.40.', 'credit', '50000'],
];
const reviewMoney = (item) => item.kind === 'universal'
  ? [item.event.direction, item.event.amount.value && item.event.amount.value.minorUnits]
  : [item.direction, item.amount && item.amount.minorUnits];

test('iOS live queue: Tabby Cash money from the Tabby sender reaches Review, never the ledger', () => {
  for (const [what, body, direction, minor] of TABBY_CASH) {
    for (const sender of ['Tabby', 'AD-Tabby']) {
      for (const [label, session] of sessions()) {
        const outcome = localOutcome(sender, body, session);
        assert.equal(outcome.kind, 'review', `${what} / ${sender} / ${label}: Review, not ${outcome.kind}`);
        assert.equal(Object.hasOwn(outcome, 'row'), false, `${what} / ${sender} / ${label}: no money row`);
        assert.deepEqual(reviewMoney(outcome.item), [direction, minor], `${what} / ${sender} / ${label}: the amount it states`);
        // Structured facts only (amount, direction, merchant): never the text.
        assert.equal(JSON.stringify(outcome).includes(body.slice(0, 20)), false, `${what} / ${label}: source-free`);
      }
    }
  }
});

test('iOS History import: Tabby Cash money from the Tabby sender reaches Review, never the ledger', () => {
  for (const [what, body, direction, minor] of TABBY_CASH) {
    const result = history('Tabby', body);
    assert.equal(result.parsed.length, 0, `${what}: nothing posts`);
    assert.equal(result.acceptedCount, 0, `${what}: nothing accepted`);
    assert.equal(result.reviewCandidates.length, 1, `${what}: one Review card`);
    assert.deepEqual(reviewMoney(result.reviewCandidates[0]), [direction, minor], `${what}: the amount it states`);
    assert.equal(result.ignoredCount, 0, `${what}: not counted as ignored`);
  }
});
