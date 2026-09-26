'use strict';
// BNPL provider restatements on the two iOS Message lanes.
//
// A Tabby/Tamara instalment arrives twice: the bank's card alert (the real
// outflow) and the provider's own SMS restating it under the shop's name. The
// provider SOURCE is gated in bnpl-providers.ts and consulted by sms-parser,
// the launch session and the refused-alert inspector. These tests pin that the
// iOS live queue (parseLocalMessageRecord) and iOS History import
// (parseHistoricalMessageRecords) honour the same gate as Android: a provider
// sender is ignored — never posted and never sent to Review — while a bank
// alert that merely names TABBY still posts.
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
