'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHarness } = require('./reference-harness.cjs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const core = load(path.join(root, 'src/lib/transfer-reconciliation.ts'), {
  '@/lib/markets': load(path.join(root, 'src/lib/markets.ts')),
  '@/lib/currency-metadata': load(path.join(root, 'src/lib/currency-metadata.ts')),
  '@noble/hashes/sha2.js': require('@noble/hashes/sha2.js'),
  '@noble/hashes/utils.js': require('@noble/hashes/utils.js'),
});
const { confirmedTransferIds, duplicateTransactionIds, getTransferActivity, isListedExternalTransfer } = load(path.join(root, 'src/lib/transfer-activity.ts'), {
  '@/lib/transfer-reconciliation': core,
});
const NOW = Date.parse('2026-09-08T10:00:00Z');
const accounts = ['1111', '2222'].map((last4, i) => ({ id: `bank-${i}`, name: `Bank ${i}`, kind: 'bank',
  bankName: 'ADCB', last4, openingFils: 0, color: '#111111' }));
const row = (id, extra = {}) => ({ id, type: 'expense', amountFils: 10000, category: 'other',
  accountId: accounts[0].id, title: 'Outgoing transfer', date: '2026-09-08', ts: NOW,
  source: 'sms', smsKey: `s${NOW}-${id}`, captureInstrument: { last4: '1111', kind: 'account', bankIdentity: 'adcb' },
  transferEvidence: { version: 1, currency: 'AED', attribution: 'source' }, ...extra });
const ids = value => Array.from(value).sort();

test('primary tabs use stored receipts without forcing canonical reconciliation on first render', () => {
  for (const receipt of [
    { transferInternalIds: [], transferNormalizationVersion: 2, historyImport: null },
    { transferInternalIds: [], transferNormalizationVersion: undefined, historyImport: { status: 'running', scanned: 10, found: 2 } },
  ]) {
    const h = createHarness({ state: receipt });
    h.deps['@/lib/transfer-reconciliation'].reconcileTransfers = () => {
      throw new Error('Primary tab rebuilt the transfer graph');
    };
    assert.doesNotThrow(() => h.render('home'));
    assert.doesNotThrow(() => h.render('flow'));
  }
});

test('paired own transfers retain both legs; external and explicitly own missing-counterpart transfers are confirmed', () => {
  const rows = [
    row('out', { transferEvidence: { version: 1, currency: 'AED', attribution: 'source', reference: 'TRANSFER-123456' } }),
    row('in', { type: 'income', accountId: accounts[1].id, title: 'Incoming transfer',
      captureInstrument: { last4: '2222', kind: 'account', bankIdentity: 'adcb' },
      transferEvidence: { version: 1, currency: 'AED', attribution: 'source', reference: 'TRANSFER-123456' } }),
    row('external', { amountFils: 24000, transferDecision: { version: 1, ownership: 'external', decidedAt: NOW } }),
    row('missing', { amountFils: 33000, transferDecision: { version: 1, ownership: 'own', decidedAt: NOW } }),
  ];
  const snapshot = JSON.stringify(rows);
  const reconciliation = core.reconcileTransfers(rows, accounts);
  assert.equal(reconciliation.byId.get('out').status, 'confirmed-own');
  assert.equal(reconciliation.byId.get('missing').status, 'counterpart-missing');
  assert.deepEqual(ids(confirmedTransferIds(rows, reconciliation)), ['external', 'in', 'missing', 'out']);
  const activity = getTransferActivity(rows, accounts, reconciliation);
  assert.equal(activity.length, 4);
  assert.equal(activity.find(r => r.transaction.id === 'external').ownership, 'external');
  assert.ok(activity.every(r => !r.needsReview));
  assert.equal(activity[0].assessment.counterpartId, 'in');
  assert.equal(activity[1].assessment.counterpartId, 'out');
  assert.equal(JSON.stringify(rows), snapshot, 'browsing cannot mutate source rows');
  assert.equal(getTransferActivity(rows, accounts).length, 4, 'optional reconciliation uses the same current model');
});

