'use strict';
// Work that used to run while nothing could have changed: the lag sampler's
// 1 Hz tick in the background, and a fresh internal-transfer Set (breaking
// every memo keyed on it) after dispatches that carry the same arrays.
const assert = require('node:assert/strict');
const test = require('node:test');
const native = require('../build/stub-react-native');
const runtime = require('../build/runtime-performance');
const ledger = require('../build/ledger');
const { TRANSFER_NORMALIZATION_VERSION } = require('../build/transfer-reconciliation');

test('the runtime lag sampler runs only while the app is active', () => {
  const saved = { os: native.Platform.OS, state: native.AppState.currentState,
    add: native.AppState.addEventListener, setInterval: global.setInterval, clearInterval: global.clearInterval };
  const intervals = new Set();
  let listener;
  let next = 1;
  global.setInterval = () => { const id = next++; intervals.add(id); return id; };
  global.clearInterval = (id) => { intervals.delete(id); };
  native.Platform.OS = 'android';
  native.AppState.currentState = 'background';
  native.AppState.addEventListener = (_event, fn) => { listener = fn; return { remove() { listener = undefined; } }; };
  let stop;
  try {
    stop = runtime.startRuntimePerformanceMonitor();
    assert.equal(intervals.size, 0, 'no sampler while launched in the background');
    listener('active');
    assert.equal(intervals.size, 1);
    listener('active');
    assert.equal(intervals.size, 1, 'repeated active edges do not stack timers');
    listener('background');
    assert.equal(intervals.size, 0);
    listener('active');
    assert.equal(intervals.size, 1);
    stop();
    assert.equal(intervals.size, 0);
  } finally {
    native.Platform.OS = saved.os;
    native.AppState.currentState = saved.state;
    native.AppState.addEventListener = saved.add;
    global.setInterval = saved.setInterval;
    global.clearInterval = saved.clearInterval;
  }
});

test('priming the same ledger arrays keeps one internal-transfer Set identity', () => {
  const transactions = [{ id: 'a', type: 'expense', amountFils: 1, category: 'other', accountId: 'x',
    title: 'Coffee', date: '2026-09-20', source: 'manual' }];
  const accounts = [{ id: 'x', name: 'X', kind: 'bank', openingFils: 0 }];
  const ids = ['a'];
  const state = { transactions, accounts, transferInternalIds: ids,
    transferNormalizationVersion: TRANSFER_NORMALIZATION_VERSION };
  ledger.primeInternalTransferIds(transactions, accounts, ids, true);
  const first = ledger.internalTransferIdsForState(state);
  ledger.primeInternalTransferIds(transactions, accounts, ids, true);
  assert.equal(ledger.internalTransferIdsForState(state), first);
  assert.equal(ledger.internalTransferIds(transactions, accounts), first);
  assert.deepEqual([...first], ['a']);
  // A new receipt array (even with equal contents) is a new answer.
  const replaced = ['a'];
  ledger.primeInternalTransferIds(transactions, accounts, replaced, true);
  const second = ledger.internalTransferIdsForState({ ...state, transferInternalIds: replaced });
  assert.notEqual(second, first);
  assert.deepEqual([...second], ['a']);
});
