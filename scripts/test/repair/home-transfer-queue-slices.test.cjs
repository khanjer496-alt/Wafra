'use strict';
/**
 * Home's transfer queue after a cold launch was one task: the full transfer
 * graph plus the activity walk over the whole ledger. On the owner's 15k-row
 * phone that was the one long task after Home appeared. The two passes now run
 * in separate deferred slices with frames between them. Scheduling only: the
 * same graph (cached for the stored receipt) feeds the same activity walk.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../../src/screens/journal-home-screen.tsx'), 'utf8');
const start = source.indexOf('const task = runAfterFirstFrames(() => {\n      if (cancelled) return;\n      if (!state.transactions.some(isTransferCandidate))');
const effect = source.slice(start, source.indexOf('// Transfer receipts change the reconciliation even when the arrays do not.', start));

test('the graph and the activity walk run in separate slices', () => {
  assert.ok(start > 0, 'Home transfer queue effect found');
  const graphAt = effect.indexOf('transferReconciliationForState(state)');
  const sliceAt = effect.indexOf('activityTask = runAfterFirstFrames(() => {');
  const activityAt = effect.indexOf('getTransferActivity(state.transactions, state.accounts, reconciliation)');
  assert.ok(graphAt > 0 && sliceAt > graphAt && activityAt > sliceAt,
    'the activity walk is scheduled after the graph, in its own slice');
  // Frames between the slices (no lease wait: the entrance lease was already
  // waited out before the graph), and both slices honour cancellation.
  assert.match(effect, /\}, \{ idle: false, delayMs: 0 \}\);/);
  assert.match(effect, /activityTask = runAfterFirstFrames\(\(\) => \{\n\s+if \(cancelled\) return;/);
  assert.match(effect, /task\.cancel\(\);\n\s+activityTask\?\.cancel\(\);/);
});

test('no candidate and no graph still publish an empty queue without a second slice', () => {
  const noCandidate = effect.slice(effect.indexOf('if (!state.transactions.some(isTransferCandidate))'), effect.indexOf('const reconciliation'));
  assert.match(noCandidate, /publish\(\{ count: 0, incomingFils: 0, outgoingFils: 0, questions: 0 \}\);\n\s+return;/);
  const noGraph = effect.slice(effect.indexOf('if (!reconciliation)'), effect.indexOf('activityTask ='));
  assert.match(noGraph, /publish\(\{ count: 0, incomingFils: 0, outgoingFils: 0, questions: 0 \}\);\n\s+return;/);
});
