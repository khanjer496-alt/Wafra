'use strict';
// A running month is compared with the same first days of earlier months,
// never with whole months: on 8 Oct, "↓83% vs Sep" set eight days against
// thirty. Fixed dates only; salary-day months included.
const test = require('node:test');
const assert = require('node:assert/strict');

const analytics = require('../build/analytics');
const format = require('../build/format');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { spendingCopy, spendingTrendsCopy } = load(path.resolve(__dirname, '../../../src/lib/reference-copy.ts'));

const row = (id, date, amountFils, category = 'groceries', extra = {}) => ({
  id, date, amountFils, category, type: 'expense', title: id, accountId: 'card', source: 'sms', ...extra,
});

// September: 100 a day on the 1st-8th, then 1,000 a day to the 30th.
const september = [];
for (let day = 1; day <= 30; day += 1) {
  september.push(row(`sep-${day}`, `2026-09-${String(day).padStart(2, '0')}`, day <= 8 ? 10_000 : 100_000));
}
// October so far (today is the 8th): 90 a day.
const october = [];
for (let day = 1; day <= 8; day += 1) october.push(row(`oct-${day}`, `2026-10-0${day}`, 9_000));
const rows = [...october, ...september,
  row('sep-dining', '2026-09-03', 50_000, 'dining'), row('oct-transfer', '2026-10-02', 70_000, 'other', { isTransfer: true })];

test('days 1..N of each month, with the earlier month cut to the same days', () => {
  const totals = analytics.spendingThroughDay(rows, ['2026-09', '2026-10'], 8);
  assert.equal(totals.get('2026-09'), 8 * 10_000 + 50_000);
  assert.equal(totals.get('2026-10'), 8 * 9_000, 'a transfer is not spending');
  const groceries = analytics.spendingThroughDay(rows, ['2026-09', '2026-10'], 8, undefined, undefined, 'groceries');
  assert.equal(groceries.get('2026-09'), 80_000);
  assert.equal(groceries.get('2026-10'), 72_000);
});

test('a running month against whole months reads as a fall; like-for-like it is -10%', () => {
  const series = [{ key: '2026-09', fils: 8 * 10_000 + 22 * 100_000 }, { key: '2026-10', fils: 72_000 }];
  const whole = analytics.monthComparison(series, '2026-10', 72_000, null);
  assert.equal(whole.previousDeltaPercent, -97, 'the misleading whole-month figure');
  const sameDays = analytics.spendingThroughDay(rows, ['2026-09', '2026-10'], 8, undefined, undefined, 'groceries');
  const like = analytics.monthComparison(series, '2026-10', 72_000, sameDays);
  assert.equal(like.sameDays, true);
  assert.equal(like.previousKey, '2026-09');
  assert.equal(like.previousDeltaPercent, -10);
  // The yardstick is the earlier months only, cut to the same days.
  assert.equal(like.averageFils, 80_000);
  assert.equal(like.averageDeltaPercent, -10);
});

test('a short month never reaches into the next one, and a month with nothing has no percentage', () => {
  const feb = [row('feb-28', '2026-02-28', 1_000), row('mar-1', '2026-03-01', 5_000)];
  assert.equal(analytics.spendingThroughDay(feb, ['2026-02'], 31).get('2026-02'), 1_000);
  assert.equal(analytics.percentChange(500, 0), null);
  assert.equal(analytics.spendingThroughDay(feb, ['2026-02'], 0).get('2026-02'), 0);
});

test('a salary-day month counts from its own first day', () => {
  format.setMonthStartDay(25);
  try {
    // The money month "2026-09" runs 25 Sep – 24 Oct; its first three days are 25–27 Sep.
    const salary = [row('a', '2026-09-24', 1_000), row('b', '2026-09-25', 2_000), row('c', '2026-09-27', 3_000), row('d', '2026-09-28', 4_000)];
    assert.equal(analytics.spendingThroughDay(salary, ['2026-09'], 3).get('2026-09'), 5_000);
  } finally {
    format.setMonthStartDay(1);
  }
});

test('the comparison is labelled as the same days, in both languages', () => {
  assert.equal(spendingCopy.en.vsSameDays(29, 'Sep'), '29% vs the same days of Sep');
  assert.match(spendingCopy.en.belowAverageSameDays(30, 8), /days 1–8 of earlier months/);
  assert.match(spendingCopy.ar.vsSameDays(29, 'سبتمبر'), /الأيام نفسها/);
  assert.match(spendingTrendsCopy.ar.sameDaysOf('سبتمبر'), /الأيام نفسها/);
  assert.equal(spendingTrendsCopy.en.sameDaysOf('Sep'), 'vs the same days of Sep');
});
