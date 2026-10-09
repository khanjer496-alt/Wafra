'use strict';
/**
 * Home's transfer queue after a cold launch was one task: the full transfer
 * graph plus the activity walk over the whole ledger. On the owner's 15k-row
 * phone that was the one long task after Home appeared. The graph is now built
 * in short slices (transferReconciliationForStateInSlices, the same cached
 * reconciliation) and the activity walk runs in its own slice after it.
 * Scheduling only: the same graph feeds the same activity walk.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../../src/screens/journal-home-screen.tsx'), 'utf8');
const start = source.indexOf('const task = runAfterFirstFrames(() => {\n      if (cancelled) return;\n      if (!state.transactions.some(isTransferCandidate))');
const effect = source.slice(start, source.indexOf('// Transfer receipts change the reconciliation even when the arrays do not.', start));

test('the graph is built in slices, then the activity walk runs in its own slice', () => {
  assert.ok(start > 0, 'Home transfer queue effect found');
  const graphAt = effect.indexOf('graph = transferReconciliationForStateInSlices(state, (reconciliation) => {');
  const sliceAt = effect.indexOf('activityTask = runAfterFirstFrames(() => {');
  const activityAt = effect.indexOf('getTransferActivity(state.transactions, state.accounts, reconciliation)');
  assert.ok(graphAt > 0 && sliceAt > graphAt && activityAt > sliceAt,
    'the activity walk is scheduled once the sliced graph has answered');
  assert.doesNotMatch(effect, /transferReconciliationForState\(state\)/, 'no synchronous graph build on Home');
  // Frames between graph and walk (no second lease wait), and a ledger change
  // or blur cancels the graph build as well as both slices.
  assert.match(effect, /\}, \{ idle: false, delayMs: 0 \}\);/);
  assert.match(effect, /activityTask = runAfterFirstFrames\(\(\) => \{\n\s+if \(cancelled\) return;/);
  assert.match(effect, /task\.cancel\(\);\n\s+graph\?\.cancel\(\);\n\s+activityTask\?\.cancel\(\);/);
});

test('no candidate and no graph still publish an empty queue without a walk', () => {
  const noCandidate = effect.slice(effect.indexOf('if (!state.transactions.some(isTransferCandidate))'), effect.indexOf('graph ='));
  assert.match(noCandidate, /publish\(\{ count: 0, incomingFils: 0, outgoingFils: 0, questions: 0 \}\);\n\s+return;/);
  const noGraph = effect.slice(effect.indexOf('if (!reconciliation)'), effect.indexOf('activityTask ='));
  assert.match(noGraph, /publish\(\{ count: 0, incomingFils: 0, outgoingFils: 0, questions: 0 \}\);\n\s+return;/);
});

test('Transactions waits for the sliced graph when it recomputes after the first frames', () => {
  const screen = fs.readFileSync(path.resolve(__dirname, '../../../src/app/transactions.tsx'), 'utf8');
  assert.match(screen, /graph = transferReconciliationForStateInSlices\(input, \(reconciliation\) => \{\n\s+if \(!cancelled\) setSeparation\(separationFor\(input, reconciliation\)\);/);
  assert.match(screen, /return \(\) => \{ cancelled = true; task\.cancel\(\); graph\?\.cancel\(\); \};/);
});
