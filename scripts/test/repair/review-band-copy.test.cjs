'use strict';
// Copy for the checking screens in design language E (Transfers, the transfer
// queue, Improve categories): English/Arabic parity and the counted phrases.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const { reviewBandCopyTables, reviewBandCopy } = load(path.join(root, 'src/lib/review-band-copy.ts'));
const { en, ar } = reviewBandCopyTables;
const ARABIC = /[؀-ۿ]/;
const sample = (fn) => fn.length === 0 ? fn() : typeof fn(1) === 'string' && fn.toString().includes('entries')
  ? fn('7 entries') : `${fn(1)} ${fn(2)} ${fn(11)}`;

test('English and Arabic carry exactly the same keys and kinds', () => {
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof ar[key], typeof en[key], key);
    if (typeof en[key] === 'function') assert.equal(ar[key].length, en[key].length, `${key} arity`);
  }
  assert.equal(reviewBandCopy('ar'), ar);
  assert.equal(reviewBandCopy('en'), en);
  assert.equal(reviewBandCopy(undefined), en, 'anything else reads English');
});

test('every Arabic string is Arabic and every English string is not', () => {
  for (const key of Object.keys(en)) {
    const english = typeof en[key] === 'function' ? sample(en[key]) : en[key];
    const arabic = typeof ar[key] === 'function' ? sample(ar[key]) : ar[key];
    assert.ok(english.trim().length > 0 && !ARABIC.test(english), `${key} en`);
    assert.ok(ARABIC.test(arabic), `${key} ar`);
  }
});

test('counted phrases read naturally in both languages', () => {
  assert.equal(en.toCheck(2), '2 to check');
  assert.equal(en.namesToPlace(1), '1 name to place');
  assert.equal(en.namesToPlace(3), '3 names to place');
  // Arabic puts the count after a colon, so no noun needs a plural form.
  assert.equal(ar.toCheck(2), 'للمراجعة: 2');
  assert.equal(ar.namesToPlace(11), 'أسماء تحتاج تصنيفاً: 11');
  // The entries count arrives already pluralised (detailsCopy.entries).
  assert.match(en.placeLine('7 entries'), /move their 7 entries/);
  assert.match(ar.placeLine('7 عمليات'), /7 عمليات/);
  assert.equal(en.entriesMoved('1 entry'), '1 entry will move');
});
