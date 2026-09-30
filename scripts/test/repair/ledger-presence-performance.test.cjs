'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// Exercise the shipping pure module without sharing the full-suite build
// directory with concurrently running checks.
function load(name, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../../src/lib', name), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `unexpected dependency ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return module.exports;
}

const { ledgerStateHasMoney, migrateLegacyLedgerMoney } = load('ledger-money.ts', {
  '@/lib/currency-metadata': load('currency-metadata.ts'),
});

test('every stored and planned monetary field continues to pin ledger currency', () => {
  const fields = {
    accounts: ['openingFils', 'snapshotFils', 'creditLimitFils'],
    budgets: ['limitFils'],
    bills: ['amountFils'],
    cardDues: ['totalDueFils', 'minDueFils', 'paidFils'],
    goals: ['targetFils', 'savedFils'],
  };
  for (const [collection, keys] of Object.entries(fields)) {
    for (const key of keys) {
      for (const value of [1, -1, Number.MAX_SAFE_INTEGER, NaN, Infinity]) {
        const state = { [collection]: [null, false, { [key]: 0 }, { [key]: value }] };
        assert.equal(ledgerStateHasMoney(state), true, `${collection}.${key}=${value}`);
        assert.throws(() => migrateLegacyLedgerMoney({ ...state, marketId: 'XX' }));
      }
      for (const value of [0, -0, undefined, null, '100', false]) {
        assert.equal(ledgerStateHasMoney({ [collection]: [{ [key]: value }] }), false);
      }
    }
  }
});

test('legacy transaction presence stays conservative and does not inspect amounts', () => {
  for (const transaction of [{}, { amountFils: 0 }, { amountFils: null }, []]) {
    assert.equal(ledgerStateHasMoney({ transactions: [transaction] }), true);
    assert.equal(migrateLegacyLedgerMoney({ marketId: 'SA', transactions: [transaction] }).currency, 'SAR');
  }
  for (const value of [undefined, null, false, 0, '', '100']) {
    assert.equal(ledgerStateHasMoney({ transactions: [value] }), false);
  }
  for (const collection of ['accounts', 'transactions', 'budgets', 'bills', 'cardDues', 'goals']) {
    for (const value of [undefined, null, {}, '', 1, []]) {
      assert.equal(ledgerStateHasMoney({ [collection]: value }), false);
    }
  }
  assert.equal(ledgerStateHasMoney({ transactions: new Array(100) }), false);
});

function countedRows(rows) {
  let reads = 0;
  return {
    rows: new Proxy(rows, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key, receiver);
      },
    }),
    reads: () => reads,
  };
}

test('a 14,840-row ledger presence check stops at its first transaction', () => {
  const transactions = countedRows(Array.from({ length: 14_840 }, () => ({ amountFils: 100 })));
  const state = { accounts: [{ openingFils: 0 }], transactions: transactions.rows };
  assert.equal(ledgerStateHasMoney(state), true);
  assert.equal(transactions.reads(), 1, 'existence must not allocate and traverse the complete history');
});

test('presence short-circuits each money collection and still finds later nonzero rows', () => {
  for (const [collection, key] of [['accounts', 'openingFils'], ['budgets', 'limitFils'],
    ['bills', 'amountFils'], ['cardDues', 'totalDueFils'], ['goals', 'savedFils']]) {
    const rows = countedRows([null, { [key]: 0 }, { [key]: -1 }, ...Array(100).fill({ [key]: 0 })]);
    assert.equal(ledgerStateHasMoney({ [collection]: rows.rows }), true);
    assert.equal(rows.reads(), 3, collection);
  }
});
