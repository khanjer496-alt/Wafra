'use strict';
// Home's today / last-7-days / budget pace / daily average arithmetic. Synthetic ledger only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const { summarizeHomeToday, localISODate } = load(path.join(__dirname, '../../../src/lib/home-today.ts'), {});

const now = new Date(2026, 8, 25, 21, 0); // Fri 25 Sep 2026, local time
const tx = (id, date, amountFils, extra = {}) => ({ id, date, amountFils, type: 'expense', category: 'dining', accountId: 'a', ...extra });
const allocations = t => (t.splits?.length ? t.splits : [{ category: t.category, amountFils: t.amountFils }]);
const newestFirst = rows => [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
const run = (transactions, over = {}) => summarizeHomeToday({
  transactions: newestFirst(transactions), budgets: [], now,
  isSpending: t => t.type === 'expense' && !t.internal,
  inBudgetPeriod: date => date >= '2026-09-01' && date <= '2026-09-30',
  budgetPeriodStartISO: '2026-09-01',
  budgetPeriodEndISO: '2026-09-30',
  allocations,
  isFixedCommitment: c => c === 'rent' || c === 'business',
  averageWindow: null,
  ...over,
});

test('today counts only today’s spending, and the window is seven days ending today', () => {
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

test('future-dated rows never enter today or the window', () => {
  const r = run([tx('f', '2026-09-26', 5000), tx('t', '2026-09-25', 100)]);
  assert.equal(r.todayFils, 100);
  assert.equal(r.weekFils, 100);
});

test('no budgets means no pace figure', () => {
  assert.equal(run([tx('1', '2026-09-25', 675)]).budget, null);
  assert.equal(run([tx('1', '2026-09-25', 675)], { budgets: [{ category: 'dining', limitFils: 30000 }], budgetPeriodEndISO: null }).budget, null);
});

test('left in budgets is per category, split-aware, with days left including today', () => {
  const r = run([
    tx('d', '2026-09-03', 20000),
    tx('g', '2026-09-10', 50000, { category: 'groceries' }),
    tx('s', '2026-09-12', 10000, { category: 'shopping', splits: [{ category: 'dining', amountFils: 4000 }, { category: 'shopping', amountFils: 6000 }] }),
    tx('old', '2026-08-30', 90000),
  ], { budgets: [{ category: 'dining', limitFils: 30000 }, { category: 'groceries', limitFils: 70000 }] });
  assert.equal(r.budget.limitFils, 100000);
  assert.equal(r.budget.spentFils, 20000 + 50000 + 4000, 'shopping share of a split and August are excluded');
  assert.equal(r.budget.leftFils, 6000 + 20000);
  assert.equal(r.budget.overCount, 0);
  assert.equal(r.budget.daysLeft, 6, '25–30 September');
  assert.equal(r.budget.perDayFils, Math.floor(26000 / 6));
});

test('one category’s headroom never hides another category’s overspend', () => {
  const r = run([tx('d', '2026-09-03', 35000)], {
    budgets: [{ category: 'dining', limitFils: 30000 }, { category: 'groceries', limitFils: 10000 }],
  });
  assert.equal(r.budget.leftFils, 10000, 'groceries is untouched; dining over contributes nothing');
  assert.equal(r.budget.overCount, 1);
  assert.equal(r.budget.overFils, 5000);
  assert.equal(r.budget.perDayFils, Math.floor(10000 / 6));
});

test('the last day of the period still has one day left', () => {
  const last = new Date(2026, 8, 30, 23, 30);
  const r = run([], { now: last, budgets: [{ category: 'dining', limitFils: 30000 }] });
  assert.equal(r.budget.daysLeft, 1);
  assert.equal(localISODate(last), '2026-09-30');
});

test('the window crosses month boundaries by calendar day', () => {
  const r = run([tx('a', '2026-09-29', 100), tx('b', '2026-10-02', 200)], { now: new Date(2026, 9, 2, 9) });
  assert.deepEqual([...r.week.map(d => d.dateISO)], ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  assert.equal(r.weekFils, 300);
});

test('daily average covers elapsed days only and leaves rent out, including rent shares of splits', () => {
  assert.equal(run([]).average, null);
  const rows = [
    tx('rent', '2026-09-01', 550000, { category: 'rent' }),
    tx('d', '2026-09-03', 20000),
    tx('mix', '2026-09-04', 10000, { category: 'rent', splits: [{ category: 'rent', amountFils: 6000 }, { category: 'home-services', amountFils: 4000 }] }),
  ];
  const current = run(rows, { averageWindow: { startISO: '2026-09-01', endISO: '2026-09-30' } });
  assert.equal(current.average.days, 25, '1–25 September, not the whole month');
  assert.equal(current.average.fils, Math.floor(24000 / 25));
  const past = run([tx('a', '2026-08-05', 31000)], { averageWindow: { startISO: '2026-08-01', endISO: '2026-08-31' } });
  assert.deepEqual({ ...past.average }, { fils: 1000, days: 31 }, 'a finished period divides by its full length');
  assert.equal(run([], { averageWindow: { startISO: '2026-10-01', endISO: '2026-10-31' } }).average, null);
});

test('salary months: a 25th–24th budget month counts its own days', () => {
  const r = run([tx('d', '2026-09-26', 1000), tx('before', '2026-09-24', 5000)], {
    now: new Date(2026, 8, 30, 12),
    budgets: [{ category: 'dining', limitFils: 30000 }],
    inBudgetPeriod: date => date >= '2026-09-25' && date <= '2026-10-24',
    budgetPeriodStartISO: '2026-09-25', budgetPeriodEndISO: '2026-10-24',
  });
  assert.equal(r.budget.spentFils, 1000, 'the 24th belongs to the previous salary month');
  assert.equal(r.budget.daysLeft, 25, '30 September to 24 October');
});

test('an out-of-order ledger is still read completely', () => {
  const rows = [tx('today', '2026-09-25', 100), tx('old', '2026-01-01', 9999), tx('yesterday', '2026-09-24', 200)];
  const r = summarizeHomeToday({
    transactions: rows, budgets: [], now,
    isSpending: () => true, inBudgetPeriod: () => false, budgetPeriodStartISO: null, budgetPeriodEndISO: null,
    allocations, isFixedCommitment: () => false, averageWindow: null,
  });
  assert.equal(r.weekFils, 300, 'yesterday after an old row still counts');
});

test('a newest-first ledger stops at the oldest date any figure needs', () => {
  let visited = 0;
  const rows = [tx('today', '2026-09-25', 100), ...Array.from({ length: 500 }, (_, i) => tx(`old${i}`, '2025-01-01', 1))];
  summarizeHomeToday({
    transactions: rows, budgets: [], now,
    isSpending: () => { visited += 1; return true; },
    inBudgetPeriod: () => false, budgetPeriodStartISO: null, budgetPeriodEndISO: null,
    allocations, isFixedCommitment: () => false, averageWindow: null,
  });
  assert.equal(visited, 1, 'only the in-window row is examined');
});
