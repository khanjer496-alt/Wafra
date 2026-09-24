'use strict';
// Home's today / this-week / left-to-spend arithmetic. Synthetic ledger only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const { summarizeHomeToday, localISODate } = load(path.join(__dirname, '../../../src/lib/home-today.ts'), {});

const now = new Date(2026, 8, 25, 21, 0); // Fri 25 Sep 2026, local time
const tx = (id, date, amountFils, extra = {}) => ({ id, date, amountFils, type: 'expense', category: 'dining', accountId: 'a', ...extra });
const allocations = t => (t.splits?.length ? t.splits : [{ category: t.category, amountFils: t.amountFils }]);
const run = (transactions, over = {}) => summarizeHomeToday({
  transactions, budgets: [], now,
  isSpending: t => t.type === 'expense' && !t.internal,
  inBudgetPeriod: date => date >= '2026-09-01' && date <= '2026-09-30',
  budgetPeriodEndISO: '2026-09-30',
  allocations,
  periodExpenseFils: 0,
  averageWindow: null,
  ...over,
});

test('today counts only today’s spending, and the week is seven days ending today', () => {
  const r = run([
    tx('1', '2026-09-25', 675), tx('2', '2026-09-25', 4562),
    tx('3', '2026-09-24', 12140), tx('4', '2026-09-19', 4200), tx('5', '2026-09-18', 99999),
  ]);
  assert.equal(r.todayFils, 5237);
  assert.equal(r.todayCount, 2);
  assert.deepEqual([...r.week.map(d => d.dateISO)], ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
  assert.equal(r.week[6].today, true);
  assert.equal(r.week.filter(d => d.today).length, 1);
  assert.equal(r.week[0].fils, 4200, 'day seven days back is inside the window');
  assert.equal(r.weekFils, 5237 + 12140 + 4200, 'the 18th is outside the window');
  assert.equal(r.week[6].weekday, 5, 'Friday');
});

test('the shared spending predicate decides what counts', () => {
  const r = run([
    tx('in', '2026-09-25', 420000, { type: 'income' }),
    tx('own', '2026-09-25', 21200, { internal: true }),
    tx('buy', '2026-09-25', 675),
  ]);
  assert.equal(r.todayFils, 675);
  assert.equal(r.todayCount, 1);
});

test('future-dated rows never enter today or the week', () => {
  const r = run([tx('f', '2026-09-26', 5000), tx('t', '2026-09-25', 100)]);
  assert.equal(r.todayFils, 100);
  assert.equal(r.weekFils, 100);
});

test('no budgets means no pace figure', () => {
  assert.equal(run([tx('1', '2026-09-25', 675)]).budget, null);
  assert.equal(run([tx('1', '2026-09-25', 675)], { budgets: [{ category: 'dining', limitFils: 30000 }], budgetPeriodEndISO: null }).budget, null);
});

test('left to spend uses budgeted categories only, split-aware, with days left including today', () => {
  const r = run([
    tx('d', '2026-09-03', 20000),
    tx('g', '2026-09-10', 50000, { category: 'groceries' }),
    tx('s', '2026-09-12', 10000, { category: 'shopping', splits: [{ category: 'dining', amountFils: 4000 }, { category: 'shopping', amountFils: 6000 }] }),
    tx('old', '2026-08-30', 90000),
  ], { budgets: [{ category: 'dining', limitFils: 30000 }, { category: 'groceries', limitFils: 70000 }] });
  assert.equal(r.budget.limitFils, 100000);
  assert.equal(r.budget.spentFils, 20000 + 50000 + 4000, 'shopping share of a split and August are excluded');
  assert.equal(r.budget.leftFils, 26000);
  assert.equal(r.budget.daysLeft, 6, '25–30 September');
  assert.equal(r.budget.perDayFils, Math.floor(26000 / 6));
});

test('going over budget reports a negative left and no daily allowance', () => {
  const r = run([tx('d', '2026-09-03', 35000)], { budgets: [{ category: 'dining', limitFils: 30000 }] });
  assert.equal(r.budget.leftFils, -5000);
  assert.equal(r.budget.perDayFils, 0);
});

test('the last day of the period still has one day left', () => {
  const last = new Date(2026, 8, 30, 23, 30);
  const r = run([], { now: last, budgets: [{ category: 'dining', limitFils: 30000 }] });
  assert.equal(r.budget.daysLeft, 1);
  assert.equal(localISODate(last), '2026-09-30');
});

test('the week crosses month boundaries by calendar day', () => {
  const r = run([tx('a', '2026-09-29', 100), tx('b', '2026-10-02', 200)], { now: new Date(2026, 9, 2, 9) });
  assert.deepEqual([...r.week.map(d => d.dateISO)], ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  assert.equal(r.weekFils, 300);
});

test('daily average covers the elapsed part of the window only, and is absent without one', () => {
  assert.equal(run([]).average, null);
  const current = run([], { periodExpenseFils: 291540, averageWindow: { startISO: '2026-09-01', endISO: '2026-09-30' } });
  assert.equal(current.average.days, 25, '1–25 September, not the whole month');
  assert.equal(current.average.fils, Math.floor(291540 / 25));
  const past = run([], { periodExpenseFils: 331300, averageWindow: { startISO: '2026-08-01', endISO: '2026-08-31' } });
  assert.equal(past.average.days, 31, 'a finished period divides by its full length');
  const future = run([], { periodExpenseFils: 0, averageWindow: { startISO: '2026-10-01', endISO: '2026-10-31' } });
  assert.equal(future.average, null, 'a period that has not started has no average');
});
