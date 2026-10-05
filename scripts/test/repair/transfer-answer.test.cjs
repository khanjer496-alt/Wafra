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

test('undoing a linked own answer clears both sides through the resolver', () => {
  const out = row('o'); const inn = row('i', { type: 'income', accountId: accounts[1].id, title: 'Incoming transfer' });
  const answered = core.applyTransferDecision([out, inn], accounts, {
    ...answer.buildTransferAnswer({ transaction: out, answer: 'own', counterpart: inn, generation: 3 }), now: NOW + 1,
  });
  const [a, b] = answered;
  assert.equal(a.transferDecision.ownership, 'own');
  assert.equal(b.transferDecision.ownership, 'own', 'the other side carries its own decision after a linked answer');
  assert.equal(a.transferMatch.counterpartId, 'i');

  const undo = answer.buildTransferUndo({ transaction: a, counterpart: b, generation: 3 });
  assert.equal(undo.decisions.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(undo.decisions)), [{ ids: ['o'], ownership: null }, { ids: ['i'], ownership: null }]);
  assert.deepEqual(Object.keys(undo.expectedFingerprints).sort(), ['i', 'o']);
  assert.equal(undo.expectedGeneration, 3);

  const cleared = core.applyTransferDecisionBatch(answered, accounts, { ...undo, now: NOW + 2 });
  for (const tx of cleared) {
    assert.equal(tx.transferDecision, undefined, `${tx.id} keeps no decision`);
    assert.equal(tx.transferMatch, undefined, `${tx.id} keeps no link`);
  }
});

test('the one-sided undo the brief first described leaves the counterpart decided', () => {
  const out = row('o'); const inn = row('i', { type: 'income', accountId: accounts[1].id, title: 'Incoming transfer' });
  const answered = core.applyTransferDecision([out, inn], accounts, {
    ...answer.buildTransferAnswer({ transaction: out, answer: 'own', counterpart: inn, generation: 3 }), now: NOW + 1,
  });
  const half = core.applyTransferDecision(answered, accounts, { ids: ['o'], ownership: null, now: NOW + 2,
    expectedFingerprints: { o: core.transferFingerprint(answered[0]) } });
  assert.equal(half[1].transferDecision.ownership, 'own');
});

test('an undo without a counterpart is a single-row decision', () => {
  const undo = answer.buildTransferUndo({ transaction: row('o'), generation: 2 });
  assert.equal(undo.decisions.length, 1);
  assert.deepEqual(Object.keys(undo.expectedFingerprints), ['o']);
});

test('a likely card repayment offers nothing to link: "own" is saved without a pair link', () => {
  const debit = row('debit'); const receipt = row('receipt', { type: 'income', accountId: accounts[1].id, title: 'Payment received' });
  const rowsById = new Map([[receipt.id, receipt]]);
  assert.deepEqual([...answer.ownCandidates(debit, { id: 'debit', status: 'likely-card-repayment', reason: 'amount-time',
    counterpartId: 'receipt', candidateIds: ['receipt'] }, rowsById)], []);
  // A likely own-account pair still links to its matching entry.
  assert.deepEqual([...answer.ownCandidates(debit, { id: 'debit', status: 'likely-own', reason: 'amount-time',
    counterpartId: 'receipt', candidateIds: ['receipt'] }, rowsById).map(r => r.id)], ['receipt']);
});

test('undo clears the other side only while its decision still names this entry', () => {
  const out = row('o', { transferDecision: { version: 1, ownership: 'own', decidedAt: 2, counterpartId: 'i' } });
  const linked = row('i', { type: 'income', accountId: accounts[1].id,
    transferDecision: { version: 1, ownership: 'own', decidedAt: 2, counterpartId: 'o' } });
  assert.deepEqual(JSON.parse(JSON.stringify(answer.buildTransferUndo({ transaction: out, counterpart: linked, generation: 1 }).decisions)),
    [{ ids: ['o'], ownership: null }, { ids: ['i'], ownership: null }]);
  // Answered again since (on its own, or linked elsewhere): its newer answer is kept.
  for (const decision of [{ version: 1, ownership: 'external', decidedAt: 3 },
    { version: 1, ownership: 'own', decidedAt: 3, counterpartId: 'elsewhere' }]) {
    const undo = answer.buildTransferUndo({ transaction: out, counterpart: { ...linked, transferDecision: decision }, generation: 1 });
    assert.deepEqual(JSON.parse(JSON.stringify(undo.decisions)), [{ ids: ['o'], ownership: null }]);
    assert.deepEqual(Object.keys(undo.expectedFingerprints), ['o']);
  }
  const undecided = answer.buildTransferUndo({ transaction: out, counterpart: row('i', { type: 'income' }), generation: 1 });
  assert.equal(undecided.decisions.length, 1);
});

