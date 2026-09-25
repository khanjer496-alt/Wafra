'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);
const DAY = 86_400_000;
const NOW = Date.parse('2026-09-06T12:00:00Z');
// Home's own useState order: ... 10 pendingTransfers, 11 captureSnoozedAt, 12 budgetSheetOpen.
const PENDING = 10; const SNOOZE = 11; const BUDGET_SHEET = 12;

/** Four bank texts a day for a month, the last `quietDays` ago. */
function capturedMonth(quietDays) {
  const rows = [];
  for (let ago = 34 * DAY; ago >= quietDays * DAY; ago -= 6 * 3_600_000) {
    const ts = NOW - ago;
    rows.push({ id: `c${rows.length}`, title: 'Cafe', amountFils: 1500, category: 'dining', type: 'expense', accountId: 'enbd',
      source: 'sms', ts, date: new Date(ts).toISOString().slice(0, 10) });
  }
  return rows.reverse();
}

test('first day: Left to spend shows a dash and offers a budget instead of disappearing', () => {
  const h = createHarness({ empty: true, platform: 'ios' });
  const tree = h.render('home');
  const cell = byId(tree, 'home-left-to-spend');
  assert.ok(cell);
  assert.match(text(cell), /—/);
  assert.match(text(cell), /Set a monthly budget/);
  byId(tree, 'home-set-budget').props.onPress();
  assert.deepEqual(h.events.at(-1), ['state', BUDGET_SHEET, true]);
  const open = createHarness({ empty: true, platform: 'ios', states: { [BUDGET_SHEET]: true } }).render('home');
  const sheet = walk(open).find((node) => node.props?.name === 'LimitSheet');
  assert.equal(sheet.props.open, true);
  assert.equal(sheet.props.category, null);
  assert.equal(sheet.props.monthKey, '2026-09');
  // A past month has no budget to set.
  const past = createHarness({ empty: true, platform: 'ios', period: { mode: 'month', key: '2026-08' } }).render('home');
  assert.equal(byId(past, 'home-set-budget'), undefined);
});

test('first day: fill in the past links to statement import and manual entry', () => {
  const h = createHarness({ empty: true, platform: 'ios' });
  const tree = h.render('home');
  assert.ok(byId(tree, 'home-fill-past'));
  byId(tree, 'home-fill-past-statement').props.onPress();
  assert.deepEqual(h.events.at(-1), ['route', '/statement-import']);
  byId(tree, 'home-fill-past-manual').props.onPress();
  assert.deepEqual(h.events.at(-1), ['route', '/add-transaction']);
  // A ledger with earlier months has nothing to fill.
  assert.equal(byId(createHarness({ platform: 'ios' }).render('home'), 'home-fill-past'), undefined);
});

test('capture set up but nothing captured yet shows the ready card', () => {
  const manual = [{ id: 'm', title: 'Cash', amountFils: 500, category: 'other', type: 'expense', accountId: 'cash', date: '2026-09-05', source: 'manual' }];
  const ready = createHarness({ platform: 'ios', state: { transactions: manual } }).render('home');
  assert.match(text(byId(ready, 'home-capture-ready')), /Ready for your next bank text/);
  const android = createHarness({ platform: 'android', state: { transactions: manual } }).render('home');
  assert.match(text(byId(android, 'home-capture-ready')), /Ready for your next bank alert/);
  // The fixture's bank texts mean capture is already working.
  assert.equal(byId(createHarness({ platform: 'ios' }).render('home'), 'home-capture-ready'), undefined);
});

