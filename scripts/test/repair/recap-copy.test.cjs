'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const detailsCopy = load(path.join(root, 'src/lib/details-copy.ts'));
const { recapCopy, recapWords } = load(path.join(root, 'src/lib/recap-copy.ts'), { '@/lib/details-copy': detailsCopy });
const { en, ar } = recapCopy;
const ARABIC = /[؀-ۿ]/;

const SAMPLES = {
  position: (fn) => fn(2, 7),
  coverTitle: (fn) => fn('Naser', 'August 2026') + fn(null, 'August 2026'),
  spentLess: (fn) => fn(9, 'July 2026'),
  spentMore: (fn) => fn(9, 'July 2026'),
  spentSame: (fn) => fn('July 2026'),
  paymentsCount: (fn) => `${fn(1)} ${fn(2)} ${fn(14)}`,
  timeHeadline: (fn) => fn('X'),
  timedBase: (fn) => `${fn(1)} ${fn(237)}`,
  timeBar: (fn) => fn('X', 3),
  busiest: (fn) => fn('X'),
  dayShort: (fn) => [0, 1, 2, 3, 4, 5, 6].map(fn).join(' '),
};
const sample = (key, fn) => {
  assert.ok(SAMPLES[key], `no sample for ${key}`);
  return SAMPLES[key](fn);
};

test('English and Arabic carry exactly the same keys and kinds', () => {
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof ar[key], typeof en[key], key);
    if (typeof en[key] === 'function') assert.equal(ar[key].length, en[key].length, `${key} arity`);
  }
  assert.equal(recapWords('ar'), ar);
  assert.equal(recapWords('en'), en);
  assert.equal(recapWords('fr'), en, 'anything else reads English');
});

test('every Arabic string is Arabic and every English string is not', () => {
  for (const key of Object.keys(en)) {
    const english = typeof en[key] === 'function' ? sample(key, en[key]) : en[key];
    const arabic = typeof ar[key] === 'function' ? sample(key, ar[key]) : ar[key];
    assert.ok(english.trim().length > 0 && !ARABIC.test(english), `${key} en`);
    assert.ok(ARABIC.test(arabic), `${key} ar`);
  }
});

test('counts agree in number in both languages', () => {
  assert.equal(en.paymentsCount(1), '1 payment');
  assert.equal(en.paymentsCount(14), '14 payments');
  assert.equal(ar.paymentsCount(1), 'دفعة واحدة');
  assert.equal(ar.paymentsCount(2), 'دفعتان');
  assert.equal(ar.paymentsCount(5), '5 دفعات');
  assert.equal(ar.paymentsCount(14), '14 دفعة');
  assert.equal(ar.paymentsCount(100), '100 دفعة');
  assert.equal(en.timeBar('Evening', 1), 'Evening: 1 payment');
  assert.equal(ar.timeBar('المساء', 2), 'المساء: دفعتان');
});

test('the time-of-day caption states its base: payments that had a time', () => {
  assert.equal(en.timedBase(237), 'Of 237 payments that had a time.');
  assert.equal(en.timedBase(1), 'Of 1 payment that had a time.');
  assert.match(ar.timedBase(237), /237/);
  assert.equal(en.timeHeadline('Evening'), 'Evening had the most payments');
});

test('the cover names the person and says the comparison plainly', () => {
  assert.equal(en.coverTitle('Naser', 'August 2026'), 'Naser’s August 2026');
  assert.equal(en.coverTitle(null, 'August 2026'), 'Your August 2026');
  assert.equal(en.spentLess(9, 'July 2026'), 'spent, 9% less than July 2026');
  assert.equal(en.spentMore(12, 'July 2026'), 'spent, 12% more than July 2026');
  assert.equal(en.spentSame('July 2026'), 'spent, about the same as July 2026');
  assert.match(ar.coverTitle('ناصر', 'أغسطس 2026'), /ناصر/);
});

test('weekday labels are distinct in both languages', () => {
  for (const words of [en, ar]) {
    const days = [0, 1, 2, 3, 4, 5, 6].map(words.dayShort);
    assert.equal(new Set(days).size, 7);
    assert.ok(days.every((day) => day.length > 0));
  }
});
