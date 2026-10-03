'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const { transactionSource, isLiveCapture, APPLE_PAY_SOURCE_KEY } = load(path.join(root, 'src/lib/transaction-source.ts'));
const applePayKey = `apple_pay_review_source_${'a'.repeat(32)}`;

test('source is derived only from the row provenance fields', () => {
  assert.equal(transactionSource({}), 'manual', 'rows before `source` existed are by hand');
  assert.equal(transactionSource({ source: 'manual' }), 'manual');
  assert.equal(transactionSource({ source: 'sms' }), 'bank-text');
  assert.equal(transactionSource({ source: 'sms', captureSource: 'shortcut' }), 'bank-text', 'iOS Messages automation is a bank text');
  assert.equal(transactionSource({ source: 'sms', viaPush: true }), 'notification', 'a bank-app alert is not an SMS');
  assert.equal(transactionSource({ source: 'sms', smsKey: applePayKey }), 'apple-pay');
  assert.equal(transactionSource({ source: 'sms', smsKey: applePayKey, walletBound: true }), 'bank-text',
    'a Wallet record confirmed as the same purchase as a bank Message carries the Message identity');
  assert.equal(transactionSource({ source: 'sms', smsKey: 'apple_pay_review_source_short' }), 'bank-text');
  assert.equal(transactionSource({ source: 'sms', captureSource: 'pdf' }), 'statement');
  assert.equal(transactionSource({ captureSource: 'csv' }), 'statement');
  assert.equal(transactionSource({ source: 'sms', viaPush: true, captureSource: 'pdf' }), 'statement', 'statement provenance wins');
  assert.equal(transactionSource({ source: 'sms', captureSource: 'email' }), 'email');
});

test('live capture means bank text, app alert or Apple Pay only', () => {
  assert.equal(isLiveCapture({ source: 'sms' }), true);
  assert.equal(isLiveCapture({ source: 'sms', viaPush: true }), true);
  assert.equal(isLiveCapture({ source: 'sms', smsKey: applePayKey }), true);
  assert.equal(isLiveCapture({ source: 'sms', captureSource: 'csv' }), false);
  assert.equal(isLiveCapture({ source: 'sms', captureSource: 'email' }), false);
  assert.equal(isLiveCapture({ source: 'manual' }), false);
  assert.equal(isLiveCapture({}), false);
});

test('the Apple Pay identity pattern matches the one dedupe uses', () => {
  const dedupe = fs.readFileSync(path.join(root, 'src/lib/dedupe.ts'), 'utf8');
  const match = dedupe.match(/export const APPLE_PAY_REVIEW_SOURCE_KEY = (\/.*\/);/);
  assert.ok(match, 'dedupe.ts still declares APPLE_PAY_REVIEW_SOURCE_KEY');
  assert.equal(match[1], String(APPLE_PAY_SOURCE_KEY));
});
