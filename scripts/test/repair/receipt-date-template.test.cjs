'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const test = require('node:test');
const load = require('./load-typescript.cjs');

// Always transpile actual source, including pure dependencies, before testing.
const cache = new Map();
function source(name) {
  if (cache.has(name)) return cache.get(name);
  const file = path.resolve(__dirname, '../../../src/lib', `${name}.ts`);
  const dependencies = {};
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)) {
    const target = match[1].slice('@/lib/'.length);
    // Type-only dependencies do not execute and can have UI-only imports.
    if (target !== 'types') dependencies[match[1]] = source(target);
  }
  const api = load(file, dependencies);
  cache.set(name, api);
  return api;
}
const { parseSms } = source('sms-parser');
// Date-only mutations of the real redacted ADIB template in parser.test.js.
const receipt = date => `Dear Customer, your payment of AED 42.10 on ${date} for card ending with **1234 has been credited. Thank you.`;
const jan10 = Date.parse('2021-01-10T12:00:00Z');

test('unknown sender requires original received day for both ambiguous receipts', () => {
  for (const [rawDate, observedAt, date, previous] of [
    ['01/10/2021', jan10, '2021-01-10', '2021-10-01'],
    ['09/08/2020', Date.parse('2020-09-08T12:00:00Z'), '2020-09-08', '2020-08-09'],
  ]) {
    for (const sender of [undefined, 'Unknown Sender']) {
      const original = parseSms(receipt(rawDate));
      const corrected = parseSms(receipt(rawDate), undefined, { sender, observedAt });
      assert.equal(original.date, previous);
      assert.equal(corrected.date, date);
      assert.equal(corrected.dateRepairFrom, previous);
      const { date: ignoredDate, dateRepairFrom, ...rest } = corrected;
      assert.deepEqual(rest, Object.fromEntries(Object.entries(original).filter(([key]) => key !== 'date')));
    }
  }
});

test('confirmed ADIB sender supports a backdated receipt independently of arrival', () => {
  for (const observedAt of [undefined, Date.parse('2021-02-17T12:00:00Z')]) {
    const result = parseSms(receipt('01/10/2021'), undefined, { sender: 'ADIB', observedAt });
    assert.equal(result.date, '2021-01-10');
    assert.equal(result.dateRepairFrom, '2021-10-01');
  }
});

test('another known sender cannot borrow the ADIB template date order', () => {
  for (const sender of ['ENBD', 'RAKBANK', 'Mashreq']) {
    const result = parseSms(receipt('01/10/2021'), undefined, { sender, observedAt: jan10 });
    assert.equal(result.date, '2021-10-01', sender);
    assert.equal(result.dateRepairFrom, undefined);
  }
});

test('known Saudi senders cannot become unknown under the active UAE market', () => {
  assert.equal(source('markets').getActiveMarket().id, 'AE');
  for (const sender of ['AlRajhi', 'SNB']) {
    const result = parseSms(receipt('01/10/2021'), undefined, { sender, observedAt: jan10 });
    assert.equal(result.date, '2021-10-01', sender);
    assert.equal(result.dateRepairFrom, undefined);
  }
});

test('mixed known sender identities cannot authorize the ADIB correction', () => {
  for (const sender of ['ADIB SNB', 'ADIB ENBD']) {
    for (const observedAt of [undefined, jan10]) {
      const result = parseSms(receipt('01/10/2021'), undefined, { sender, observedAt });
      assert.equal(result.date, '2021-10-01', sender);
      assert.equal(result.dateRepairFrom, undefined);
    }
  }
});

test('Saudi currency template under the Saudi market never inherits ADIB date order', () => {
  const markets = source('markets');
  const previous = markets.getActiveMarket().id;
  try {
    markets.setActiveMarket('SA');
    const raw = receipt('01/10/2021').replace('AED', 'SAR');
    for (const sender of [undefined, 'Unknown Sender', 'ADIB', 'AlRajhi', 'SNB']) {
      const result = parseSms(raw, undefined, { sender, observedAt: jan10 });
      assert.equal(result.kind, 'cardPayment');
      assert.equal(result.date, '2021-10-01', sender);
      assert.equal(result.dateRepairFrom, undefined);
    }
  } finally {
    markets.setActiveMarket(previous);
  }
});

test('unknown sender with absent, invalid or nonmatching received time stays unchanged', () => {
  for (const observedAt of [undefined, NaN, Infinity, -Infinity, 9e15, '2021-01-10', null, 0, Date.parse('2021-01-11T12:00:00Z')]) {
    const result = parseSms(receipt('01/10/2021'), undefined, { observedAt });
    assert.equal(result.date, '2021-10-01');
    assert.equal(result.dateRepairFrom, undefined);
  }
});

test('corroboration uses UAE midnight and never the device timezone', () => {
  const before = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      assert.equal(parseSms(receipt('01/10/2021'), undefined, { observedAt: Date.parse('2021-01-09T20:00:00Z') }).date, '2021-01-10');
      assert.equal(parseSms(receipt('01/10/2021'), undefined, { observedAt: Date.parse('2021-01-09T19:59:59.999Z') }).date, '2021-10-01');
    }
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});

test('unambiguous MDY and symmetric numeric dates need no repair marker', () => {
  for (const [input, expected] of [['7/29/2020', '2020-07-29'], ['01/01/2021', '2021-01-01']]) {
    const result = parseSms(receipt(input), undefined, { sender: 'ADIB' });
    assert.equal(result.date, expected);
    assert.equal(result.dateRepairFrom, undefined);
  }
});

test('invalid MDY calendar days never roll over or displace an existing date', () => {
  for (const input of ['02/30/2021', '02/29/2021', '13/10/2021', '00/10/2021']) {
    const original = parseSms(receipt(input));
    const contextual = parseSms(receipt(input), undefined, { sender: 'ADIB', observedAt: jan10 });
    assert.equal(contextual?.date, original?.date);
    assert.equal(contextual?.dateRepairFrom, undefined);
  }
});

test('ISO and named-date variants do not gain a repair marker or change behavior', () => {
  for (const input of ['2021-01-10', '10 Jan 2021', 'Jan 10, 2021']) {
    assert.deepEqual(parseSms(receipt(input), undefined, { sender: 'ADIB', observedAt: jan10 }), parseSms(receipt(input), undefined, { sender: 'ADIB' }));
  }
});

test('purchase, ordinary receipt and statement dates retain generic day-month order', () => {
  for (const raw of [
    'Purchase of AED 42.10 with Credit Card ending 1234 at CARREFOUR on 01/10/2021.',
    'Payment of AED 42.10 received for your Credit Card ending 1234 on 01/10/2021.',
    'Emirates NBD Credit Card Mini Stmt for Card ending 8575: Statement date 28/12/20. Total Amt Due AED 4061.96, Due Date 01/10/21. Min Amt Due AED 203.10',
  ]) {
    const original = parseSms(raw, undefined, { sender: 'ADIB' });
    assert.ok(original);
    assert.deepEqual(parseSms(raw, undefined, { sender: 'ADIB', observedAt: jan10 }), original);
    assert.equal(original.date, '2021-10-01');
    assert.equal(original.dateRepairFrom, undefined);
  }
});

test('an earlier separate message date is not silently overwritten', () => {
  const raw = `Recorded on 03/04/2021. ${receipt('01/10/2021')}`;
  const result = parseSms(raw, undefined, { sender: 'ADIB', observedAt: jan10 });
  assert.equal(result.date, '2021-04-03');
  assert.equal(result.dateRepairFrom, undefined);
});
