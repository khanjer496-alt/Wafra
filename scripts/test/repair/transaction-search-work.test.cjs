'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { performanceLedger } = require('../fixtures/performance-ledger.cjs');
const realPresentation = require('../build/transaction-presentation.js');
const realCategories = require('../build/categories.js');

function harness() {
  let presentations = 0;
  let categoryLookups = 0;
  let categoryLabels = 0;
  const filter = load(path.resolve(__dirname, '../../../src/lib/transaction-filter.ts'), {
    '@/lib/categories': {
      ...realCategories,
      getCategory(...args) { categoryLookups++; return realCategories.getCategory(...args); },
      categoryLabel(...args) { categoryLabels++; return realCategories.categoryLabel(...args); },
    },
    '@/lib/format': require('../build/format.js'),
    '@/lib/ledger': require('../build/ledger.js'),
    '@/lib/splits': require('../build/splits.js'),
    '@/lib/transaction-source': require('../build/transaction-source.js'),
    '@/lib/transaction-presentation': {
      transactionPresentation(...args) { presentations++; return realPresentation.transactionPresentation(...args); },
    },
  });
  return { ...filter, calls: () => presentations,
    categoryCalls: () => ({ lookups: categoryLookups, labels: categoryLabels }) };
}
const defaults = { type: null, accountId: null, categories: new Set(), datePreset: 'selected',
  dateFrom: null, dateTo: null, minFils: null, sort: 'newest' };
const options = { query: '', merchant: null, smsOnly: false, currentKey: '2026-09',
  period: { mode: 'month', key: '2026-09' }, live: new Set(['bank']), internal: new Set(), corroborating: new Set() };

test('opening and filtering a 15k ledger without a query does no search presentation work', () => {
  const h = harness();
  const { transactions } = performanceLedger(15000);
  const index = h.createTransactionFilterIndex(transactions, 'en');
  assert.equal(h.calls(), 0, 'constructing a browsing index must not format historical search labels');
  assert.deepEqual(h.categoryCalls(), { lookups: 0, labels: 0 });
  const result = h.projectTransactionFilter(index, defaults, options);
  assert.ok(result.filtered.length > 0);
  assert.ok(result.filtered.length < 15000);
  assert.equal(h.calls(), 0, 'date browsing must not touch lazy search text');
  assert.deepEqual(h.categoryCalls(), { lookups: 0, labels: 0 }, 'browsing must not resolve or localize search categories');
});

test('search prepares only eligible rows and reuses text while queries change', () => {
  const h = harness();
  const row = (id, title, extra = {}) => ({ id, title, date: '2026-09-23', type: 'expense',
    source: 'manual', amountFils: 1234, category: 'dining', accountId: 'bank', ...extra });
  const rows = [row('a', 'Coffee'), row('b', 'Lunch'), row('other-account', 'Hidden', { accountId: 'other' }),
    row('old', 'Old coffee', { date: '2026-08-01' })];
  const index = h.createTransactionFilterIndex(rows, 'en', new Map([['bank', 'Everyday account']]));
  const filters = { ...defaults, accountId: 'bank' };
  const find = query => h.projectTransactionFilter(index, filters, { ...options, query });
  assert.deepEqual(Array.from(find('coffee').filtered, row => row.id), ['a']);
  assert.equal(h.calls(), 2, 'historical and other-account rows need no search labels');
  assert.deepEqual(Array.from(find('everyday').filtered, row => row.id), ['a', 'b']);
  assert.deepEqual(Array.from(find('12.34').filtered, row => row.id), ['a', 'b']);
  assert.equal(h.calls(), 2, 'typing must not reformat previously searched rows');
  assert.equal(find('coffee').totalShown, -1234);
  const all = h.projectTransactionFilter(index, { ...defaults, datePreset: 'all' }, { ...options, query: 'old coffee' });
  assert.deepEqual(Array.from(all.filtered, row => row.id), ['old'], 'all-history search must still find older rows');
});

const school = `custom:expense:${'a'.repeat(32)}`;
const family = `custom:expense:${'b'.repeat(32)}`;
const transaction = (id, category, amountFils, extra = {}) => Object.freeze({
  id, title: `Synthetic merchant ${id}`, date: '2026-09-23', type: 'expense',
  source: 'manual', accountId: 'bank', category, amountFils, ...extra,
});

