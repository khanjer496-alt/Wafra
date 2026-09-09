'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const load = require('./load-typescript.cjs');
const file = path.resolve(__dirname, '../../../src/lib/capture-trace.ts');
const harness = (flag, sink) => {
  const logs = [];
  return { logs, ...load(file, {}, { process: { env: { EXPO_PUBLIC_WAFRA_CAPTURE_TRACE: flag } },
    console: { info: sink ?? ((...args) => logs.push(args)) } }) };
};
test('capture trace is closed by default and requires the exact explicit build flag', () => {
  for (const flag of [undefined, '', '0', 'true', 'yes']) {
    const h = harness(flag); h.captureTrace('inbox:start');
    assert.equal(h.captureTraceEnabled(), false); assert.equal(h.logs.length, 0);
  }
});
test('enabled trace accepts only a fixed stage plus numeric counts and elapsed times', () => {
  const h = harness('1'); h.captureTrace('page:progress', 123, 1200.4, 2);
  assert.deepEqual(JSON.parse(h.logs[0][1]), { phase: 'page:progress', count: 123, ms: 1200, page: 2 });
  for (const invalid of ['private message', { raw: 'private' }, NaN, Infinity, -1]) {
    h.captureTrace('page:progress', invalid); h.captureTrace('page:progress', 0, invalid);
    h.captureTrace('page:progress', 0, 0, invalid);
  }
  h.captureTrace('unrecognised private stage');
  assert.equal(h.logs.length, 1);
});
test('logging failures never change financial execution', () => {
  const h = harness('1', () => { throw new Error('sink unavailable'); });
  assert.doesNotThrow(() => h.captureTrace('save:done', 1, 20));
});
test('public APK builds default tracing off and Play bundles refuse it', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/build-apk.yml'), 'utf8');
  assert.match(workflow, /capture_trace:\n[\s\S]*?default: false/);
  assert.ok(workflow.includes("github.event.inputs.capture_trace == 'true' && '1' || '0'"));
  assert.ok(workflow.includes("github.event.inputs.capture_trace == 'true' && github.event.inputs.bundle == 'true'"));
});
