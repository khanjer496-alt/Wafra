'use strict';
// Exercise shipping compiled ledger/import/backup modules with synthetic data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../build/transfer-reconciliation');
const ledger = require('../build/ledger');
const { cardPaymentRows } = require('../build/cards');
const { reconcileCaptureDuplicates } = require('../build/dedupe');
const { applyHealUpdates } = require('../build/heal');
const { onboardingIncomeBasis } = require('../build/onboarding');
const { summarizeCashOutflow } = require('../build/cash-flow');
const { isValidBackupState } = require('../build/backup-validation');
const { applyMaterializedImportBatch, materializeImportBatch } = require('../build/ledger-import');
const { buildImportPlan } = require('../build/import-plan');
const { createLaunchAlertSession } = require('../build/launch-alert-parser');
const markets = require('../build/markets');
const ts = Date.UTC(2026, 8, 8, 10);
const accounts = [
  { id: 'bank', name: 'ADCB', bankName: 'ADCB', last4: '1111', kind: 'bank', openingFils: 0, color: '#000' },
  { id: 'other-bank', name: 'FAB', bankName: 'FAB', last4: '2222', kind: 'bank', openingFils: 0, color: '#000' },
  { id: 'credit', name: 'ADCB credit', bankName: 'ADCB', last4: '3333', kind: 'card', cardType: 'credit', openingFils: 0, color: '#000' },
];
const row = (id, type, patch = {}) => ({ id, type, amountFils: 10000, category: 'other', accountId: 'bank',
  title: type === 'income' ? 'Incoming transfer' : 'Outgoing transfer', date: '2026-09-08', ts,
  source: 'sms', ...patch });
const stateOf = transactions => ({ hydrated: true, accounts, transactions, bills: [], cardDues: [],
  budgets: [], goals: [], accountHints: {}, merchantOverrides: {}, notSubscriptions: [],
  marketId: 'AE', ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 }, privateMode: true,
  lastScanTs: 0, parserVersion: 35, reviewTray: { pending: [] }, historyImport: null });
const decide = (rows, ids, ownership) => core.applyTransferDecision(rows, accounts, { ids, ownership, now: ts,
  expectedFingerprints: Object.fromEntries(rows.map(t => [t.id, core.transferFingerprint(t)])) });
// Unknown recipients are reviewed one entry at a time, never as a catchall batch.
const decideEach = (rows, ids, ownership) => ids.reduce((current, id) => decide(current, [id], ownership), rows);

test('unknown bank transfers stay recorded outside confirmed totals; external choices restore exact amounts', () => {
  const rows = [row('out', 'expense', { isTransfer: true }), row('in', 'income', { accountId: 'other-bank' }),
    row('salary', 'income', { title: 'Salary', category: 'salary', amountFils: 50000 }),
    row('shop', 'expense', { title: 'Coffee', category: 'dining', amountFils: 2500 })];
  const sums = transactions => {
    const internal = ledger.internalTransferIds(transactions, accounts);
    return [transactions.filter(t => ledger.isIncome(t, undefined, internal)).reduce((s,t) => s+t.amountFils,0),
      transactions.filter(t => ledger.isSpending(t, undefined, internal)).reduce((s,t) => s+t.amountFils,0)];
  };
  assert.deepEqual(sums(rows), [50000, 2500]);
  assert.equal(core.reconcileTransfers(rows, accounts).pendingIds.size, 2);
  assert.throws(() => decide(rows, ['out', 'in'], 'external'), /known-counterparty group/);
  const external = decideEach(rows, ['out', 'in'], 'external');
  assert.deepEqual(sums(external), [60000, 12500]);
  assert.equal(ledger.isTransfer(external[0]), false, 'old outgoing flag cannot override user decision');
  assert.equal(external.length, rows.length);
  assert.deepEqual(external.map(t => [t.id,t.type,t.amountFils,t.accountId]), rows.map(t => [t.id,t.type,t.amountFils,t.accountId]));
  const own = decideEach(external, ['out', 'in'], 'own');
  assert.deepEqual(sums(own), [50000, 2500]);
  assert.equal(core.reconcileTransfers(own, accounts).pendingIds.size, 0);
  const undo = decide(own, ['out'], null);
  assert.equal(core.reconcileTransfers(undo, accounts).pendingIds.has('out'), true);
});

