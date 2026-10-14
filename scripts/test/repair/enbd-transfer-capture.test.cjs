'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const { parseSms } = load('@/lib/sms-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const markets = load('@/lib/markets');
const rows = require('../fixtures/enbd-transfer-capture.js');
const { constant, patternSource } = require('../kotlin-source.js');
const { createReader } = require('../instant-alert-reader.cjs');
const CUR_AR = constant('InstantAlert', 'CUR_AR'), CUR = constant('InstantAlert', 'CUR', { CUR_AR });
const names = ['UNSAFE_TRANSACTION_RE', 'PURCHASE_PREFIX_RE', 'PROMO_FOOTER_RE', 'REFUSE_RE', 'CREDIT_RE', 'DEBIT_RE', 'AMOUNT_RE', 'LAST4_RE', 'MERCHANT_RE', 'PAYMENT_MERCHANT_RE', 'BANK_WORD_RE'];
const native = createReader(Object.fromEntries(names.map(name => [name, new RegExp(patternSource('InstantAlert', name, { CUR, CUR_AR }), 'i')]))).read;
for (const [index, row] of rows.entries()) test(`ENBD transfer ${index}: parser and native notification preserve principal/direction`, () => {
  const parsed = parseSms(row.body, {});
  assert.equal(parsed?.kind, 'transaction');
  assert.equal(parsed.type, row.type);
  assert.equal(parsed.amountFils, row.minor);
  assert.equal(parsed.snapshotFils, row.balance);
  const preview = native(row.body);
  assert.ok(preview);
  assert.equal(preview.credit, row.type === 'income');
  assert.equal(Number(preview.figure.replace(/[,.]/g, '')), row.minor);
  if (index !== 1) assert.equal(parsed.card, null, 'separated visible fragments cannot invent a last-four');
});
test('senderless iPhone History retains both same-amount opposite transfer legs', () => {
  markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
  const reader = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' });
  const now = Date.parse('2026-10-13T12:00:00Z');
  const records = rows.map((row, i) => JSON.stringify({ v: 1, id: String(i + 1).repeat(64), text: row.body, receivedAt: new Date(now + i * 1000).toISOString() }));
  const result = parseHistoricalMessageRecords(records, {}, new Date(now + 5000), new Set(), reader);
  assert.equal(result.parsed.length, 4);
  assert.deepEqual(result.parsed.map(p => [p.type, p.amountFils]), rows.map(r => [r.type, r.minor]));
});
for (const body of [
  'If AED 1,714.50 has been transferred to your account 202XXX55XXX02.',
  'AED 1,714.50 has not been transferred to your account 202XXX55XXX02.',
  'AED 1,714.50 will be transferred to your account 202XXX55XXX02.',
  'Your balance AED 8,500.00. Transfer request awaiting confirmation.',
  'OTP 123456: AED 1,714.50 has been transferred to your account 202XXX55XXX02.',
]) test(`unsupported/credential transfer has no native Wafra banner: ${body.slice(0, 25)}`, () => assert.equal(native(body), null));

for (const body of [
  'I spent AED 50.00 at Carrefour today.',
  'Hi Ann, I have just spent USD 50.00 at Example Market.',
  'Hello, I have already spent EUR 50.00 at Example Market.',
  "Hey, I've just spent SAR 50.00 at Example Market.",
  'أنا دفعت 50.00 درهم اليوم.',
]) test(`personal conversation has no native Wafra banner: ${body.slice(0, 28)}`, () => assert.equal(native(body), null));

for (const body of [
  "AED 24.86 has not been debited from your account ending 4421.",
  "USD 24.86 has not been credited to your account ending 4421.",
  "Dear Customer, AED 24.86 wasn’t deducted from your account ending 4421.",
  "AED 24.86 has not been transferred to your account ending 4421.",
  "EUR 24.86 has not been refunded to your card ending 4421.",
  "AED 24.86 hasn’t been deposited to your account ending 4421."
]) test(`negated principal has no native banner: ${body.slice(0, 25)}`, () => assert.equal(native(body), null));
