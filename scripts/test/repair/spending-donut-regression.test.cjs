'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const noop = () => {};
const renderOverview = (h, overrides = {}) => h.deps['@/components/spending/spending-overview'].SpendingOverview({
  periodLabel: 'All time',
  totalFils: 193_999_465,
  rows: [
    ['utilities', 57_037_283],
    ['dining', 32_591_910],
    ['loan', 20_951_942],
    ['shopping', 19_981_345],
    ['other', 14_161_961],
    ['transport', 49_275_024],
  ].map(([category, spentFils]) => ({ category, spentFils, limitFils: null, ratio: null, remainingFils: null })),
  monthScoped: false,
  filter: 'all',
  onFilter: noop,
  onPeriod: noop,
  onCategory: noop,
  onNewLimit: noop,
  ...overrides,
});

test('Spending share bar keeps large totals exact and distinguishes the aggregate tail from real Other', () => {
  const h = createHarness({ width: 390 });
  const tree = renderOverview(h);
  const bar = walk(tree).find((node) => node.props?.testID === 'spending-share-bar');
  assert.ok(bar, 'one stacked share bar replaces the donut');
  assert.equal(walk(tree).some((node) => node.type === 'CategoryDonut'), false);
  const segments = walk(bar).filter((node) => String(node.props?.testID ?? '').startsWith('spending-share-segment-'));
  assert.deepEqual(segments.map((node) => node.props.testID.replace('spending-share-segment-', '')),
    ['utilities', 'dining', 'loan', 'shopping', 'other', '__tail']);
  // Segment widths are the exact minor-unit values, not rounded percentages.
  assert.equal(segments[0].props.style[1].flexGrow, 57_037_283);
  assert.equal(segments.at(-1).props.style[1].flexGrow, 49_275_024);
  // The picture is one accessible image whose label lists every share; the
  // real "Other" category and the pooled tail keep different names.
  assert.equal(bar.props.accessibilityRole, 'image');
  assert.match(bar.props.accessibilityLabel, /Other \d/);
  assert.match(bar.props.accessibilityLabel, /Other categories \d/);
  assert.match(text(tree), /1,939,994\.65/, 'The exact total, including cents, remains visible');
});

test('Spending pace shows only when the caller supplies the running period', () => {
  const h = createHarness();
  const withPace = renderOverview(h, { paceLabel: 'day 6 of 30' });
  assert.equal(text(walk(withPace).find((node) => node.props?.testID === 'spending-pace')), 'day 6 of 30');
  const without = renderOverview(h, { paceLabel: null });
  assert.equal(walk(without).some((node) => node.props?.testID === 'spending-pace'), false);
});

test('limit captions read "N% of LIMIT limit" and colour amber from 85% and red above 100%', () => {
  const h = createHarness();
  const row = (category, spentFils, limitFils) => ({ category, spentFils, limitFils, ratio: spentFils / limitFils, remainingFils: limitFils - spentFils });
  const tree = renderOverview(h, { totalFils: 300_000, monthScoped: true, rows: [
    row('groceries', 61_200, 70_000), row('dining', 33_400, 30_000), row('transport', 18_600, 25_000),
  ] });
  const caption = (id) => walk(tree).find((node) => node.props?.testID === `spending-limit-${id}`);
  assert.match(text(caption('groceries')), /87%\s+of AED 700\.00 limit/);
  const ink = (id) => JSON.stringify(caption(id).props.style);
  assert.ok(ink('groceries').includes(h.theme.warning), 'amber at 87%');
  assert.match(text(caption('dining')), /111%\s+of AED 300\.00 limit/);
  assert.ok(ink('dining').includes(h.theme.expense), 'red above 100%');
  assert.ok(ink('transport').includes(h.theme.textSecondary), 'neutral below 85%');
  const { limitHealth } = h.deps['@/components/spending/spending-overview'];
  assert.equal(limitHealth(0.849), 'ok');
  assert.equal(limitHealth(0.85), 'warning');
  assert.equal(limitHealth(1), 'warning');
  assert.equal(limitHealth(1.0001), 'over');
  assert.equal(limitHealth(null), 'ok');
});
