'use strict';
// Bills: "All" can never total less than "Next 30 days", the window keeps
// what is already late apart from what falls due, and a detected charge that
// is the payment a hand-made reminder is for is listed once. Fixed dates only.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const format = require('../build/format');
const subscriptions = require('../build/subscriptions');
const windowing = load(path.join(root, 'src/lib/upcoming-window.ts'), { '@/lib/format': format });
const band = load(path.join(root, 'src/lib/money-places-band.ts'), {
  '@/lib/format': format, '@/lib/limit-status': load(path.join(root, 'src/lib/limit-status.ts')),
});

const TODAY = '2026-10-08';
const item = (id, dateISO, amountFils, extra = {}) => ({
  id, title: id, category: 'other', kind: 'bill', dateISO,
  daysLeft: format.daysBetweenISO(TODAY, dateISO), amountFils, estimated: false, paid: false, ...extra,
});

test('All holds the next cycle of a bill already paid this month, so it is never below Next 30 days', () => {
  // Rent, AED 8,500 on the 1st, paid for October; the Skywards statement is late.
  const agenda = [
    item('bill-rent', '2026-10-01', 850_000, { paid: true }),
    item('card-sky', '2026-10-06', 1_070_627, { kind: 'card' }),
    item('bill-dewa', '2026-10-09', 52_000),
    item('sub-netflix', '2026-10-15', 5_600, { kind: 'recurring', estimated: true }),
  ];
  const recurrence = (row) => row.kind === 'card' ? null
    : row.id === 'bill-rent' ? { cadence: 'monthly', anchorDay: 1, isPaid: (iso) => iso.slice(0, 7) === '2026-10' }
      : row.kind === 'recurring' ? { cadence: 'weekly' } : { cadence: 'monthly' };
  const next30 = windowing.upcomingWindowItems(agenda, recurrence, TODAY, 30);
  const all = windowing.allAgendaItems(agenda, next30);
  assert.ok(next30.some((row) => row.id === 'bill-rent@2026-11-01'), 'the window holds November rent');
  assert.ok(all.some((row) => row.id === 'bill-rent@2026-11-01'), 'so does All');
  const allIds = new Set(all.map((row) => row.id));
  for (const row of next30) assert.ok(allIds.has(row.id), `All holds ${row.id}`);
  assert.equal(new Set(all.map((row) => row.id)).size, all.length, 'no row twice');
  const allTotal = band.openAgendaSummary(all);
  const windowTotal = band.openAgendaSummary(next30);
  assert.ok(allTotal.totalFils >= windowTotal.totalFils);
  assert.ok(allTotal.count >= windowTotal.count);
  // The paid October row stays in All as history, never in a total.
  assert.ok(all.some((row) => row.id === 'bill-rent' && row.paid));
});

test('Next 30 days counts from today; a late statement is said beside the total, not inside it', () => {
  const rows = [
    item('card-sky', '2026-10-06', 1_070_627, { kind: 'card' }),
    item('bill-dewa', '2026-10-09', 52_000),
    item('sub-apple', '2026-10-11', 1_499, { estimated: true }),
    item('bill-old', '2026-10-01', 9_999, { paid: true }),
  ];
  const summary = band.windowAgendaSummary(rows);
  assert.deepEqual({ ...summary }, {
    totalFils: 53_499, count: 2, estimated: 1, overdueFils: 1_070_627, overdueCount: 1,
  });
  const none = band.windowAgendaSummary([item('bill-dewa', '2026-10-09', 52_000)]);
  assert.equal(none.overdueCount, 0);
  assert.equal(none.overdueFils, 0);
});

const sub = (title, category, nextExpectedISO, lastAmountFils, extra = {}) => ({
  title, category, cadence: 'monthly', nextExpectedISO, lastAmountFils, ...extra,
});
const bill = (title, category, dueDay, amountFils, extra = {}) => ({
  id: title, title, category, dueDay, amountFils, paidMonths: [], ...extra,
});

test('a hand-made Rent reminder takes the detected "Rent - Emaar" on the same day and amount', () => {
  const rent = bill('Rent', 'rent', 1, 850_000);
  assert.equal(subscriptions.subscriptionMatchesBill(sub('Rent - Emaar', 'rent', '2026-11-01', 850_000), rent), true);
  // Within three days either side, across a month end, and within 5%.
  assert.equal(subscriptions.subscriptionMatchesBill(sub('EMAAR PROPERTIES', 'rent', '2026-10-30', 830_000), rent), true);
  assert.equal(subscriptions.subscriptionMatchesBill(sub('Landlord', 'rent', '2026-11-04', 892_500), rent), true);
  // A name that overlaps carries a generic category too.
  assert.equal(subscriptions.subscriptionMatchesBill(sub('School fees term', 'other', '2026-11-15', 1_850_000),
    bill('School fees', 'education', 15, 1_850_000)), true);
});

test('anything less than the same payment stays separate', () => {
  const rent = bill('Rent', 'rent', 1, 850_000);
  assert.equal(subscriptions.subscriptionMatchesBill(sub('Rent - Emaar', 'rent', '2026-11-05', 850_000), rent), false, 'four days apart');
  assert.equal(subscriptions.subscriptionMatchesBill(sub('Rent - Emaar', 'rent', '2026-11-01', 800_000), rent), false, 'amount 6% off');
  assert.equal(subscriptions.subscriptionMatchesBill(sub('Rent - Emaar', 'rent', '2026-11-01', 850_000, { cadence: 'quarterly' }), rent), false, 'not monthly');
  assert.equal(subscriptions.subscriptionMatchesBill(sub('Parking', 'transport', '2026-11-01', 850_000), rent), false, 'other category, other name');
  // Same generic category and amount, different names: not enough.
  assert.equal(subscriptions.subscriptionMatchesBill(sub('Gym', 'other', '2026-11-01', 20_000), bill('Maid', 'other', 1, 20_000)), false);
  // Two services in one category at one price near one date stay two payments.
  assert.equal(subscriptions.subscriptionMatchesBill(sub('Spotify', 'entertainment', '2026-10-26', 999),
    bill('Netflix', 'entertainment', 28, 999)), false);
  assert.equal(subscriptions.subscriptionMatchesBill(sub('du', 'telecom', '2026-10-15', 38_900), bill('Etisalat Home', 'telecom', 14, 38_900)), false);
  // Two phone lines in one category, different amounts, stay two payments.
  assert.equal(subscriptions.subscriptionMatchesBill(sub('du', 'telecom', '2026-10-18', 21_000), bill('Etisalat Home', 'telecom', 14, 38_900)), false);
  // A provider-identified or detected reminder keeps its own matching only.
  assert.equal(subscriptions.subscriptionMatchesBill(sub('Rent - Emaar', 'rent', '2026-11-01', 850_000), { ...rent, autoDetected: true }), false);
  assert.equal(subscriptions.subscriptionMatchesBill(sub('Rent - Emaar', 'rent', '2026-11-01', 850_000), { ...rent, importIdentity: 'account:1234' }), false);
  assert.equal(subscriptions.subscriptionMatchesBill(sub('Rent - Emaar', 'rent', '2026-11-01', 850_000), { ...rent, yearlyOnISO: '2026-11-01' }), false);
  // A caller without the schedules (identity only) keeps the old name rule.
  assert.equal(subscriptions.subscriptionMatchesBill({ title: 'Rent - Emaar' }, { title: 'Rent', category: 'rent' }), false);
  assert.equal(subscriptions.subscriptionMatchesBill({ title: 'Rent' }, { title: 'Rent', category: 'rent' }), true);
});
