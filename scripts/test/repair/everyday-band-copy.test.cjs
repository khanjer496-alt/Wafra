'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const { everydayBandCopyTables, everydayBandCopy } = load(path.join(root, 'src/lib/everyday-band-copy.ts'));
const { en, ar } = everydayBandCopyTables;
const ARABIC = /[؀-ۿ]/;

const sample = (fn) => {
  if (fn.length === 3) return fn('AED 640', 'Aug 2026', true) + fn('AED 640', 'Aug 2026', false);
  if (fn.length === 2) return typeof fn('x', true) === 'string' && fn.toString().includes('partial')
    ? fn('Aug 2026', true) + fn('Aug 2026', false) : fn(25, 30);
  return fn.length === 1 ? String(fn(25)) + String(fn(1)) : fn();
};

test('English and Arabic carry exactly the same keys and kinds', () => {
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof ar[key], typeof en[key], key);
    if (typeof en[key] === 'function') assert.equal(ar[key].length, en[key].length, `${key} arity`);
  }
  assert.equal(everydayBandCopy('ar'), ar);
  assert.equal(everydayBandCopy('en'), en);
  assert.equal(everydayBandCopy('fr'), en, 'anything else reads English');
});

test('every Arabic string is Arabic and every English string is not', () => {
  for (const key of Object.keys(en)) {
    const english = typeof en[key] === 'function' ? sample(en[key]) : en[key];
    const arabic = typeof ar[key] === 'function' ? sample(ar[key]) : ar[key];
    assert.ok(english.trim().length > 0 && !ARABIC.test(english), `${key} en`);
    assert.ok(ARABIC.test(arabic), `${key} ar`);
  }
});

test('Compare sentences keep the amount whole and isolate it in Arabic', () => {
  assert.equal(en.compareMore('AED 640', 'Aug 2026', true), 'AED 640 more than by this point in Aug 2026');
  assert.equal(en.compareLess('AED 12.50', 'Aug 2026', false), 'AED 12.50 less than in Aug 2026');
  assert.equal(en.compareSame('Aug 2026', true), 'About the same as by this point in Aug 2026');
  // The figure reads left to right inside the Arabic sentence.
  assert.match(ar.compareMore('AED 640', 'أغسطس', true), /^⁦AED 640⁩ /);
  assert.match(ar.compareLess('AED 640', 'أغسطس', false), /^⁦AED 640⁩ /);
  assert.equal(en.compareWindow(1), 'Day 1 of each month');
  assert.equal(en.compareWindow(25), 'Days 1–25 of each month');
  assert.equal(en.dayOf(25, 30), 'Day 25 of 30');
  assert.equal(en.shareNoLimit('16%'), '16% of spending · no limit');
});
