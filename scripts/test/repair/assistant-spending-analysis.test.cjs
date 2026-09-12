'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const currency = load(path.join(root, 'src/lib/currency-metadata.ts'));
const money = load(path.join(root, 'src/lib/ledger-money.ts'), {
  '@/lib/currency-metadata': currency,
});
const splits = load(path.join(root, 'src/lib/splits.ts'));
const { spendingChangeDrivers } = load(path.join(root, 'src/lib/assistant-spending-analysis.ts'), {
  '@/lib/ledger-money': money,
  '@/lib/splits': splits,
});
const analyze = (current, previous) => JSON.parse(JSON.stringify(spendingChangeDrivers(current, previous)));
const tx = (id, title, amountFils, category = 'dining', extra = {}) => ({
  id, title, amountFils, category, type: 'expense', accountId: 'everyday', date: '2026-09-12', ...extra,
});
const keyed = (rows, key) => rows.find(row => row.key === key);

test('category drivers reconcile split allocations, not the headline category', () => {
  const current = [tx('mixed', 'Market', 10_000, 'groceries', {
    splits: [
      { category: 'groceries', amountFils: 6_000 },
      { category: 'shopping', amountFils: 3_000 },
      { category: 'groceries', amountFils: 1_000 },
    ],
  })];
  const previous = [tx('prior-market', 'Market', 5_000, 'groceries')];
  const result = analyze(current, previous);
  assert.equal(result.currentFils, 10_000);
  assert.equal(result.previousFils, 5_000);
  assert.equal(result.deltaFils, 5_000);
  assert.equal(keyed(result.categoryDrivers, 'groceries').currentFils, 7_000);
  assert.equal(keyed(result.categoryDrivers, 'groceries').currentCount, 1);
  assert.deepEqual(keyed(result.categoryDrivers, 'groceries').currentTransactionIds, ['mixed']);
  assert.deepEqual(keyed(result.categoryDrivers, 'groceries').currentContributionsFils, { mixed: 7_000 });
  assert.deepEqual(keyed(result.categoryDrivers, 'groceries').previousContributionsFils, { 'prior-market': 5_000 });
  assert.equal(keyed(result.categoryDrivers, 'shopping').deltaFils, 3_000);
  assert.equal(money.checkedMinorSum(result.categoryDrivers.map(row => row.deltaFils)), result.deltaFils);
  for (const grouping of [result.categoryDrivers, result.merchantDrivers]) {
    assert.equal(money.checkedMinorSum(grouping.map(row => row.currentFils)), result.currentFils);
    assert.equal(money.checkedMinorSum(grouping.map(row => row.previousFils)), result.previousFils);
    for (const driver of grouping) {
      for (const period of ['current', 'previous']) {
        assert.equal(money.checkedMinorSum(Object.values(driver[`${period}ContributionsFils`])), driver[`${period}Fils`]);
        assert.deepEqual(Object.keys(driver[`${period}ContributionsFils`]), driver[`${period}TransactionIds`]);
        assert.equal(driver[`${period}TransactionIds`].length, driver[`${period}Count`]);
      }
    }
  }
});

test('merchant grouping folds case and outer whitespace while preserving branch identities', () => {
  const current = [tx('coffee-b', '  CAFE  ', 1_000), tx('coffee-a', 'Cafe', 2_000), tx('branch', 'Cafe Mall', 400)];
  const previous = [tx('prior-coffee', 'cafe', 500)];
  const result = analyze(current, previous);
  assert.equal(result.merchantDrivers.length, 2);
  assert.deepEqual(keyed(result.merchantDrivers, 'cafe'), {
    key: 'cafe', displayTitle: 'CAFE', currentFils: 3_000, previousFils: 500,
    deltaFils: 2_500, currentCount: 2, previousCount: 1,
    currentTransactionIds: ['coffee-a', 'coffee-b'], previousTransactionIds: ['prior-coffee'],
    currentContributionsFils: { 'coffee-a': 2_000, 'coffee-b': 1_000 }, previousContributionsFils: { 'prior-coffee': 500 },
  });
  assert.deepEqual(analyze([...current].reverse(), previous), result, 'input order does not affect grouping, labels or proof');
});

test('increases and decreases remain visible even when they cancel overall', () => {
  const result = analyze(
    [tx('new-food', 'Cafe', 400, 'dining'), tx('new-travel', 'Rail', 100, 'transport')],
    [tx('old-food', 'Cafe', 100, 'dining'), tx('old-travel', 'Rail', 400, 'transport')],
  );
  assert.equal(result.deltaFils, 0);
  assert.deepEqual(result.categoryDrivers.map(row => [row.key, row.deltaFils]), [['dining', 300], ['transport', -300]]);
  assert.deepEqual(result.merchantDrivers.map(row => [row.key, row.deltaFils]), [['cafe', 300], ['rail', -300]]);
  assert.equal(result.currentCount, 2);
  assert.equal(result.previousCount, 2);
});

