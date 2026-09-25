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

test('steppers move the limit by a currency-sized step and never below one step', () => {
  const h = sheet({ states: { [TEXT]: '1500' } });
  byId(h.tree, 'limit-step-up').props.onPress();
  assert.deepEqual(h.events.at(-1), ['state', TEXT, '1525']);
  byId(h.tree, 'limit-step-down').props.onPress();
  assert.deepEqual(h.events.at(-1), ['state', TEXT, '1475']);
  assert.match(byId(h.tree, 'limit-step-up').props.accessibilityLabel, /Raise by AED 25/);
  const empty = sheet({ states: { [TEXT]: '' } });
  assert.equal(byId(empty.tree, 'limit-step-down').props.disabled, true);
  byId(empty.tree, 'limit-step-up').props.onPress();
  assert.deepEqual(empty.events.at(-1), ['state', TEXT, '25']);
});

test('a roomy limit says so; no history means no chart', () => {
  const roomy = sheet({ states: { [TEXT]: '6000' } });
  assert.match(text(byId(roomy.tree, 'limit-usual')), /leaves some room/);
  const fresh = sheet({ states: { [TEXT]: '500' }, state: { transactions: [] } });
  assert.equal(byId(fresh.tree, 'limit-history'), undefined);
});
