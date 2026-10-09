'use strict';
// A credit card on Accounts shows one figure — the latest the bank reported —
// and its statement on a line of its own, so a settled statement can never
// read as "AED 0.00 owed" beside "AED 15,000 used". Debit cards have no
// figure and name an account only when there is no choice. Fixed dates only.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const format = require('../build/format');
const ledger = require('../build/ledger');
const places = load(path.join(root, 'src/lib/money-places.ts'), { '@/lib/format': format, '@/lib/ledger': ledger });
const { moneyPlacesCopy } = load(path.join(root, 'src/lib/money-places-copy.ts'));

const TODAY = '2026-10-08';
const credit = { cardType: 'credit' };
const plain = (value) => JSON.parse(JSON.stringify(value));

test('a settled statement beside a bank-quoted headroom: the figure is what is used, the line says paid', () => {
  // Limit AED 38,400 entered by the user, AED 23,400 available per the bank.
  const card = { ...credit, creditLimitFils: 3_840_000, snapshotKind: 'limit', snapshotFils: 2_340_000 };
  const standing = places.creditCardStanding(card, undefined, { dueDate: '2026-10-11', totalDueFils: 734_512 }, TODAY);
  assert.deepEqual(plain(standing), {
    figureFils: 1_500_000, figureKind: 'used', availableFils: null, statement: { kind: 'paid' },
  });
});

test('an open statement stays on its own line while the bank figure leads', () => {
  const card = { ...credit, creditLimitFils: 4_390_000, snapshotKind: 'limit', snapshotFils: 2_890_000 };
  const open = { remainingFils: 312_090, due: { dueDate: '2026-10-17' }, daysLeft: 9 };
  const standing = places.creditCardStanding(card, open, { dueDate: '2026-10-17', totalDueFils: 412_090 }, TODAY);
  assert.equal(standing.figureFils, 1_500_000);
  assert.equal(standing.figureKind, 'used');
  assert.deepEqual(plain(standing.statement), { kind: 'left', fils: 312_090, dueISO: '2026-10-17', overdue: false });
});

test('a quoted outstanding balance is "owed" and wins over the limit arithmetic', () => {
  const card = { ...credit, creditLimitFils: 1_000_000, snapshotKind: 'outstanding', snapshotFils: -280_000 };
  const standing = places.creditCardStanding(card, undefined, undefined, TODAY);
  assert.deepEqual(plain(standing), { figureFils: 280_000, figureKind: 'owed', availableFils: null, statement: null });
});

test('with no bank figure an open statement is the figure, and a late one says so', () => {
  const card = { ...credit };
  const late = { remainingFils: 1_070_627, due: { dueDate: '2026-10-06' }, daysLeft: -2 };
  const standing = places.creditCardStanding(card, late, { dueDate: '2026-10-06', totalDueFils: 1_520_775 }, TODAY);
  assert.equal(standing.figureKind, 'statement');
  assert.equal(standing.figureFils, 1_070_627);
  assert.equal(standing.statement.overdue, true);
});

test('headroom without a limit is not turned into a debt; nothing at all is unknown, never zero', () => {
  const headroom = places.creditCardStanding({ ...credit, snapshotKind: 'limit', snapshotFils: 1_800_000 }, undefined, undefined, TODAY);
  assert.deepEqual(plain(headroom), { figureFils: null, figureKind: 'unknown', availableFils: 1_800_000, statement: null });
  const nothing = places.creditCardStanding({ ...credit }, undefined, undefined, TODAY);
  assert.equal(nothing.figureFils, null);
  assert.equal(nothing.figureKind, 'unknown');
});

test('an empty or long-settled statement says nothing; a zero-left open due is not "left"', () => {
  const card = { ...credit, snapshotKind: 'outstanding', snapshotFils: 50_000 };
  assert.equal(places.creditCardStanding(card, undefined, { dueDate: '2026-10-20', totalDueFils: 0 }, TODAY).statement, null);
  assert.equal(places.creditCardStanding(card, undefined, { dueDate: '2026-07-01', totalDueFils: 90_000 }, TODAY).statement, null);
  assert.deepEqual(plain(places.creditCardStanding(card, undefined, { dueDate: '2026-08-25', totalDueFils: 90_000 }, TODAY).statement), { kind: 'paid' });
  const settled = { remainingFils: 0, due: { dueDate: '2026-10-12' }, daysLeft: 4 };
  assert.deepEqual(plain(places.creditCardStanding(card, settled, { dueDate: '2026-10-12', totalDueFils: 90_000 }, TODAY).statement), { kind: 'paid' });
});

test('a debit card names its account only when the bank has exactly one', () => {
  const accounts = [
    { id: 'fab-cur', kind: 'bank', bankName: 'FAB' }, { id: 'fab-sav', kind: 'bank', bankName: 'FAB' },
    { id: 'liv', kind: 'bank', bankName: 'Liv' }, { id: 'liv-old', kind: 'bank', bankName: 'Liv', archived: true },
    { id: 'liv-cc', kind: 'card', cardType: 'credit', bankName: 'Liv' },
  ];
  assert.equal(places.linkedBankAccount({ bankName: 'FAB' }, accounts), null);
  assert.equal(places.linkedBankAccount({ bankName: 'liv ' }, accounts).id, 'liv');
  assert.equal(places.linkedBankAccount({}, accounts), null);
  assert.equal(places.isNonCreditCard({ kind: 'card', cardType: 'debit' }), true);
  assert.equal(places.isNonCreditCard({ kind: 'card' }), true);
  assert.equal(places.isNonCreditCard({ kind: 'card', cardType: 'credit' }), false);
  assert.equal(places.isPaymentCard({ kind: 'bank', cardType: 'debit' }), true);
  assert.equal(places.isPaymentCard({ kind: 'bank' }), false);
});

test('the new card words exist in both languages, with Arabic in Arabic script', () => {
  for (const key of ['usedCaption', 'statementPaid', 'debitCard']) {
    assert.ok(moneyPlacesCopy.en[key] && moneyPlacesCopy.ar[key], key);
    assert.match(moneyPlacesCopy.ar[key], /[؀-ۿ]/, key);
  }
  assert.equal(moneyPlacesCopy.en.cardsByKind(17, 5), '17 credit cards · 5 debit cards');
  assert.equal(moneyPlacesCopy.en.statementLeft('AED 3,120.90', '17 Oct'), 'Statement left AED 3,120.90 · due 17 Oct');
  assert.equal(moneyPlacesCopy.en.inactiveSplit(2, 3), 'Inactive · 2 accounts, 3 cards');
  assert.match(moneyPlacesCopy.ar.cardsByKind(17, 5), /[؀-ۿ]/);
});
