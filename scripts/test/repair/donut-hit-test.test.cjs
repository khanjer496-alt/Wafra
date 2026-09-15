'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const { donutSliceAtPoint } = load(path.resolve(__dirname, '../../../src/lib/donut-hit-test.ts'));
const slices = [
  { key: 'utilities', value: 42 },
  { key: 'shopping', value: 21 },
  { key: 'other', value: 37 },
];
const size = 196;
const thickness = 22;
const c = size / 2;
const r = size / 2 - thickness / 2;
const point = (degrees, radius = r) => {
  const radians = (degrees - 90) * Math.PI / 180;
  return [c + Math.cos(radians) * radius, c + Math.sin(radians) * radius];
};

test('donut hit testing follows the painted clockwise slices from 12 o’clock', () => {
  let p = point(20); assert.equal(donutSliceAtPoint(slices, size, thickness, ...p), 'utilities');
  p = point(180); assert.equal(donutSliceAtPoint(slices, size, thickness, ...p), 'shopping');
  p = point(300); assert.equal(donutSliceAtPoint(slices, size, thickness, ...p), 'other');
});

test('donut uses a forgiving phone-sized touch band around the visible ring', () => {
  const innerVisual = r - thickness / 2;
  const outerVisual = r + thickness / 2;
  assert.equal(donutSliceAtPoint(slices, size, thickness, ...point(20, innerVisual - 12)), 'utilities');
  assert.equal(donutSliceAtPoint(slices, size, thickness, ...point(20, outerVisual + 12)), 'utilities');
  assert.equal(donutSliceAtPoint(slices, size, thickness, ...point(20, innerVisual - 18)), null);
  assert.equal(donutSliceAtPoint(slices, size, thickness, ...point(20, outerVisual + 18)), null);
});

test('donut center and outside area do not accidentally open a category', () => {
  assert.equal(donutSliceAtPoint(slices, size, thickness, c, c), null);
  assert.equal(donutSliceAtPoint(slices, size, thickness, 0, 0), null);
});

test('visual separator gaps remain tappable instead of becoming dead zones', () => {
  // Utilities ends at 151.2° clockwise from 12 o’clock. The logical resolver
  // intentionally gives that boundary to the next slice rather than returning null.
  const p = point(151.25);
  assert.equal(donutSliceAtPoint(slices, size, thickness, ...p), 'shopping');
});
