'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);
const TEXT = 1; // limit-sheet.tsx useState order: 0 picked, 1 text, 2 currencySheetVisible.

function sheet(options = {}) {
  const h = createHarness(options);
  Object.assign(h.deps['@/lib/period'], { daysInPeriod: () => 30, elapsedDays: () => 6 });
  delete h.deps['@/components/limit-sheet'];
  const { LimitSheet } = h.local('@/components/limit-sheet');
  const tree = LimitSheet({ category: 'dining', open: true, monthKey: '2026-09', onClose: () => h.events.push(['close']) });
  return { ...h, tree };
}

test('limit sheet shows three full months and this month against the limit line, with the usual', () => {
  const h = sheet({ states: { [TEXT]: '1500' } });
  const history = byId(h.tree, 'limit-history');
  assert.ok(history);
  const bars = walk(history).filter((node) => node.props?.accessible && node.props.accessibilityRole === 'text' && node.props.accessibilityLabel);
  assert.equal(bars.length, 4, 'Jun, Jul, Aug and September so far');
  assert.match(bars[0].props.accessibilityLabel, /June 2026, AED 4,720/);
  assert.match(bars[3].props.accessibilityLabel, /September 2026 so far, AED 620/);
  assert.ok(byId(history, 'limit-line'), 'the limit is drawn as a line');
  // The usual is the existing complete-three-month average, not this month.
  assert.match(text(byId(history, 'limit-usual')), /Your usual is about AED 4,840\.\s+This limit is below what you usually spend\./);
});

test('the dial and its steppers move the limit by a currency-sized step and never below one step', () => {
  const h = sheet({ states: { [TEXT]: '1500' } });
  const dial = byId(h.tree, 'limit-dial');
  assert.equal(walk(dial).find((node) => node.props?.accessibilityRole === 'adjustable').props.accessibilityValue.text, 'AED 1,500');
  byId(h.tree, 'limit-dial-raise').props.onPress();
  assert.deepEqual(h.events.at(-1), ['state', TEXT, '1525']);
  byId(h.tree, 'limit-dial-lower').props.onPress();
  assert.deepEqual(h.events.at(-1), ['state', TEXT, '1475']);
  assert.match(byId(h.tree, 'limit-dial-raise').props.accessibilityLabel, /Raise by AED 25/);
  // Swipe up/down on the adjustable dial does the same.
  walk(dial).find((node) => node.props?.accessibilityRole === 'adjustable')
    .props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
  assert.deepEqual(h.events.at(-1), ['state', TEXT, '1525']);
  const lowest = sheet({ states: { [TEXT]: '25' } });
  lowest.events.length = 0;
  byId(lowest.tree, 'limit-dial-lower').props.onPress();
  assert.equal(lowest.events.some((event) => event[0] === 'state' && event[1] === TEXT && event[2] === '0'), false,
    'lowering never sets a zero limit');
  const empty = sheet({ states: { [TEXT]: '' } });
  empty.events.length = 0;
  byId(empty.tree, 'limit-dial-lower').props.onPress();
  assert.equal(empty.events.some((event) => event[0] === 'state' && event[1] === TEXT), false);
  byId(empty.tree, 'limit-dial-raise').props.onPress();
  assert.deepEqual(empty.events.at(-1), ['state', TEXT, '25']);
  // An exact figure the step cannot reach is still typed.
  assert.ok(walk(h.tree).some((node) => node.type === 'TextInput' && node.props.value === '1500'));
});

test('a roomy limit says so; no history means no chart', () => {
  const roomy = sheet({ states: { [TEXT]: '6000' } });
  assert.match(text(byId(roomy.tree, 'limit-usual')), /leaves some room/);
  const fresh = sheet({ states: { [TEXT]: '500' }, state: { transactions: [] } });
  assert.equal(byId(fresh.tree, 'limit-history'), undefined);
});

// The harness's dining history: 5 Apr–5 Aug, AED 4,480 / 4,600 / 4,720 / 4,840 / 4,960.
const withHistoryFrom = (h, startISO) => h.deps['@/lib/store'].useStore().state.transactions
  .filter((tx) => tx.date >= startISO);

test('the usual averages only the months the ledger fully covers', () => {
  const { usualMonthlyMinor } = require('./load-typescript.cjs')(
    require('node:path').join(__dirname, '../../../src/lib/reference-presentation.ts'));
  const months = [{ startISO: '2026-06-01', fils: 0 }, { startISO: '2026-07-01', fils: 0 }, { startISO: '2026-08-01', fils: 90_000 }];
  assert.deepEqual({ ...usualMonthlyMinor(months, '2026-07-20') }, { averageFils: 90_000, fullMonths: 1 }, 'one month, not a third of it');
  assert.deepEqual({ ...usualMonthlyMinor(months, '2026-06-30') }, { averageFils: 45_000, fullMonths: 2 });
  assert.deepEqual({ ...usualMonthlyMinor(months, '2026-06-01') }, { averageFils: 30_000, fullMonths: 3 }, 'a covered month with no spending is zero');
  assert.equal(usualMonthlyMinor(months, '2026-08-02'), null, 'the month the ledger began in is not complete');
  assert.equal(usualMonthlyMinor(months, null), null);
});

test('a ledger that began last month shows that month as the usual, with no 3-month chip', () => {
  const base = createHarness();
  // History from 20 July: only August is a complete month.
  const transactions = [...withHistoryFrom(base, '2026-08-01'),
    { id: 'first', title: 'Cafe', amountFils: 1_000, category: 'other', date: '2026-07-20', type: 'expense', accountId: 'enbd', source: 'sms' }];
  const h = sheet({ states: { [TEXT]: '1500' }, state: { transactions } });
  assert.match(text(byId(h.tree, 'limit-usual')), /Your usual is about AED 4,960\.\s+This limit is below what you usually spend\./);
  assert.doesNotMatch(text(h.tree), /your 3-month average/);
  // History from this month only: no complete month, so no usual and no advice.
  const fresh = sheet({ states: { [TEXT]: '1500' }, state: { transactions: withHistoryFrom(base, '2026-08-02') } });
  assert.equal(byId(fresh.tree, 'limit-usual'), undefined);
  assert.equal(byId(fresh.tree, 'limit-history'), undefined);
});
