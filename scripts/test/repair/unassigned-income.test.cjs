'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLaunchAlertSession } = require('../build/launch-alert-parser.js');
const { buildImportPlan } = require('../build/import-plan.js');
const { materializeImportBatch, applyMaterializedImportBatch } = require('../build/ledger-import.js');
const { summarizeMonth } = require('../build/insights.js');
const { liveAccountIds, internalTransferIds, UNASSIGNED_INCOME_ACCOUNT_ID } = require('../build/ledger.js');
const { countsInTotals } = require('../build/ledger.js');
const { isValidBackupState } = require('../build/backup-validation.js');
const { setActiveMarket, setLedgerCurrency } = require('../build/markets.js');
setActiveMarket('AE'); setLedgerCurrency('AED', 2);
const now = new Date('2026-09-08T12:00:00Z');
// Synthetic identifiers and figures, preserving the reported partial-mask grammar.
const messages = [
  ['1801.11', '5000.55', 'Balance Net Online Sales till'],
  ['264.22', '3199.44', 'Balance Net Online Sales till'],
  ['145.33', '2935.22', 'Biweekly Net Online Sales from'],
].map(([amount, balance, note], index) => {
  const raw = `AED ${amount} has been credited to your account no. 098XXX44XXX02 DTB TR REF EXAMPLE000${index} 222808092640002${index} BY DELIVERY HERO TALABAT DB LLC${note}. The available balance is AED ${balance}.`;
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED' });
  const p = session.parse(raw, 'Liv', session.inspect(raw, 'Liv'));
  assert.equal(p.card, null);
  return { ...p, raw, date: '2026-09-06', smsTs: Date.parse('2026-09-06T08:00:00Z') + index * 60000,
    sourceEventId: `a${8100 + index}`, sender: 'Liv', channel: 'inbox' };
});
const account = (id, archived = false) => ({ id, name: id, kind: 'bank', bankName: 'Liv', last4: '1234', openingFils: 0, color: '#111111', archived });
const base = accounts => ({ hydrated: true, onboarded: true, accounts, transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: {}, merchantOverrides: {}, reviewTray: { schemaVersion: 1, pending: [], tombstones: [], templateRules: [] },
  marketId: 'AE', ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 }, monthStartDay: 1,
  lastScanTs: 0, parserVersion: 34, privateMode: true });
const apply = (state, rows = messages) => {
  let id = 0;
  const plan = buildImportPlan(rows, state, now.getTime(), now);
  const batch = materializeImportBatch(plan.batch, state, prefix => `${prefix}-${++id}`);
  return { plan, state: applyMaterializedImportBatch(state, batch) };
};
for (const accounts of [[], [account('active')], [account('hidden', true)], [account('hidden', true), account('active')]]) {
  test(`partial bank credits survive ${accounts.length} accounts without guessing or hidden fallback`, () => {
    const result = apply(base(accounts));
    assert.equal(result.state.transactions.length, 3);
    assert.equal(typeof UNASSIGNED_INCOME_ACCOUNT_ID, 'string');
    assert.ok(result.state.transactions.every(tx => tx.accountId === UNASSIGNED_INCOME_ACCOUNT_ID));
    assert.equal(result.plan.batch.newAccounts.length, 0, 'unknown attribution is not a fabricated bank');
    assert.deepEqual(result.plan.batch.snapshots, {}, 'no available balance is assigned on a guess');
    const summary = summarizeMonth(result.state.transactions, { mode: 'month', key: '2026-09' }, liveAccountIds(accounts), internalTransferIds(result.state.transactions, accounts));
    assert.equal(summary.incomeFils, 221066);
    assert.equal(summary.expenseFils, 0);
    assert.deepEqual(apply(result.state).state, result.state, 'reread is idempotent');
  });
}
test('a source-identical old fallback credit moves to review, not to an unrelated active account', () => {
  const start = apply(base([account('hidden', true), account('other')] )).state;
  const old = { ...start, transactions: start.transactions.map(tx => ({ ...tx, accountId: 'hidden' })) };
  const result = apply(old);
  assert.equal(result.plan.txCount, 0);
  assert.deepEqual(result.state.transactions.map(tx => tx.id), start.transactions.map(tx => tx.id));
  assert.ok(result.state.transactions.every(tx => tx.accountId === UNASSIGNED_INCOME_ACCOUNT_ID));
  assert.equal(result.state.accounts[0].archived, true, 'no automatic account unarchive');
});
test('user-assigned or source-identified historical accounts remain untouched', () => {
  const start = apply(base([account('hidden', true)])).state;
  for (const extra of [{ userEdited: true }, { captureInstrument: { kind: 'account', last4: '1234' } }]) {
    const state = { ...start, transactions: start.transactions.map(tx => ({ ...tx, accountId: 'hidden', ...extra })) };
    assert.ok(apply(state).state.transactions.every(tx => tx.accountId === 'hidden'));
  }
});
test('ordinary fully identified business credits retain their real account and snapshot', () => {
  const result = apply(base([account('real')]), messages.map(p => ({ ...p, card: { kind: 'account', last4: '1234' } })));
  assert.ok(result.state.transactions.every(tx => tx.accountId === 'real'));
  assert.ok(result.plan.batch.snapshots.real);
});
test('unassigned income is not a proven own-account transfer; corrupt expenses cannot use its visibility exception', () => {
  const income = { id: 'credit', accountId: UNASSIGNED_INCOME_ACCOUNT_ID, type: 'income', title: 'Incoming transfer',
    category: 'business', amountFils: 10000, date: '2026-09-01', source: 'sms' };
  const expense = { ...income, id: 'debit', accountId: 'bank', type: 'expense', title: 'Outgoing transfer', isTransfer: true };
  assert.equal(internalTransferIds([income, expense], new Set(['bank'])).size, 0);
  assert.equal(countsInTotals(income, new Set(['bank'])), false, 'generic Business is still ownership-pending');
  assert.equal(countsInTotals({ ...income, title: 'Talabat Business' }, new Set(['bank'])), true,
    'named business receipts remain income even while their bank attribution needs review');
  assert.equal(countsInTotals({ ...income, transferDecision: { version: 1, ownership: 'external', decidedAt: now.getTime() } }, new Set(['bank'])), true);
  assert.equal(countsInTotals({ ...income, type: 'expense' }, liveAccountIds([])), false);
});
test('reserved unassigned attribution survives JSON and the existing backup validator', () => {
  const result = apply(base([])).state;
  const restored = JSON.parse(JSON.stringify(result));
  assert.equal(isValidBackupState(restored), true);
  assert.ok(restored.transactions.every(tx => tx.accountId === UNASSIGNED_INCOME_ACCOUNT_ID));
  assert.equal(summarizeMonth(restored.transactions, { mode: 'month', key: '2026-09' }, liveAccountIds(restored.accounts)).incomeFils, 221066);
});
