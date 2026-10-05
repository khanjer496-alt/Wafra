'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { transferListItems, transferTotals, filterTransferItems, absorbedOwnIncoming } = load(path.resolve(__dirname, '../../../src/lib/transfer-list.ts'));

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

test('an own transfer captured only from its incoming side still moved that money', () => {
  // e.g. cash logged by hand after an ATM withdrawal whose bank debit was never captured.
  const inn = tx('i', 'income', 'cash', 50000);
  const items = transferListItems([rec(inn, 'own')], []);
  assert.equal(items.length, 1);
  assert.equal(items[0].direction, 'in');
  assert.equal(transferTotals(items).ownFils, 50000);
  assert.equal(filterTransferItems(items, 'own').length, 1, 'the tile lists exactly what it counts');
});

test('unlinked own legs pair only on the same amount, a different account and nearby dates', () => {
  const out = tx('o', 'expense', 'fab', 250000);
  const otherAmount = tx('i', 'income', 'enbd', 90000);
  assert.equal(transferTotals(transferListItems([rec(out, 'own'), rec(otherAmount, 'own')], [])).ownFils, 340000,
    'different amounts are two movements');
  const later = tx('l', 'income', 'enbd', 250000, { date: '2026-10-20' });
  assert.equal(transferTotals(transferListItems([rec(out, 'own'), rec(later, 'own')], [])).ownFils, 500000,
    'weeks apart, the same amount is two movements');
  const sameAccount = tx('s', 'income', 'fab', 250000);
  assert.equal(transferTotals(transferListItems([rec(out, 'own'), rec(sameAccount, 'own')], [])).ownFils, 500000,
    'money back into the account it left is not the other side of that transfer');
});

test('one outgoing leg absorbs only one incoming leg of the same amount', () => {
  const out = tx('o', 'expense', 'fab', 250000);
  const in1 = tx('i1', 'income', 'enbd', 250000);
  const in2 = tx('i2', 'income', 'cash', 250000);
  const items = transferListItems([rec(out, 'own'), rec(in1, 'own'), rec(in2, 'own')], []);
  assert.equal(transferTotals(items).ownFils, 500000);
});

test('legs straddling a period boundary are paired over the whole history, so each period counts the movement once', () => {
  // Calendar months: left FAB on 30 Sep, arrived at ENBD on 1 Oct.
  const out = tx('o', 'expense', 'fab', 250000, { date: '2026-09-30' });
  const inn = tx('i', 'income', 'enbd', 250000, { date: '2026-10-01' });
  const all = transferListItems([rec(out, 'own'), rec(inn, 'own')], []);
  const absorbed = absorbedOwnIncoming(all);
  const period = (from, to) => all.filter(item => item.date >= from && item.date <= to);
  assert.equal(transferTotals(period('2026-09-01', '2026-09-30'), absorbed).ownFils, 250000, 'September counts it, where it left');
  assert.equal(transferTotals(period('2026-10-01', '2026-10-31'), absorbed).ownFils, 0, 'October does not count it again');
  // A salary period starting on the 25th: both legs fall in 25 Sep - 24 Oct, counted once.
  assert.equal(transferTotals(period('2026-09-25', '2026-10-24'), absorbed).ownFils, 250000);
  // Without the whole-history pairing, October alone would have counted the arrival again.
  assert.equal(transferTotals(period('2026-10-01', '2026-10-31')).ownFils, 250000);
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
