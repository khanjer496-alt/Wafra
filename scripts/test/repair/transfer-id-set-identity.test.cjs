'use strict';
// A category edit replaces the transactions array but keeps the transfer receipt.
// The internal-transfer id Set must keep its IDENTITY then: the Transactions
// list keys its row actions, its row cache and every memoized TransactionRow on
// it, and a fresh `new Set(ids)` with the same ids reset all of them (~100
// mounted rows re-rendered on every edit).
const test = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../build/ledger');
const { TRANSFER_NORMALIZATION_VERSION } = require('../build/transfer-reconciliation');

const row = (id) => ({ id, type: 'expense', amountFils: 1000, category: 'other', accountId: 'main', title: `Row ${id}`, date: '2026-07-01', source: 'manual' });
const stateOf = (transactions, accounts, transferInternalIds) => ({
  transactions, accounts, transferInternalIds,
  transferNormalizationVersion: TRANSFER_NORMALIZATION_VERSION,
  historyImport: undefined,
});

test('an edit that keeps the transfer ids keeps the Set identity (state path)', () => {
  const accounts = [];
  const ids = ['t1', 't2', 't3'];
  const before = ledger.internalTransferIdsForState(stateOf([row('a'), row('b')], accounts, ids));
  // A category edit: a NEW transactions array (and row), the same receipt array.
  const edited = [{ ...row('a'), category: 'dining' }, row('b')];
  const after = ledger.internalTransferIdsForState(stateOf(edited, accounts, ids));
  assert.equal(after, before, 'same Set object, so row memos keyed on it survive the edit');
  assert.deepEqual([...after].sort(), ['t1', 't2', 't3']);
});

test('a new but equal ids array keeps the Set too', () => {
  const accounts = [];
  const first = ledger.internalTransferIdsForState(stateOf([row('a')], accounts, ['t1', 't2']));
  const second = ledger.internalTransferIdsForState(stateOf([row('a'), row('b')], accounts, ['t1', 't2']));
  assert.equal(second, first);
});

test('changed ids (a real transfer change) produce a new Set with the new ids', () => {
  const accounts = [];
  const first = ledger.internalTransferIdsForState(stateOf([row('a')], accounts, ['t1', 't2']));
  const changed = ledger.internalTransferIdsForState(stateOf([row('a')], accounts, ['t1', 't2', 't3']));
  assert.notEqual(changed, first);
  assert.deepEqual([...changed].sort(), ['t1', 't2', 't3']);
  // ...and a different set of the same length is not mistaken for the old one.
  const swapped = ledger.internalTransferIdsForState(stateOf([row('a')], accounts, ['t1', 't2', 't4']));
  assert.notEqual(swapped, changed);
  assert.deepEqual([...swapped].sort(), ['t1', 't2', 't4']);
});

test('the store priming path reuses the Set across dispatches that keep the ids', () => {
  const accounts = [];
  const ids = ['t1', 't2'];
  const first = [row('a')];
  ledger.primeInternalTransferIds(first, accounts, ids);
  const primed = ledger.internalTransferIds(first, accounts);
  const second = [{ ...row('a'), category: 'dining' }];
  ledger.primeInternalTransferIds(second, accounts, ids);
  assert.equal(ledger.internalTransferIds(second, accounts), primed, 'an edit does not reset the Set');
  ledger.primeInternalTransferIds(second, accounts, ['t1']);
  const shrunk = ledger.internalTransferIds(second, accounts);
  assert.notEqual(shrunk, primed);
  assert.deepEqual([...shrunk], ['t1']);
});

test('the reused Set is a read-only view of the receipt: later ids never leak into it', () => {
  const accounts = [];
  const ids = ['t1'];
  const a = ledger.internalTransferIdsForState(stateOf([row('a')], accounts, ids));
  ledger.internalTransferIdsForState(stateOf([row('a')], accounts, ['t1', 't9']));
  assert.deepEqual([...a], ['t1'], 'an earlier Set is not mutated when the ids later change');
});
