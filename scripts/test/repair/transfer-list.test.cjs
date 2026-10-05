'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { transferListItems, transferTotals, filterTransferItems } = load(path.resolve(__dirname, '../../../src/lib/transfer-list.ts'));

const tx = (id, type, accountId, amountFils, extra = {}) => ({ id, type, accountId, amountFils, date: '2026-10-01', ts: 1,
  title: 'Transfer', category: 'other', ...extra });
const rec = (transaction, ownership, confirmed = true, needsReview = false) =>
  ({ transaction, ownership, confirmed, needsReview, assessment: { id: transaction.id, status: 'confirmed-own', reason: 'user', candidateIds: [] } });

test('a linked pair is one row reading from → to, counted once', () => {
  const out = tx('o', 'expense', 'fab', 700000); const inn = tx('i', 'income', 'enbd', 700000);
  const items = transferListItems([rec(out, 'own'), rec(inn, 'own')], [{ key: 'o|i', out, in: inn, anchorId: 'o', counterpartId: 'i' }]);
  assert.equal(items.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify([items[0].from, items[0].to])), [{ kind: 'account', accountId: 'fab' }, { kind: 'account', accountId: 'enbd' }]);
  assert.equal(items[0].direction, 'between');
  assert.equal(items[0].linked, true);
  assert.equal(transferTotals(items).ownFils, 700000);
});

test('two unlinked own legs of one transfer count the amount once', () => {
  const out = tx('o', 'expense', 'fab', 250000); const inn = tx('i', 'income', 'enbd', 250000);
  const items = transferListItems([rec(out, 'own'), rec(inn, 'own')], []);
  assert.equal(items.length, 2);
  assert.equal(transferTotals(items).ownFils, 250000);
});

test('an own transfer captured only from its incoming side adds nothing to the tile', () => {
  const inn = tx('i', 'income', 'enbd', 250000);
  const items = transferListItems([rec(inn, 'own')], []);
  assert.equal(items.length, 1);
  assert.equal(items[0].direction, 'in');
  assert.equal(transferTotals(items).ownFils, 0);
});

test('single rows: names the person, else a dashed unknown; tags follow the answer', () => {
  const paid = tx('p', 'expense', 'adcb', 85000, { transferEvidence: { counterpartyName: 'Ahmed K.' } });
  const got = tx('r', 'income', 'adcb', 12000);
  const open = tx('q', 'expense', 'fab', 500000);
  const items = transferListItems([rec(paid, 'external'), rec(got, 'external'), rec(open, 'unknown', false, true)], []);
  const byId = Object.fromEntries(items.map(i => [i.transactionId, i]));
  assert.deepEqual(JSON.parse(JSON.stringify(byId.p.to)), { kind: 'party', name: 'Ahmed K.' });
  assert.deepEqual(JSON.parse(JSON.stringify(byId.r.from)), { kind: 'unknown' });
  assert.deepEqual(JSON.parse(JSON.stringify(byId.r.to)), { kind: 'account', accountId: 'adcb' });
  assert.equal(byId.p.tag, 'external');
  assert.equal(byId.q.tag, 'needs-answer');
  assert.deepEqual(JSON.parse(JSON.stringify(transferTotals(items))), { ownFils: 0, sentFils: 85000, receivedFils: 12000 });
});

test('tile filters and newest-first order', () => {
  const a = tx('a', 'expense', 'x', 1, { date: '2026-10-01' });
  const b = tx('b', 'expense', 'x', 1, { date: '2026-10-03' });
  const items = transferListItems([rec(a, 'own'), rec(b, 'external')], []);
  assert.deepEqual(JSON.parse(JSON.stringify(items.map(i => i.transactionId))), ['b', 'a']);
  assert.deepEqual(JSON.parse(JSON.stringify(filterTransferItems(items, 'own').map(i => i.transactionId))), ['a']);
  assert.deepEqual(JSON.parse(JSON.stringify(filterTransferItems(items, 'sent').map(i => i.transactionId))), ['b']);
  assert.equal(filterTransferItems(items, null).length, 2);
});
