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

const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const legendLine = (tree, key) => text(walk(tree).find((node) => node.props?.testID === `spending-share-bar-legend-${key}`)).trim();

test('Spending coins keep large totals exact, each in its category colour, with every coin in the legend', () => {
  const h = createHarness({ width: 390 });
  const tree = renderBand(h);
  const bar = walk(tree).find((node) => node.props?.testID === 'spending-share-bar');
  assert.ok(bar, 'one row of coins replaces the donut');
  assert.equal(walk(tree).some((node) => node.type === 'CategoryDonut'), false);
  const image = walk(bar).find((node) => node.props?.accessibilityRole === 'image');
  const segments = image.props.children;
  // Biggest first; widths are the exact minor-unit values, not rounded percentages.
  assert.deepEqual(segments.map((node) => node.props.style[1].flexGrow),
    [57_037_283, 49_275_024, 32_591_910, 20_951_942, 19_981_345, 14_161_961]);
  // Each coin is its category's own colour, the same one its row's glyph tile has on the sheet.
  const band = h.deps['@/hooks/use-band'].useBand('spending');
  const { categoryColor } = h.deps['@/lib/category-colors'];
  const order = ['utilities', 'transport', 'dining', 'loan', 'shopping', 'other'];
  assert.deepEqual(segments.map((node) => walk(node).find((part) => part.props?.testID?.startsWith('spending-share-bar-coin-')).props.style[1].backgroundColor),
    order.map(categoryColor));
  segments.forEach((node, index) => {
    const fills = new Set(walk(node).map((part) => flat(part.props?.style).backgroundColor).filter(Boolean));
    fills.delete(band.band); // the rim and the face's shade
    fills.delete('#FFFFFF'); // the sheen
    assert.deepEqual([...fills], [categoryColor(order[index])], `coin ${index} is one colour`);
  });
  // The legend names every coin with its amount and share, in the rows' own formatting.
  assert.equal(legendLine(tree, 'dining'), 'Dining AED 325,919.10 · 16.8%');
  assert.equal(legendLine(tree, 'other'), 'Other AED 141,619.61 · 7.3%');
  // One accessible image naming the three biggest and counting the rest; the
  // real "Other" category and the pooled rest keep different names.
  // Shares use the rows' own formatter and denominator, so the legend never
  // says "30%" over a row reading 29.4%.
  assert.match(image.props.accessibilityLabel, /Utilities 29.4%, Transport 25.4%, Dining 16.8%, 3 other categories 28.4%/);
  const legend = walk(tree).find((node) => node.props?.testID === 'spending-share-bar-legend');
  assert.equal(legend.props.importantForAccessibility, 'no-hide-descendants', 'the legend repeats the summary visually only');
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

test('a tapped coin pops up and dims the other coins and legend lines', () => {
  // The bar's one piece of state is the selected coin's key.
  const h = createHarness({ width: 390, states: { 0: 'dining' } });
  const tree = renderBand(h);
  const image = walk(tree).find((node) => node.props?.accessibilityRole === 'image');
  const coins = image.props.children;
  const opacity = (coin) => walk(coin).find((node) => node.props?.testID?.startsWith('spending-share-bar-paint-')).props.style[1].opacity.value;
  assert.deepEqual(coins.map(opacity), [0.32, 0.32, 1, 0.32, 0.32, 0.32], 'the other coins dim');
  assert.equal(coins[2].props.style[1].zIndex, 1, 'the lifted coin rises over its neighbour');
  const lines = walk(tree).find((node) => node.props?.testID === 'spending-share-bar-legend').props.children;
  assert.deepEqual(lines.map((line) => flat(line.props.style).opacity), [0.32, 0.32, 1, 0.32, 0.32, 0.32], 'so do the other legend lines');
  // The summary assistive tech hears does not change with a visual selection.
  assert.match(image.props.accessibilityLabel, /Utilities 29.4%, Transport 25.4%, Dining 16.8%, 3 other categories 28.4%/);
  // A tap on a coin or its legend line selects; a second tap puts it back.
  const press = coins[2].props.children.at(-1);
  assert.equal(press.props.accessible, false, 'no screen reader stops on a coin');
  assert.equal(press.props.importantForAccessibility, 'no');
  for (const target of [press, lines[2]]) {
    target.props.onPress();
    const [kind, , update] = h.events.at(-1);
    assert.equal(kind, 'state');
    assert.equal(update(null), 'dining');
    assert.equal(update('dining'), null);
  }
});

test('past seven categories the smallest share one coin, so the row never runs off the band', () => {
  const h = createHarness({ width: 320 });
  const many = Array.from({ length: 20 }, (_, index) => ({
    category: `c${index}`, spentFils: (20 - index) * 1_000, limitFils: null, ratio: null, remainingFils: null,
  }));
  const tree = renderBand(h, { rows: many, totalFils: many.reduce((sum, row) => sum + row.spentFils, 0) });
  const image = walk(tree).find((node) => node.props?.accessibilityRole === 'image');
  const coins = image.props.children;
  assert.equal(coins.length, 7);
  const grow = coins.map((node) => node.props.style[1].flexGrow);
  assert.deepEqual(grow.slice(0, 6), [20_000, 19_000, 18_000, 17_000, 16_000, 15_000]);
  assert.equal(grow[6], 14 * 15 / 2 * 1_000, 'the last coin is every remaining category together');
  const { CATEGORY_REST } = h.deps['@/lib/category-colors'];
  const rest = walk(tree).find((node) => node.props?.testID === 'spending-share-bar-coin-__rest');
  assert.equal(rest.props.style[1].backgroundColor, CATEGORY_REST, 'the pooled coin is no category\'s colour');
  assert.equal(legendLine(tree, '__rest'), '14 other categories AED 1,050.00 · 50%');
  // The spoken summary pools the same way it always has.
  assert.match(image.props.accessibilityLabel, /17 other categories/);
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

test('Spending share legend agrees with the rows when one category dominates', () => {
  // Rent 5,500 and a 24.92 ride: whole-number shares read "Rent 100%, Transport 0%"
  // over rows reading 99.5% and 0.5%.
  const h = createHarness({ width: 390 });
  const tree = renderBand(h, { totalFils: 552_492, rows: [
    { category: 'rent', spentFils: 550_000, limitFils: null, ratio: null, remainingFils: null },
    { category: 'transport', spentFils: 2_492, limitFils: 90_000, ratio: 2_492 / 90_000, remainingFils: 87_508 },
  ] });
  const image = walk(tree).find((node) => node.props?.accessibilityRole === 'image');
  assert.match(image.props.accessibilityLabel, /Rent 99.5%, Transport 0.5%$/);
  assert.doesNotMatch(text(tree), /\b(100|0)%/);
});
