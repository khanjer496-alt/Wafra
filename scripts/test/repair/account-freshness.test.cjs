'use strict';
// How old a bank-reported balance is. Synthetic timestamps only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const { accountFreshness, QUIET_AFTER_DAYS } = load(path.join(__dirname, '../../../src/lib/account-freshness.ts'), {});
const now = new Date(2026, 8, 25, 21, 0);
const at = (y, m, d, h = 9, min = 41) => new Date(y, m, d, h, min).getTime();

test('same local day shows the time of the bank alert', () => {
  assert.deepEqual({ ...accountFreshness(at(2026, 8, 25), now, 'en') }, { label: 'Bank alert · today 09:41', quiet: false });
});

test('yesterday and a few days ago are plain words, not dates', () => {
  assert.equal(accountFreshness(at(2026, 8, 24, 23, 59), now, 'en').label, 'Bank alert · yesterday');
  assert.equal(accountFreshness(at(2026, 8, 23), now, 'en').label, 'Bank alert · 2 days ago');
});

test('two weeks without a bank alert is marked quiet', () => {
  const before = accountFreshness(at(2026, 8, 25 - (QUIET_AFTER_DAYS - 1)), now, 'en');
  const after = accountFreshness(at(2026, 8, 25 - QUIET_AFTER_DAYS), now, 'en');
  assert.equal(before.quiet, false);
  assert.equal(after.quiet, true);
  assert.equal(after.label, `No bank alert for ${QUIET_AFTER_DAYS} days`);
});

test('days are counted by calendar day, not 24-hour blocks', () => {
  // 23:59 yesterday and 00:01 today are one calendar day apart.
  const early = new Date(2026, 8, 25, 0, 1);
  assert.equal(accountFreshness(at(2026, 8, 24, 23, 59), early, 'en').label, 'Bank alert · yesterday');
});

test('a timestamp from the future never reads as negative', () => {
  assert.equal(accountFreshness(at(2026, 8, 26), now, 'en').label.startsWith('Bank alert · today'), true);
});

test('Arabic wording is Arabic', () => {
  for (const ts of [at(2026, 8, 25), at(2026, 8, 24), at(2026, 8, 20), at(2026, 7, 1)]) {
    assert.match(accountFreshness(ts, now, 'ar').label, /[؀-ۿ]/);
  }
});
