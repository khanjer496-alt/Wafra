'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');
const source = path.resolve(__dirname, '../../../src/lib/runtime-performance.ts');

function harness(flag, platform = 'android', sinkThrows = false) {
  let now = 10_000;
  const logs = [];
  class Clock extends Date { static now() { return now; } }
  const api = load(source, {
    '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async () => {} },
    'react-native': { Platform: { OS: platform }, AppState: { currentState: 'active' } },
  }, {
    Date: Clock,
    process: { env: { EXPO_PUBLIC_WAFRA_CAPTURE_TRACE: flag } },
    console: { info: (...args) => { logs.push(args); if (sinkThrows) throw new Error('sink unavailable'); } },
  });
  return { ...api, logs, advance: ms => { now += ms; } };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('runtime trace defaults off and preserves valid aggregate timing', () => {
  for (const flag of [undefined, '0', 'true']) {
    const h = harness(flag);
    h.recordRuntimeOperation('capture-plan', 123.4);
    assert.equal(h.logs.length, 0);
    assert.deepEqual(plain(h.getRuntimePerformanceSnapshot().operations['capture-plan']),
      { count: 1, maxMs: 123, totalMs: 123, recentMs: [123] });
  }
});

test('enabled trace emits only slow Android operations as closed tag plus numeric duration', () => {
  const h = harness('1');
  for (const ms of [0, 12, 99, 99.9]) h.recordRuntimeOperation('capture-plan', ms);
  assert.equal(h.logs.length, 0);
  h.recordRuntimeOperation('capture-plan', 100);
  h.recordRuntimeOperation('history-save-page', 250.6);
  assert.deepEqual(h.logs, [
    ['[WafraRuntimeOperation]', 'capture-plan', 100],
    ['[WafraRuntimeOperation]', 'history-save-page', 251],
  ]);
  for (const platform of ['ios', 'web']) {
    const other = harness('1', platform);
    other.recordRuntimeOperation('capture-plan', 500);
    assert.equal(other.logs.length, 0);
    assert.deepEqual(plain(other.getRuntimePerformanceSnapshot().operations), {});
  }
});

test('per-tag trace rate is bounded but every valid operation still aggregates', () => {
  const h = harness('1');
  for (let i = 0; i < 100; i++) h.recordRuntimeOperation('capture-plan', 200);
  assert.equal(h.logs.length, 1);
  h.advance(999);
  h.recordRuntimeOperation('capture-plan', 300);
  h.recordRuntimeOperation('capture-save', 400);
  assert.equal(h.logs.length, 2, 'another tag has its own bounded slot');
  h.advance(1);
  h.recordRuntimeOperation('capture-plan', 500);
  assert.equal(h.logs.length, 3);
  assert.deepEqual(plain(h.getRuntimePerformanceSnapshot().operations['capture-plan']),
    { count: 102, maxMs: 500, totalMs: 20_800, recentMs: [200, 200, 200, 200, 300, 500] });
});

test('arbitrary runtime tags and invalid durations never reach logs or aggregate keys', () => {
  const h = harness('1');
  let coerced = false;
  const privateObject = { toString() { coerced = true; throw new Error('private payload'); } };
  for (const tag of ['private merchant text', '__proto__', 'constructor', '', null, undefined, privateObject]) {
    assert.doesNotThrow(() => h.recordRuntimeOperation(tag, 500));
  }
  for (const duration of [NaN, Infinity, -Infinity, -1, '500', privateObject, null]) {
    assert.doesNotThrow(() => h.recordRuntimeOperation('capture-plan', duration));
  }
  assert.equal(coerced, false);
  assert.equal(h.logs.length, 0);
  assert.deepEqual(plain(h.getRuntimePerformanceSnapshot().operations), {});
});

test('a failing console sink never escapes or disables rate limiting and aggregates', () => {
  const h = harness('1', 'android', true);
  assert.doesNotThrow(() => h.recordRuntimeOperation('capture-save', 400));
  assert.doesNotThrow(() => h.recordRuntimeOperation('capture-save', 500));
  assert.equal(h.logs.length, 1);
  assert.deepEqual(plain(h.getRuntimePerformanceSnapshot().operations['capture-save']),
    { count: 2, maxMs: 500, totalMs: 900, recentMs: [400, 500] });
});
