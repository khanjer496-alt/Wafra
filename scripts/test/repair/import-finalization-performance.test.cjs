'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '../../..');
const source = name => fs.readFileSync(path.join(root, 'src/lib', name + '.ts'), 'utf8');
function compiled(body, dependencies, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, require: name => dependencies[name] ?? require(name.startsWith('@/lib/') ? '../build/' + name.slice(6) : name), ...globals });
  return module.exports;
}
function runner(legacy = false) {
  let computations = 0;
  // Instrument only graph entry; execute the actual monetary implementation.
  const core = compiled(source('transfer-reconciliation').replace('function reconcile(ctx: Context): TransferReconciliationResult {',
    'function reconcile(ctx: Context): TransferReconciliationResult { countGraph();'), {}, { countGraph: () => computations++ });
  const body = legacy ? source('ledger-import').replace('sortTransactionsIfNeeded(', 'sortTransactions(') : source('ledger-import');
  const imports = compiled(body, { '@/lib/transfer-reconciliation': core });
  return { apply: imports.applyMaterializedImportBatch, computations: () => computations };
}
const accounts = [
  { id: 'a', name: 'ADCB', bankName: 'ADCB', last4: '1111', kind: 'bank', openingFils: 0, color: '#000' },
  { id: 'b', name: 'ADCB Savings', bankName: 'ADCB', last4: '2222', kind: 'bank', openingFils: 0, color: '#000' },
];
const money = { schemaVersion: 2, currency: 'AED', exponent: 2 };
function rows(count) {
  return Array.from({ length: count }, (_, i) => {
    const stamp = Date.UTC(2026, 8, 20) - i * 3600000;
    return { id: `t${i}`, type: i % 29 === 0 ? 'income' : 'expense', amountFils: 1500 + i,
      category: i % 29 === 0 ? 'salary' : 'dining', title: i % 29 === 0 ? 'Salary' : 'Coffee',
      date: new Date(stamp).toISOString().slice(0, 10), ts: stamp, accountId: i % 2 ? 'a' : 'b', source: 'sms',
      smsKey: `s${stamp}-${1500 + i}` };
  });
}
const state = transactions => ({ hydrated: true, accounts, transactions, cardDues: [], bills: [], accountHints: {},
  ledgerMoney: money, marketId: 'AE', lastScanTs: 0 });
const batch = { transactions: [], newAccounts: [], newHints: {}, newDues: [], newBills: [], snapshots: {}, bankNames: {},
  cardTypes: {}, updates: [], parserRereadComplete: true, lastScanTs: 0, historyImport: { status: 'complete' } };
const plain = value => JSON.parse(JSON.stringify(value));
test('sorted finalization reuses the unchanged graph and matches legacy financial output', () => {
  const input = state(rows(200));
  const current = runner(), legacy = runner(true);
  const result = current.apply(input, batch);
  assert.deepEqual(plain(result), plain(legacy.apply(input, batch)));
  assert.equal(current.computations(), 1, 'unchanged graph must not be recomputed after sorting');
});
test('new reciprocal links retain the necessary second graph and ambiguous rows remain equivalent', () => {
  const transfer = (id, type, accountId) => ({ ...rows(1)[0], id, type, accountId, category: 'other', title: type === 'expense' ? 'Outgoing transfer' : 'Incoming transfer',
    amountFils: 50000, smsKey: undefined, captureInstrument: { last4: accountId === 'a' ? '1111' : '2222', kind: 'account', bankIdentity: 'adcb' }, transferEvidence: { version: 1, currency: 'AED', attribution: 'source', reference: 'TRX984512AB' } });
  const pair = [transfer('out', 'expense', 'a'), transfer('in', 'income', 'b')];
  for (const transactions of [pair, [...pair, transfer('ambiguous', 'income', 'b')]]) {
    const current = runner(), legacy = runner(true);
    const result = current.apply(state(transactions), batch);
    assert.deepEqual(plain(result), plain(legacy.apply(state(transactions), batch)));
    if (transactions.length === 2) {
      assert.ok(result.transactions[0].transferMatch);
      assert.equal(current.computations(), 2, 'changed normalized rows require fresh reconciliation');
    }
  }
});
test('unsorted input preserves legacy stable date ordering including timestamp ties', () => {
  const transactions = rows(100).reverse();
  const current = runner(), legacy = runner(true);
  assert.deepEqual(plain(current.apply(state(transactions), batch)), plain(legacy.apply(state(transactions), batch)));
});
if (process.env.WAFRA_IMPORT_BENCH === '1') {
  test('15k/30k synthetic history finalization timing (diagnostic, no timing threshold)', () => {
    for (const count of [15000, 30000]) {
      const input = state(rows(count));
      const measurements = { before: [], after: [] };
      for (let trial = 0; trial < 5; trial++) {
        for (const legacy of trial % 2 ? [false, true] : [true, false]) {
          const run = runner(legacy);
          const start = performance.now();
          run.apply(input, batch);
          measurements[legacy ? 'before' : 'after'].push(Number((performance.now() - start).toFixed(2)));
        }
      }
      console.log(JSON.stringify({ rows: count, milliseconds: measurements }));
    }
  });
}
