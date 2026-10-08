'use strict';
/**
 * The transfer graph is built at launch (Home's transfer queue), on every
 * transfer answer and on every canonical capture. On the owner's phone
 * (14,905 rows, 3,131 transfer candidates) one build was several hundred ms of
 * Hermes time, a third of it re-validating the same evidence and decision
 * objects about six times per row, and thousands of bank-name lookups that
 * each tested every bank pattern.
 *
 * These pins keep the speed-ups honest without letting them change answers:
 * - the graph over a transfer-heavy ledger is byte-identical to the one the
 *   pre-change build produced (digests below were taken from that build);
 * - a validation verdict is memoised only inside one pass, and never leaks
 *   into the next pass or to callers outside a pass;
 * - bank identities and the shared row index return exactly what the
 *   uncached code returned.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { transferHeavyLedger, NOW } = require('../fixtures/transfer-heavy-ledger.cjs');
const load = require('./load-typescript.cjs');

const BUILD = process.env.WAFRA_HOT_PATH_BUILD ?? path.resolve(__dirname, '../build');
const lib = (name) => require(path.join(BUILD, name));
const markets = lib('markets');
const tr = lib('transfer-reconciliation');
markets.setActiveMarket('AE');

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

test('a transfer-heavy 15k ledger reconciles exactly as before the pass memo', () => {
  const ledger = transferHeavyLedger();
  const normalized = tr.normalizeTransferLinks(ledger.transactions, ledger.accounts);
  const result = tr.reconcileTransfers(normalized, ledger.accounts);
  const statuses = {};
  for (const assessment of result.byId.values()) statuses[assessment.status] = (statuses[assessment.status] ?? 0) + 1;
  assert.deepEqual(statuses, { 'ownership-unknown': 2996, 'confirmed-own': 212, 'likely-own': 4 });
  assert.equal(tr.reconciliationInternalIds(result).size, 212);
  assert.equal(result.pendingIds.size, 4);
  // Digests of the pre-change build's output for this exact fixture.
  assert.equal(digest(normalized), 'fb486625099ba5e8');
  assert.equal(digest([...result.byId].sort(([a], [b]) => (a < b ? -1 : 1))), '1d493aef516c3be1');
  assert.equal(digest(result.groups), 'f6e2029f7f0c7930');
});

test('answers applied through the reducer path match a fresh rebuild of the graph', () => {
  const ledger = transferHeavyLedger(4000, 800);
  const rows = tr.normalizeTransferLinks(ledger.transactions, ledger.accounts);
  const candidates = rows.filter(tr.isTransferCandidate).slice(0, 12);
  for (const [i, row] of candidates.entries()) {
    const ownership = ['own', 'external', 'none'][i % 3];
    const next = tr.applyTransferDecision(rows, ledger.accounts, {
      ids: [row.id], ownership, expectedFingerprints: { [row.id]: tr.transferFingerprint(row) }, now: NOW + i,
    });
    const linked = tr.normalizeTransferLinks(next, ledger.accounts);
    // A structurally identical copy has new object identities, so nothing
    // memoised for `linked` can answer for it.
    const copy = JSON.parse(JSON.stringify(linked));
    const a = tr.reconcileTransfers(linked, ledger.accounts);
    const b = tr.reconcileTransfers(copy, ledger.accounts);
    assert.equal(JSON.stringify([...a.byId]), JSON.stringify([...b.byId]), `answer ${i}`);
    assert.deepEqual([...a.internalIds].sort(), [...b.internalIds].sort());
    assert.equal(linked.find((tx) => tx.id === row.id).transferDecision?.ownership, ownership);
  }
});

test('one pass validates each evidence object once; the next pass validates it again', () => {
  const ledger = transferHeavyLedger(2000, 400);
  const rows = [...ledger.transactions];
  const index = rows.findIndex((tx) => tx.transferEvidence && !tx.transferEvidence.counterparty);
  let reads = 0;
  const evidence = { ...rows[index].transferEvidence };
  const counted = Object.defineProperty({ ...evidence }, 'version', {
    enumerable: true, get() { reads += 1; return evidence.version; },
  });
  rows[index] = { ...rows[index], transferEvidence: counted };
  tr.reconcileTransfers(rows, ledger.accounts);
  const first = reads;
  assert.ok(first >= 1 && first <= 2, `evidence validated ${first} times in one pass (want at most 2)`);
  reads = 0;
  tr.reconcileTransfers([...rows], ledger.accounts);
  assert.ok(reads >= 1, 'a new pass re-validates rather than trusting an earlier verdict');
});

test('a verdict never outlives its pass: a corrected row is re-read by the next pass and by callers', () => {
  const accounts = [
    { id: 'a', name: 'Current', kind: 'bank', bankName: 'ENBD', last4: '1111', openingFils: 0, color: '#000' },
    { id: 'b', name: 'Savings', kind: 'bank', bankName: 'FAB', last4: '2222', openingFils: 0, color: '#000' },
  ];
  const row = { id: 'x', type: 'expense', amountFils: 5000, category: 'other', title: 'Sample shop', accountId: 'a',
    date: '2026-09-01', ts: NOW, source: 'sms', smsKey: `s${NOW}-x`,
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'ENBD' } };
  assert.equal(tr.isTransferCandidate(row), true);
  assert.ok(tr.reconcileTransfers([row], accounts).byId.has('x'));
  // Outside a pass nothing is cached: the exported predicate sees the change at once.
  row.transferEvidence.currency = 'not a currency';
  assert.equal(tr.isTransferCandidate(row), false);
  assert.equal(tr.reconcileTransfers([row], accounts).byId.has('x'), false);
  row.transferEvidence.currency = 'AED';
  assert.equal(tr.isTransferCandidate(row), true);
  assert.ok(tr.reconcileTransfers([row], accounts).byId.has('x'));
});

test('a pass that throws leaves no memo behind', () => {
  const accounts = [{ id: 'a', name: 'Current', kind: 'bank', bankName: 'ENBD', last4: '1111', openingFils: 0, color: '#000' }];
  const row = { id: 'x', type: 'expense', amountFils: 5000, category: 'other', title: 'Outgoing transfer', accountId: 'a',
    date: '2026-09-01', ts: NOW, source: 'sms', smsKey: `s${NOW}-x` };
  assert.throws(() => tr.applyTransferDecision([row], accounts, {
    ids: [row.id], ownership: 'own', expectedFingerprints: { x: 'stale' }, now: NOW,
  }), /open it again/);
  row.title = 'Sample shop';
  assert.equal(tr.isTransferCandidate(row), false, 'the failed pass cached nothing for later callers');
});

test('bank identities are unchanged by the memo, including past its bound', () => {
  const names = ['Emirates NBD', 'ENBD', 'Liv', 'FAB', 'First Abu Dhabi Bank', 'ADCB', 'Mashreq', 'Al Rajhi', 'مصرف الراجحي',
    'Some Bank', '  spaced   bank  ', 'Ｆｕｌｌ Width', undefined, ''];
  const first = names.map((name) => markets.bankIdentityForName(name));
  const again = names.map((name) => markets.bankIdentityForName(name));
  assert.deepEqual(again, first);
  // Overflow the bounded table, then ask again: the answers stay the same.
  for (let i = 0; i < 1200; i += 1) markets.bankIdentityForName(`Synthetic bank ${i}`);
  assert.deepEqual(names.map((name) => markets.bankIdentityForName(name)), first);
  assert.equal(markets.bankIdentityForName('Synthetic bank 7'), 'synthetic bank 7');
  assert.equal(markets.bankIdentityForName('ENBD'), markets.bankIdentityForName('Emirates NBD'));
});

test('the shared row index matches new Map(rows) and is built once per ledger snapshot', () => {
  const { rowsByIdFor } = load(path.resolve(__dirname, '../../../src/lib/rows-by-id.ts'));
  const rows = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'a', n: 3 }];
  const index = rowsByIdFor(rows);
  assert.deepEqual([...index], [...new Map(rows.map((row) => [row.id, row]))]);
  assert.equal(index.get('a').n, 3, 'a repeated id keeps its last row, as new Map did');
  assert.equal(rowsByIdFor(rows), index, 'one index per snapshot');
  const next = [...rows, { id: 'c', n: 4 }];
  assert.notEqual(rowsByIdFor(next), index, 'a new snapshot gets its own index');
  assert.equal(rowsByIdFor(next).get('c').n, 4);
});

test('the entry sheet and Transfers read the shared index instead of building their own', () => {
  const fs = require('node:fs');
  const read = (file) => fs.readFileSync(path.resolve(__dirname, '../../..', file), 'utf8');
  for (const file of ['src/components/entry-detail-sheet.tsx', 'src/app/transfers.tsx']) {
    const source = read(file);
    assert.match(source, /rowsByIdFor\(state\.transactions\)/, file);
    assert.doesNotMatch(source, /new Map\(state\.transactions\.map/, file);
  }
});
