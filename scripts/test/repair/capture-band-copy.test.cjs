'use strict';
// Words and the pure time helper behind the capture / import screens in
// design language E.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const { captureBandCopyTables, captureBandCopy } = load(path.join(root, 'src/lib/capture-band-copy.ts'));
const health = load(path.join(root, 'src/lib/ios-capture-health.ts'));
const { handledTimeParts } = load(path.join(root, 'src/lib/capture-band.ts'), { '@/lib/ios-capture-health': health });
const { en, ar } = captureBandCopyTables;
const ARABIC = /[؀-ۿ]/;
const sample = (fn) => fn.length === 2 ? fn(1, true) + fn(2, false) : fn();

test('English and Arabic carry exactly the same keys and kinds', () => {
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof ar[key], typeof en[key], key);
    if (typeof en[key] === 'function') assert.equal(ar[key].length, en[key].length, `${key} arity`);
  }
  assert.equal(captureBandCopy('ar'), ar);
  assert.equal(captureBandCopy('en'), en);
  assert.equal(captureBandCopy('fr'), en, 'anything else reads English');
});

test('every Arabic string is Arabic and every English string is not', () => {
  for (const key of Object.keys(en)) {
    const english = typeof en[key] === 'function' ? sample(en[key]) : en[key];
    const arabic = typeof ar[key] === 'function' ? sample(ar[key]) : ar[key];
    assert.ok(english.trim().length > 0 && !ARABIC.test(english), `${key} en`);
    assert.ok(ARABIC.test(arabic), `${key} ar`);
  }
  assert.equal(en.step(1, true), 'Step 1, done');
  assert.equal(en.step(2, false), 'Step 2');
});

test('the handled time comes only from a real receipt, with today / yesterday / a date', () => {
  const now = new Date(2026, 8, 25, 12, 0).getTime();
  const words = { today: en.today, yesterday: en.yesterday };
  for (const missing of [null, NaN, -1, Infinity, '1720000000000']) {
    assert.equal(handledTimeParts(missing, now, 'en', words), null, String(missing));
  }
  const today = handledTimeParts(new Date(2026, 8, 25, 9, 41).getTime(), now, 'en', words);
  assert.equal(today.time, '09:41');
  assert.equal(today.day, 'Today');
  assert.equal(handledTimeParts(new Date(2026, 8, 24, 23, 5).getTime(), now, 'en', words).day, 'Yesterday');
  assert.match(handledTimeParts(new Date(2026, 8, 20, 8, 0).getTime(), now, 'en', words).day, /^20 Sep/);
  const arabic = handledTimeParts(new Date(2026, 8, 25, 9, 41).getTime(), now, 'ar', { today: ar.today, yesterday: ar.yesterday });
  assert.equal(arabic.day, 'اليوم');
  assert.ok(arabic.time.length > 0);
});