for (const language of ['en', 'ar']) {
  test(`${language}: lazy search includes custom and split category labels without changing allocation totals`, () => {
    const h = harness();
    const catalog = Object.freeze([
      Object.freeze({ id: school, name: 'School adventures', type: 'expense' }),
      Object.freeze({ id: family, name: 'رعاية الأسرة', type: 'expense' }),
    ]);
    const splits = Object.freeze([
      Object.freeze({ category: school, amountFils: 2000 }),
      Object.freeze({ category: 'groceries', amountFils: 3000 }),
    ]);
    const rows = Object.freeze([
      transaction('primary', school, 2500),
      transaction('split', 'other', 5000, { splits }),
      transaction('builtin', 'dining', 700),
      transaction('arabic', family, 1800),
    ]);
    const before = JSON.stringify({ catalog, rows });
    const index = h.createTransactionFilterIndex(rows, language, undefined, catalog);
    const find = (query, filters = defaults) => h.projectTransactionFilter(index, filters, { ...options, query });
    const ids = result => Array.from(result.filtered, row => row.id);

    assert.equal(find('').filtered.length, 4);
    assert.equal(find('').totalShown, -10000);
    assert.deepEqual(h.categoryCalls(), { lookups: 0, labels: 0 }, 'custom/split browsing must remain lazy');
    assert.equal(h.calls(), 0);

    const custom = find('SCHOOL ADVENTURES');
    assert.deepEqual(ids(custom), ['primary', 'split']);
    assert.equal(custom.totalShown, -7500, 'text search counts each matching transaction once');
    const formatted = h.categoryCalls();
    const presented = h.calls();
    assert.ok(formatted.lookups > 0 && formatted.labels > 0, 'search resolves the actual explicit catalog');

    assert.deepEqual(ids(find('groceries')), ['split'], 'a split-only built-in category remains searchable');
    if (language === 'ar') assert.deepEqual(ids(find('البقالة')), ['split'], 'localized split labels remain searchable');
    assert.deepEqual(ids(find('رعاية الأسرة')), ['arabic'], 'user-defined Arabic names remain literal searchable labels');
    const portion = find('school adventures', { ...defaults, categories: new Set([school]) });
    assert.deepEqual(ids(portion), ['primary', 'split']);
    assert.equal(portion.totalShown, -4500, 'category-filtered totals include only the matching split portion');
    assert.deepEqual(h.categoryCalls(), formatted, 'subsequent queries reuse category labels');
    assert.equal(h.calls(), presented, 'subsequent queries reuse presentation text');
    assert.equal(JSON.stringify({ catalog, rows }), before, 'search never changes categories, amounts or splits');
  });
}

test('rebuilding for a renamed catalog invalidates warmed search labels with the same ledger rows', () => {
  const h = harness();
  const catalog = Object.freeze([Object.freeze({ id: school, name: 'School adventures', type: 'expense' })]);
  const rows = Object.freeze([
    transaction('primary', school, 2500),
    transaction('split', 'other', 2500, { splits: Object.freeze([
      Object.freeze({ category: school, amountFils: 1000 }),
      Object.freeze({ category: 'groceries', amountFils: 1500 }),
    ]) }),
  ]);
  const find = (index, query) => h.projectTransactionFilter(index, defaults, { ...options, query });
  const ids = result => Array.from(result.filtered, row => row.id);
  const original = h.createTransactionFilterIndex(rows, 'en', undefined, catalog);
  const previous = find(original, 'school adventures');
  assert.deepEqual(ids(previous), ['primary', 'split']);
  const warmed = h.categoryCalls();

  // The screen rebuilds on immutable catalog replacement, even when rows,
  // language and accounts retain their identities. Each index owns its labels.
  const renamedCatalog = Object.freeze([Object.freeze({ ...catalog[0], name: 'رحلات مدرسية' })]);
  const renamed = h.createTransactionFilterIndex(rows, 'en', undefined, renamedCatalog);
  assert.equal(find(renamed, '').totalShown, previous.totalShown);
  assert.deepEqual(h.categoryCalls(), warmed, 'a catalog change must not eagerly format labels during browsing');
  const current = find(renamed, 'رحلات مدرسية');
  assert.deepEqual(ids(current), ['primary', 'split']);
  assert.equal(current.totalShown, previous.totalShown);
  assert.deepEqual(ids(find(renamed, 'school adventures')), [], 'new catalog must not reuse stale cached names');
  assert.ok(h.categoryCalls().labels > warmed.labels);
  assert.deepEqual(ids(find(original, 'school adventures')), ['primary', 'split'], 'older snapshot keeps its own catalog');
  assert.deepEqual(ids(find(original, 'رحلات مدرسية')), [], 'new labels must not leak into an older index');
  assert.equal(catalog[0].name, 'School adventures');
  assert.equal(rows[1].splits[0].amountFils, 1000);
});
