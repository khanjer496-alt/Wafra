'use strict';
// A movement imported first from a bank STATEMENT and then again from SMS
// History (a senderless Find-Messages record, so no bank identity) is one
// movement. Device ledger facts, reproduced synthetically: a FAB account
// statement row "Outgoing transfer" of AED 280.00, and the History alert
// "Outward remittance" one second later on the same account tail, stating the
// running balance the statement shows after that row. The reverse order was
// already merged; this order produced a duplicate. Two genuinely separate
// equal transfers on the same day must stay two.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTypescript = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const source = (name) => path.join(root, 'src/lib', `${name}.ts`);
function load(name, overrides = {}) {
  const dependencies = {};
  for (const [, dependency] of fs.readFileSync(source(name), 'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)) {
    const built = path.join(__dirname, '../build', `${dependency.slice('@/lib/'.length)}.js`);
    if (fs.existsSync(built)) dependencies[dependency] = require(built);
  }
  return loadTypescript(source(name), { ...dependencies, ...overrides });
}
const dedupe = load('dedupe');
const { buildImportPlan } = load('import-plan', { '@/lib/dedupe': dedupe });
const heal = load('heal', { '@/lib/dedupe': dedupe });
const { materializeImportBatch, applyMaterializedImportBatch } =
  load('ledger-import', { '@/lib/dedupe': dedupe, '@/lib/heal': heal });
require(path.join(__dirname, '../build/markets.js')).setActiveMarket('AE');
require(path.join(__dirname, '../build/markets.js')).setLedgerCurrency('AED', 2);

const now = new Date('2026-09-30T12:00:00Z');
const STATEMENT_TS = 1788861835875;
const HISTORY_TS = 1788861836780;
const base = () => ({ hydrated: true, privateMode: true, marketId: 'AE',
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: {}, merchantOverrides: {}, billAliases: {}, lastScanTs: 0, parserVersion: 0 });
const statementRow = (changes = {}) => ({ kind: 'transaction', type: 'expense', amountFils: 28000, currency: 'AED',
  merchant: 'Outgoing transfer', date: '2026-09-08', dueDay: null, minDueFils: null,
  card: { last4: '0002', kind: 'account' }, reference: null, transferHint: true,
  snapshotFils: null, snapshotKind: null, categoryGuess: 'other', categoryDeliberate: true,
  captureSource: 'pdf', smsTs: STATEMENT_TS, statementImportId: 'f'.repeat(32), statementRowIndex: 32,
  bankHint: 'FAB', ...changes });
const historyRow = (changes = {}) => ({ kind: 'transaction', type: 'expense', amountFils: 28000, currency: 'AED',
  merchant: 'Outward remittance', date: '2026-09-08', dueDay: null, minDueFils: null,
  card: { last4: '0002', kind: 'account' }, reference: null, transferHint: true,
  snapshotFils: 248448, snapshotKind: 'balance', categoryGuess: 'other', categoryDeliberate: true,
  smsTs: HISTORY_TS, channel: 'inbox', sourceEventId: 'a'.repeat(64), ...changes });
let serial = 0;
function apply(rows, state = base()) {
  const plan = buildImportPlan(rows, state, 0, now);
  return applyMaterializedImportBatch(state, materializeImportBatch(plan.batch, state, (p) => `${p}-${++serial}`));
}
const decision = { version: 1, ownership: 'external', decidedAt: Date.parse('2026-09-09T08:00:00Z') };
const withDecision = (state) => ({ ...state, transactions: state.transactions.map((t) =>
  t.captureSource === 'pdf' ? { ...t, transferDecision: decision } : t) });

for (const decided of [false, true]) {
  test(`statement first, then SMS History: one movement${decided ? ' (user already decided the transfer)' : ''}`, () => {
    let state = apply([statementRow()]);
    assert.equal(state.transactions.length, 1);
    if (decided) state = withDecision(state);
    state = apply([historyRow()], state);
    const rows = state.transactions.filter((t) => t.amountFils === 28000);
    assert.equal(rows.length, 1, JSON.stringify(rows.map((t) => [t.title, t.captureSource, t.smsKey])));
    if (decided) assert.deepEqual(rows[0].transferDecision, decision, "the user's answer survives");
  });
}

// The same pair with the History row produced by the REAL senderless History
// path from a FAB field-list alert (values replaced), and the statement row
// carrying the transfer evidence a statement import stores.
const { parseHistoricalMessageRecords } = require(path.join(__dirname, '../build/historical-import.js'));
const { createLaunchAlertSession } = require(path.join(__dirname, '../build/launch-alert-parser.js'));
const OUTWARD = 'Outward Remittance Debit\nAccount XXXX0002\nAED 280.00\nValue Date 08/09/2026\nAvailable Balance AED 2,484.48';
function realHistoryRow() {
  const result = parseHistoricalMessageRecords([JSON.stringify({ v: 1, id: 'c'.repeat(64), text: OUTWARD,
    receivedAt: new Date(HISTORY_TS).toISOString() })], {}, now, new Set(),
    createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' }));
  assert.equal(result.parsed.length, 1, 'premise: the senderless alert parses');
  return result.parsed[0];
}
const statementEvidence = { version: 1, currency: 'AED', attribution: 'source', sourceKindAmbiguous: true,
  counterparty: { last4: '9623', kind: 'account' }, statement: true };
for (const decided of [false, true]) {
  for (const evidence of [false, true]) {
    test(`statement then real senderless History alert: one movement (decision ${decided}, statement evidence ${evidence})`, () => {
      let state = apply([statementRow(evidence ? { transferEvidence: statementEvidence } : {})]);
      if (decided) state = withDecision(state);
      const history = realHistoryRow();
      state = apply([history], state);
      const rows = state.transactions.filter((t) => t.amountFils === 28000);
      assert.equal(rows.length, 1, JSON.stringify({ history: { title: history.merchant, card: history.card, bank: history.bankHint,
        snap: history.snapshotFils, ev: history.transferEvidence }, rows: rows.map((t) => [t.title, t.captureSource, t.accountId]) }));
      if (decided) assert.deepEqual(rows[0].transferDecision, decision);
    });
  }
}

test('SMS History first, then the statement: one movement (already worked)', () => {
  let state = apply([historyRow()]);
  state = apply([statementRow()], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 1);
});

test('two separate equal transfers the same day stay two: a different stated balance trail', () => {
  let state = apply([statementRow(), statementRow({ statementRowIndex: 33, smsTs: STATEMENT_TS + 1 })]);
  assert.equal(state.transactions.length, 2);
  // One History alert pairs with one statement row; the other stays.
  state = apply([historyRow()], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
  // A second History alert, a later balance, takes the remaining row.
  state = apply([historyRow({ snapshotFils: 220448, smsTs: HISTORY_TS + 3_600_000, sourceEventId: 'b'.repeat(64) })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
});

test('a History transfer from a different account tail stays separate', () => {
  let state = apply([statementRow()]);
  state = apply([historyRow({ card: { last4: '0007', kind: 'account' } })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
});

test('a History transfer in the opposite direction stays separate', () => {
  let state = apply([statementRow()]);
  state = apply([historyRow({ type: 'income', merchant: 'Inward remittance' })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
});

// Earlier iPhone History builds minted bankless accounts for senderless
// alerts ("Account •0002"), so a ledger can hold the statement's FAB account
// beside a bankless account, or a FAB debit card, with the same tail.
for (const [name, extra] of [
  ['a bankless account with the same tail', [{ id: 'bankless', name: 'Account •0002', kind: 'bank', last4: '0002', openingFils: 0, color: '#000' }]],
  ['a same-bank debit card with the same tail', [{ id: 'card2', name: 'FAB Card', bankName: 'FAB', kind: 'card', cardType: 'debit', last4: '0002', openingFils: 0, color: '#000' }]],
]) {
  test(`statement then real senderless History alert beside ${name}: one movement`, () => {
    let state = apply([statementRow({ transferEvidence: statementEvidence })]);
    state = withDecision({ ...state, accounts: [...state.accounts, ...extra] });
    state = apply([realHistoryRow()], state);
    const rows = state.transactions.filter((t) => t.amountFils === 28000);
    assert.equal(rows.length, 1, JSON.stringify(rows.map((t) => [t.title, t.captureSource ?? '-', t.accountId])));
    assert.deepEqual(rows[0].transferDecision, decision);
  });
}

test('beside a bankless same-tail account, two equal statement rows never both claim one alert', () => {
  const bankless = { id: 'bankless', name: 'Account •0002', kind: 'bank', last4: '0002', openingFils: 0, color: '#000' };
  let state = apply([statementRow(), statementRow({ statementRowIndex: 33, smsTs: STATEMENT_TS + 1 })]);
  state = { ...state, accounts: [...state.accounts, bankless] };
  state = apply([realHistoryRow()], state);
  // Two candidate statement rows: ambiguous, so the alert is kept, not merged.
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 3);
});

test('beside a bankless same-tail account, a next-day equal transfer is a separate movement', () => {
  const bankless = { id: 'bankless', name: 'Account •0002', kind: 'bank', last4: '0002', openingFils: 0, color: '#000' };
  let state = apply([statementRow({ transferEvidence: statementEvidence })]);
  state = { ...state, accounts: [...state.accounts, bankless] };
  const nextDay = realHistoryRow();
  state = apply([{ ...nextDay, date: '2026-09-09', smsTs: HISTORY_TS + 86_400_000, sourceEventId: 'd'.repeat(64) }], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
});

// Real-device order: the live capture of the transfer, then the FAB statement
// (whose transfer evidence re-titles the live row "Outgoing transfer"), then
// the senderless History copy of the SAME Message ("Outward remittance", the
// same running balance, 0.9 s later). One movement, not two.
const LIVE_TS = STATEMENT_TS;
const liveRow = () => {
  const { sourceEventId: _id, ...rest } = realHistoryRow();
  return { ...rest, smsTs: LIVE_TS, messageObservationId: '12345678-1234-4123-8123-123456789abc' };
};
const deviceEvidence = { version: 1, currency: 'AED', attribution: 'source', sourceKindAmbiguous: true,
  counterparty: { last4: '9623', kind: 'unknown' }, statement: true };
test('live capture, then the statement, then the senderless History copy: one movement', () => {
  let state = apply([liveRow()]);
  state = apply([statementRow({ statementRowIndex: 40, transferEvidence: deviceEvidence })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 1, 'premise: the statement claims the live row');
  state = apply([realHistoryRow()], state);
  const rows = state.transactions.filter((t) => t.amountFils === 28000);
  assert.equal(rows.length, 1, JSON.stringify(rows.map((t) => [t.title, t.smsKey?.slice(0, 2), t.statedBalanceFils])));
});
test('the device pair in the other order (History, then statement) is one movement too', () => {
  let state = apply([realHistoryRow()]);
  state = apply([statementRow({ statementRowIndex: 40, transferEvidence: deviceEvidence })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 1);
});
test('a statement row and an alert with different transfer titles pair on the same running balance', () => {
  // The statement's closing row carries its running balance (server: closing snapshot).
  let state = apply([statementRow({ statementRowIndex: 40, merchant: 'Transfer-MOB-LOCAL FT', snapshotFils: 248448, snapshotKind: 'balance' })]);
  state = apply([historyRow({ merchant: 'Funds sent' })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 1);
});
test('a different running balance keeps a renamed-title pair apart', () => {
  let state = apply([statementRow({ statementRowIndex: 40, merchant: 'Transfer-MOB-LOCAL FT', snapshotFils: 248448, snapshotKind: 'balance' })]);
  state = apply([historyRow({ merchant: 'Funds sent', snapshotFils: 199000 })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
});
test('two equal same-day live transfers with different balances stay two after the statement and History', () => {
  let state = apply([liveRow(), { ...liveRow(), smsTs: LIVE_TS + 3_600_000, snapshotFils: 220448,
    messageObservationId: '22345678-1234-4123-8123-123456789abc' }]);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
  state = apply([statementRow({ statementRowIndex: 40, transferEvidence: deviceEvidence })], state);
  state = apply([realHistoryRow()], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
});
