'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const { motionAndroidCopyTables, motionAndroidCopy } = load(path.join(root, 'src/lib/motion-android-copy.ts'), {
  '@/lib/i18n': { getLanguage: () => 'en' },
});
const { en, ar } = motionAndroidCopyTables;
const ARABIC = /[؀-ۿ]/;

test('English and Arabic carry exactly the same keys and kinds', () => {
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof ar[key], typeof en[key], key);
    if (typeof en[key] === 'function') assert.equal(ar[key].length, en[key].length, `${key} arity`);
  }
});

test('every Arabic string is Arabic and every English string is not', () => {
  const sample = (fn) => fn('Starbucks', 'Dining', 'USD 6.75');
  for (const key of Object.keys(en)) {
    const english = typeof en[key] === 'function' ? sample(en[key]) : en[key];
    const arabic = typeof ar[key] === 'function' ? sample(ar[key]) : ar[key];
    assert.equal(typeof english, 'string', key);
    assert.ok(english.trim().length > 0 && !ARABIC.test(english), `${key} en`);
    assert.ok(ARABIC.test(String(arabic)), `${key} ar`);
  }
});

test('counted nouns agree with the count in both languages', () => {
  assert.equal(en.importPromosSpoken(1), '1 promotional message skipped');
  assert.equal(en.importPromosSpoken(64), '64 promotional messages skipped');
  assert.equal(en.importPercent(72), '72%');
  assert.equal(ar.importPercent(72), `${(72).toLocaleString('ar-AE')}٪`,
    'the ring uses the same digit policy as the Arabic counts beside it');
  assert.equal(en.importPercentOf(1284), 'of 1,284 messages');
  assert.equal(en.importPercentOf(1), 'of 1 message');
  assert.equal(ar.importPercentOf(1), 'من أصل رسالة واحدة');
  assert.equal(ar.importPercentOf(2), 'من أصل رسالتان');
  assert.match(ar.importPercentOf(5), /رسائل$/);
  assert.match(ar.importPercentOf(11), /رسالة$/);
  assert.match(ar.importPercentOf(103), /رسائل$/, '103 takes the 3–10 form');
  assert.equal(ar.importPromosSpoken(0), 'لم يتم تخطي أي عرض ترويجي');
  assert.match(ar.importPromosSpoken(1), /عرض ترويجي واحد/);
  assert.match(ar.importPromosSpoken(2), /عرضان ترويجيان/);
  assert.match(ar.importPromosSpoken(4), /عروض ترويجية/);
  assert.match(ar.importPromosSpoken(20), /عرضاً ترويجياً/);
});

test('the capture line names the merchant and category, the spoken line adds the amount', () => {
  assert.equal(en.captureAdded('Starbucks', 'Dining'), 'Starbucks added · Dining');
  assert.equal(en.captureAddedSpoken('Starbucks', 'Dining', 'USD 6.75'), 'Starbucks added to Dining, USD 6.75');
  assert.match(ar.captureAddedSpoken('ستاربكس', 'مطاعم', 'USD 6.75'), /USD 6\.75/);
});

test('the table follows the requested language', () => {
  assert.equal(motionAndroidCopy('ar'), ar);
  assert.equal(motionAndroidCopy('en'), en);
  assert.equal(motionAndroidCopy(), en, 'defaults to the app language');
});
