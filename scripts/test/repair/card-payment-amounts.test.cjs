'use strict';
// "Record a payment": Full / Minimum (only when the bank stated one) / Other,
// filed through the store's own payCardDue path and read back through the
// real allocator in cards.ts. Synthetic statements only.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { loadStore } = require('../../perf/load-store.cjs');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const { reducer, build } = loadStore();
const cards = build('cards');
const places = load(path.join(root, 'src/lib/money-places.ts'), { '@/lib/format': build('format'), '@/lib/ledger': build('ledger') });

const AED = { schemaVersion: 2, currency: 'AED', exponent: 2 };
const card = { id: 'visa', name: 'Visa', kind: 'card', cardType: 'credit', last4: '4821', openingFils: 0, color: '#000' };
const statement = (over = {}) => ({ id: 'sep', accountId: 'visa', totalDueFils: 124_000, minDueFils: 6_200,
  dueDate: '2026-10-13', paidFils: 0, ...over });
const state = (dues, transactions = []) => reducer({ hydrated: false, transactions: [], accounts: [] }, {
  type: 'hydrate',
  state: { onboarded: true, language: 'en', marketId: 'AE', ledgerMoney: AED, accounts: [card], transactions,
    bills: [], goals: [], budgets: [], cardDues: dues },
});
const TODAY = new Date(2026, 8, 25, 12);
const status = (s, id = 'sep') => cards.dueWithStatus(s, s.cardDues.find((d) => d.id === id), TODAY);
const options = (s, id = 'sep') => {
  const st = status(s, id);
  return places.cardPaymentOptions({ due: st.due, remainingFils: st.remainingFils });
};
/** What the sheet's filePayment dispatches for a resolved choice. */
const record = (s, resolution, id = 'sep') => reducer(s, {
  type: 'payCardDue', id, amountFils: resolution.amountFils,
  transaction: { id: `pay-${resolution.amountFils}-${s.transactions.length}`, type: 'income', amountFils: resolution.amountFils,
    category: 'other', accountId: 'visa', title: 'Visa payment', date: '2026-09-25', source: 'manual', isTransfer: true },
  settledAt: resolution.settles ? '2026-09-25T08:00:00.000Z' : null,
});

test('a stated minimum is offered beside the full statement', () => {
  const s = state([statement()]);
  assert.deepEqual({ ...options(s) }, { fullFils: 124_000, minimumFils: 6_200 });
});

test('an estimated minimum is never offered, whatever figure is stored', () => {
  const s = state([statement({ minDueEstimated: true })]);
  assert.equal(options(s).minimumFils, null);
  assert.deepEqual({ ...places.resolveCardPayment('minimum', null, options(s)) }, { ok: false, reason: 'no-minimum' });
  assert.equal(status(s).minimumKnown, false);
});

test('full records exactly what is left and settles the statement', () => {
  const s = state([statement()]);
  const full = places.resolveCardPayment('full', null, options(s));
  assert.deepEqual({ ...full }, { ok: true, amountFils: 124_000, settles: true });
  const after = record(s, full);
  const st = status(after);
  assert.equal(st.status, 'settled');
  assert.equal(st.remainingFils, 0);
  assert.equal(after.cardDues[0].paidFils, 0, 'the recorded transfer is the single source of truth');
  assert.equal(typeof after.cardDues[0].settledAt, 'string');
  assert.equal(cards.openDues(after, TODAY).length, 0);
});

test('a minimum payment keeps the statement open, clears the below-minimum warning and stamps no settlement', () => {
  const s = state([statement()]);
  const minimum = places.resolveCardPayment('minimum', null, options(s));
  assert.deepEqual({ ...minimum }, { ok: true, amountFils: 6_200, settles: false });
  const after = record(s, minimum);
  const st = status(after);
  assert.notEqual(st.status, 'settled');
  assert.equal(st.remainingFils, 124_000 - 6_200);
  assert.equal(st.belowMinimum, false);
  assert.equal(after.cardDues[0].settledAt, undefined);
  assert.equal(cards.openDues(after, TODAY).length, 1);
  // With the minimum met there is no minimum left to offer.
  assert.equal(options(after).minimumFils, null);
});

test('part of the minimum paid offers only what is left of it', () => {
  const s = record(state([statement()]), { amountFils: 2_000, settles: false });
  assert.deepEqual({ ...options(s) }, { fullFils: 122_000, minimumFils: 4_200 });
  assert.equal(status(s).belowMinimum, true);
});

test('another amount below what is left is a partial payment; equal to it settles', () => {
  const s = state([statement()]);
  const partial = places.resolveCardPayment('other', 50_000, options(s));
  assert.deepEqual({ ...partial }, { ok: true, amountFils: 50_000, settles: false });
  const afterPartial = record(s, partial);
  assert.equal(status(afterPartial).remainingFils, 74_000);
  assert.notEqual(status(afterPartial).status, 'settled');
  const exact = places.resolveCardPayment('other', 74_000, options(afterPartial));
  assert.deepEqual({ ...exact }, { ok: true, amountFils: 74_000, settles: true });
  assert.equal(status(record(afterPartial, exact)).status, 'settled');
});

test('another amount above what is left is refused, not capped or spilled onto the next statement', () => {
  const s = state([statement()]);
  assert.deepEqual({ ...places.resolveCardPayment('other', 124_001, options(s)) }, { ok: false, reason: 'over-remaining' });
  for (const bad of [null, 0, -100, 12.5]) {
    assert.deepEqual({ ...places.resolveCardPayment('other', bad, options(s)) }, { ok: false, reason: 'invalid' });
  }
});

test('a settled statement offers nothing to record', () => {
  const s = record(state([statement()]), { amountFils: 124_000, settles: true });
  assert.deepEqual({ ...places.resolveCardPayment('full', null, options(s)) }, { ok: false, reason: 'nothing-owed' });
  assert.deepEqual({ ...places.resolveCardPayment('other', 100, options(s)) }, { ok: false, reason: 'nothing-owed' });
});

test('a minimum equal to the whole balance is one choice, not two', () => {
  const s = state([statement({ totalDueFils: 5_000, minDueFils: 5_000 })]);
  assert.equal(options(s).minimumFils, null);
});

test('with an older statement still on file, a partial payment is counted once', () => {
  // August was paid in full; September is the one being paid now.
  const aug = statement({ id: 'aug', dueDate: '2026-09-13', totalDueFils: 90_000, minDueFils: 4_500 });
  const paidAug = { id: 'bank-aug', type: 'income', amountFils: 90_000, category: 'other', accountId: 'visa',
    title: 'Visa payment', date: '2026-09-10', source: 'manual', isTransfer: true };
  const s = state([aug, statement()], [paidAug]);
  assert.equal(status(s, 'aug').status, 'settled');
  const after = record(s, places.resolveCardPayment('other', 30_000, options(s)));
  assert.equal(status(after, 'aug').remainingFils, 0);
  assert.equal(status(after, 'sep').remainingFils, 94_000);
  assert.equal(cards.openDues(after, TODAY).length, 1);
});
