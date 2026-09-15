'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, walk, text } = require('./reference-harness.cjs');

test('Spending donut keeps large totals readable and distinguishes the aggregate tail from real Other', () => {
  const h = createHarness({ width: 390 });
  const totalFils = 193_999_465;
  const rows = [
    ['utilities', 57_037_283],
    ['dining', 32_591_910],
    ['loan', 20_951_942],
    ['shopping', 19_981_345],
    ['other', 14_161_961],
    ['transport', 49_275_024],
  ].map(([category, spentFils]) => ({
    category,
    spentFils,
    limitFils: null,
    ratio: null,
    remainingFils: null,
  }));
  const noop = () => {};
  const tree = h.deps['@/components/spending/spending-overview'].SpendingOverview({
    periodLabel: 'All time',
    totalFils,
    rows,
    monthScoped: false,
    filter: 'all',
    onFilter: noop,
    onPeriod: noop,
    onCategory: noop,
    onNewLimit: noop,
  });
  const donut = walk(tree).find((node) => node.type === 'CategoryDonut');
  assert.ok(donut);
  assert.ok(donut.props.size < 196);
  assert.ok(donut.props.thickness <= 16);
  assert.equal(JSON.stringify(Array.from(donut.props.slices, (slice) => slice.label)), JSON.stringify([
    'Utilities', 'Dining', 'Loan', 'Shopping', 'Other', 'Other categories',
  ]));
  assert.equal(text(donut.props.centerValue), 'AED 1.94M');

  donut.props.onPressSlice('utilities');
  const selection = h.events.at(-1);
  assert.equal(selection[0], 'state');
  assert.equal(selection[1], 0);
  assert.equal(typeof selection[2], 'function');
  assert.equal(selection[2](null), 'utilities');
  assert.equal(selection[2]('utilities'), null);
});