test('a company-suffix category guess cannot turn an unclear transfer into confirmed business income', () => {
  const unknown = row('company-transfer', 'income', { category: 'business', title: 'Incoming transfer' });
  const named = row('business-payout', 'income', { category: 'business', title: 'Business payout' });
  assert.equal(core.reconcileTransfers([unknown, named], accounts).pendingIds.has(unknown.id), true);
  assert.equal(ledger.isIncome(unknown), false);
  assert.equal(ledger.isIncome(named), true);
  const confirmed = decide([unknown], [unknown.id], 'external')[0];
  assert.equal(ledger.isIncome(confirmed), true);
});

test('starter budgets use confirmed business income and exclude pending and own transfer credits', () => {
  const pending = ['2026-08-08', '2026-09-08'].map((date, index) => row(`business-${index}`, 'income',
    { category: 'business', amountFils: 1000000, date }));
  assert.equal(onboardingIncomeBasis(pending), 0);
  assert.equal(onboardingIncomeBasis(decideEach(pending, pending.map(t => t.id), 'own')), 0);
  assert.equal(onboardingIncomeBasis(decideEach(pending, pending.map(t => t.id), 'external')), 1000000);
  assert.equal(onboardingIncomeBasis(pending.map(t => ({ ...t, title: 'Business payout' }))), 1000000);
});

test('generic credit routed onto a credit card cannot settle a statement; explicit repayment still does', () => {
  const generic = row('unknown-credit', 'income', { accountId: 'credit', isTransfer: true });
  const payment = row('repayment', 'income', { title: 'Card payment', accountId: 'credit', isTransfer: true,
    cardPaymentSide: 'receipt' });
  assert.deepEqual(cardPaymentRows(stateOf([generic, payment])).map(t => t.id), ['repayment']);
  const cash = summarizeCashOutflow(stateOf([generic, payment]), '2026-09');
  assert.equal(cash.cardPaymentsFils, 10000);
  assert.equal(cash.transactionIds.has('unknown-credit'), false);
  const manual = row('manual-repayment', 'income', { source: 'manual', title: 'ADCB payment', accountId: 'credit', isTransfer: true });
  assert.deepEqual(cardPaymentRows(stateOf([manual])).map(t => t.id), ['manual-repayment']);
  assert.equal(summarizeCashOutflow(stateOf([manual]), '2026-09').cardPaymentsFils, 10000);
});

test('saved external payment remains separate from a coincident card repayment after role-changing reread', () => {
  const outgoing = decide([row('external', 'expense', { isTransfer: true })], ['external'], 'external')[0];
  const rewritten = { ...outgoing, cardPaymentSide: 'debit', paymentFlowSide: 'funding' };
  const repayment = row('repayment', 'income', { title: 'Card payment', accountId: 'credit', isTransfer: true,
    cardPaymentSide: 'receipt', ts: ts + 10000 });
  const summary = summarizeCashOutflow(stateOf([rewritten, repayment]), '2026-09');
  assert.equal(summary.totalFils, 20000);
  assert.equal(summary.cardPaymentsFils, 10000);
  assert.equal(summary.accountOutflowFils, 10000);
  assert.equal(ledger.isSpending(rewritten), true);
});

