'use strict';
// The arithmetic behind the coin drawings: a share fills a fixed stack without
// ever drawing a little money as none, or nearly all as all.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const { filledCoins, shareOf } = load(path.resolve(__dirname, '../../../src/lib/coin-math.ts'));

test('filledCoins: empty is empty, full is full, and anything between shows', () => {
  assert.equal(filledCoins(0, 10), 0);
  assert.equal(filledCoins(-0.2, 10), 0);
  assert.equal(filledCoins(Number.NaN, 10), 0);
  assert.equal(filledCoins(1, 10), 10);
  assert.equal(filledCoins(1.4, 10), 10, 'over budget still draws a full stack, never more');
  assert.equal(filledCoins(0.01, 10), 1, 'a little money left is never drawn as none');
  assert.equal(filledCoins(0.99, 10), 9, 'nearly all is never drawn as all');
  assert.equal(filledCoins(0.5, 10), 5);
  assert.equal(filledCoins(0.34, 3), 1);
  assert.equal(filledCoins(0.5, 0), 0, 'a one-coin stack is all or nothing');
});

test('shareOf: a part of a positive whole, clamped to 0..1', () => {
  assert.equal(shareOf(50, 200), 0.25);
  assert.equal(shareOf(300, 200), 1);
  assert.equal(shareOf(-10, 200), 0);
  assert.equal(shareOf(10, 0), 0);
  assert.equal(shareOf(Number.NaN, 10), 0);
});
