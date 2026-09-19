'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(__dirname, '../build');
const subjects = new Set(['heal', 'import-plan', 'ledger-import']);
const cache = new Map();
function load(name) {
  if (!subjects.has(name)) return require(path.join(build, name));
  if (cache.has(name)) return cache.get(name).exports;
  const module = { exports: {} }; cache.set(name, module);
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  Function('module', 'exports', 'require', code)(module, module.exports, id => {
    assert.ok(id.startsWith('@/lib/')); return load(id.slice(6));
  });
  return module.exports;
}
load('markets').setActiveMarket('AE'); load('markets').setLedgerCurrency('AED', 2);
const { buildImportPlan } = load('import-plan');
const { applyHealPatch, applyHealUpdates } = load('heal');
const { applyMaterializedImportBatch, materializeImportBatch } = load('ledger-import');
const event = 'b'.repeat(64), sourceKey = 'h' + event;
const observedAt = Date.parse('2021-01-10T10:30:55Z');
const money = { schemaVersion: 2, currency: 'AED', exponent: 2 };
const account = { id: 'card', name: 'Credit Card', kind: 'card', cardType: 'credit', last4: '1234', openingFils: 0, color: '#000' };
const row = patch => ({ id: 'receipt', source: 'sms', smsKey: sourceKey, ts: observedAt,
  date: '2021-10-01', amountFils: 300000, type: 'income', isTransfer: true,
  cardPaymentSide: 'receipt', accountId: 'card', category: 'other', title: 'Card •1234 payment',
  captureInstrument: { last4: '1234', kind: 'credit' }, ...patch });
const parsed = patch => ({ kind: 'cardPayment', type: 'expense', amountFils: 300000,
  date: '2021-01-10', dateRepairFrom: '2021-10-01', smsTs: observedAt, sourceEventId: event,
  card: { last4: '1234', kind: 'credit' }, cardPaymentSide: 'receipt', transferHint: true,
  merchant: 'Card •1234 payment', categoryGuess: 'other', categoryDeliberate: true,
  minDueFils: null, dueDay: null, snapshotFils: null, snapshotKind: null, reference: null,
  currency: 'AED', channel: 'inbox', market: 'AE', ...patch });
const state = (transactions = [row()]) => ({ hydrated: true, accounts: [account], transactions,
  marketId: 'AE', ledgerMoney: money, bills: [], cardDues: [], budgets: [], goals: [],
  accountHints: {}, merchantOverrides: {}, notSubscriptions: [], lastScanTs: observedAt });
const plan = (rows = [row()], p = parsed()) => buildImportPlan([p], state(rows), observedAt, new Date('2026-09-19'));
const proof = { from: '2021-10-01', to: '2021-01-10', sourceKey, observedAt, amountFils: 300000,
  accountId: 'card', instrument: { last4: '1234', kind: 'credit' } };
