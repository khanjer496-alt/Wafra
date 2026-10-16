'use strict';
// A credit-card STATEMENT imported through the relay gives the whole card
// experience: one card due for its cycle (total, minimum, due date), what the
// card owed on its issue date, and the printed credit limit. A due the bank's
// SMS already created for the same cycle is not duplicated, a limit the
// person edited is never overwritten, and an older statement never replaces
// a newer one's limit. Fictional card and figures throughout.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const build = (name) => require(path.join(__dirname, '../build', `${name}.js`));
const relay = require(path.join(__dirname, '../build/relay.cjs'));
const { buildImportPlan } = build('import-plan');
const { materializeImportBatch, applyMaterializedImportBatch } = build('ledger-import');
const { parseSms } = build('sms-parser');
const { isValidBackupState } = build('backup-validation');
build('markets').setActiveMarket('AE');
build('markets').setLedgerCurrency('AED', 2);

const NOW = new Date('2026-09-20T09:00:00Z');
const base = () => ({ hydrated: true, privateMode: false, marketId: 'AE',
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: {}, merchantOverrides: {}, billAliases: {}, lastScanTs: 0, parserVersion: 0 });

/** The relay row /v1/import/pdf queues for a card statement summary. */
const summaryRow = (changes = {}) => ({
  kind: 'cardStatement', type: 'expense', amountFils: 240876, currency: 'AED',
  merchant: 'Card •9012', date: '2026-10-05', dueDay: 5, minDueFils: 12044,
  card: { last4: '9012', kind: 'credit' }, reference: null, transferHint: false,
  snapshotFils: 240876, snapshotKind: 'outstanding', statementDate: '2026-09-10',
  categoryGuess: 'other', categoryDeliberate: true, creditLimitFils: 1500000, bankHint: 'HSBC',
  captureSource: 'pdf', receivedAt: '2026-09-10T12:00:00.000Z',
  statementImportId: 'a'.repeat(32), statementRowIndex: 3, ...changes,
});
const chargeRow = (changes = {}) => ({
  kind: 'transaction', type: 'expense', amountFils: 3399, currency: 'AED', merchant: 'Talabat',
  date: '2026-09-02', dueDay: null, minDueFils: null, card: { last4: '9012', kind: 'credit' },
  reference: null, transferHint: false, snapshotFils: null, snapshotKind: null,
  categoryGuess: 'dining', categoryDeliberate: true, bankHint: 'HSBC', captureSource: 'pdf',
  receivedAt: '2026-09-02T12:00:00.000Z', statementImportId: 'a'.repeat(32), statementRowIndex: 0, ...changes,
});

let serial = 0;
function importRelay(rows, state = base()) {
  for (const row of rows) assert.equal(relay.isParsedRelayRow(row), true, `relay refused ${row.kind}`);
  const parsed = rows.map((row) => relay.relayRowToScannedSms(row)).sort((a, b) => a.smsTs - b.smsTs);
  const plan = buildImportPlan(parsed, state, Math.max(...parsed.map((p) => p.smsTs)), NOW);
  return applyMaterializedImportBatch(state, materializeImportBatch(plan.batch, state, (p) => `${p}-${++serial}`));
}
const card = (state) => state.accounts.find((a) => a.last4 === '9012');

test('a card statement gives one due, the owed figure and the printed credit limit on the card', () => {
  const after = importRelay([chargeRow(), summaryRow()]);
  assert.equal(after.accounts.length, 1);
  const c = card(after);
  assert.equal(c.kind, 'card'); assert.equal(c.cardType, 'credit');
  assert.equal(c.creditLimitFils, 1500000);
  assert.deepEqual(c.importedCreditLimit, { fils: 1500000, ts: Date.parse('2026-09-10T12:00:00.000Z') });
  assert.equal(c.snapshotKind, 'outstanding'); assert.equal(c.snapshotFils, 240876);
  assert.equal(after.cardDues.length, 1);
  const due = after.cardDues[0];
  assert.equal(due.accountId, c.id); assert.equal(due.dueDate, '2026-10-05');
  assert.equal(due.totalDueFils, 240876); assert.equal(due.minDueFils, 12044); assert.equal(due.minDueEstimated, undefined);
  assert.equal(after.transactions.filter((t) => t.accountId === c.id).length, 1);
});

