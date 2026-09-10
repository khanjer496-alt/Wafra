'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createTransactionFilterIndex, projectTransactionFilter } = require('../build/transaction-filter.js');
const { monthKey, shiftMonthKey, setMonthStartDay } = require('../build/format.js');
const { inPeriod } = require('../build/period.js');
const { categoryLabel, getCategory } = require('../build/categories.js');
const { countsInTotals, isMoneyMovementOnly } = require('../build/ledger.js');
const { touchesCategories, amountInCategories } = require('../build/splits.js');
const defaults = { type: null, accountId: null, categories: new Set(), datePreset: 'selected',
  dateFrom: null, dateTo: null, minFils: null, sort: 'newest' };
function original(rows, filters, o, language) {
  const query = o.query.trim().toLowerCase(), merchant = o.merchant?.toLowerCase();
  const last = shiftMonthKey(o.currentKey, -1), three = shiftMonthKey(o.currentKey, -2);
  const list = rows.filter(t => {
    if (o.smsOnly && t.source !== 'sms') return false;
    if (merchant && t.title.trim().toLowerCase() !== merchant) return false;
    if (filters.type && t.type !== filters.type) return false;
    if (filters.accountId && t.accountId !== filters.accountId) return false;
    if (filters.categories.size && !touchesCategories(t, filters.categories)) return false;
    if (filters.minFils && t.amountFils < filters.minFils) return false;
    const k = monthKey(t.date);
    if (filters.datePreset === 'selected' && !inPeriod(t.date, o.period)) return false;
    if (filters.datePreset === 'month' && k !== o.currentKey) return false;
    if (filters.datePreset === 'lastMonth' && k !== last) return false;
    if (filters.datePreset === '3months' && (k < three || k > o.currentKey)) return false;
    if (filters.datePreset === 'custom' && ((filters.dateFrom && t.date < filters.dateFrom) || (filters.dateTo && t.date > filters.dateTo))) return false;
    return !query || t.title.toLowerCase().includes(query) || getCategory(t.category).label.toLowerCase().includes(query) || categoryLabel(t.category, language).toLowerCase().includes(query);
  });
  if (filters.sort === 'largest') list.sort((a, b) => b.amountFils - a.amountFils);
  else if (filters.sort === 'oldest') list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    (a.ts ?? Date.parse(a.date + 'T12:00:00Z')) - (b.ts ?? Date.parse(b.date + 'T12:00:00Z')));
  const contribution = t => countsInTotals(t, o.live, o.internal)
    ? (t.type === 'income' ? 1 : -1) * (filters.categories.size ? amountInCategories(t, filters.categories) : t.amountFils) : 0;
  const excluded = { transfers: 0, movements: 0, hidden: 0 };
  for (const t of list) if (!countsInTotals(t, o.live, o.internal)) {
    if (!o.live.has(t.accountId)) excluded.hidden++;
    else if (isMoneyMovementOnly(t)) excluded.movements++;
    else excluded.transfers++;
  }
  return { filtered: list, totalShown: list.reduce((sum, t) => sum + contribution(t), 0), excluded };
}
const rows = Array.from({ length: 12000 }, (_, i) => ({ id: 'row-' + i,
  title: ['Careem', 'Talabat', 'Cedar Cafe'][i % 3], amountFils: 10000 + i % 500,
  category: i % 7 ? 'dining' : 'business', type: i % 7 ? 'expense' : 'income',
  date: `202${i % 2 ? '5' : '6'}-${String(i % 12 + 1).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}`,
  accountId: i % 11 ? 'active' : 'hidden', source: i % 4 ? 'sms' : 'manual', isTransfer: i % 29 === 0,
  ...(i % 31 === 0 ? { splits: [{ category: 'dining', amountFils: 5000 }, { category: 'groceries', amountFils: 5000 + i % 500 }] } : {}),
})).sort((a, b) => b.date.localeCompare(a.date));
const o = { query: '', merchant: null, smsOnly: false, currentKey: '2026-09', period: { mode: 'all' }, live: new Set(['active']), internal: new Set(['row-23']) };
for (const language of ['en', 'ar']) for (const salaryDay of [1, 25]) {
  test(`${language}/${salaryDay}: indexed filters preserve exact order, splits, exclusions and totals`, () => {
    setMonthStartDay(salaryDay);
    const before = JSON.stringify(rows); const index = createTransactionFilterIndex(rows, language);
    for (const sort of ['newest', 'oldest', 'largest']) for (const datePreset of ['selected', 'all', 'month', 'lastMonth', '3months', 'custom']) {
      for (const variant of [{ query: 'talabat' }, { merchant: 'careem' }, { query: 'طعام', smsOnly: true }, { query: '' }]) {
        const options = { ...o, ...variant };
        const filters = { ...defaults, datePreset, sort, dateFrom: '2026-02-01', dateTo: '2026-09-05',
          categories: variant.smsOnly ? new Set(['groceries']) : new Set() };
        const expected = original(rows, filters, options, language); const actual = projectTransactionFilter(index, filters, options);
        assert.deepEqual(actual.filtered, expected.filtered);
        assert.equal(actual.totalShown, expected.totalShown);
        assert.deepEqual(actual.excluded, expected.excluded);
        if (sort !== 'largest') assert.equal(actual.days.reduce((sum, day) => sum + day.totalFils, 0), actual.totalShown);
      }
    }
    assert.equal(JSON.stringify(rows), before);
    assert.equal(index.ordered('oldest'), index.ordered('oldest'), 'sort result reused for the immutable ledger');
  });
}
test('records a repeat-filter benchmark without asserting phone performance or flaky wall-clock budgets', () => {
  setMonthStartDay(1); const start = performance.now(); const index = createTransactionFilterIndex(rows, 'en');
  const indexMs = performance.now() - start;
  const filters = { ...defaults, datePreset: 'all', sort: 'oldest' };
  projectTransactionFilter(index, filters, o);
  const measure = fn => { const from = performance.now(); for (let i = 0; i < 15; i++) fn(); return (performance.now() - from) / 15; };
  const originalMs = measure(() => original(rows, filters, o, 'en'));
  const indexedMs = measure(() => projectTransactionFilter(index, filters, o));
  console.log(JSON.stringify({ rows: rows.length, indexMs, originalMs, indexedMs, scope: 'local Node benchmark, not Android frame time' }));
});
