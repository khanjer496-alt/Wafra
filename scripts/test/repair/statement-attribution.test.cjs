'use strict';
// Statement rows land on the account or card the statement names: same bank
// and same tail. Never on another bank's account that shares the tail, never
// on a new duplicate account when the right one exists (bank-named or the
// bankless one SMS minted), and a card statement's rows land on the card.
// Fictional tails and amounts.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const build = (name) => require(path.join(__dirname, '../build', `${name}.js`));
const relay = require(path.join(__dirname, '../build/relay.cjs'));
const { buildImportPlan } = build('import-plan');
const { materializeImportBatch, applyMaterializedImportBatch } = build('ledger-import');
build('markets').setActiveMarket('AE');
build('markets').setLedgerCurrency('AED', 2);

const NOW = new Date('2026-09-20T09:00:00Z');
const account = (id, name, last4, extra = {}) => ({ id, name, kind: 'bank', last4, openingFils: 0, color: '#123456', ...extra });
const base = (accounts, hints = {}) => ({ hydrated: true, privateMode: false, marketId: 'AE',
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  accounts, transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: hints, merchantOverrides: {}, billAliases: {}, lastScanTs: 0, parserVersion: 0 });
const row = (index, changes = {}) => ({ kind: 'transaction', type: 'expense', amountFils: 2000 + index, currency: 'AED',
  merchant: 'Grocery store', date: `2026-09-0${1 + index}`, dueDay: null, minDueFils: null,
  card: { last4: '0002', kind: 'account' }, reference: null, transferHint: false, snapshotFils: null, snapshotKind: null,
  categoryGuess: 'groceries', categoryDeliberate: true, bankHint: 'FAB', captureSource: 'pdf',
  receivedAt: `2026-09-0${1 + index}T12:00:00.000Z`, statementImportId: 'a'.repeat(32), statementRowIndex: index, ...changes });
let serial = 0;
function importRelay(rows, state) {
  for (const r of rows) assert.equal(relay.isParsedRelayRow(r), true);
  const parsed = rows.map((r) => relay.relayRowToScannedSms(r));
  const plan = buildImportPlan(parsed, state, Math.max(...parsed.map((p) => p.smsTs)), NOW);
  return applyMaterializedImportBatch(state, materializeImportBatch(plan.batch, state, (p) => `${p}-${++serial}`));
}
const rowsOn = (state, id) => state.transactions.filter((t) => t.accountId === id).length;

test('a FAB account statement lands on FAB •0002, not on Liv •0002 that shares the tail', () => {
  const state = base([account('liv', 'Liv Account •0002', '0002', { bankName: 'Liv' }),
    account('fab', 'FAB Account •0002', '0002', { bankName: 'FAB' })]);
  const after = importRelay([row(0), row(1), row(2)], state);
  assert.equal(after.accounts.length, 2);
  assert.equal(rowsOn(after, 'fab'), 3);
  assert.equal(rowsOn(after, 'liv'), 0);
});

test('a FAB statement never joins another bank\'s account with its tail', () => {
  const after = importRelay([row(0), row(1)], base([account('liv', 'Liv Account •0002', '0002', { bankName: 'Liv' })]));
  assert.equal(rowsOn(after, 'liv'), 0);
  const fab = after.accounts.find((a) => a.bankName === 'FAB' && a.last4 === '0002');
  assert.ok(fab, 'a FAB account for the statement');
  assert.equal(rowsOn(after, fab.id), 2);
});

test('a bankless SMS-minted "Account •0002" receives the statement and learns its bank', () => {
  const after = importRelay([row(0), row(1)], base([account('acct', 'Account •0002', '0002')], { '0002': 'acct' }));
  assert.equal(after.accounts.length, 1);
  assert.equal(rowsOn(after, 'acct'), 2);
  assert.equal(after.accounts[0].bankName, 'FAB');
});

test('a card statement lands on the card, not on an account with the same tail', () => {
  const state = base([account('fab', 'FAB Account •0002', '0002', { bankName: 'FAB' }),
    { id: 'card', name: 'FAB Credit Card •0002', kind: 'card', cardType: 'credit', last4: '0002', bankName: 'FAB', openingFils: 0, color: '#654321' }]);
  const after = importRelay([row(0, { card: { last4: '0002', kind: 'credit' } }), row(1, { card: { last4: '0002', kind: 'credit' } })], state);
  assert.equal(rowsOn(after, 'card'), 2);
  assert.equal(rowsOn(after, 'fab'), 0);
  assert.equal(after.accounts.length, 2);
});

test('a statement with no stated number creates no account and invents no tail', () => {
  const after = importRelay([row(0, { card: null }), row(1, { card: null })], base([]));
  for (const a of after.accounts) assert.notEqual(a.last4, '0002');
  assert.ok(after.accounts.every((a) => a.last4 === undefined || /^\d{3,4}$/.test(a.last4)));
});
