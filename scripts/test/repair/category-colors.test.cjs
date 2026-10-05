'use strict';
// Each category's own colour: the same everywhere, readable under dark ink and
// on Spending's near-black band, and stable for custom categories.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const colors = load(path.join(root, 'src/lib/category-colors.ts'));
const theme = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (x) => x.android } } });
const tiles = load(path.join(root, 'src/lib/spending-calendar-tiles.ts'), { '@/constants/theme': theme });

test('every category colour holds 7:1 for dark ink and against the Spending band in both schemes', () => {
  for (const color of colors.CATEGORY_PALETTE) {
    assert.ok(tiles.contrastRatio(colors.CATEGORY_INK, color) >= 7, `ink on ${color}`);
    for (const scheme of ['light', 'dark']) {
      const band = theme.BandPalettes[scheme].spending.band;
      assert.ok(tiles.contrastRatio(color, band) >= 7, `${color} on ${scheme} band ${band}`);
    }
  }
});

test('built-in categories each have their own colour; custom ones take a stable colour from the same set', () => {
  assert.equal(new Set(colors.CATEGORY_PALETTE).size, colors.CATEGORY_PALETTE.length, 'no two built-in categories share a colour');
  const custom = 'custom:expense:Pets';
  assert.equal(colors.categoryColor(custom), colors.categoryColor(custom));
  assert.ok(colors.CATEGORY_PALETTE.includes(colors.categoryColor(custom)));
  // The pooled coin is no category's colour, and still reads on the band.
  assert.ok(!colors.CATEGORY_PALETTE.includes(colors.CATEGORY_REST));
  for (const scheme of ['light', 'dark']) {
    assert.ok(tiles.contrastRatio(colors.CATEGORY_REST, theme.BandPalettes[scheme].spending.band) >= 4.5);
  }
});

test('categories drawn together never share a colour: a custom one moves off a taken colour', () => {
  const ids = ['dining', 'rent', 'custom:expense:Pets', 'custom:expense:Gym', 'custom:expense:Kids', 'groceries'];
  const assigned = colors.categoryColors(ids);
  assert.equal(assigned.get('dining'), colors.categoryColor('dining'), 'built-in categories keep their own');
  assert.equal(assigned.get('rent'), colors.categoryColor('rent'));
  assert.equal(new Set(ids.map((id) => assigned.get(id))).size, ids.length);
  assert.deepEqual([...colors.categoryColors(ids)], [...assigned], 'the same list gets the same colours');
  // A custom category whose hashed colour is free keeps it.
  assert.equal(colors.categoryColors(['custom:expense:Pets']).get('custom:expense:Pets'), colors.categoryColor('custom:expense:Pets'));
});
