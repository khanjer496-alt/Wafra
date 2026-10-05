'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);
// The harness shows Reduce Motion: a gold coin is drawn at full opacity, a spent place not at all.
const gold = (stack, prefix) => walk(stack)
  .filter((node) => node.props?.testID?.startsWith(`${prefix}-coin-`))
  .map((node) => [node.props.style].flat(2).find((style) => style && style.opacity)?.opacity?.value === 1);
const hidden = (node) => node.props.importantForAccessibility === 'no-hide-descendants' && node.props.accessibilityElementsHidden === true;

test('Home: Left in budgets carries a coin stack of the share still left, hidden from assistive tech', () => {
  const h = createHarness({ platform: 'ios' });
  const tree = h.render('home');
  const tile = byId(tree, 'home-left-to-spend');
  const stack = byId(tile, 'home-left-coins');
  assert.ok(stack, 'the stack sits inside the Left-in-budgets tile');
  assert.ok(hidden(stack));
  // Harness budgets total AED 6,500 with AED 2,630 left: 40% of 8 coins is 3 gold.
  assert.deepEqual(gold(stack, 'home-left-coins'), [true, true, true, false, false, false, false, false]);
  // The spoken label and written figure are unchanged by the drawing.
  assert.equal(tile.props.accessibilityLabel, 'Left in budgets, AED 2,630. AED 105.20 a day · 25 days left');
  assert.match(text(tile), /2,630/);
});

test('Home: over every budget the stack is empty; no budget or Larger Text draws none', () => {
  const over = createHarness({ platform: 'ios', state: { budgets: [{ category: 'dining', limitFils: 10_000 }] } }).render('home');
  const stack = byId(over, 'home-left-coins');
  assert.ok(stack);
  assert.equal(gold(stack, 'home-left-coins').filter(Boolean).length, 0);
  const empty = createHarness({ empty: true, platform: 'ios' }).render('home');
  assert.ok(byId(empty, 'home-set-budget'), 'the set-a-budget variant');
  assert.equal(byId(empty, 'home-left-coins'), undefined);
  const large = createHarness({ platform: 'ios', largeText: true }).render('home');
  assert.ok(byId(large, 'home-left-to-spend'));
  assert.equal(byId(large, 'home-left-coins'), undefined, 'the figure keeps the whole tile');
});

function limitSheet(limit) {
  const h = createHarness({ states: { 1: limit } });
  Object.assign(h.deps['@/lib/period'], { daysInPeriod: () => 30, elapsedDays: () => 6 });
  delete h.deps['@/components/limit-sheet'];
  const { LimitSheet } = h.local('@/components/limit-sheet');
  const tree = LimitSheet({ category: 'dining', open: true, monthKey: '2026-09', onClose: () => {} });
  return { tree, band: h.deps['@/hooks/use-band'].useBand('spending') };
}

test('Limits: this month rises as coins toward a limit line in the limit status colour', () => {
  // Dining has AED 620 this month.
  const cases = [
    ['1500', 4, 'limitOk'], // 41%: within
    ['700', 9, 'statusNear'], // 89%: near, never drawn as full
    ['500', 10, 'statusOver'], // over: the stack is full to the line
  ];
  for (const [limit, filled, tone] of cases) {
    const { tree, band } = limitSheet(limit);
    const coins = byId(tree, 'limit-coins');
    assert.ok(coins);
    assert.ok(hidden(coins));
    assert.equal(coins.props.accessible, false);
    const drawn = gold(byId(coins, 'limit-coin-stack'), 'limit-coin-stack');
    assert.equal(drawn.length, 10);
    assert.equal(drawn.filter(Boolean).length, filled, `limit ${limit}`);
    assert.equal([byId(coins, 'limit-coins-line').props.style].flat().find((style) => style.backgroundColor).backgroundColor, band[tone]);
  }
  // The written figures and the status bar beside the coins are unchanged.
  const { tree } = limitSheet('1500');
  assert.ok(byId(tree, 'limit-status-bar'));
  assert.match(text(tree), /AED 620\s+\/\s+AED 1,500/);
  assert.match(text(tree), /AED 880 left/);
});

test('Limits: no limit typed yet draws no coins', () => {
  const { tree } = limitSheet('');
  assert.equal(byId(tree, 'limit-coins'), undefined);
});
