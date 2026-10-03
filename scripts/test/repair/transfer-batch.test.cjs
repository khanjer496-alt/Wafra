'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { performance } = require('node:perf_hooks');
const { loadStore, ledger, NOW } = require('../../perf/load-store.cjs');

const { reducer, takeCalls, build } = loadStore({ counted: {
  '@/lib/transfer-reconciliation': ['applyTransferDecisionBatch', 'normalizeTransferLinks', 'reconcileTransfers'],
} });
const core = build('transfer-reconciliation');
const money = build('ledger');
const accounts = [
  { id: 'a', name: 'Current', kind: 'bank', bankName: 'ADCB', last4: '1111', openingFils: 0 },
  { id: 'b', name: 'Savings', kind: 'bank', bankName: 'ADCB', last4: '2222', openingFils: 0 },
];
const row = (id, type = 'expense', extra = {}) => ({ id, type, amountFils: 10000, category: 'other',
  accountId: type === 'expense' ? 'a' : 'b', title: type === 'expense' ? 'Outgoing transfer' : 'Incoming transfer',
  date: '2026-09-20', ts: NOW, source: 'sms', smsKey: `s${NOW}-${id}`,
  transferEvidence: { version: 1, currency: 'AED', attribution: 'source' }, ...extra });
const pair = (index) => [row(`out-${index}`, 'expense', { amountFils: 10000 + index * 100 }),
  row(`in-${index}`, 'income', { amountFils: 10000 + index * 100 })];
const rows = [...pair(0), ...pair(1), row('single'),
  row('purchase', 'expense', { title: 'Lunch', category: 'dining', transferEvidence: undefined }),
  row('salary', 'income', { title: 'Salary', category: 'salary', transferEvidence: undefined })];
const decisions = [{ ids: ['out-0'], ownership: 'own', counterpartId: 'in-0' },
  { ids: ['out-1'], ownership: 'own', counterpartId: 'in-1' }, { ids: ['single'], ownership: 'own' }];
const fingerprintRequest = (transactions, choices = decisions) => ({ decisions: choices, now: NOW,
  expectedFingerprints: Object.fromEntries(transactions.map(tx => [tx.id, core.transferFingerprint(tx)])) });
const snapshot = value => structuredClone(value);

test('one batch links both legs of independent transfers, preserving money and unrelated transactions', () => {
  const before = snapshot(rows);
  const next = core.applyTransferDecisionBatch(rows, accounts, fingerprintRequest(rows));
  assert.deepEqual(rows, before, 'input snapshot is immutable');
  assert.equal(next.length, rows.length);
  for (let i = 0; i < next.length; i++) {
    const { transferDecision, transferMatch, ...kept } = next[i];
    assert.deepEqual(kept, rows[i], 'amount, type, date, source and routing are unchanged');
  }
  for (let i = 0; i < 2; i++) {
    const out = next.find(tx => tx.id === `out-${i}`), into = next.find(tx => tx.id === `in-${i}`);
    assert.equal(out.transferDecision.counterpartId, into.id);
    assert.equal(into.transferDecision.counterpartId, out.id);
    assert.equal(out.transferMatch.counterpartSignature, core.transferFingerprint(into));
    assert.equal(into.transferMatch.counterpartSignature, core.transferFingerprint(out));
  }
  const result = core.reconcileTransfers(next, accounts);
  assert.deepEqual([...result.internalIds].sort(), ['in-0', 'in-1', 'out-0', 'out-1', 'single']);
  assert.equal(next.filter(tx => money.isSpending(tx, undefined, result.internalIds)).reduce((sum, tx) => sum + tx.amountFils, 0), 10000);
  assert.equal(next.filter(tx => money.isIncome(tx, undefined, result.internalIds)).reduce((sum, tx) => sum + tx.amountFils, 0), 10000);
  assert.equal(next.at(-1), rows.at(-1)); assert.equal(next.at(-2), rows.at(-2));
});

test('a stale final item rejects the entire selection before any first-pair changes', () => {
  const request = fingerprintRequest(rows);
  request.expectedFingerprints.single = 'stale';
  const before = snapshot(rows);
  assert.throws(() => core.applyTransferDecisionBatch(rows, accounts, request), /changed/);
  assert.deepEqual(rows, before);
});

