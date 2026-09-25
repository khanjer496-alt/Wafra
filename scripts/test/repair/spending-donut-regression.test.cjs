'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const noop = () => {};
const rows = [
  ['utilities', 57_037_283],
  ['dining', 32_591_910],
  ['loan', 20_951_942],
  ['shopping', 19_981_345],
  ['other', 14_161_961],
  ['transport', 49_275_024],
].map(([category, spentFils]) => ({ category, spentFils, limitFils: null, ratio: null, remainingFils: null }));
const renderOverview = (h, overrides = {}) => h.deps['@/components/spending/spending-overview'].SpendingOverview({
  totalFils: 193_999_465,
  rows,
  monthScoped: false,
  filter: 'all',
  onFilter: noop,
  onCategory: noop,
  onNewLimit: noop,
  ...overrides,
});
renderOverview.rows = rows;

// Design language E: the total and the share bar sit on Spending's clay band
// (SpendingCategoriesBand); the rows that add up to it stay on the sheet.
const renderBand = (h, overrides = {}) => h.deps['@/components/spending/spending-band'].SpendingCategoriesBand({
  palette: h.deps['@/hooks/use-band'].useBand('spending'),
  label: 'Spent in All time',
  totalFils: 193_999_465,
  paceLabel: null,
  rows: renderOverview.rows,
  ...overrides,
});

test('Spending share bar keeps large totals exact, one tone, the top three named and the rest counted', () => {
  const h = createHarness({ width: 390 });
  const tree = renderBand(h);
  const bar = walk(tree).find((node) => node.props?.testID === 'spending-share-bar');
  assert.ok(bar, 'one stacked share bar replaces the donut');
  assert.equal(walk(tree).some((node) => node.type === 'CategoryDonut'), false);
  const image = walk(bar).find((node) => node.props?.accessibilityRole === 'image');
  const segments = image.props.children;
  // Biggest first; widths are the exact minor-unit values, not rounded percentages.
  assert.deepEqual(segments.map((node) => node.props.style[1].flexGrow),
    [57_037_283, 49_275_024, 32_591_910, 20_951_942, 19_981_345, 14_161_961]);
  // One tone: every segment is the band's own text colour, never a category hue.
  const band = h.deps['@/hooks/use-band'].useBand('spending');
  assert.ok(segments.every((node) => node.props.style[1].backgroundColor === band.onBand));
  // One accessible image naming the three biggest and counting the rest; the
  // real "Other" category and the pooled rest keep different names.
  assert.match(image.props.accessibilityLabel, /Utilities 30%, Transport 25%, Dining 17%, 3 other categories 28%/);
  const withOther = renderBand(h, { rows: [
    { category: 'other', spentFils: 50_000, limitFils: null, ratio: null, remainingFils: null },
    { category: 'dining', spentFils: 30_000, limitFils: null, ratio: null, remainingFils: null },
    { category: 'transport', spentFils: 10_000, limitFils: null, ratio: null, remainingFils: null },
    { category: 'shopping', spentFils: 10_000, limitFils: null, ratio: null, remainingFils: null },
  ], totalFils: 100_000 });
  const otherLabel = walk(withOther).find((node) => node.props?.accessibilityRole === 'image').props.accessibilityLabel;
  assert.match(otherLabel, /Other 50%/);
  assert.match(otherLabel, /1 other category 10%/);
  assert.match(text(walk(tree).find((node) => node.props?.testID === 'spending-total')), /1,939,994\.65/,
    'The exact total, including cents, remains visible');
});

test('Spending pace shows only when the caller supplies the running period', () => {
  const h = createHarness();
  const withPace = renderBand(h, { paceLabel: 'Day 6 of 30' });
  assert.equal(text(walk(withPace).find((node) => node.props?.testID === 'spending-pace')), 'Day 6 of 30');
  const without = renderBand(h, { paceLabel: null });
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
