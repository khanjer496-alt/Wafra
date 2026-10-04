'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { core } = require('./load-transfer-ledger.cjs');
const root = path.resolve(__dirname, '../../..');
const answer = load(path.join(root, 'src/lib/transfer-answer.ts'), { '@/lib/transfer-reconciliation': core });

const NOW = Date.parse('2026-10-02T10:00:00Z');
const accounts = ['1111', '2222'].map((last4, i) => ({ id: `bank-${i}`, name: `Bank ${i}`, kind: 'bank',
  bankName: 'ADCB', last4, openingFils: 0, color: '#111111' }));
const row = (id, extra = {}) => ({ id, type: 'expense', amountFils: 500000, category: 'other',
  accountId: accounts[0].id, title: 'Outgoing transfer', date: '2026-10-02', ts: NOW,
  source: 'sms', smsKey: `s-${id}`, captureInstrument: { last4: '1111', kind: 'account', bankIdentity: 'adcb' },
  transferEvidence: { version: 1, currency: 'AED', attribution: 'source' }, ...extra });

test('builds an own answer linked to the one likely counterpart', () => {
  const tx = row('o'); const other = row('i', { type: 'income', accountId: accounts[1].id });
  const request = answer.buildTransferAnswer({ transaction: tx, answer: 'own', counterpart: other, generation: 7 });
  assert.deepEqual([...request.ids], ['o']);
  assert.equal(request.counterpartId, 'i');
  assert.deepEqual(Object.keys(request.expectedFingerprints).sort(), ['i', 'o']);
  assert.equal(request.expectedGeneration, 7);
});

test('external and none never link, and only freeze the selected row', () => {
  for (const choice of ['external', 'none']) {
    const request = answer.buildTransferAnswer({ transaction: row('o'), answer: choice, counterpart: row('i'), generation: 1 });
    assert.equal(request.counterpartId, undefined);
    assert.deepEqual(Object.keys(request.expectedFingerprints), ['o']);
  }
});

test('current answer and own candidates', () => {
  assert.equal(answer.currentAnswer(row('a', { transferDecision: { version: 1, ownership: 'none', decidedAt: 1 } })), 'none');
  assert.equal(answer.currentAnswer(row('b', { transferDecision: { version: 1, ownership: 'external', decidedAt: 1 } })), 'external');
  assert.equal(answer.currentAnswer(row('c')), null);
  const b = row('b', { type: 'income', accountId: accounts[1].id });
  const c = row('c', { type: 'income', accountId: accounts[1].id });
  const rowsById = new Map([[b.id, b], [c.id, c]]);
  assert.deepEqual([...answer.ownCandidates(row('a'), { id: 'a', status: 'ambiguous', reason: 'multiple-candidates', candidateIds: ['b', 'c'] }, rowsById).map(r => r.id)], ['b', 'c']);
  assert.deepEqual([...answer.ownCandidates(row('a'), { id: 'a', status: 'likely-own', reason: 'reference', counterpartId: 'b', candidateIds: [] }, rowsById).map(r => r.id)], ['b']);
});