test('capture stopped: notice, "I was away" snooze and the Left to spend caveat', () => {
  const h = createHarness({ platform: 'ios', state: { transactions: capturedMonth(5) } });
  const tree = h.render('home');
  const notice = byId(tree, 'home-capture-stopped');
  assert.ok(notice, 'four quiet days after four texts a day');
  assert.match(text(notice), /No payments captured for 5 days/);
  assert.match(text(notice), /several are captured a day/);
  assert.doesNotMatch(text(notice), /No bank texts/, 'Wafra sees captures, not the inbox');
  assert.match(text(byId(tree, 'home-left-caveat')), /May be too high until capture resumes/);
  byId(tree, 'home-capture-check').props.onPress();
  assert.deepEqual(h.events.at(-1), ['route', '/ios-setup']);
  byId(tree, 'home-capture-away').props.onPress();
  const snoozed = h.events.find((event) => event[0] === 'state' && event[1] === SNOOZE);
  assert.equal(typeof snoozed[2], 'number');
  // Home's clock moves with the snooze, or a snooze later than `now` is ignored.
  const clock = h.events.find((event) => event[0] === 'state' && event[2] instanceof Date);
  assert.ok(clock, 'the Home clock is refreshed');
  assert.equal(clock[2].getTime(), snoozed[2]);
  const pause = require(path.join(root, 'scripts/test/repair/load-typescript.cjs'))(path.join(root, 'src/lib/capture-pause.ts'));
  const times = capturedMonth(5).map((row) => row.ts);
  assert.equal(pause.detectCapturePause({ captureTimes: times, nowMs: snoozed[2], snoozedAtMs: snoozed[2] }).stopped, false);
  assert.ok(h.events.some((event) => event[0] === 'snooze'), 'the snooze is persisted');

  const away = createHarness({ platform: 'ios', state: { transactions: capturedMonth(5) }, states: { [SNOOZE]: NOW - 3_600_000 } }).render('home');
  assert.equal(byId(away, 'home-capture-stopped'), undefined);
  assert.equal(byId(away, 'home-left-caveat'), undefined);

  const recent = createHarness({ platform: 'ios', state: { transactions: capturedMonth(2) } }).render('home');
  assert.equal(byId(recent, 'home-capture-stopped'), undefined, 'two quiet days is within the rule');
  const android = createHarness({ platform: 'android', state: { transactions: capturedMonth(5) } });
  const androidTree = android.render('home');
  assert.match(text(byId(androidTree, 'home-capture-stopped')), /No payments captured for 5 days/);
  assert.match(text(byId(androidTree, 'home-capture-stopped')), /notification access/);
  byId(androidTree, 'home-capture-check').props.onPress();
  assert.deepEqual(android.events.at(-1), ['route', '/settings?section=imports']);
});

test('the transfer notice appears only for a non-empty review queue and opens the review', () => {
  assert.equal(byId(createHarness({ platform: 'ios' }).render('home'), 'transfer-review-notice'), undefined);
  const h = createHarness({ platform: 'ios', states: { [PENDING]: { count: 2, incomingFils: 0, outgoingFils: 21200 } } });
  const tree = h.render('home');
  const notice = byId(tree, 'transfer-review-notice');
  assert.match(text(notice), /2 transfers to confirm/);
  assert.doesNotMatch(text(notice), /AED/, 'a disclosure, not a monetary backlog');
  notice.props.onPress();
  assert.deepEqual(h.events.at(-1), ['route', '/review-transfers']);
});

test('Arabic week row uses full weekday names when they fit, and always speaks them', () => {
  const wide = createHarness({ language: 'ar', width: 390 }).render('home');
  const week = byId(wide, 'home-week');
  assert.match(text(week), /السبت/);
  assert.match(week.props.accessibilityLabel, /الأحد|السبت/);
  const narrow = createHarness({ language: 'ar', width: 330 }).render('home');
  const narrowWeek = byId(narrow, 'home-week');
  assert.doesNotMatch(text(narrowWeek), /السبت/);
  assert.match(narrowWeek.props.accessibilityLabel, /السبت/);
  const english = createHarness({ width: 390 }).render('home');
  assert.match(byId(english, 'home-week').props.accessibilityLabel, /Saturday/);
});

test('home-today helpers: pending transfer totals, capture times and earlier records', () => {
  const today = load(path.join(root, 'src/lib/home-today.ts'));
  const rows = [
    { id: 'a', type: 'expense', amountFils: 1000, date: '2026-09-05' },
    { id: 'b', type: 'income', amountFils: 2500, date: '2026-09-04' },
    { id: 'c', type: 'expense', amountFils: 9999, date: '2026-09-03' },
  ];
  assert.deepEqual({ ...today.pendingTransferSummary(rows, new Set(['a', 'b'])) }, { count: 2, incomingFils: 2500, outgoingFils: 1000 });
  assert.deepEqual({ ...today.pendingTransferSummary(rows, new Set()) }, { count: 0, incomingFils: 0, outgoingFils: 0 });
  assert.equal(today.hasRecordsBefore(rows, '2026-09-04'), true);
  assert.equal(today.hasRecordsBefore(rows, '2026-09-03'), false);
  const now = new Date(2026, 8, 6, 12);
  const times = today.liveCaptureTimes([
    { id: 'x', date: '2026-09-05', ts: 123 }, { id: 'y', date: '2026-09-04' }, { id: 'z', date: '2026-01-01', ts: 5 },
  ], () => true, now, 30);
  assert.equal(times.length, 2, 'rows older than the window are not read');
  assert.equal(times[0], 123);
  assert.equal(times[1], new Date(2026, 8, 4, 12).getTime(), 'a row without a clock counts at local noon');
});