test('exact iOS source replay repairs date without another transaction, and is idempotent', () => {
  const result = plan();
  assert.equal(result.batch.transactions.length, 0);
  assert.deepEqual(result.batch.updates.find(p => p.sourceDateCorrection)?.sourceDateCorrection, proof);
  const original = row();
  const changed = applyHealUpdates([original], result.batch.updates)[0];
  assert.equal(changed.date, proof.to);
  for (const key of ['id', 'amountFils', 'ts', 'smsKey', 'accountId', 'isTransfer']) assert.equal(changed[key], original[key]);
  assert.equal(plan([changed]).batch.transactions.length, 0);
  assert.ok(plan([changed]).batch.updates.every(p => !p.sourceDateCorrection));
});
test('date planning rejects user ownership, collisions, absent evidence and incompatible facts', () => {
  const cases = [
    [[row({ userEdited: true })], parsed()], [[row({ source: 'manual' })], parsed()],
    [[row({ transferDecision: { version: 1, ownership: 'own', decidedAt: 1 } })], parsed()],
    [[row(), row({ id: 'collision' })], parsed()],
    [[row(), row({ id: 'manual-collision', source: 'manual' })], parsed()],
    [[row()], parsed({ smsTs: observedAt + 1 })], [[row()], parsed({ amountFils: 300001 })],
    [[row()], parsed({ dateRepairFrom: undefined })], [[row()], parsed({ sourceEventId: undefined })],
    [[row({ smsKey: 'hlegacy' })], parsed({ sourceEventId: 'legacy' })],
    [[row({ smsKey: 's' + observedAt + '-300000' })], parsed({ sourceEventId: undefined })],
    [[row({ captureInstrument: { last4: '9876', kind: 'credit' } })], parsed()],
    [[row({ captureInstrument: undefined })], parsed()],
    [[row({ type: 'expense' })], parsed()], [[row({ cardPaymentSide: 'debit' })], parsed()],
    [[row({ isTransfer: false })], parsed()],
  ];
  for (const [rows, p] of cases) assert.ok(plan(rows, p).batch.updates.every(u => !u.sourceDateCorrection));
});
test('a date proof cannot carry other mutations or survive a new source collision', () => {
  const original = row();
  const patch = { id: original.id, sourceDateCorrection: proof, amountFils: 5,
    accountId: 'wrong', isTransfer: false, smsKey: 'wrong', ts: 1, type: 'expense', remove: true };
  assert.deepEqual(applyHealPatch(original, patch), { ...original, date: proof.to });
  assert.deepEqual(applyHealUpdates([original], [patch]), [{ ...original, date: proof.to }]);
  assert.equal(applyHealPatch(original, { ...patch, id: 'different' }), original);
  const rows = [original, row({ id: 'later-collision' })];
  assert.deepEqual(applyHealUpdates(rows, [patch]), rows);
});
test('apply boundary rechecks source, clock, amount, role, edit pins and date evidence', () => {
  const patch = { id: 'receipt', sourceDateCorrection: proof };
  assert.equal(applyHealPatch(row(), patch).date, proof.to);
  for (const change of [{ userEdited: true }, { source: 'manual' }, { smsKey: 'h' + 'c'.repeat(64) },
    { ts: observedAt + 1 }, { amountFils: 1 }, { date: '2021-09-01' }, { type: 'expense' },
    { cardPaymentSide: 'debit' }, { isTransfer: false }, { transferDecision: { ownership: 'own' } }]) {
    const current = row(change); assert.equal(applyHealPatch(current, patch).date, current.date);
  }
  for (const invalid of [{ to: '2021-02-30' }, { to: '2021-02-01' }, { from: '2021-13-01' }, { sourceKey: 's123-300000' }]) {
    assert.equal(applyHealPatch(row(), { ...patch, sourceDateCorrection: { ...proof, ...invalid } }).date, proof.from);
  }
});
test('post-plan instrument and account changes invalidate the date correction', () => {
  const patch = plan().batch.updates.find(update => update.sourceDateCorrection);
  assert.ok(patch);
  for (const change of [
    { captureInstrument: { last4: '9876', kind: 'credit' } },
    { captureInstrument: { last4: '1234', kind: 'debit' } },
    { captureInstrument: { last4: '1234', kind: 'credit', bankIdentity: 'other-bank' } },
    { captureInstrument: undefined }, { accountId: 'rerouted-card' },
  ]) {
    const current = row(change);
    assert.equal(applyHealPatch(current, patch), current);
  }
  const attributed = row({ captureInstrument: { last4: '1234', kind: 'credit', bankIdentity: 'adib' } });
  const bankPatch = plan([attributed]).batch.updates.find(update => update.sourceDateCorrection);
  assert.ok(bankPatch);
  assert.equal(applyHealPatch(row(), bankPatch).date, proof.from, 'removing bank identity invalidates the proof');
});
test('intermediate and final history pages remain newest-first after a date correction', () => {
  const rows = [row(), row({ id: 'middle', smsKey: 'h' + 'd'.repeat(64), date: '2021-06-01', ts: observedAt + 1, amountFils: 10 })];
  for (const status of ['running', 'complete']) {
    const s = state(rows); const batch = plan(rows).batch;
    batch.historyImport = { status, scanned: 2, found: 2, startedAt: observedAt, updatedAt: observedAt, cursor: null };
    batch.parserRereadComplete = status === 'complete';
    batch.transactions.push(row({ id: undefined, smsKey: 'h' + 'e'.repeat(64), date: '2021-03-01',
      ts: observedAt + 100, amountFils: 20, cardPaymentSide: undefined, type: 'expense', isTransfer: false }));
    const materialized = materializeImportBatch(batch, s, prefix => prefix + '-new');
    const result = applyMaterializedImportBatch(s, materialized);
    assert.deepEqual(result.transactions.map(t => t.date), ['2021-06-01', '2021-03-01', '2021-01-10']);
  }
});
test('a rejected date correction with an unrelated removal does not sort the ledger', () => {
  const current = row({ userEdited: true });
  const newest = row({ id: 'removed', smsKey: 'h' + 'f'.repeat(64), date: '2021-12-01' });
  const s = state([newest, current]);
  const batch = plan().batch;
  batch.updates.push({ id: newest.id, remove: true });
  batch.historyImport = { status: 'running', scanned: 2, found: 1, startedAt: observedAt, updatedAt: observedAt, cursor: null };
  const originalSort = Array.prototype.sort;
  let ledgerSorts = 0;
  Array.prototype.sort = function (...args) {
    if (this.some(item => item?.id === current.id)) ledgerSorts++;
    return originalSort.apply(this, args);
  };
  let result;
  try { result = applyMaterializedImportBatch(s, materializeImportBatch(batch, s, prefix => prefix + '-new')); }
  finally { Array.prototype.sort = originalSort; }
  assert.equal(ledgerSorts, 0);
  assert.deepEqual(result.transactions, [current]);
});

test('date-only correction cannot create accounts, hints or snapshots from newly learned issuer facts', () => {
  const s = { ...state(), accounts: [{ ...account, bankName: 'Emirates NBD' }] };
  const result = buildImportPlan([parsed({ bankHint: 'ADIB', snapshotFils: 100000, snapshotKind: 'limit' })], s, observedAt, new Date('2026-09-19'));
  assert.equal(result.batch.updates.filter(update => update.sourceDateCorrection).length, 1);
  assert.deepEqual(result.batch.newAccounts, []);
  assert.deepEqual(result.batch.newHints, {});
  assert.deepEqual(result.batch.snapshots, {});
  assert.deepEqual(result.batch.bankNames, {});
  assert.deepEqual(result.batch.cardTypes, {});
  const applied = applyMaterializedImportBatch(s, materializeImportBatch(result.batch, s, () => { throw Error('date repair must not create rows'); }));
  assert.deepEqual(applied.accounts, s.accounts);
  assert.deepEqual(applied.transactions, [{ ...row(), date: '2021-01-10' }]);
});
