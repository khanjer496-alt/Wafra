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
const { confirmedTransferIds, getTransferActivity } = load(path.join(root, 'src/lib/transfer-activity.ts'), {
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
  assert.equal(activity.needsReview, true);
});

test('likely and ambiguous candidates do not gain ownership or new pairing in the activity projection', () => {
  const rows = [row('likely'), row('ambiguous'), row('missing-unknown')];
  const reconciliation = core.reconcileTransfers(rows, accounts);
  for (const [id, status] of [['likely', 'likely-own'], ['ambiguous', 'ambiguous'], ['missing-unknown', 'counterpart-missing']]) {
    reconciliation.byId.set(id, { id, status, reason: 'multiple-candidates', candidateIds: ['candidate-a', 'candidate-b'] });
  }
  const activity = getTransferActivity(rows, accounts, reconciliation);
  assert.equal(activity.length, 3);
  assert.ok(activity.every(r => r.ownership === 'unknown' && r.needsReview && !r.assessment.counterpartId));
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
  assert.ok(activity.every(r => r.needsReview && r.ownership === 'unknown'));
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
