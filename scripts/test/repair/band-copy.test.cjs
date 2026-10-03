'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const { bandCopyTables, bandCopy } = load(path.join(root, 'src/lib/band-copy.ts'));
const { en, ar } = bandCopyTables;
const ARABIC = /[؀-ۿ]/;

test('English and Arabic carry exactly the same keys and kinds', () => {
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof ar[key], typeof en[key], key);
    if (typeof en[key] === 'function') assert.equal(ar[key].length, en[key].length, `${key} arity`);
  }
  assert.equal(bandCopy('ar'), ar);
  assert.equal(bandCopy('en'), en);
  assert.equal(bandCopy('fr'), en, 'anything else reads English');
});

test('every Arabic string is Arabic and every English string is not', () => {
  const sample = (fn) => fn.length === 2 ? fn(3, '32%') : fn(3);
  for (const key of Object.keys(en)) {
    const english = typeof en[key] === 'function' ? sample(en[key]) : en[key];
    const arabic = typeof ar[key] === 'function' ? sample(ar[key]) : ar[key];
    assert.ok(english.trim().length > 0 && !ARABIC.test(english), `${key} en`);
    // A number-only label ("+10" on the timeline axis) has no words to translate.
    const numeric = /^[+\d٠-٩,.٪%]+$/.test(String(arabic));
    assert.ok(ARABIC.test(String(arabic)) || numeric, `${key} ar: ${arabic}`);
  }
});

test('counts agree with their nouns in both languages', () => {
  assert.equal(en.shareOthers(1, '5%'), '1 other category 5%');
  assert.equal(en.shareOthers(5, '32%'), '5 other categories 32%');
  assert.equal(en.lastDays(7), 'Last 7 days');
  assert.equal(en.dueIn(0), 'today');
  assert.equal(en.dueIn(1), 'tomorrow');
  assert.equal(en.dueIn(3), 'in 3 days');
  // Arabic counts use the same digit policy as the rest of the Arabic copy.
  const n = (value) => value.toLocaleString('ar-AE');
  assert.equal(ar.lastDays(7), `آخر ${n(7)} أيام`);
  assert.equal(ar.lastDays(30), `آخر ${n(30)} يوماً`);
  assert.equal(ar.lastDays(2), 'آخر يومين');
  assert.equal(ar.dueIn(1), 'غداً');
  assert.equal(ar.dueIn(11), `بعد ${n(11)} يوماً`);
  assert.equal(ar.shareOthers(2, '9%'), 'فئتان أخريان 9%');
  assert.equal(ar.percent(34), `${n(34)}٪`);
  assert.equal(en.lower('AED 25'), 'Lower by AED 25');
});
