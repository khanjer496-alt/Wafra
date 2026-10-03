'use strict';
// Equivalence and work-count regressions for the launch/mutation fast paths in
// src/lib/store.tsx. The shipping store executes against the real compiled
// parser, dedupe, accounts and transfer-reconciliation modules; fixtures are
// synthetic (scripts/perf/load-store.cjs).
const assert = require('node:assert/strict');
const test = require('node:test');
const { loadStore, ledger, NOW, DAY } = require('../../perf/load-store.cjs');

const { store, reducer, takeCalls, build } = loadStore({
  counted: {
    '@/lib/sms-parser': ['normalizeServiceName', 'guessCategory'],
    '@/lib/transfer-reconciliation': ['normalizeTransferLinks', 'reconcileTransfers'],
  },
});
const core = build('transfer-reconciliation');
const markets = build('markets');
markets.setActiveMarket('AE');

const EMPTY = { hydrated: false, transactions: [], accounts: [] };
const clone = (value) => JSON.parse(JSON.stringify(value));
function hydrated(rows, reuse = false) {
  const persisted = clone(ledger(rows));
  const migrated = store.migratePersistedState(persisted, { reuseCompletedReparse: reuse });
  return reducer({ ...EMPTY }, { type: 'hydrate', state: migrated });
}
const stableSort = (rows) => [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

/** The receipt the reducer carries must be exactly what a full pass computes. */
function assertExactReceipt(state) {
  assert.equal(state.transferNormalizationVersion, core.TRANSFER_NORMALIZATION_VERSION);
  assert.deepEqual(core.normalizeTransferLinks(state.transactions, state.accounts), state.transactions);
  assert.deepEqual(
    [...core.reconciliationInternalIds(core.reconcileTransfers(state.transactions, state.accounts))].sort(),
    [...state.transferInternalIds].sort(),
  );
}

const base = hydrated(600);
const manual = (patch = {}) => ({ id: `manual-${Math.random().toString(36).slice(2)}`, type: 'expense',
  amountFils: 5000, category: 'dining', accountId: 'card-0', title: 'Lunch', date: '2026-09-18',
  ts: NOW - 2 * DAY, source: 'manual', ...patch });

test('fixture ledger has a non-trivial exact transfer receipt', () => {
  assert.ok(base.transferInternalIds.length > 0, 'the fixture must pair some transfers');
  assertExactReceipt(base);
});

test('adding an inert row skips the transfer graph and keeps the receipt exact', () => {
  for (const date of ['2026-09-20', '2026-09-18', base.transactions.at(-1).date, '2020-01-01', '2030-01-01']) {
    const row = manual({ date });
    takeCalls();
    const next = reducer(base, { type: 'addTransaction', transaction: row });
    const counted = takeCalls();
    assert.equal(counted.normalizeTransferLinks, 0);
    assert.equal(counted.reconcileTransfers, 0);
    // Ordering identical to the stable sort of the prepended row.
    assert.deepEqual(next.transactions.map((t) => t.id), stableSort([row, ...base.transactions]).map((t) => t.id));
    assertExactReceipt(next);
  }
});

test('transfer-relevant, instrumented or colliding rows still take the full path', () => {
  const evidence = { version: 1, currency: 'AED', attribution: 'source', reference: 'REF77777777' };
  const cases = [
    manual({ isTransfer: true }),
    manual({ title: 'Outgoing transfer', source: 'sms', smsKey: `s${NOW}-5000`, transferEvidence: evidence,
      accountId: 'bank-0', captureInstrument: { last4: '1100', kind: 'account', bankIdentity: 'ENBD' } }),
    manual({ captureInstrument: { last4: '4800', kind: 'credit', bankIdentity: 'ENBD' } }),
    manual({ cardPaymentSide: 'debit' }),
    manual({ id: base.transactions[3].id }),
  ];
  for (const row of cases) {
    takeCalls();
    const next = reducer(base, { type: 'addTransaction', transaction: row });
    assert.ok(takeCalls().normalizeTransferLinks > 0, `full pass expected for ${JSON.stringify(row).slice(0, 80)}`);
    assertExactReceipt(next);
  }
  // Without an exact prior receipt nothing is carried forward.
  const stale = { ...base, transferNormalizationVersion: undefined };
  takeCalls();
  assertExactReceipt(reducer(stale, { type: 'addTransaction', transaction: manual() }));
  assert.ok(takeCalls().normalizeTransferLinks > 0);
});

test('deleting inert rows skips the graph; deleting a transfer leg re-reconciles', () => {
  const inert = base.transactions.find((t) => !t.isTransfer && !t.transferEvidence && !t.captureInstrument &&
    t.category !== 'salary');
  takeCalls();
  const next = reducer(base, { type: 'deleteTransaction', id: inert.id });
  assert.equal(takeCalls().normalizeTransferLinks, 0);
  assert.equal(next.transactions.length, base.transactions.length - 1);
  assertExactReceipt(next);

  const leg = base.transactions.find((t) => base.transferInternalIds.includes(t.id));
  takeCalls();
  const unpaired = reducer(base, { type: 'deleteTransaction', id: leg.id });
  assert.ok(takeCalls().normalizeTransferLinks > 0);
  assertExactReceipt(unpaired);
  assert.ok(unpaired.transferInternalIds.length < base.transferInternalIds.length);
});

test('a duplicated id is deleted through the full path when any copy is transfer-relevant', () => {
  const leg = base.transactions.find((t) => base.transferInternalIds.includes(t.id));
  const withCopy = { ...base, transactions: [...base.transactions, { ...manual(), id: leg.id }] };
  takeCalls();
  const next = reducer(withCopy, { type: 'deleteTransaction', id: leg.id });
  assert.ok(takeCalls().normalizeTransferLinks > 0);
  assertExactReceipt(next);
});

test('randomized inert add/delete sequences keep an exact receipt', () => {
  let state = base;
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let step = 0; step < 60; step += 1) {
    if (random() < 0.5) {
      const day = Math.floor(random() * 80);
      state = reducer(state, { type: 'addTransaction', transaction: manual({
        date: new Date(NOW - day * DAY).toISOString().slice(0, 10), amountFils: 1 + Math.floor(random() * 90000) }) });
    } else {
      const victim = state.transactions[Math.floor(random() * state.transactions.length)];
      state = reducer(state, { type: 'deleteTransaction', id: victim.id });
    }
    assertExactReceipt(state);
  }
});

