'use strict';
// Independent, synthetic accounting review of the actual merchant projection.
// No live ledger, inbox or native service is accessed by these tests.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const load = require('./load-typescript.cjs');
const ledger = require('../build/ledger.js');
const period = require('../build/period.js');
const money = require('../build/ledger-money.js');
const format = require('../build/format.js');
const { topMerchants } = require('../build/analytics.js');
const root = path.resolve(__dirname, '../../..');
const { merchantSpendingKey, merchantSpendingHref, projectMerchantSpending } = load(
  path.join(root, 'src/lib/merchant-spending.ts'), {
    '@/lib/ledger': ledger, '@/lib/period': period, '@/lib/ledger-money': money,
  },
);

const accounts = [
  { id: 'bank', kind: 'bank', name: 'Synthetic bank', openingFils: 0 },
  { id: 'card', kind: 'card', name: 'Synthetic card', openingFils: 0 },
  { id: 'hidden', kind: 'bank', name: 'Hidden bank', openingFils: 0, archived: true },
];
const tx = (id, amountFils, fields = {}) => ({
  id, title: 'Cedar Cafe', date: '2026-09-05', type: 'expense',
  accountId: 'bank', source: 'manual', category: 'dining', amountFils, ...fields,
});
const september = { mode: 'month', key: '2026-09' };
function project(rows, merchant = 'Cedar Cafe', scope = september, sources = accounts) {
  return projectMerchantSpending(rows, merchant, scope,
    ledger.liveAccountIds(sources), ledger.internalTransferIds(rows, sources));
}
const plain = value => JSON.parse(JSON.stringify(value));

test('merchant identity agrees with existing totals without fuzzy brand/logo grouping', () => {
  assert.equal(merchantSpendingKey('  CEDAR Cafe  '), 'cedar cafe');
  const rows = [tx('a', 1050), tx('b', 2225, { title: ' CEDAR CAFE ' }),
    tx('c', 9900, { title: 'Cedar Cafe Catering' }), tx('d', 8750, { title: 'Cedar Cafeteria' })];
  const result = project(rows);
  assert.equal(result.totalFils, 3275);
  assert.deepEqual(plain(result.spending.map(row => row.id)).sort(), ['a', 'b']);
  const existing = topMerchants(rows, september, 20, ledger.liveAccountIds(accounts), new Set());
  assert.equal(existing.find(row => merchantSpendingKey(row.title) === 'cedar cafe').totalFils, result.totalFils);
  assert.equal(project([tx('apple', 500, { title: 'Apple' }),
    tx('pineapple', 900, { title: 'Pineapple Cafe' })], 'Apple').totalFils, 500);
});

test('merchant spending excludes credits, flagged transfers, hidden and missing accounts', () => {
  const rows = [tx('expense', 8950), tx('second', 1240, { accountId: 'card' }),
    tx('credit', 4260, { type: 'income', category: 'other' }),
    tx('transfer', 70000, { isTransfer: true }),
    tx('repayment', 180000, { isTransfer: true, type: 'income', accountId: 'card' }),
    tx('hidden', 90000, { accountId: 'hidden' }),
    tx('orphaned', 3200, { accountId: 'missing' })];
  const result = project(rows);
  assert.equal(result.totalFils, 10190);
  assert.equal(result.receivedFils, 4260, 'incoming money must not silently reduce spending');
  assert.equal(result.spending.length, 2);
  assert.equal(result.excludedCount, 4);
  assert.equal(result.activity.length, 7, 'All activity keeps excluded records available for inspection');
});

test('both legs of inferred transfers remain excluded even when the sending account is hidden', () => {
  const rows = [tx('outgoing', 20000, { title: 'Outgoing transfer', accountId: 'hidden', isTransfer: true }),
    tx('incoming', 20000, { title: 'Incoming transfer', type: 'income', category: 'other' })];
  const result = project(rows, 'Incoming transfer');
  assert.equal(result.receivedFils, 0);
  assert.equal(result.excludedCount, 1);
  assert.equal(result.activity.length, 1);
});

test('split transactions count once at their full merchant amount, across categories', () => {
  const row = tx('split', 15876, { splits: [
    { category: 'groceries', amountFils: 10000 }, { category: 'dining', amountFils: 5876 },
  ] });
  const result = project([row]);
  assert.equal(result.totalFils, 15876);
  assert.equal(result.spending.length, 1);
  assert.equal(result.averageFils, 15876);
});