test('the same statement imported again, or under another upload id, adds no second due', () => {
  const once = importRelay([chargeRow(), summaryRow()]);
  const twice = importRelay([chargeRow(), summaryRow()], once);
  const other = importRelay([chargeRow({ statementImportId: 'b'.repeat(32) }), summaryRow({ statementImportId: 'b'.repeat(32) })], twice);
  assert.equal(other.cardDues.length, 1);
  assert.equal(other.accounts.length, 1);
});

test('a due the bank texted for the same cycle is not duplicated by the statement', () => {
  const sms = parseSms('Your Credit Card statement for card ending 9012: Total due AED 2,408.76, minimum due AED 120.44 by 05/10/2026');
  assert.ok(sms && sms.kind === 'cardStatement', 'fixture SMS reads as a statement');
  const smsState = (() => {
    const state = base();
    const plan = buildImportPlan([{ ...sms, smsTs: Date.parse('2026-09-10T08:00:00Z'), raw: undefined }], state, 0, NOW);
    return applyMaterializedImportBatch(state, materializeImportBatch(plan.batch, state, (p) => `s-${p}-${++serial}`));
  })();
  assert.equal(smsState.cardDues.length, 1);
  const after = importRelay([chargeRow(), summaryRow()], smsState);
  assert.equal(after.cardDues.length, 1, 'one due for the cycle');
  assert.equal(after.accounts.filter((a) => a.last4 === '9012').length, 1, 'one card');
  assert.equal(after.cardDues[0].minDueFils, 12044);
});

test('a newer statement updates the limit it set; an older one does not', () => {
  const first = importRelay([summaryRow()]);
  const newer = importRelay([summaryRow({ creditLimitFils: 2000000, statementDate: '2026-10-10', date: '2026-11-05', dueDay: 5,
    receivedAt: '2026-10-10T12:00:00.000Z', statementImportId: 'c'.repeat(32) })], first);
  assert.equal(card(newer).creditLimitFils, 2000000);
  const older = importRelay([summaryRow({ creditLimitFils: 1000000, statementDate: '2026-08-10', date: '2026-10-05',
    receivedAt: '2026-08-10T12:00:00.000Z', statementImportId: 'd'.repeat(32) })], newer);
  assert.equal(card(older).creditLimitFils, 2000000);
});

test('a limit the person set or edited is never overwritten by a statement', () => {
  const first = importRelay([summaryRow()]);
  const edited = { ...first, accounts: first.accounts.map((a) => a.last4 === '9012' ? { ...a, creditLimitFils: 1800000 } : a) };
  const newer = importRelay([summaryRow({ creditLimitFils: 2000000, statementDate: '2026-10-10', date: '2026-11-05',
    receivedAt: '2026-10-10T12:00:00.000Z', statementImportId: 'c'.repeat(32) })], edited);
  assert.equal(card(newer).creditLimitFils, 1800000);
  const typed = { ...base(), accounts: [{ id: 'card-1', name: 'HSBC Credit Card •9012', kind: 'card', cardType: 'credit',
    last4: '9012', bankName: 'HSBC', openingFils: 0, color: '#000000', creditLimitFils: 900000 }],
    accountHints: { 9012: 'card-1' } };
  assert.equal(card(importRelay([summaryRow()], typed)).creditLimitFils, 900000);
});

test('a statement without a limit changes no limit', () => {
  const after = importRelay([summaryRow({ creditLimitFils: undefined })]);
  assert.equal(card(after).creditLimitFils, undefined);
  assert.equal(card(after).importedCreditLimit, undefined);
});

test('the relay accepts a limit only on a card statement summary, and only a positive whole figure', () => {
  assert.equal(relay.isParsedRelayRow(chargeRow({ creditLimitFils: 100 })), false);
  assert.equal(relay.isParsedRelayRow(summaryRow({ creditLimitFils: -5 })), false);
  assert.equal(relay.isParsedRelayRow(summaryRow({ creditLimitFils: 1.5 })), false);
  assert.equal(relay.isParsedRelayRow(summaryRow()), true);
});

test('a backup holding a statement-set limit restores', () => {
  const after = importRelay([summaryRow()]);
  const { hydrated: _h, ...persisted } = JSON.parse(JSON.stringify(after));
  assert.equal(isValidBackupState(persisted), true);
  assert.deepEqual(card(persisted).importedCreditLimit, card(after).importedCreditLimit);
});
