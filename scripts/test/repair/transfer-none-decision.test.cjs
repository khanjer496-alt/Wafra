'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { ledger, core } = require('./load-transfer-ledger.cjs');
const root = path.resolve(__dirname, '../../..');
const activity = load(path.join(root, 'src/lib/transfer-activity.ts'), { '@/lib/transfer-reconciliation': core });

const NOW = Date.parse('2026-10-02T10:00:00Z');
const accounts = ['1111', '2222'].map((last4, i) => ({ id: `bank-${i}`, name: `Bank ${i}`, kind: 'bank',
  bankName: 'ADCB', last4, openingFils: 0, color: '#111111' }));
const row = (id, extra = {}) => ({ id, type: 'expense', amountFils: 500000, category: 'other',
  accountId: accounts[0].id, title: 'Outgoing transfer', date: '2026-10-02', ts: NOW,
  source: 'sms', smsKey: `s-${id}`, captureInstrument: { last4: '1111', kind: 'account', bankIdentity: 'adcb' },
  transferEvidence: { version: 1, currency: 'AED', attribution: 'source' }, ...extra });
const decide = (rows, ids, ownership) => core.applyTransferDecision(rows, accounts, {
  ids, ownership, now: NOW + 1,
  expectedFingerprints: Object.fromEntries(ids.map(id => [id, core.transferFingerprint(rows.find(r => r.id === id))])),
});

test('a none decision validates, round-trips and is reported as declined', () => {
  assert.equal(core.isTransferDecision({ version: 1, ownership: 'none', decidedAt: NOW }), true);
  assert.equal(core.isTransferDecision({ version: 1, ownership: 'none', decidedAt: NOW, counterpartId: 'x' }), false,
    'only an own-account answer may name a counterpart');
  const [saved] = decide([row('t1')], ['t1'], 'none');
  assert.equal(saved.transferDecision.ownership, 'none');
  assert.equal(core.transferDeclined(saved), true);
  assert.equal(core.isTransferCandidate(saved), true, 'stays reachable for Undo');
  assert.equal(core.transferOwnership(saved), null);
});

test('a declined row leaves Transfers and the review queue and counts like an ordinary row', () => {
  const rows = decide([row('t1')], ['t1'], 'none');
  const result = core.reconcileTransfers(rows, accounts);
  assert.equal(result.byId.has('t1'), false);
  assert.equal(result.pendingIds.has('t1'), false);
  assert.equal(result.internalIds.has('t1'), false);
  assert.equal(activity.getTransferActivity(rows, accounts, result).length, 0);
  assert.equal(ledger.countsInTotals(rows[0], new Set(accounts.map(a => a.id)), result.internalIds), true);
});

test('legacy isTransfer does not keep a declined manual row out of totals', () => {
  const manual = { id: 'm1', type: 'expense', amountFils: 2000, category: 'other', accountId: accounts[0].id,
    title: 'Move to savings', date: '2026-10-02', source: 'manual', isTransfer: true };
  assert.equal(ledger.isTransfer(manual), true);
  const [declined] = decide([manual], ['m1'], 'none');
  assert.equal(ledger.isTransfer(declined), false);
  const live = new Set([accounts[0].id]);
  assert.equal(ledger.countsInTotals(declined, live, new Set()), true);
  assert.equal(ledger.countsInCashflowTotals(declined, live, new Set()), true,
    'Home activity and day totals must include it, matching the month total');
  assert.equal(ledger.isSpending(declined, live, new Set()), true);
  assert.equal(ledger.isUnresolvedTransferMovement(declined, live, new Set()), false);
  assert.equal(ledger.isInboundTransfer(declined), false);
});

test('a declined row is never proposed as the other side of someone else\'s transfer', () => {
  const out = row('out', { transferEvidence: { version: 1, currency: 'AED', attribution: 'source', reference: 'TRANSFER-777777' } });
  const inn = row('in', { type: 'income', accountId: accounts[1].id, title: 'Incoming transfer',
    captureInstrument: { last4: '2222', kind: 'account', bankIdentity: 'adcb' },
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', reference: 'TRANSFER-777777' } });
  const rows = decide([out, inn], ['in'], 'none');
  const result = core.reconcileTransfers(rows, accounts);
  assert.notEqual(result.byId.get('out')?.counterpartId, 'in');
  assert.ok(!(result.byId.get('out')?.candidateIds ?? []).includes('in'));
});

test('Undo (null) removes a none decision and the batch path accepts none', () => {
  const declined = decide([row('t1')], ['t1'], 'none');
  const undone = decide(declined, ['t1'], null);
  assert.equal(undone[0].transferDecision, undefined);
  const batch = core.applyTransferDecisionBatch([row('a'), row('b')], accounts, {
    decisions: [{ ids: ['a'], ownership: 'none' }, { ids: ['b'], ownership: 'external' }], now: NOW + 1,
    expectedFingerprints: { a: core.transferFingerprint(row('a')), b: core.transferFingerprint(row('b')) },
  });
  assert.deepEqual(batch.map(r => r.transferDecision.ownership), ['none', 'external']);
});

test('canMarkOwnTransfer offers the one-tap mark only on ordinary rows the system has not claimed', () => {
  const shop = { id: 'shop', type: 'expense', amountFils: 4500, category: 'groceries', accountId: accounts[0].id, title: 'Carrefour',
    date: '2026-10-02', ts: NOW, source: 'sms', smsKey: 's-shop' };
  assert.equal(typeof core.canMarkOwnTransfer, 'function');
  assert.equal(core.canMarkOwnTransfer(shop), true, 'an ordinary captured purchase');
  assert.equal(core.canMarkOwnTransfer({ ...shop, isTransfer: true }), true, 'and the same row once chip-marked, so it can be unmarked');
  assert.equal(core.canMarkOwnTransfer({ ...shop, type: 'income' }), true);
  assert.equal(core.canMarkOwnTransfer({ ...shop, isTransfer: true, cardPaymentSide: 'payer' }), false, 'a card payment with cardPaymentSide');
  assert.equal(core.canMarkOwnTransfer({ ...shop, isTransfer: true, paymentFlowSide: 'receipt' }), false, 'a payment flow');
  assert.equal(core.canMarkOwnTransfer({ ...shop, isTransfer: true, title: 'Card payment' }), false, 'a "Card payment" SMS title');
  assert.equal(core.canMarkOwnTransfer({ ...shop, title: 'Credit card payment received' }), false, 'a settlement title');
  assert.equal(core.canMarkOwnTransfer({ ...shop, category: 'salary', type: 'income', title: 'Salary' }), false, 'salary');
  assert.equal(core.canMarkOwnTransfer({ ...shop, category: 'business', title: 'Acme Trading' }), false, 'business spending');
  assert.equal(core.canMarkOwnTransfer(row('candidate')), false, 'a candidate answers through the question instead');
  assert.equal(core.canMarkOwnTransfer(row('declined', { transferDecision: { version: 1, ownership: 'none', decidedAt: NOW } })), false);
  assert.equal(core.canMarkOwnTransfer({ ...shop, source: 'manual', smsKey: undefined, isTransfer: true }), false, 'a manual flagged row is a candidate');
  assert.equal(core.canMarkOwnTransfer({ ...shop, type: 'transfer' }), false, 'only income and expense rows');
  assert.equal(core.isTransferCandidate(row('candidate')), true, 'the shared exclusions did not change candidates');
});
