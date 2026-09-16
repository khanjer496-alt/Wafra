'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const native = require('../build/stub-react-native');
const runtime = require('../build/runtime-performance');

test('runtime operation diagnostics retain only fixed timing aggregates', () => {
  const before = native.Platform.OS;
  native.Platform.OS = 'android';
  try {
    runtime.recordRuntimeOperation('ask-plan', 12.4);
    runtime.recordRuntimeOperation('ask-plan', 28.7);
    runtime.recordRuntimeOperation('ask-evidence', 9);
    const snapshot = runtime.getRuntimePerformanceSnapshot();
    assert.deepEqual(snapshot.operations['ask-plan'], {
      count: 2,
      maxMs: 29,
      totalMs: 41,
      recentMs: [12, 29],
    });
    assert.deepEqual(snapshot.operations['ask-evidence'], {
      count: 1,
      maxMs: 9,
      totalMs: 9,
      recentMs: [9],
    });
    assert.equal(JSON.stringify(snapshot.operations).includes('transaction'), false);
    assert.equal(JSON.stringify(snapshot.operations).includes('merchant'), false);
  } finally {
    native.Platform.OS = before;
  }
});