test('overlapping selections, missing legs and duplicate ledger IDs reject atomically', () => {
  for (const choices of [
    [...decisions, { ids: ['in-0'], ownership: 'own' }],
    [{ ids: ['out-0'], ownership: 'own', counterpartId: 'in-0' }, { ids: ['out-1'], ownership: 'own', counterpartId: 'in-0' }],
    [{ ids: ['out-0'], ownership: 'own', counterpartId: 'out-0' }],
    [{ ids: ['missing'], ownership: 'own' }],
    [{ ids: ['salary'], ownership: 'own' }],
    [{ ids: ['out-0'], ownership: 'external', counterpartId: 'in-0' }],
  ]) {
    assert.throws(() => core.applyTransferDecisionBatch(rows, accounts, fingerprintRequest(rows, choices)));
    assert.equal(rows.some(tx => tx.transferDecision), false);
  }
  assert.throws(() => core.applyTransferDecisionBatch([...rows, { ...rows[0] }], accounts, fingerprintRequest(rows)), /changed/);
  for (const request of [null, {}, { decisions: [], now: NOW, expectedFingerprints: {} },
    { decisions: [null], now: NOW, expectedFingerprints: {} }, { decisions, now: NOW, expectedFingerprints: {} }]) {
    assert.throws(() => core.applyTransferDecisionBatch(rows, accounts, request));
  }
});

test('explicit independent selections do not relax the legacy known-counterparty group rule', () => {
  const selected = [row('left'), row('right')];
  const request = fingerprintRequest(selected, [{ ids: ['left', 'right'], ownership: 'own' }]);
  assert.throws(() => core.applyTransferDecisionBatch(selected, accounts, request), /known-counterparty group/);
  assert.throws(() => core.applyTransferDecision(selected, accounts, { ...request, ids: ['left', 'right'], ownership: 'own' }), /known-counterparty group/);
  const next = core.applyTransferDecisionBatch(selected, accounts, fingerprintRequest(selected,
    selected.map(tx => ({ ids: [tx.id], ownership: 'own' }))));
  assert.equal(next.every(tx => tx.transferDecision.ownership === 'own'), true);
});

test('an occupied partner in one selected pair aborts the batch without stealing or partially applying links', () => {
  const linked = core.applyTransferDecisionBatch([...rows, row('another')], accounts,
    fingerprintRequest([...rows, row('another')], [{ ids: ['another'], ownership: 'own', counterpartId: 'in-1' }]));
  const before = snapshot(linked);
  assert.throws(() => core.applyTransferDecisionBatch(linked, accounts, fingerprintRequest(linked)), /existing transfer decision/);
  assert.deepEqual(linked, before);
});

test('undo after batch confirmation keeps the other leg decision and detaches reciprocal links', () => {
  const linked = core.applyTransferDecisionBatch(rows, accounts, fingerprintRequest(rows));
  const next = core.applyTransferDecision(linked, accounts, { ids: ['out-0'], ownership: null,
    now: NOW + 1, expectedFingerprints: { 'out-0': core.transferFingerprint(linked[0]) } });
  const into = next.find(tx => tx.id === 'in-0');
  assert.equal(next[0].transferDecision, undefined); assert.equal(next[0].transferMatch, undefined);
  assert.equal(into.transferMatch, undefined); assert.equal(into.transferDecision.ownership, 'own');
  assert.equal(into.transferDecision.counterpartId, undefined);
  assert.equal(next.find(tx => tx.id === 'out-1'), linked.find(tx => tx.id === 'out-1'));
});

test('40 confirmations on a 10,000-entry ledger use one normalization and produce the same stored result', (t) => {
  const base = reducer({ hydrated: false, transactions: [], accounts: [] }, { type: 'hydrate', state: ledger(10000) });
  const choices = base.transactions.filter(tx => tx.id.endsWith('-out')).slice(0, 40)
    .map(tx => ({ ids: [tx.id], ownership: 'own', counterpartId: tx.id.replace(/-out$/, '-in') }));
  const request = fingerprintRequest(base.transactions, choices);
  takeCalls();
  const batchStart = performance.now();
  const batched = reducer(base, { type: 'resolveTransferBatch', request });
  const batchMs = performance.now() - batchStart, batchCalls = takeCalls();
  assert.equal(batchCalls.applyTransferDecisionBatch, 1);
  assert.equal(batchCalls.normalizeTransferLinks, 1);
  assert.equal(batchCalls.reconcileTransfers, 1, 'the final stored-array assessment is retained');
  let individual = base;
  const singleStart = performance.now();
  for (const decision of choices) individual = reducer(individual, { type: 'resolveTransfers', request: {
    ...decision, expectedFingerprints: request.expectedFingerprints, now: NOW,
  } });
  const singleMs = performance.now() - singleStart, singleCalls = takeCalls();
  assert.equal(singleCalls.normalizeTransferLinks, 40);
  assert.deepEqual(batched.transactions, individual.transactions);
  assert.deepEqual(batched.transferInternalIds, individual.transferInternalIds);
  assert.deepEqual([...core.reconciliationInternalIds(core.reconcileTransfers(batched.transactions, batched.accounts))].sort(),
    [...batched.transferInternalIds].sort());
  t.diagnostic(`Host benchmark: ${base.transactions.length} rows, ${choices.length} pairs; batch ${batchMs.toFixed(1)}ms, individual ${singleMs.toFixed(1)}ms. Device latency is not measured here.`);
});