test('payment-flow repair cannot consume a reviewed funding row during batch application', () => {
  const funding = decide([row('funding', 'expense', { isTransfer: true })], ['funding'], 'own')[0];
  const rewritten = { ...funding, paymentFlowSide: 'funding' };
  const receipt = row('utility', 'expense', { title: 'DEWA', accountId: 'other-bank', category: 'utilities',
    paymentFlowSide: 'receipt', billIdentity: 'dewa', ts: ts + 60000 });
  const base = stateOf([rewritten, receipt]);
  const batch = materializeImportBatch({ transactions: [], newAccounts: [], newDues: [], newBills: [],
    newHints: {}, snapshots: {}, bankNames: {}, lastScanTs: ts, updates: [] }, base, () => 'unused');
  const result = applyMaterializedImportBatch(base, batch);
  assert.equal(result.transactions.length, 2);
  assert.deepEqual(result.transactions.find(t => t.id === funding.id).transferDecision, funding.transferDecision);
});

test('reread deletion and capture dedupe protect decisions without resurrecting duplicate events', () => {
  const original = row('reviewed', 'expense', { smsKey: `ha44t${ts}` });
  const decided = decide([original], [original.id], 'external')[0];
  assert.equal(applyHealUpdates([decided], [{ id: decided.id, remove: true }]).length, 1);
  const duplicate = { ...original, id: 'new-unreviewed' };
  for (const input of [[duplicate, decided], [decided, duplicate]]) {
    const deduped = reconcileCaptureDuplicates(input);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].id, decided.id);
    assert.deepEqual(deduped[0].transferDecision, decided.transferDecision);
  }
  const differentEvent = { ...duplicate, smsKey: `ha45t${ts}` };
  assert.equal(reconcileCaptureDuplicates([differentEvent, decided]).length, 2);
});

test('backup validation retains valid decisions and refuses malformed nested metadata', () => {
  const rows = decide([row('out', 'expense')], ['out'], 'own');
  const decoded = JSON.parse(JSON.stringify(stateOf(rows)));
  assert.equal(isValidBackupState(decoded), true);
  assert.deepEqual(core.normalizeTransferLinks(decoded.transactions, decoded.accounts)[0].transferDecision, rows[0].transferDecision);
  for (const patch of [
    { transferDecision: { version: 1, ownership: 'unknown', decidedAt: ts } },
    { transferEvidence: { version: 1, currency: 'AED', attribution: 'source', counterparty: { last4: '12**34', kind: 'account' } } },
    { transferMatch: { version: 1, counterpartId: 'missing', basis: 'user', signature: 'fake', counterpartSignature: 'fake' } },
  ]) assert.equal(isValidBackupState(stateOf([{ ...rows[0], ...patch }])), false);
});

test('private reread backfills bounded evidence without changing a saved external decision or duplicating rows', () => {
  markets.setLedgerCurrency(null); markets.setActiveMarket('AE');
  const raw = 'Your funds transfer request to account 2222 from your account 1111 for AED 100.00 has been processed.';
  const session = createLaunchAlertSession({ overrides: {}, regionHint: 'AE' });
  const parsed = session.parse(raw, 'ADCB');
  assert.ok(parsed);
  const scan = { ...parsed, raw, sender: 'ADCB', date: '2026-09-08', smsTs: ts, channel: 'inbox', sourceEventId: 'synthetic-transfer-1' };
  const base = stateOf([]);
  let nextId = 0;
  const apply = (rows, state) => {
    const plan = buildImportPlan(rows, state, ts);
    return applyMaterializedImportBatch(state, materializeImportBatch(plan.batch, state, p => `${p}-${nextId++}`));
  };
  const imported = apply([scan], base);
  assert.equal(imported.transactions.length, 1);
  const tx = imported.transactions[0];
  assert.ok(tx.transferEvidence);
  assert.equal(tx.raw, undefined);
  const saved = { ...imported, transactions: core.applyTransferDecision(imported.transactions, imported.accounts,
    { ids: [tx.id], ownership: 'external', now: ts, expectedFingerprints: { [tx.id]: core.transferFingerprint(tx) } }) };
  const replayed = apply([scan], saved);
  assert.equal(replayed.transactions.length, 1);
  assert.deepEqual(replayed.transactions[0].transferDecision, saved.transactions[0].transferDecision);
  assert.equal(ledger.isSpending(replayed.transactions[0]), true);
  assert.equal(replayed.transactions[0].raw, undefined);
});