test('the selected month and all-time scope remain distinct and include exact cents', () => {
  const rows = [tx('august', 1499, { date: '2026-08-31' }), tx('september', 3551),
    tx('october', 1001, { date: '2026-10-01' })];
  assert.equal(project(rows).totalFils, 3551);
  assert.equal(project(rows, 'Cedar Cafe', { mode: 'all' }).totalFils, 6051);
});

test('custom range includes both endpoints and excludes adjacent days', () => {
  const rows = [tx('before', 100, { date: '2026-09-01' }), tx('first', 200, { date: '2026-09-02' }),
    tx('last', 300, { date: '2026-09-08' }), tx('after', 400, { date: '2026-09-09' })];
  assert.equal(project(rows, 'Cedar Cafe', { mode: 'range', from: '2026-09-02', to: '2026-09-08' }).totalFils, 500);
});

test('salary-month boundaries follow the shared reporting-month setting', () => {
  const before = format.getMonthStartDay();
  try {
    format.setMonthStartDay(25);
    const rows = [tx('before', 100, { date: '2026-09-24' }), tx('first', 200, { date: '2026-09-25' }),
      tx('last', 300, { date: '2026-10-24' }), tx('after', 400, { date: '2026-10-25' })];
    assert.equal(project(rows).totalFils, 500);
  } finally { format.setMonthStartDay(before); }
});

test('empty or unknown merchant shows a real zero and no invented average', () => {
  for (const name of ['', '   ', 'Unknown shop']) {
    const result = project([tx('a', 100)], name);
    assert.equal(result.totalFils, 0);
    assert.equal(result.averageFils, null);
    assert.equal(result.lastPurchase, null);
    assert.equal(result.activity.length, 0);
  }
});

test('fractional-minor-unit averages are disclosed as approximate; totals stay exact', () => {
  const result = project([tx('a', 100), tx('b', 101)]);
  assert.equal(result.totalFils, 201);
  assert.equal(result.averageFils, 101);
  assert.equal(result.averageApproximate, true);
  assert.equal(project([tx('a', 100), tx('b', 102)]).averageApproximate, false);
});

test('merchant totals use recorded ledger minor units, not original foreign amounts', () => {
  const result = project([tx('converted', 15342, {
    originalCurrency: 'USD', originalAmountMinor: 4200, fxRate: 3.6529,
  })]);
  assert.equal(result.totalFils, 15342);
  assert.equal(result.hasConvertedAmounts, true);
  assert.equal(project([tx('yen', 2786)]).totalFils, 2786);
  assert.equal(project([tx('dinar', 180250)]).totalFils, 180250);
});

test('input order and transactions remain untouched; edits and deletions recompute', () => {
  const a = Object.freeze(tx('older', 321, { date: '2026-09-02' }));
  const b = Object.freeze(tx('latest', 789, { date: '2026-09-08' }));
  const rows = Object.freeze([a, b]);
  const result = project(rows);
  assert.equal(result.lastPurchase, '2026-09-08');
  assert.deepEqual(rows, [a, b]);
  assert.equal(result.spending[0], b);
  assert.equal(project([a, { ...b, amountFils: 900 }]).totalFils, 1221);
  assert.equal(project([a]).totalFils, 321);
  assert.equal(project([]).totalFils, 0);
});

test('unsafe monetary input and aggregate overflow fail rather than display a wrong total', () => {
  assert.throws(() => project([tx('a', Number.MAX_SAFE_INTEGER), tx('b', 1)]), /safe integer/);
  assert.throws(() => project([tx('a', 12.34)]), /safe integer/);
});

test('merchant links round-trip Arabic, punctuation and reserved URL characters safely', () => {
  for (const name of ['A&B / Cafe? branch=1', 'مقهى النور', 'Cedar #1', 'Shop + 50%', '"Quotes"']) {
    const href = merchantSpendingHref(name);
    const parsed = new URL(href, 'https://example.invalid');
    assert.equal(parsed.pathname, '/merchant');
    assert.equal(parsed.searchParams.get('name'), name);
    assert.equal([...parsed.searchParams.keys()].length, 1);
  }
});
