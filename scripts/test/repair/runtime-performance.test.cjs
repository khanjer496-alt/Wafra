'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const native = require('../build/stub-react-native');
const asyncStorage = require('../build/stub-async-storage');
const runtime = require('../build/runtime-performance');

const BREADCRUMB_KEY = 'wafra.runtime-breadcrumb.v1';

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

test('runtime diagnostics preserve source-free interaction pressure across a process restart', async () => {
  const before = native.Platform.OS;
  native.Platform.OS = 'android';
  asyncStorage.__storage.reset();
  await asyncStorage.default.setItem(BREADCRUMB_KEY, JSON.stringify({
    version: 1,
    processStartedAt: 1,
    updatedAt: Date.now() - 5_000,
    recentMainTabPresses2s: 9,
    lastStallMs: 840,
    maxStallMs: 1_270,
    stallsOver100Ms: 4,
  }));

  const cleanup = runtime.startRuntimePerformanceMonitor();
  try {
    // The persisted read is intentionally async so app startup never waits on
    // diagnostics. Let that microtask settle before inspecting the snapshot.
    await Promise.resolve();
    await Promise.resolve();
    const previous = runtime.getRuntimePerformanceSnapshot().previousProcess;
    assert.ok(previous);
    assert.equal(previous.recentMainTabPresses2s, 9);
    assert.equal(previous.lastStallMs, 840);
    assert.equal(previous.maxStallMs, 1_270);
    assert.equal(previous.stallsOver100Ms, 4);
    assert.ok(previous.updatedAgeMs >= 5_000);

    runtime.recordRuntimeInteraction('main-tab-press');
    runtime.recordRuntimeInteraction('main-tab-press');
    runtime.recordRuntimeInteraction('main-tab-press');
    assert.equal(runtime.getRuntimePerformanceSnapshot().recentMainTabPresses2s, 3);

    // The first press writes immediately and the rest coalesce into one short
    // trailing write. Wait past that bound and inspect what would survive a kill.
    await new Promise((resolve) => setTimeout(resolve, 320));
    const persisted = JSON.parse(await asyncStorage.default.getItem(BREADCRUMB_KEY));
    assert.equal(persisted.recentMainTabPresses2s, 3);
    assert.equal('screen' in persisted, false);
    assert.equal('route' in persisted, false);
    assert.equal('transaction' in persisted, false);
    assert.equal('merchant' in persisted, false);
  } finally {
    cleanup();
    native.Platform.OS = before;
  }
});
