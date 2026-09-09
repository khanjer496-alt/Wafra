'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildImportPlan } = require('../build/import-plan');
const { materializeImportBatch, applyMaterializedImportBatch } = require('../build/ledger-import');
const { createLaunchAlertSession } = require('../build/launch-alert-parser');
const { liveAccountIds, countsInTotals, UNASSIGNED_TRANSACTION_ACCOUNT_ID } = require('../build/ledger');
const markets = require('../build/markets');
markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
const NOW = Date.parse('2026-09-10T10:00:00Z');
const account = { id: 'unrelated-card', name: 'ENBD credit card', bankName: 'Emirates NBD', kind: 'card', cardType: 'credit', last4: '1234', openingFils: 0, color: '#000' };
const base = { hydrated: true, onboarded: true, accounts: [account], accountHints: {}, transactions: [],
  budgets: [], bills: [], goals: [], cardDues: [], merchantOverrides: {}, marketId: 'AE', monthStartDay: 1,
  lastScanTs: 0, parserVersion: 39, ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  reviewTray: { pending: [], tombstones: [] } };
const body = 'Dear Customer, Your payment instructions of AED 450.45 to Example Vendor for consumer number 123456789 has been processed on 02/09/2026 12:18';
const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED' });
const parsed = session.parse(body, 'FAB', session.inspect(body, 'FAB'));
assert.ok(parsed); assert.equal(parsed.card, null);
const row = { ...parsed, smsTs: NOW - 1000, sender: 'FAB', channel: 'inbox', sourceEventId: 'a801' };
const apply = state => {
  let id = 0;
  const plan = buildImportPlan([row], state, row.smsTs, new Date(NOW));
  const batch = materializeImportBatch(plan.batch, state, prefix => `${prefix}-${++id}`);
  return { plan, state: applyMaterializedImportBatch(state, batch) };
};

test('an unidentified FAB payment is counted without pretending it used an ENBD card', () => {
  const result = apply(base);
  assert.equal(result.plan.txCount, 1);
  const tx = result.state.transactions[0];
  assert.equal(tx.accountId, UNASSIGNED_TRANSACTION_ACCOUNT_ID);
  assert.equal(tx.amountFils, 45045);
  assert.equal(countsInTotals(tx, liveAccountIds(result.state.accounts)), true);
  assert.equal(result.state.accounts.length, 1, 'no invented account');
});

test('exact-source reread repairs a wrong-issuer fallback once, preserving money, date and identity', () => {
  const initial = apply(base).state;
  const original = { ...initial.transactions[0], accountId: account.id };
  const before = { ...initial, transactions: [original] };
  const result = apply(before);
  assert.equal(result.plan.txCount, 0);
  const repaired = result.state.transactions[0];
  assert.equal(repaired.accountId, UNASSIGNED_TRANSACTION_ACCOUNT_ID);
  for (const key of ['id', 'date', 'amountFils', 'type', 'smsKey']) assert.equal(repaired[key], original[key], key);
  assert.deepEqual(apply(result.state).state, result.state, 'replaying the repair is idempotent');
});

test('user corrections and independently evidenced instruments are not overwritten by an unidentified reread', () => {
  const initial = apply(base).state;
  for (const protection of [{ userEdited: true }, { captureInstrument: { kind: 'credit', last4: '1234', bankIdentity: 'emirates-nbd' } }]) {
    const original = { ...initial.transactions[0], accountId: account.id, ...protection };
    const result = apply({ ...initial, transactions: [original] });
    assert.equal(result.state.transactions[0].accountId, account.id);
    assert.equal(result.state.transactions[0].amountFils, original.amountFils);
  }
});

test('an empty refresh does not read the ledger transaction array to rebuild duplicate indexes', () => {
  const state = { ...base, get transactions() { throw Error('An empty read touched all ledger transactions'); } };
  const plan = buildImportPlan([], state, NOW, new Date(NOW), []);
  assert.equal(plan.txCount, 0); assert.equal(plan.batch.lastScanTs, NOW);
  assert.deepEqual(plan.batch.updates, []); assert.equal(plan.batch.parserRereadComplete, undefined);
});
