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
  assert.equal(ledger.countsInTotals(declined, new Set([accounts[0].id]), new Set()), true);
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