test('the per-pass title memo matches migrating each row alone', () => {
  const persisted = ledger(400);
  // An upgraded grammar: the receipt is stale, so every parser-owned row runs
  // the row-local repairs. Some rows are re-filed from Other.
  persisted.hydrationReparseKey = JSON.stringify([2, 1, 'AE']);
  persisted.parserVersion = 1;
  persisted.merchantOverrides = {};
  persisted.transactions = persisted.transactions.map((t, i) =>
    i % 5 === 0 && t.type === 'expense' ? { ...t, title: ['Tap * Netflix.com', 'Carrefour', 'Talabat'][i % 3] } : t);
  takeCalls();
  const together = store.migratePersistedState(clone(persisted), { reuseCompletedReparse: true });
  const counted = takeCalls();
  const distinctTitles = new Set(persisted.transactions.filter((t) => t.source === 'sms' && !t.userEdited)
    .map((t) => t.title)).size;
  assert.ok(counted.normalizeServiceName <= distinctTitles * 2,
    `normalizeServiceName ran ${counted.normalizeServiceName} times for ${distinctTitles} titles`);
  const alone = persisted.transactions.map((row) => store.migratePersistedState(
    clone({ ...persisted, transactions: [row] }), { reuseCompletedReparse: true }).transactions[0]);
  assert.deepEqual(together.transactions, alone);
});

test('a live capture with an instrument cannot carry a stale transfer receipt forward', () => {
  // A debit-card purchase is an independent observation of that card, which
  // proves the explicit transfer to it is an internal move.
  const accounts = [
    { id: 'bank-0', name: 'A', kind: 'bank', bankName: 'ENBD', last4: '1100', openingFils: 0 },
    { id: 'dc', name: 'D', kind: 'card', cardType: 'debit', bankName: 'ENBD', last4: '5555', openingFils: 0 },
  ];
  const date = new Date(NOW).toISOString().slice(0, 10);
  const transfer = { id: 'T', type: 'expense', amountFils: 50000, category: 'other', accountId: 'bank-0',
    title: 'Outgoing transfer', date, ts: NOW, source: 'sms', smsKey: `s${NOW}-50000`,
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'ENBD',
      endpointProof: 'explicit-transfer', counterparty: { last4: '5555', kind: 'debit', bankIdentity: 'ENBD' } },
    captureInstrument: { last4: '1100', kind: 'account', bankIdentity: 'ENBD' } };
  const ids = (rows) => [...core.reconciliationInternalIds(core.reconcileTransfers(rows, accounts))].sort();
  const money = { schemaVersion: 2, currency: 'AED', exponent: 2 };
  const state = { onboarded: true, hydrated: true, ledgerMoney: money, marketId: 'AE', country: 'AE',
    transactions: [transfer], accounts, cardDues: [], bills: [], budgets: [], goals: [], notSubscriptions: [],
    merchantOverrides: {}, accountHints: {}, knownBanks: ['ENBD'], monthStartDay: 1, hydrationFinalizeVersion: 1,
    reviewTray: { pending: [], tombstones: [], templateRules: [] }, lastScanTs: NOW,
    transferNormalizationVersion: core.TRANSFER_NORMALIZATION_VERSION, transferInternalIds: ids([transfer]) };
  assert.deepEqual(state.transferInternalIds, []);
  const imported = reducer(state, { type: 'importBatch', importMoney: money,
    transactions: [{ type: 'expense', amountFils: 1234, category: 'groceries', accountId: 'dc', title: 'Carrefour',
      date, ts: NOW + 1000, source: 'sms', smsKey: `s${NOW + 1000}-1234`,
      captureInstrument: { last4: '5555', kind: 'debit', bankIdentity: 'ENBD' } }],
    newAccounts: [], newHints: {}, newDues: [], newBills: [], snapshots: {}, bankNames: {}, cardTypes: {},
    lastScanTs: NOW + 1000, updates: [] });
  assert.deepEqual([...imported.transferInternalIds].sort(), ['T']);
  assertExactReceipt(imported);
  // ...and the inert-row skip then carries that exact answer forward.
  const added = reducer(imported, { type: 'addTransaction', transaction: manual({ accountId: 'bank-0' }) });
  assert.deepEqual([...added.transferInternalIds].sort(), ['T']);
  assertExactReceipt(added);
});

test('dateless rows fall back to the exact stable sort', () => {
  const rows = [manual({ date: '2026-09-20' }), manual({ date: undefined }), manual({ date: '2026-09-01' })];
  const row = manual({ date: '2026-09-10' });
  const next = reducer({ ...base, transactions: rows }, { type: 'addTransaction', transaction: row });
  assert.deepEqual(next.transactions.map((t) => t.id), stableSort([row, ...rows]).map((t) => t.id));
});
