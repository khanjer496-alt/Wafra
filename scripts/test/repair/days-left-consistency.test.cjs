'use strict';
// Home's budget tile ("27 days left", and its per-day figure) and the limit
// sheet ("with 27 days still to go") count the days left in the money month the
// same way: today included. Fixed clocks, synthetic ledger only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const period = require('../build/period.js');
const format = require('../build/format.js');
const { summarizeHomeToday } = load(path.join(__dirname, '../../../src/lib/home-today.ts'), {});

/** Home's budget pace on `now`, for the money month `now` falls in. */
function homeBudget(now, limitFils = 300000, spentFils = 30000) {
  const key = format.monthKey(now);
  const startISO = format.monthStartISO(key), endISO = format.monthEndISO(key);
  const todayISO = format.toISODate(now);
  return summarizeHomeToday({
    transactions: [{ id: 'a', date: todayISO, amountFils: spentFils, type: 'expense', category: 'dining', accountId: 'x' }],
    budgets: [{ category: 'dining', limitFils }], now,
    isSpending: t => t.type === 'expense',
    inBudgetPeriod: date => date >= startISO && date <= endISO,
    budgetPeriodStartISO: startISO, budgetPeriodEndISO: endISO,
    allocations: t => [{ category: t.category, amountFils: t.amountFils }],
    isFixedCommitment: () => false, averageWindow: null,
  }).budget;
}
const sheetDays = now => period.daysLeftInPeriod({ mode: 'month', key: format.monthKey(now) }, now, []);

test('on 5 October both say 27: the 5th to the 31st, today included', () => {
  const now = new Date(2026, 9, 5, 12, 0);
  const budget = homeBudget(now);
  assert.equal(budget.daysLeft, 27);
  assert.equal(sheetDays(now), 27);
  assert.equal(budget.perDayFils, Math.floor((300000 - 30000) / 27), 'the per-day figure divides by the same count');
});

test('the last day of the month still has one day to go, on both', () => {
  const now = new Date(2026, 9, 31, 23, 30);
  assert.equal(homeBudget(now).daysLeft, 1);
  assert.equal(sheetDays(now), 1);
});

test('every day of a calendar month and of a salary-day month agrees', () => {
  for (const startDay of [1, 25]) {
    format.setMonthStartDay(startDay);
    try {
      for (let offset = 0; offset < 62; offset += 1) {
        const now = new Date(2026, 8, 1 + offset, 9, 0);
        assert.equal(sheetDays(now), homeBudget(now).daysLeft, `start day ${startDay}, ${format.toISODate(now)}`);
      }
    } finally {
      format.setMonthStartDay(1);
    }
  }
});

test('a month that is over, or not yet begun, has no days left on the sheet', () => {
  const now = new Date(2026, 9, 5, 12, 0);
  assert.equal(period.daysLeftInPeriod({ mode: 'month', key: '2026-09' }, now, []), 0);
  assert.equal(period.daysLeftInPeriod({ mode: 'month', key: '2026-11' }, now, []), 0);
  assert.equal(period.daysLeftInPeriod({ mode: 'year', year: 2026 }, now, []), 0);
});

test('the limit sheet reads the shared count, not its own subtraction', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '../../../src/components/limit-sheet.tsx'), 'utf8');
  assert.match(source, /const daysLeft = daysLeftInPeriod\(period, now, state\.transactions\);/);
  assert.doesNotMatch(source, /daysInPeriod\(period, now\) - elapsedDays/);
});