test('appearing and disappearing merchants carry both periods and exact evidence', () => {
  const result = analyze([tx('new', 'New shop', 300, 'shopping')], [tx('old', 'Old shop', 200, 'shopping')]);
  assert.deepEqual(keyed(result.merchantDrivers, 'new shop'), {
    key: 'new shop', displayTitle: 'New shop', currentFils: 300, previousFils: 0, deltaFils: 300,
    currentCount: 1, previousCount: 0, currentTransactionIds: ['new'], previousTransactionIds: [],
    currentContributionsFils: { new: 300 }, previousContributionsFils: {},
  });
  assert.equal(keyed(result.merchantDrivers, 'old shop').currentCount, 0);
  assert.equal(keyed(result.merchantDrivers, 'old shop').previousCount, 1);
  assert.equal(keyed(result.merchantDrivers, 'old shop').deltaFils, -200);
  assert.deepEqual(keyed(result.merchantDrivers, 'old shop').previousTransactionIds, ['old']);
});

test('already weighted rows retain only their selected allocations and original source IDs', () => {
  const result = analyze([tx('split-source', 'Market', 301, 'shopping', {
    splits: [{ category: 'groceries', amountFils: 301 }],
  })], []);
  assert.equal(result.currentFils, 301);
  assert.equal(result.currentCount, 1);
  assert.deepEqual(result.categoryDrivers.map(row => row.key), ['groceries']);
  assert.deepEqual(result.categoryDrivers[0].currentTransactionIds, ['split-source']);
  assert.deepEqual(result.merchantDrivers[0].currentTransactionIds, ['split-source']);
  assert.equal(result.merchantDrivers[0].currentFils, 301);
});

test('split contribution fragments count one source per group without losing their amounts', () => {
  const result = analyze([
    tx('split-source', 'Market', 100, 'groceries'),
    tx('split-source', 'Market', 200, 'groceries'),
    tx('split-source', 'Market', 400, 'shopping'),
  ], []);
  assert.equal(result.currentFils, 700);
  assert.equal(result.currentCount, 1);
  assert.equal(keyed(result.categoryDrivers, 'groceries').currentFils, 300);
  assert.equal(keyed(result.categoryDrivers, 'groceries').currentCount, 1);
  assert.equal(result.merchantDrivers[0].currentCount, 1);
});

test('empty periods and zero contributions have no invented purchases or groups', () => {
  assert.deepEqual(analyze([tx('zero', 'Ignored', 0)], []), {
    currentFils: 0, previousFils: 0, deltaFils: 0, currentCount: 0, previousCount: 0,
    categoryDrivers: [], merchantDrivers: [],
  });
});

test('analysis never mutates transactions or category allocations', () => {
  const row = tx('frozen', ' Shop ', 123, 'other', {
    splits: [Object.freeze({ category: 'dining', amountFils: 23 }), Object.freeze({ category: 'shopping', amountFils: 100 })],
  });
  Object.freeze(row.splits);
  const current = Object.freeze([Object.freeze(row)]);
  const previous = Object.freeze([]);
  const before = JSON.stringify(current);
  assert.equal(analyze(current, previous).currentFils, 123);
  assert.equal(JSON.stringify(current), before);
});

test('JPY and KWD amounts stay in ledger minor units, including changes of one minor unit', () => {
  for (const [code, currentText, previousText, expectedCurrent] of [
    ['JPY', '123', '122', 123], ['KWD', '1.234', '1.233', 1234], ['USD', '12.34', '12.33', 1234],
  ]) {
    const spec = money.ledgerMoneySpec(code);
    const current = money.parseMajorToMinor(currentText, spec);
    const previous = money.parseMajorToMinor(previousText, spec);
    const result = analyze([tx('current', 'Shop', current)], [tx('previous', 'Shop', previous)]);
    assert.equal(result.currentFils, expectedCurrent, code);
    assert.equal(result.deltaFils, 1, code);
    assert.equal(result.categoryDrivers[0].deltaFils, 1, code);
    assert.equal(result.merchantDrivers[0].deltaFils, 1, code);
  }
});

test('safe integer limits preserve one-unit changes and reject unsafe totals', () => {
  const limit = Number.MAX_SAFE_INTEGER;
  const result = analyze([tx('current', 'Shop', limit)], [tx('previous', 'Shop', limit - 1)]);
  assert.equal(result.currentFils, limit);
  assert.equal(result.deltaFils, 1);
  const splitResult = analyze([tx('huge-split', 'Shop', limit, 'groceries', {
    splits: [{ category: 'groceries', amountFils: limit - 1 }, { category: 'shopping', amountFils: 1 }],
  })], [tx('previous', 'Shop', limit - 1, 'groceries')]);
  assert.equal(splitResult.deltaFils, 1);
  assert.equal(keyed(splitResult.categoryDrivers, 'groceries').deltaFils, 0);
  assert.equal(keyed(splitResult.categoryDrivers, 'shopping').deltaFils, 1);
  assert.throws(() => analyze([tx('limit', 'Shop', limit), tx('overflow', 'Other', 1)], []), /safe integer range/);
  for (const amount of [0.5, NaN, Infinity, limit + 1]) {
    assert.throws(() => analyze([tx('invalid', 'Shop', amount)], []), /safe integer range/);
  }
});

test('inconsistent weighted splits and negative amounts cannot produce unreconciled explanations', () => {
  assert.throws(() => analyze([tx('wrong', 'Shop', 100, 'groceries', {
    splits: [{ category: 'groceries', amountFils: 200 }],
  })], []), /allocations.*amount/i);
  assert.throws(() => analyze([tx('negative', 'Shop', -100)], []), /non-negative/);
  assert.throws(() => analyze([tx('negative-split', 'Shop', 100, 'groceries', {
    splits: [{ category: 'groceries', amountFils: 200 }, { category: 'shopping', amountFils: -100 }],
  })], []), /non-negative/);
});
