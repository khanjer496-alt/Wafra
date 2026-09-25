'use strict';
// Bills' "Next 30 days" counts each time a repeating payment falls due inside
// the window: a weekly charge four or five times, a monthly bill paid this
// month again when next month's due date is near, a yearly one only when its
// date is inside. Pure helper, real source. Synthetic data only.
// Requires `bash scripts/test/build.sh` (for the real format helpers).
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const format = require('../build/format.js');
const { upcomingWindowItems, recurrenceDatesInWindow, addCalendarMonths } =
  load(path.join(root, 'src/lib/upcoming-window.ts'), { '@/lib/format': format });

const TODAY = '2026-09-25';
const WINDOW = 30;
const row = (over) => ({ id: 'sub-gym', title: 'Gym', category: 'health', kind: 'recurring',
  dateISO: '2026-09-27', daysLeft: 2, amountFils: 4_000, estimated: true, paid: false, ...over });
// The module runs in its own VM context; compare its arrays as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const total = (items) => items.reduce((sum, item) => sum + item.amountFils, 0);

test('a weekly charge falls four or five times in 30 days, and the total says so', () => {
  const five = upcomingWindowItems([row()], () => ({ cadence: 'weekly' }), TODAY, WINDOW);
  assert.deepEqual(plain(five.map((i) => i.dateISO)), ['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
  assert.equal(total(five), 5 * 4_000);
  assert.deepEqual(plain(five.map((i) => i.daysLeft)), [2, 9, 16, 23, 30]);
  assert.equal(five[0].id, 'sub-gym', 'the first is the agenda row itself');
  assert.equal(new Set(five.map((i) => i.id)).size, 5, 'each occurrence has its own id');
  assert.ok(five.slice(1).every((i) => i.repeatOf === 'sub-gym' && !i.paid), 'repeats point at the obligation they repeat');

  const four = upcomingWindowItems([row({ dateISO: '2026-09-30', daysLeft: 5 })], () => ({ cadence: 'weekly' }), TODAY, WINDOW);
  assert.equal(four.length, 4);
  assert.equal(total(four), 16_000);
});

test('a monthly payment with its next due date inside the window is counted once', () => {
  const monthly = upcomingWindowItems([row({ dateISO: '2026-10-10', daysLeft: 15 })], () => ({ cadence: 'monthly' }), TODAY, WINDOW);
  assert.equal(monthly.length, 1);
  assert.equal(total(monthly), 4_000);
});

test('a monthly bill already paid this month still shows next month when that is inside the window', () => {
  const paidBill = row({ id: 'bill-dewa', kind: 'bill', title: 'DEWA', dateISO: '2026-09-04', daysLeft: -21, amountFils: 38_000, estimated: false, paid: true });
  const recurrence = { cadence: 'monthly', anchorDay: 4, isPaid: () => false };
  const items = upcomingWindowItems([paidBill], () => recurrence, TODAY, WINDOW);
  assert.deepEqual(plain(items.map((i) => [i.dateISO, i.daysLeft, i.paid, i.repeatOf])), [['2026-10-04', 9, false, 'bill-dewa']]);
  assert.equal(total(items), 38_000);
  // ...unless that month is already recorded as paid.
  assert.equal(upcomingWindowItems([paidBill], () => ({ ...recurrence, isPaid: (iso) => iso.startsWith('2026-10') }), TODAY, WINDOW).length, 0);
  // Paid, with next due outside the window: nothing to pay in it.
  assert.equal(upcomingWindowItems([{ ...paidBill, dateISO: '2026-09-24', daysLeft: -1 }], () => ({ ...recurrence, anchorDay: 28 }), '2026-09-27', WINDOW).length, 0);
});

test('a yearly payment counts only when its date is inside the window', () => {
  const yearly = (dateISO, daysLeft) => upcomingWindowItems([row({ dateISO, daysLeft })], () => ({ cadence: 'yearly' }), TODAY, WINDOW);
  assert.equal(yearly('2026-10-20', 25).length, 1);
  assert.equal(yearly('2027-03-01', 157).length, 0);
});

test('a late payment is one late payment, and rows without a cadence keep the old rule', () => {
  // Weekly, two weeks late: the late one, then only the dates from today on.
  const late = upcomingWindowItems([row({ dateISO: '2026-09-11', daysLeft: -14 })], () => ({ cadence: 'weekly' }), TODAY, WINDOW);
  assert.deepEqual(plain(late.map((i) => i.dateISO)), ['2026-09-11', '2026-09-25', '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23']);
  const card = row({ id: 'card-due', kind: 'card', dateISO: '2026-10-01', daysLeft: 6 });
  const outside = row({ id: 'card-later', kind: 'card', dateISO: '2026-11-30', daysLeft: 66 });
  const paid = row({ id: 'card-paid', kind: 'card', paid: true });
  assert.deepEqual(plain(upcomingWindowItems([card, outside, paid], () => null, TODAY, WINDOW).map((i) => i.id)), ['card-due']);
});

test('month steps keep the billing day through short months', () => {
  assert.equal(addCalendarMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addCalendarMonths('2027-02-28', 1, 31), '2027-03-31');
  assert.equal(addCalendarMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(addCalendarMonths('2028-02-29', 12), '2029-02-28');
  assert.deepEqual(plain(recurrenceDatesInWindow('2027-01-31', { cadence: 'monthly' }, '2027-01-20', 45)), ['2027-01-31', '2027-02-28']);
});
