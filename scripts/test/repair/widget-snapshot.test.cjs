'use strict';
// What widgets may read. Synthetic figures only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const real = require('../../universal-test/load-ts.cjs').createLoader();
const logos = real('@/lib/widget-logo');
const { buildWidgetSnapshot, WIDGET_SNAPSHOT_VERSION } = load(path.join(__dirname, '../../../src/lib/widget-snapshot.ts'), { '@/lib/widget-logo': logos, '@/lib/format': real('@/lib/format') });
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
  assert.deepEqual(Object.keys(s).sort(), ['amountsSensitive', 'bills', 'budgetTotalMinor', 'budgetsOver', 'currency', 'exponent', 'generatedAt', 'hidden',
    'language', 'last7Minor', 'leftInBudgetsMinor', 'perDayMinor', 'spending', 'todayCount', 'todayISO', 'todayMinor', 'version'].sort(), 'no extra fields leak out');
  assert.equal(s.budgetTotalMinor, 100000, 'the limits behind the budget bar');
  assert.equal(s.spending, null, 'no month supplied, no Spending figures');
  assert.equal(s.todayISO, '2026-09-25');
});

test('bills: overdue items skipped, at most three in upcoming date order', () => {
  const s = buildWidgetSnapshot(base);
  assert.deepEqual([...s.bills.map(b => b.title)], ['Netflix', 'Electricity', 'Spotify']);
  assert.deepEqual(Object.keys(s.bills[0]).sort(), ['amountMinor', 'dueISO', 'estimated', 'logoId', 'title']);
});

test('hidden amounts are null everywhere, never zero', () => {
  const s = buildWidgetSnapshot({ ...base, hideAmounts: true });
  assert.equal(s.hidden, true);
  assert.equal(s.todayMinor, null);
  assert.equal(s.todayCount, 2, 'counts and dates still help');
  assert.ok(s.last7Minor.every(v => v === null));
  assert.equal(s.leftInBudgetsMinor, null);
  assert.equal(s.budgetTotalMinor, null);
  assert.equal(s.perDayMinor, null);
  assert.ok(s.bills.every(b => b.amountMinor === null && b.dueISO));
});

test('no budgets means no pace figures', () => {
  const s = buildWidgetSnapshot({ ...base, today: { ...today, budget: null } });
  assert.equal(s.leftInBudgetsMinor, null);
  assert.equal(s.budgetTotalMinor, null);
  assert.equal(s.perDayMinor, null);
  assert.equal(s.budgetsOver, 0);
});

const spending = { monthKey: '2026-09', totalFils: 548000, categories: [
  ['Groceries', 183600], ['Dining', 100400], ['Shopping', 88000], ['Transport', 56200], ['Utilities', 43800],
  ['Telecom', 21400], ['Health', 18000], ['Travel', 36600], ['Gifts', 0],
].map(([label, fils]) => ({ label, fils })) };

test('Spending: this month by category, six named, the rest together, nothing at zero', () => {
  const s = buildWidgetSnapshot({ ...base, spending });
  assert.deepEqual(Object.keys(s.spending).sort(), ['categories', 'monthKey', 'otherMinor', 'totalMinor']);
  assert.equal(s.spending.monthKey, '2026-09');
  assert.equal(s.spending.totalMinor, 548000);
  assert.deepEqual(s.spending.categories.map(c => [c.label, c.amountMinor]), [
    ['Groceries', 183600], ['Dining', 100400], ['Shopping', 88000], ['Transport', 56200], ['Utilities', 43800], ['Telecom', 21400],
  ]);
  assert.equal(s.spending.otherMinor, 18000 + 36600, 'the remainder is one figure; a zero category adds nothing');
  assert.deepEqual(Object.keys(s.spending.categories[0]).sort(), ['amountMinor', 'label'], 'names and amounts only');
});

test('Spending in hidden mode keeps names and the month, never an amount', () => {
  const s = buildWidgetSnapshot({ ...base, spending, hideAmounts: true });
  assert.equal(s.spending.monthKey, '2026-09');
  assert.equal(s.spending.totalMinor, null);
  assert.equal(s.spending.otherMinor, null);
  assert.ok(s.spending.categories.length === 6 && s.spending.categories.every(c => c.amountMinor === null && c.label));
  assert.doesNotMatch(JSON.stringify(s.spending), /183600|548000/);
});

test('a month without spending is an empty month, not a missing one', () => {
  const s = buildWidgetSnapshot({ ...base, spending: { monthKey: '2026-09', totalFils: 0, categories: [] } });
  assert.deepEqual(JSON.parse(JSON.stringify(s.spending)), { monthKey: '2026-09', totalMinor: 0, categories: [], otherMinor: 0 });
});

test('only exact bundled identities enter the widget snapshot; no paths or network hints', () => {
  const s = buildWidgetSnapshot(base);
  assert.equal(s.bills[0].logoId, 'netflix');
  assert.equal(s.bills[1].logoId, null);
  for (const value of ['Cafe near Netflix', 'netflix.com/other', '../netflix', 'https://netflix.com', 'Netflix\u200e']) {
    assert.equal(logos.widgetLogoIdFor(value), null, value);
  }
  assert.equal(logos.widgetLogoIdFor('نتفليكس'), 'netflix');
  assert.equal(logos.widgetLogoIdFor('Apple.com/bill'), 'apple');
  assert.equal(logos.isWidgetLogoId('../../apple'), false);
});
