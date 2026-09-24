'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const { parseIosApplePayRecord } = load(path.join(root, 'src/lib/ios-apple-pay-record.ts'), {
  '@/lib/alert-review-tray': require(path.join(build, 'alert-review-tray.js')),
  '@/lib/ledger-money': require(path.join(build, 'ledger-money.js')),
  '@/lib/universal-types': require(path.join(build, 'universal-types.js')),
});
const id = 'ABCDEF01-2345-4678-9ABC-0123456789AB';
const observedAt = Date.parse('2026-09-23T12:34:56.789Z');
const payload = (amount = '12.34', currency = 'AED', merchant = 'Test Shop') => JSON.stringify({ amount, currency, merchant });
const parse = (amount, currency, merchant) => parseIosApplePayRecord(payload(amount, currency, merchant), id, observedAt);
const refused = (outcome, reason) => {
  assert.equal(outcome.kind, 'refused');
  assert.equal(outcome.reason, reason);
  assert.deepEqual(Object.keys(outcome).sort(), ['kind', 'reason']);
};

test('exact ISO minor-unit conversion produces review-only facts without inventing settlement or dates', () => {
  for (const [amount, currency, minorUnits, exponent] of [['12.34', 'AED', '1234', 2], ['0.01', 'USD', '1', 2],
    ['1.234', 'KWD', '1234', 3], ['120', 'JPY', '120', 0], ['12', 'AED', '1200', 2],
    ['90071992547409.91', 'AED', '9007199254740991', 2]]) {
    const outcome = parse(amount, currency);
    assert.equal(outcome.kind, 'review');
    assert.equal(outcome.item.kind, 'universal');
    assert.equal(outcome.item.channel, 'push');
    assert.equal(outcome.item.observedAt, observedAt);
    assert.deepEqual(JSON.parse(JSON.stringify(outcome.item.event.amount.value)), { currency, minorUnits, exponent });
    assert.equal(outcome.item.event.status, 'unknown');
    assert.equal(outcome.item.event.family, 'purchase');
    assert.equal(outcome.item.event.direction, 'debit');
    assert.equal(outcome.item.event.transactionDate.evidence, 'missing');
    assert.equal(outcome.item.event.instrument.evidence, 'missing');
    assert.equal(outcome.item.event.merchant.value, 'Test Shop');
    assert.equal(outcome.item.event.merchant.evidence, 'explicit');
    assert.equal(Object.hasOwn(outcome, 'row'), false, 'this API cannot return an automatic ledger row');
  }
});

test('negative amounts are outside the supported card-tap scope', () => {
  for (const amount of ['-0.123', '-12', '-0']) {
    refused(parse(amount, 'KWD'), 'invalid-amount');
  }
});

test('missing merchant remains actionable review with no fabricated merchant or card', () => {
  const outcome = parse('9.50', 'AED', '');
  assert.equal(outcome.kind, 'review');
  assert.equal(outcome.item.event.merchant.evidence, 'missing');
  assert.equal(outcome.item.event.merchant.value, null);
  assert.equal(outcome.item.event.instrument.value, null);
});

test('decimal amounts never round, infer a currency or use floating point syntax', () => {
  for (const [amount, currency] of [['1.001', 'AED'], ['1.000', 'USD'], ['1.0001', 'KWD'], ['1.0', 'JPY']]) {
    refused(parse(amount, currency), 'amount-precision');
  }
  for (const amount of ['1e2', 'NaN', 'Infinity', '1,000.00', '1,20', ' 1.00', '+1', '01.00', '.50', '1.', '١٢.٣٤', 12.34]) {
    refused(parse(amount), 'invalid-amount');
  }
  for (const amount of ['0', '0.00', '90071992547409.92', '99999999999999999999999999999999999999']) {
    refused(parse(amount), 'amount-range');
  }
  for (const currency of ['ZZZ', 'XXX', 'BTC', '$', 'aed', ' AED', 'CLF']) {
    refused(parse('1', currency), 'unsupported-currency');
  }
});

test('strict structured payload rejects unknown keys and does not parse arbitrary message or OTP text', () => {
  for (const raw of ['not JSON', 'Your OTP is 123456 for AED 80.00.', '[]', 'null',
    JSON.stringify({ amount: '1', currency: 'AED' }),
    JSON.stringify({ amount: '1', currency: 'AED', merchant: '', cardName: 'Private Card' }),
    JSON.stringify({ amount: '1', currency: 'AED', merchant: '', status: 'posted' }),
    JSON.stringify({ amount: '1', currency: 'AED', merchant: '', date: '2026-09-23' })]) {
    refused(parseIosApplePayRecord(raw, id, observedAt), 'invalid-payload');
  }
  for (const merchant of [' leading', 'trailing ', 'a\nsecret', 'a\u202eb', 'x'.repeat(97), 42]) {
    refused(parse('1', 'AED', merchant), 'invalid-merchant');
  }
});

test('stable opaque UUID identity survives exact queue retry without retained payload', () => {
  const first = parse(); const again = parse();
  assert.equal(first.kind, 'review');
  assert.equal(first.item.id, 'apple_pay_review_id_abcdef01234546789abc0123456789ab');
  assert.equal(first.item.sourceKey, 'apple_pay_review_source_abcdef01234546789abc0123456789ab');
  assert.equal(again.item.id, first.item.id);
  assert.equal(again.item.sourceKey, first.item.sourceKey);
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes(payload()), false);
  for (const forbidden of ['raw', 'sender', 'cardName', 'sourcePackage']) {
    assert.equal(Object.hasOwn(first.item, forbidden), false);
    assert.equal(Object.hasOwn(first.item.event, forbidden), false);
  }
  for (const candidate of ['', 'a'.repeat(64), 'merchant-derived-id']) {
    refused(parseIosApplePayRecord(payload(), candidate, observedAt), 'invalid-identity');
  }
  for (const candidate of [NaN, Infinity, -1, 1.5, 8640000000000000]) {
    refused(parseIosApplePayRecord(payload(), id, candidate), 'invalid-observed-at');
  }
});