test('fingerprints snapshot a saved answer; a later change is detected; stale store refusals are recognised', () => {
  const saved = row('o', { transferDecision: { version: 1, ownership: 'own', decidedAt: 2 } });
  const expected = answer.transferFingerprintsOf(['o', 'missing'], new Map([[saved.id, saved]]));
  assert.deepEqual(Object.keys(expected), ['o'], 'a missing row is left out');
  assert.equal(answer.transferAnswerMoved(expected, new Map([[saved.id, saved]])), false);
  const newer = { ...saved, transferDecision: { version: 1, ownership: 'external', decidedAt: 3 } };
  assert.equal(answer.transferAnswerMoved(expected, new Map([[newer.id, newer]])), true, 'a newer answer');
  assert.equal(answer.transferAnswerMoved(expected, new Map()), true, 'a deleted row');
  assert.equal(answer.isStaleTransferRejection(new Error('Transfer review is out of date')), true);
  assert.equal(answer.isStaleTransferRejection(new Error('Transfer review changed; open it again')), true);
  assert.equal(answer.isStaleTransferRejection(new Error('Encrypted ledger write failed')), false);
  assert.equal(answer.isStaleTransferRejection(null), false);
});

const batch = load(path.join(root, 'src/lib/transfer-batch.ts'), { '@/lib/transfer-reconciliation': core });

test('a selection with a suggested pair is worded for money in and out', () => {
  assert.equal(batch.transferBatchIncoming([{ direction: 'income' }, { direction: 'income' }]), true);
  assert.equal(batch.transferBatchIncoming([{ direction: 'expense' }]), false);
  assert.equal(batch.transferBatchIncoming([{ direction: 'income' }, { direction: 'expense' }]), 'mixed');
  assert.equal(batch.transferBatchIncoming([{ direction: 'between' }]), 'mixed', 'a pair answered "someone else" is not outgoing only');
  assert.equal(batch.transferBatchIncoming([{ direction: 'expense' }, { direction: 'between' }]), 'mixed');
});

test('groups: bulk-eligible or one shared suggestion is answered whole; a catch-all is not; a duplicate id is read-only', () => {
  const card = 'card';
  const rows = [row('r1'), row('r2'), row('c1', { type: 'income', accountId: card }), row('c2', { type: 'income', accountId: card }),
    row('c3', { type: 'income', accountId: 'elsewhere' }), row('u1'), row('u2'), row('k1'), row('k2'), row('d1')];
  const rowsById = new Map(rows.map(tx => [tx.id, tx]));
  const likely = (id, counterpartId) => [id, { id, status: 'likely-card-repayment', reason: 'amount-time', counterpartId, candidateIds: [counterpartId] }];
  const group = (id, transactionIds, status, bulkEligible = false) => ({ id, transactionIds, accountId: accounts[0].id,
    direction: 'expense', status, bulkEligible });
  const result = batch.transferAnswerGroups({
    groups: [group('likely', ['r1', 'r2'], 'likely-card-repayment'), group('split', ['r1', 'r2'], 'likely-card-repayment'),
      group('catch-all', ['u1', 'u2'], 'ambiguous'), group('known', ['k1', 'k2'], 'ownership-unknown', true),
      group('mixed', ['u1', 'd1'], 'ambiguous')],
    pendingIds: new Set(['r1', 'r2', 'u1', 'u2', 'k1', 'k2', 'd1']), rowsById, excludeIds: new Set(), listedIds: new Set(['u1', 'u2', 'k1', 'k2']),
    duplicateIds: new Set(['d1']),
    assessments: new Map([likely('r1', 'c1'), likely('r2', 'c2')]) });
  const byId = Object.fromEntries(result.map(entry => [entry.id, entry]));
  assert.equal(byId.likely.whole, true, 'every entry matches the same one card');
  assert.equal(byId['catch-all'].whole, false, 'ambiguous "Account → ?" is answered entry by entry');
  assert.equal(byId.known.whole, true, 'bulk-eligible: one known other side');
  assert.deepEqual([...byId['mixed:duplicate'].transactionIds], ['d1']);
  assert.equal(byId['mixed:duplicate'].duplicate, true);
  assert.equal(byId['mixed:duplicate'].whole, false);
  assert.equal(byId.mixed, undefined, 'the one listed entry left is asked about on its own');
  // Suggestions that point at different accounts are not one suggestion.
  const split = batch.transferAnswerGroups({ groups: [group('split', ['r1', 'r2'], 'likely-card-repayment')],
    pendingIds: new Set(['r1', 'r2']), rowsById, excludeIds: new Set(), listedIds: new Set(),
    assessments: new Map([likely('r1', 'c1'), likely('r2', 'c3')]) });
  assert.equal(split[0].whole, false);
  // A suggestion whose matching entry is gone is not one either.
  const gone = batch.transferAnswerGroups({ groups: [group('gone', ['r1', 'r2'], 'likely-card-repayment')],
    pendingIds: new Set(['r1', 'r2']), rowsById, excludeIds: new Set(), listedIds: new Set(),
    assessments: new Map([likely('r1', 'c1'), likely('r2', 'missing')]) });
  assert.equal(gone[0].whole, false);
});
