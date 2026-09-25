'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const { diffRollingGlyphs, rollingDelay, isRollingDigit } = load(
  path.resolve(__dirname, '../../../src/lib/rolling-digits.ts'));

const rolled = (glyphs) => glyphs.filter((g) => g.changed).map((g) => g.char).join('');
const shape = (glyphs) => glyphs.map((g) => (g.changed ? '^' : '.')).join('');

test('first appearance and an unchanged value are static', () => {
  assert.equal(shape(diffRollingGlyphs(null, '4,562.37')), '........');
  assert.equal(shape(diffRollingGlyphs('4,562.37', '4,562.37')), '........');
});

test('only the digits that changed roll; marks never do', () => {
  // 45.62 → 52.37 (the capture board): every digit changes, the point stays.
  const glyphs = diffRollingGlyphs('45.62', '52.37');
  assert.equal(shape(glyphs), '^^.^^');
  assert.equal(rolled(glyphs), '5237');
  // 1,284.10 → 1,290.10: only the tens and units of the whole part.
  assert.equal(shape(diffRollingGlyphs('1,284.10', '1,290.10')), '...^^...');
});

test('figures align from the right when they grow or shrink', () => {
  // 99.00 → 100.00: the new leading 1 and the two pushed zeros roll; the
  // cents and the point stay still.
  const grown = diffRollingGlyphs('99.00', '100.00');
  assert.equal(shape(grown), '^^^...');
  assert.equal(grown[0].previous, '', 'a new position has nothing before it');
  assert.equal(grown[1].previous, '9');
  // 1,000 → 999: the group mark disappears; every remaining digit changed.
  assert.equal(shape(diffRollingGlyphs('1,000', '999')), '^^^');
});

test('changed digits stagger from the right, 60 ms apart', () => {
  const glyphs = diffRollingGlyphs('45.62', '52.37');
  const orders = Array.from(glyphs, (g) => g.order);
  assert.deepEqual(orders, [3, 2, -1, 1, 0]);
  assert.deepEqual(Array.from(glyphs, (g) => rollingDelay(g, 60)), [180, 120, 0, 60, 0]);
});

test('keys are stable per position from the right', () => {
  const a = Array.from(diffRollingGlyphs('5.00', '15.00'), (g) => g.key);
  assert.deepEqual(a, ['p4', 'p3', 'p2', 'p1', 'p0']);
});

test('Arabic-Indic digits roll like Latin ones; signs and currency marks do not', () => {
  assert.equal(isRollingDigit('٥'), true);
  assert.equal(isRollingDigit('۵'), true);
  assert.equal(isRollingDigit('−'), false);
  assert.equal(isRollingDigit('٫'), false);
  assert.equal(shape(diffRollingGlyphs('٤٥٫٦٢', '٤٥٫٧٢')), '...^.');
  assert.equal(shape(diffRollingGlyphs('−5.00', '+5.00')), '.....', 'a sign change is not a digit roll');
});