test('unknown transfers stay available without being promoted into confirmed membership', () => {
  const rows = [row('unknown', { isTransfer: true })];
  const reconciliation = core.reconcileTransfers(rows, accounts);
  assert.equal(reconciliation.byId.get('unknown').status, 'ownership-unknown');
  assert.equal(reconciliation.pendingIds.has('unknown'), false, 'generic unknowns are not mandatory review chores');
  assert.equal(confirmedTransferIds(rows, reconciliation).size, 0);
  const [activity] = getTransferActivity(rows, accounts, reconciliation);
  assert.equal(activity.ownership, 'unknown');
  assert.equal(activity.confirmed, false);
  assert.equal(activity.needsReview, false, 'listed neutrally, without a review chore');
});

test('likely and ambiguous candidates do not gain ownership or new pairing in the activity projection', () => {
  const rows = [row('likely'), row('ambiguous'), row('missing-unknown')];
  const reconciliation = core.reconcileTransfers(rows, accounts);
  for (const [id, status] of [['likely', 'likely-own'], ['ambiguous', 'ambiguous'], ['missing-unknown', 'counterpart-missing']]) {
    reconciliation.byId.set(id, { id, status, reason: 'multiple-candidates', candidateIds: ['candidate-a', 'candidate-b'] });
  }
  // The reconciler queues likely and ambiguous rows; an unknown-ownership
  // missing counterpart is not in its queue.
  reconciliation.pendingIds.add('likely');
  reconciliation.pendingIds.add('ambiguous');
  const activity = getTransferActivity(rows, accounts, reconciliation);
  assert.equal(activity.length, 3);
  assert.ok(activity.every(r => r.ownership === 'unknown' && !r.confirmed && !r.assessment.counterpartId));
  assert.deepEqual(activity.filter(r => r.needsReview).map(r => r.transaction.id).join(), 'likely,ambiguous');
  assert.equal(confirmedTransferIds(rows, reconciliation).size, 0);
});

test('real cross-bank suggestions retain their proposed counterpart without claiming confirmed ownership', () => {
  const rows = [
    row('wio-out', { accountId: 'unresolved-wio', captureInstrument: undefined,
      transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'Wio' } }),
    row('fab-in', { type: 'income', title: 'Incoming transfer', accountId: 'unresolved-fab', captureInstrument: undefined,
      ts: NOW + 240000, smsKey: `s${NOW + 240000}-fab-in`,
      transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'FAB' } }),
  ];
  const reconciliation = core.reconcileTransfers(rows, []);
  assert.equal(reconciliation.byId.get('wio-out').status, 'likely-own');
  const activity = getTransferActivity(rows, [], reconciliation);
  assert.equal(activity.length, 2);
  assert.ok(activity.every(r => !r.confirmed && r.ownership === 'unknown'));
  assert.equal(activity[0].needsReview, true, 'a credible own-account suggestion is a review item');
  assert.equal(activity[0].assessment.counterpartId, 'fab-in');
  assert.equal(confirmedTransferIds(rows, reconciliation).size, 0);
});

test('salary, cashback, refunds, card receipts and settlements do not enter transfer history despite legacy flags', () => {
  const rows = [
    row('salary', { category: 'salary', title: 'Salary', isTransfer: true }),
    row('cashback', { title: 'Cashback credit', isTransfer: true }),
    row('refund', { title: 'Purchase refund', isTransfer: true }),
    row('receipt', { title: 'Card •7720 payment', cardPaymentSide: 'receipt', isTransfer: true }),
    row('settlement', { title: 'Card settlement', isTransfer: true }),
    row('funding', { paymentFlowSide: 'funding', isTransfer: true }),
  ];
  const reconciliation = core.reconcileTransfers(rows, accounts);
  assert.equal(confirmedTransferIds(rows, reconciliation).size, 0);
  assert.equal(getTransferActivity(rows, accounts, reconciliation).length, 0);
});

