'use strict';
// What widgets may read. Synthetic figures only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const { buildWidgetSnapshot, WIDGET_SNAPSHOT_VERSION } = load(path.join(__dirname, '../../../src/lib/widget-snapshot.ts'), {});
const today = {
  todayFils: 5237, todayCount: 2, weekFils: 52877,
  week: [4200, 11800, 3600, 6400, 9500, 12140, 5237].map((fils, i) => ({ dateISO: `2026-09-${19 + i}`, weekday: (6 + i) % 7, fils, today: i === 6 })),
  budget: { limitFils: 100000, spentFils: 74000, leftFils: 26000, overCount: 1, overFils: 500, daysLeft: 6, perDayFils: 4333 },
  average: null,
};
const upcoming = [
  { title: 'Old card', amountFils: 999, dateISO: '2026-09-01', overdue: true },
  { title: 'Netflix', amountFils: 1549, dateISO: '2026-09-28', estimated: true },
  { title: 'Electricity', amountFils: 8420, dateISO: '2026-10-04', estimated: true },
  { title: 'Visa ••4821', amountFils: 124000, dateISO: '2026-10-13' },
  { title: 'Spotify', amountFils: 1199, dateISO: '2026-10-07' },
];
const base = { today, currency: 'USD', exponent: 2, now: new Date(Date.UTC(2026, 8, 25, 17)), upcoming, hideAmounts: false, language: 'en' };

test('the snapshot carries only summary figures, marked sensitive', () => {
  const s = buildWidgetSnapshot(base);
  assert.equal(s.version, WIDGET_SNAPSHOT_VERSION);
  assert.equal(s.amountsSensitive, true, 'native widgets redact these on the Lock Screen');
  assert.equal(s.todayMinor, 5237);
  assert.equal(s.leftInBudgetsMinor, 26000);
  assert.equal(s.perDayMinor, 4333);
  assert.equal(s.budgetsOver, 1);
  assert.equal(s.last7Minor.length, 7);
  assert.deepEqual(Object.keys(s).sort(), ['amountsSensitive', 'bills', 'budgetsOver', 'currency', 'exponent', 'generatedAt', 'hidden',
    'language', 'last7Minor', 'leftInBudgetsMinor', 'perDayMinor', 'todayCount', 'todayISO', 'todayMinor', 'version'].sort(), 'no extra fields leak out');
  assert.equal(s.todayISO, '2026-09-25');
});

test('bills: overdue items skipped, at most three, in the order Home already shows', () => {
  const s = buildWidgetSnapshot(base);
  assert.deepEqual([...s.bills.map(b => b.title)], ['Netflix', 'Electricity', 'Visa ••4821']);
  assert.deepEqual(Object.keys(s.bills[0]).sort(), ['amountMinor', 'dueISO', 'estimated', 'title']);
});

test('hidden amounts are null everywhere, never zero', () => {
  const s = buildWidgetSnapshot({ ...base, hideAmounts: true });
  assert.equal(s.hidden, true);
  assert.equal(s.todayMinor, null);
  assert.equal(s.todayCount, 2, 'counts and dates still help');
  assert.ok(s.last7Minor.every(v => v === null));
  assert.equal(s.leftInBudgetsMinor, null);
  assert.equal(s.perDayMinor, null);
  assert.ok(s.bills.every(b => b.amountMinor === null && b.dueISO));
});

test('no budgets means no pace figures', () => {
  const s = buildWidgetSnapshot({ ...base, today: { ...today, budget: null } });
  assert.equal(s.leftInBudgetsMinor, null);
  assert.equal(s.perDayMinor, null);
  assert.equal(s.budgetsOver, 0);
});
