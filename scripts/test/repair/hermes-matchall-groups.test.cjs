'use strict';
// Hermes (the Android app's engine; reproduced with the Hermes v0.13.0 CLI) returns String.prototype.matchAll results
// WITHOUT named groups: `"ab".matchAll(/(?<x>a)/g)` yields a match whose `.groups` is undefined, while
// `RegExp.prototype.exec` on the same pattern has `{ x: "a" }`. Node has both. On App QA's diagnostic build F (versionCode
// 402), the synthetic corpus N13 "ADCB: Your account balance is AED 12,345.67 as on 13/11/2026." therefore lost its
// balance role on the device (family unknown, amount-role-unresolved) while every Node test passed.
// This file emulates Hermes's matchAll before the parser loads, so the parser must not depend on matchAll groups.
// Synthetic bodies only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nativeMatchAll = String.prototype.matchAll;
// eslint-disable-next-line no-extend-native
String.prototype.matchAll = function hermesMatchAll(pattern) {
  const iterator = nativeMatchAll.call(this, pattern);
  return (function* withoutGroups() {
    for (const match of iterator) {
      match.groups = undefined;
      yield match;
    }
  })();
};

const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
const { inspectGenericBankEventForReview } = load('@/lib/launch-alert-parser');
country.setActiveCountry('AE');
markets.setActiveMarket('AE');
markets.setLedgerCurrency('AED', 2);

const money = (field) => (field?.value ? `${field.value.currency} ${field.value.minorUnits}` : field?.evidence ?? 'none');

test('the emulation drops matchAll groups and keeps exec groups, as Hermes does', () => {
  assert.equal([...'ab'.matchAll(/(?<x>a)/g)][0].groups, undefined);
  assert.deepEqual({ ...(/(?<x>a)/g.exec('ab').groups) }, { x: 'a' });
});

test('N13: an account balance keeps its balance role without matchAll groups (universal and review readers)', () => {
  const body = 'ADCB: Your account balance is AED 12,345.67 as on 13/11/2026.';
  for (const event of [inspectUniversalBankEvent(body, { sender: 'ADCB' }), inspectGenericBankEventForReview(body, 'ADCB')]) {
    assert.equal(event.family, 'balance');
    assert.equal(event.status, 'informational');
    assert.equal(event.direction, 'none');
    assert.equal(money(event.balance), 'AED 1234567');
    assert.equal(money(event.amount), 'missing');
    assert.ok(!event.issues.includes('amount-role-unresolved'), JSON.stringify(event.issues));
  }
});

test('other labelled figures keep their roles without matchAll groups', () => {
  const purchase = inspectUniversalBankEvent(
    'Your card ending 1234 was charged AED 50.00 at NOON on 12/11/2026. Available balance AED 1,000.00.', { sender: 'ADCB' });
  assert.equal(money(purchase.amount), 'AED 5000');
  assert.equal(money(purchase.balance), 'AED 100000');
  const statement = inspectUniversalBankEvent(
    'Your credit card statement: total due AED 2,000.00, minimum due AED 100.00, due by 20/11/2026.', { sender: 'ADCB' });
  assert.equal(money(statement.statementTotal), 'AED 200000');
  assert.equal(money(statement.minimumDue), 'AED 10000');
});

test('no parser module reads named groups from a matchAll result', () => {
  const dir = path.resolve(__dirname, '../../../src/lib');
  const offenders = [];
  for (const name of fs.readdirSync(dir).filter((file) => /\.tsx?$/.test(file))) {
    const lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!/\.matchAll\(/.test(line)) return;
      const window = lines.slice(index, index + 4).join('\n');
      if (/\.groups\b|\{\s*groups\s*[,}]/.test(window)) offenders.push(`${name}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'read named groups with RegExp.prototype.exec (execAll), not String.prototype.matchAll');
});
