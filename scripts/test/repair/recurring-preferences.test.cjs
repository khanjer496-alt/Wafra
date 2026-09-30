'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadStore } = require('../../perf/load-store.cjs');
const load = require('./load-typescript.cjs');
const { reducer, build } = loadStore();
const validate = load(path.resolve(__dirname, '../../../src/lib/backup-validation.ts'), {
  '@/lib/transfer-reconciliation': build('transfer-reconciliation'), '@/lib/ledger-money': build('ledger-money'),
  '@/lib/ledger': build('ledger'),
}).isValidBackupState;
const key = 'service:["e&","consumer:1111"]';
const base = () => reducer({ hydrated: false, accounts: [], transactions: [] }, { type: 'hydrate', state: {
  marketId: 'AE', ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  accounts: [], transactions: [], bills: [], cardDues: [], budgets: [], goals: [],
  cancelledSubscriptions: { 'e&': '2026-09-20' },
} });
test('undoing one service retains an explicit override without uncancelling siblings', () => {
  const state = reducer(base(), { type: 'setSubscriptionCancelled', merchant: key, cancelledOn: null });
  assert.equal(state.cancelledSubscriptions[key], null);
  assert.equal(state.cancelledSubscriptions['e&'], '2026-09-20');
  assert.equal(validate(state), true);
});
test('legacy provider-wide undo still removes its cancellation', () => {
  const state = reducer(base(), { type: 'setSubscriptionCancelled', merchant: 'E&', cancelledOn: null });
  assert.equal(Object.hasOwn(state.cancelledSubscriptions, 'e&'), false);
});
