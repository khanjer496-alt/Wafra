'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const reference = require('./ledger-reference.cjs');
const { internalTransferIds } = load(path.resolve(__dirname, '../../../src/lib/ledger.ts'));
const accounts = [{ id: 'checking' }, { id: 'savings', archived: true }];
function fixture(count) {
  const rows = [];
  for (let i = 0; i < count / 2; i += 1) {
    const date = new Date(Date.UTC(2014, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    rows.push({ id: `out-${i}`, date, type: 'expense', title: 'Outgoing transfer', amountFils: 50000, accountId: 'checking', category: 'other' },
      { id: `in-${i}`, date, type: 'income', title: 'Incoming transfer', amountFils: 50000, accountId: 'savings', category: 'other' });
  }
  return rows.reverse();
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const measure = (fn, rows) => { const start = performance.now(); const pairs = fn(rows, accounts); return { ms: performance.now() - start, pairs }; };
const results = [];
for (const count of [1000, 5000, 10000]) {
  const rows = fixture(count);
  const expected = reference(rows, accounts);
  assert.equal(expected.size, count);
  assert.deepEqual([...internalTransferIds(rows, accounts)], [...expected]);
  const before = []; const after = [];
  for (let i = 0; i < 3; i += 1) {
    before.push(measure(reference, rows).ms);
    after.push(measure(internalTransferIds, rows).ms);
  }
  results.push({ rows: count, paired_ids: expected.size, before_ms: +median(before).toFixed(3),
    after_ms: +median(after).toFixed(3), speedup: +(median(before) / median(after)).toFixed(2),
    runs_before_ms: before, runs_after_ms: after });
}
console.log(JSON.stringify({ runtime: process.version, platform: process.platform,
  scope: 'Synthetic repeated-amount, date-fallback transfer matching ONLY; not Android, SMS parsing, encryption, or end-to-end import.',
  baseline: 'b96b253 / internalTransferIds reference', repetitions: 3, results }, null, 2));
