'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const root = path.resolve(__dirname, '../../..');
const format = require('../build/format');
const deps = Object.fromEntries(['format', 'categories', 'ledger', 'period', 'splits'].map(name => [`@/lib/${name}`, require(`../build/${name}`)]));
const daily = () => load(path.join(root, 'src/lib/spending-daily.ts'), deps).spendingDailyView;
const tx = (id, date, amountFils, rest = {}) => ({ id, date, amountFils, type: 'expense', category: 'groceries', accountId: 'cash', title: id, ...rest });
const opts = { todayISO: '2026-10-03' };
const plain = value => JSON.parse(JSON.stringify(value));

test('custom range includes both bounds and zero days, separates fixed allocations and respects ledger/list exclusions', () => {
  const result = daily()([
    tx('before', '2026-09-27', 999), tx('start', '2026-09-28', 100),
    tx('split', '2026-09-30', 1000, { splits: [{ category: 'groceries', amountFils: 200 }, { category: 'rent', amountFils: 800 }] }),
    tx('end', '2026-10-03', 300), tx('after', '2026-10-04', 999),
    tx('hidden', '2026-09-29', 999, { accountId: 'hidden' }), tx('internal', '2026-09-29', 999),
    tx('listed-elsewhere', '2026-09-29', 999), tx('income', '2026-09-29', 999, { type: 'income' }),
  ], { mode: 'range', from: '2026-09-28', to: '2026-10-03' }, new Set(['cash']), new Set(['internal']), t => t.id !== 'listed-elsewhere', opts);
  assert.deepEqual(plain(result.days), [
    { dateISO: '2026-09-28', fils: 100, fixedFils: 0 }, { dateISO: '2026-09-29', fils: 0, fixedFils: 0 },
    { dateISO: '2026-09-30', fils: 200, fixedFils: 800 }, { dateISO: '2026-10-01', fils: 0, fixedFils: 0 },
    { dateISO: '2026-10-02', fils: 0, fixedFils: 0 }, { dateISO: '2026-10-03', fils: 300, fixedFils: 0 },
  ]);
  assert.equal(result.paged, false);
});

test('year and all-time show bounded daily pages, including an empty ledger and leap February', () => {
  const year = daily()([], { mode: 'year', year: 2024 }, undefined, undefined, undefined, { todayISO: '2026-10-03', monthKey: '2024-02' });
  assert.equal(year.days.length, 29); assert.equal(year.days.at(-1).dateISO, '2024-02-29');
  assert.equal(year.previousMonthKey, '2024-01'); assert.equal(year.nextMonthKey, '2024-03');
  const all = daily()([], { mode: 'all' }, undefined, undefined, undefined, opts);
  assert.equal(all.days.length, 31); assert.equal(all.monthKey, '2026-10');
  assert.equal(all.previousMonthKey, null); assert.equal(all.nextMonthKey, null);
  const long = daily()([tx('old', '2000-01-01', 100)], { mode: 'all' }, undefined, undefined, undefined, opts);
  assert.equal(long.days.length, 31); assert.equal(long.previousMonthKey, '2026-09');
});

test('salary months and reporting years keep their true boundaries without leaking neighboring dates', () => {
  format.setMonthStartDay(25);
  try {
    const month = daily()([], { mode: 'month', key: '2026-09' }, undefined, undefined, undefined, opts);
    assert.equal(month.days[0].dateISO, '2026-09-25'); assert.equal(month.days.at(-1).dateISO, '2026-10-24');
    const year = daily()([], { mode: 'year', year: 2026 }, undefined, undefined, undefined, { todayISO: '2027-02-01', monthKey: '2027-01' });
    assert.equal(year.days[0].dateISO, '2027-01-01'); assert.equal(year.days.at(-1).dateISO, '2027-01-24');
    assert.equal(year.nextMonthKey, null);
  } finally { format.setMonthStartDay(1); }
});

test('long custom ranges page without truncating scope or accepting an out-of-scope page', () => {
  const ninety = daily()([], { mode: 'range', from: '2026-07-06', to: '2026-10-03' }, undefined, undefined, undefined, opts);
  assert.equal(ninety.paged, true); assert.equal(ninety.days.length, 3);
  assert.equal(ninety.previousMonthKey, '2026-09');
  const result = daily()([], { mode: 'range', from: '2024-02-15', to: '2026-10-03' }, undefined, undefined, undefined, { ...opts, monthKey: '2020-01' });
  assert.equal(result.paged, true); assert.equal(result.monthKey, '2024-02');
  assert.equal(result.days[0].dateISO, '2024-02-15'); assert.equal(result.days.at(-1).dateISO, '2024-02-29');
  assert.equal(result.previousMonthKey, null); assert.equal(result.nextMonthKey, '2024-03');
});

test('cross-month calendar identifies each month and selecting a day exposes its full spending amount', () => {
  const h = createHarness();
  let picked;
  const props = { days: [
    { dateISO: '2026-09-30', fils: 200, fixedFils: 800 },
    { dateISO: '2026-10-01', fils: 0, fixedFils: 0 },
  ], todayISO: '2026-09-30', selected: '2026-09-30', onSelect: d => { picked = d; }, palette: h.deps['@/hooks/use-band'].useBand('spending'), periodLabel: '30 Sep – 1 Oct' };
  const tree = h.deps['@/components/spending/spending-calendar'].SpendingCalendar(props);
  const nodes = walk(tree);
  assert.match(text(nodes.find(n => n.props?.testID === 'spending-calendar-month-2026-09')), /Sept?ember 2026/);
  assert.match(text(nodes.find(n => n.props?.testID === 'spending-calendar-month-2026-10')), /October 2026/);
  const day = nodes.find(n => n.props?.testID === 'spending-calendar-day-2026-09-30');
  assert.match(day.props.accessibilityLabel, /10\.00/);
  assert.match(text(nodes.find(n => n.props?.testID === 'spending-calendar-selected-total')), /10\.00/);
  day.props.onPress(); assert.equal(picked, null);
  assert.equal(nodes.find(n => n.props?.testID === 'spending-calendar-day-2026-10-01').props.disabled, true);
});
