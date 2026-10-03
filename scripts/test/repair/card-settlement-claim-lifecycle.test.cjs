'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadStore } = require('../../perf/load-store.cjs');
const load = require('./load-typescript.cjs');
const { reducer, build } = loadStore();
const validate = () => load(path.resolve(__dirname, '../../../src/lib/backup-validation.ts'), {
  '@/lib/transfer-reconciliation': build('transfer-reconciliation'), '@/lib/ledger-money': build('ledger-money'),
  '@/lib/ledger': build('ledger'),
}).isValidBackupState;
const due = (id, date) => ({ id, accountId: 'card', totalDueFils: 100000, minDueFils: 5000,
  paidFils: 0, dueDate: date });
const base = () => reducer({ hydrated: false, accounts: [], transactions: [] }, { type: 'hydrate', state: {
  onboarded: true, marketId: 'AE', ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  accounts: [{ id: 'card', name: 'Credit card', kind: 'card', cardType: 'credit', openingFils: 0, color: '#000' }],
  transactions: [], cardDues: [due('old', '2026-08-25')], bills: [], budgets: [], goals: [],
} });
const payment = { id: 'manual', type: 'income', amountFils: 100000, category: 'other',
  accountId: 'card', title: 'Card payment', date: '2026-09-20', source: 'manual', isTransfer: true };
const mark = state => reducer(state, { type: 'payCardDue', id: 'old', amountFils: 100000,
  transaction: payment, settledAt: '2026-09-20T08:00:00Z' });

test('deleting a marked card payment cannot redirect a later receipt into the old cycle', () => {
  let state = mark(base());
  state = reducer(state, { type: 'deleteTransaction', id: 'manual' });
  assert.equal(state.cardDues[0].settledAt, undefined);
  state = reducer(state, { type: 'upsertCardDue', due: due('new', '2026-09-25') });
  state = reducer(state, { type: 'addTransaction', transaction: { ...payment, id: 'receipt', source: 'sms', cardPaymentSide: 'receipt' } });
  assert.equal(build('cards').duePaidFils(state, state.cardDues.find(d => d.id === 'old')), 0);
  assert.equal(build('cards').duePaidFils(state, state.cardDues.find(d => d.id === 'new')), 100000);
});

test('financial edits revoke the timestamp owned by that payment; cosmetics keep it', () => {
  for (const patch of [{ amountFils: 50000 }, { date: '2026-09-21' }, { accountId: 'another' },
    { type: 'expense' }, { isTransfer: false }]) {
    const state = reducer(mark(base()), { type: 'editTransaction', id: 'manual', patch });
    assert.equal(state.cardDues[0].settledAt, undefined, JSON.stringify(patch));
  }
  const state = reducer(mark(base()), { type: 'editTransaction', id: 'manual', patch: { title: 'Paid online', note: 'My note' } });
  assert.equal(state.cardDues[0].settledAt, '2026-09-20T08:00:00Z');
});

test('late manual settlement uses its recorded local payment day across a UTC boundary', () => {
  let state = reducer(base(), { type: 'upsertCardDue', due: due('new', '2026-09-25') });
  state = reducer(state, { type: 'payCardDue', id: 'old', amountFils: 100000,
    transaction: { ...payment, date: '2026-09-01' }, settledAt: '2026-08-31T20:30:00Z' });
  assert.equal(build('cards').duePaidFils(state, state.cardDues.find(d => d.id === 'old')), 100000);
  assert.equal(build('cards').duePaidFils(state, state.cardDues.find(d => d.id === 'new')), 0);
});

test('an explicit settlement without a ledger row and legacy claims remain independent', () => {
  const marked = reducer(mark(base()), { type: 'payCardDue', id: 'old', amountFils: 100000,
    transaction: null, settledAt: '2026-09-21T08:00:00Z' });
  const deleted = reducer(marked, { type: 'deleteTransaction', id: 'manual' });
  assert.equal(deleted.cardDues[0].settledAt, '2026-09-21T08:00:00Z');
  const legacy = { ...base(), transactions: [payment], cardDues: [{ ...due('old', '2026-08-25'), settledAt: '2026-09-20' }] };
  assert.equal(reducer(legacy, { type: 'deleteTransaction', id: 'manual' }).cardDues[0].settledAt, '2026-09-20');
});

test('settlement ownership survives backup and rejects broken references', () => {
  const state = mark(base());
  assert.equal(state.cardDues[0].settledByTransactionId, 'manual');
  assert.equal(validate()(state), true);
  assert.equal(validate()({ ...state, transactions: [] }), false);
  const restored = reducer(base(), { type: 'restore', state });
  assert.equal(reducer(restored, { type: 'deleteTransaction', id: 'manual' }).cardDues[0].settledAt, undefined);
});