test('card repayments, likely repayments and corroborating observations stay out even when internal or pending', () => {
  const rows = [row('repayment'), row('likely-card'), row('observation')];
  const reconciliation = core.reconcileTransfers(rows, accounts);
  for (const [id, status] of [['repayment', 'card-repayment'], ['likely-card', 'likely-card-repayment'], ['observation', 'corroborating-alert']]) {
    reconciliation.byId.set(id, { id, status, reason: 'bank-confirmation', candidateIds: [] });
    reconciliation.internalIds.add(id);
    reconciliation.pendingIds.add(id);
  }
  assert.equal(confirmedTransferIds(rows, reconciliation).size, 0);
  assert.equal(getTransferActivity(rows, accounts, reconciliation).length, 0);
});

test('duplicate-id observations are left to the review queue and never produce duplicate record keys', () => {
  const rows = [row('twice'), row('twice', { amountFils: 20000 }), row('once', { amountFils: 30000 }),
    row('sent-twice', { transferDecision: { version: 1, ownership: 'external', decidedAt: NOW } }),
    row('sent-twice', { amountFils: 40000, transferDecision: { version: 1, ownership: 'external', decidedAt: NOW } })];
  const reconciliation = core.reconcileTransfers(rows, accounts);
  assert.equal(reconciliation.byId.get('twice').status, 'ambiguous');
  assert.equal(reconciliation.pendingIds.has('twice'), true, 'the reconciler still queues the duplicate');
  const activity = getTransferActivity(rows, accounts, reconciliation);
  assert.deepEqual(activity.map(r => r.transaction.id).join(), 'once');
  const keys = activity.map(r => r.transaction.id);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(Array.from(duplicateTransactionIds(rows)).sort().join(), 'sent-twice,twice');
  assert.equal(duplicateTransactionIds(rows), duplicateTransactionIds(rows), 'cached per ledger array');
});

test('transfers on archived accounts are not listed', () => {
  const archived = [accounts[0], { ...accounts[1], archived: true }];
  const rows = [row('live', { transferDecision: { version: 1, ownership: 'external', decidedAt: NOW } }),
    row('archived-external', { accountId: accounts[1].id, amountFils: 20000,
      captureInstrument: { last4: '2222', kind: 'account', bankIdentity: 'adcb' },
      transferDecision: { version: 1, ownership: 'external', decidedAt: NOW } }),
    row('archived-unknown', { accountId: accounts[1].id, amountFils: 30000,
      captureInstrument: { last4: '2222', kind: 'account', bankIdentity: 'adcb' } })];
  const activity = getTransferActivity(rows, archived, core.reconcileTransfers(rows, archived));
  assert.deepEqual(activity.map(r => r.transaction.id).join(), 'live');
});

test('the row-local activity test never hides a row that the Transfers screen does not list', () => {
  // Primary tabs cannot rebuild the transfer graph, so they may leave out only
  // rows whose own evidence guarantees a Transfers listing. A likely card
  // repayment (unknown ownership) must stay in activity even though its
  // status is not visible row-locally.
  const external = { version: 1, ownership: 'external', decidedAt: NOW };
  const rows = [row('sent', { transferDecision: external }), row('generic'),
    row('likely-card', { amountFils: 20000 }), row('dup-sent', { transferDecision: external }),
    row('dup-sent', { amountFils: 30000, transferDecision: external }),
    row('coffee', { title: 'Coffee', category: 'dining', transferEvidence: undefined, amountFils: 1500 })];
  const reconciliation = core.reconcileTransfers(rows, accounts);
  reconciliation.byId.set('likely-card', { id: 'likely-card', status: 'likely-card-repayment', reason: 'amount-time', candidateIds: [] });
  reconciliation.pendingIds.add('likely-card');
  const listed = new Set(getTransferActivity(rows, accounts, reconciliation).map(r => r.transaction.id));
  assert.equal(listed.has('likely-card'), false, 'Transfers leaves likely card repayments to their own review');
  const duplicates = duplicateTransactionIds(rows);
  const skipped = rows.filter(tx => isListedExternalTransfer(tx, duplicates)).map(tx => tx.id);
  assert.deepEqual(skipped.join(), 'sent');
  for (const id of skipped) assert.ok(listed.has(id), `${id} is listed on Transfers`);
});
