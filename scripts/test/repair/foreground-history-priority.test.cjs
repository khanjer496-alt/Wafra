'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');

test('rapid navigation extends one foreground-history quiet deadline', () => {
  const priority = load(path.join(root, 'src/lib/foreground-history-priority.ts'));
  priority.prioritizeForegroundNavigation(20, 100);
  assert.equal(priority.foregroundHistoryBlockedFor(105), 15);
  priority.prioritizeForegroundNavigation(30, 110);
  assert.equal(priority.foregroundHistoryBlockedFor(105), 35);
  assert.equal(priority.foregroundHistoryBlockedFor(140), 0);
});

test('foreground history waits for the longer of its normal yield and navigation lease', async () => {
  let now = 1_000;
  let slept = 0;
  class Clock extends Date { static now() { return now; } }
  const priority = load(path.join(root, 'src/lib/foreground-history-priority.ts'), {}, {
    Date: Clock,
    setTimeout: (callback, milliseconds) => {
      slept += milliseconds;
      now += milliseconds;
      callback();
      return 1;
    },
  });
  priority.prioritizeForegroundNavigation(25, now);
  await priority.waitForForegroundHistoryIdle(5);
  assert.equal(slept, 25);
  assert.equal(now, 1_025);
});

