'use strict';
// "Mark paid" stamps a card statement with a full ISO timestamp. A backup made
// after that must restore: the validator used to accept only a bare date and
// refused the whole file. Runs the SHIPPING reducer and restore parser.
// Synthetic data only. Requires `bash scripts/test/build.sh`.
const assert = require('node:assert/strict');
const test = require('node:test');
const { loadStore } = require('../../perf/load-store.cjs');

const { store, reducer, build } = loadStore();
const validate = build('backup-validation').isValidBackupState;

const AED = { schemaVersion: 2, currency: 'AED', exponent: 2 };
const card = { id: 'card', name: 'Card', kind: 'card', cardType: 'credit', openingFils: 0, color: '#000' };
const due = { id: 'due-1', accountId: 'card', totalDueFils: 120_000, minDueFils: 6_000, paidFils: 0, dueDate: '2026-09-20' };

const hydrated = () => reducer({ hydrated: false, transactions: [], accounts: [] }, {
  type: 'hydrate',
  state: {
    onboarded: true, language: 'en', marketId: 'AE', ledgerMoney: AED,
    accounts: [card], transactions: [], bills: [], cardDues: [due], goals: [], budgets: [],
  },
});

test('a statement settled with a timestamp survives export and restore', () => {
  const settledAt = new Date(Date.UTC(2026, 8, 18, 7, 45, 12, 345)).toISOString();
  const state = reducer(hydrated(), { type: 'payCardDue', id: 'due-1', amountFils: 0, transaction: null, settledAt });
  assert.equal(state.cardDues[0].settledAt, settledAt);

  // Same envelope exportBackup writes, minus the non-ledger fields it strips.
  const { hydrated: _h, pro: _p, founderPro: _f, trialStartTs: _t, reviewTray: _r,
    hydrationReparseKey: _k, hydrationFinalizeVersion: _v, ...data } = state;
  const json = JSON.stringify({ app: 'wafra', version: 1, exportedAt: settledAt, data });
  assert.equal(validate(JSON.parse(json).data), true);
  const restored = store.parseBackupForRestore(json);
  assert.ok(restored, 'the backup restores');
  assert.equal(restored.cardDues.find((d) => d.id === 'due-1').settledAt, settledAt);
});

test('settledAt accepts a date or a timestamp, and nothing else', () => {
  const ok = (settledAt) => validate({ transactions: [], cardDues: [{ ...due, settledAt }] });
  assert.equal(ok('2026-09-18'), true);
  assert.equal(ok('2026-09-18T07:45:12.345Z'), true);
  assert.equal(ok('2026-09-18T11:45:12+04:00'), true);
  assert.equal(ok('2026-02-30T07:45:12.345Z'), false);
  assert.equal(ok('2026-09-18T25:99'), false);
  assert.equal(ok('yesterday'), false);
  assert.equal(ok(1_758_000_000_000), false);
});
