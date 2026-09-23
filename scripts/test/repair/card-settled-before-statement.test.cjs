'use strict';
// ── A card reported "settled" on a statement nobody had paid ──
//
// Reported against an Emirates NBD card:
//
//   "Emirates NBD Credit Card Mini Stmt for Card ending 8575: Statement date
//    28/08/26. Total Amt Due AED 2469.92, Due Date 22/09/26. Min Amt Due AED
//    513.62"
//
// The app showed that statement settled while AED 2,469.92 was still owed. The
// payment it credited was the one made for the AUGUST bill, days before the
// September statement was issued: allocation opened a statement's window 40
// days before its DEADLINE while approximating the same statement's ISSUE at 25
// days before it, so 15 days belonged to two cycles at once. Emirates NBD's gap
// is exactly 25 days, which puts the whole of that overlap inside the previous
// cycle.
//
// Oldest-first allocation hid it whenever the August statement could absorb the
// payment itself. It could not when the user had marked August paid by hand,
// when August never reached the app, or when August's recorded total was lower
// than the payment — and each of those is checked below.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const dependencies = Object.fromEntries([
  'capture-source-identity', 'cards', 'markets', 'dedupe', 'bill-alias', 'format', 'heal',
  'transfer-evidence', 'transfer-reconciliation', 'ledger', 'ledger-money', 'sms-parser', 'balances', 'i18n',
].map(name => [`@/lib/${name}`, require(`../build/${name}`)]));
const { buildImportPlan } = load(path.join(root, 'src/lib/import-plan.ts'), dependencies);
const cards = dependencies['@/lib/cards'];
const { parseSms } = dependencies['@/lib/sms-parser'];

const STATEMENT =
  'Emirates NBD Credit Card Mini Stmt for Card ending 8575: Statement date 28/08/26. ' +
  'Total Amt Due AED 2469.92, Due Date 22/09/26. Min Amt Due AED 513.62';
const accounts = [
  { id: 'enbd-card', name: 'Emirates NBD Credit Card', kind: 'card', cardType: 'credit',
    last4: '8575', bankName: 'Emirates NBD', openingFils: 0, color: '#fff' },
];
const blank = cardDues => ({
  hydrated: true, accounts, transactions: [], budgets: [], bills: [], goals: [], cardDues,
  accountHints: {}, merchantOverrides: {}, billAliases: {}, lastScanTs: 0, parserVersion: 47,
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
});

/** The September statement as the import pipeline really produces it. */
function septemberDue() {
  const smsTs = Date.UTC(2026, 7, 28, 12);
  const parsed = parseSms(STATEMENT, {}, { sender: 'EmiratesNBD' });
  const plan = buildImportPlan(
    [{ ...parsed, smsTs, sender: 'EmiratesNBD', channel: 'inbox', sourceEventId: 'e1' }],
    blank([]), smsTs, new Date(smsTs),
  );
  assert.equal(plan.batch.newDues.length, 1, 'the statement must reach the due merge');
  return { id: 'sep', paidFils: 0, ...plan.batch.newDues[0] };
}

/** A card payment the user really made, as the card's own receipt alert. */
const payment = (id, date, amountFils) => ({
  id, accountId: 'enbd-card', date, amountFils, type: 'income', category: 'other',
  title: 'Card •8575 payment', source: 'sms', isTransfer: true, cardPaymentSide: 'receipt',
});

const today = new Date('2026-09-20T12:00:00');
const statusOf = (transactions, cardDues) => {
  const state = { ...blank(cardDues), transactions };
  const sep = cardDues.find(d => d.id === 'sep');
  return cardsStatus(state, sep);
};
const cardsStatus = (state, due) => {
  const status = cards.dueWithStatus(state, due, today);
  return { status: status.status, remainingFils: status.remainingFils,
    paidFils: cards.duePaidFils(state, due), payments: cards.duePayments(state, due).map(t => t.id) };
};

test('the statement carries the date the bank closed it, not only its deadline', () => {
  const sep = septemberDue();
  assert.equal(sep.dueDate, '2026-09-22');
  assert.equal(sep.statementDate, '2026-08-28');
  assert.equal(sep.totalDueFils, 246992);
  assert.equal(sep.minDueFils, 51362);
});

test('the August bill’s payment does not settle the September statement', () => {
  const sep = septemberDue();
  const august = { id: 'aug', accountId: 'enbd-card', totalDueFils: 406196, minDueFils: 20310,
    dueDate: '2026-08-22', statementDate: '2026-07-28', paidFils: 0 };
  const paid = [payment('p', '2026-08-20', 406196)];

  // 1. The August statement is there and unpaid: it takes its own payment.
  const both = statusOf(paid, [august, sep]);
  assert.equal(both.status, 'urgent');
  assert.equal(both.remainingFils, 246992);
  assert.deepEqual(both.payments, []);

  // 2. The user marked August paid by hand, so it can absorb nothing more. The
  //    payment used to fall through to September and settle it.
  const marked = statusOf(paid, [
    { ...august, paidFils: 406196, settledAt: '2026-08-20T10:00:00.000Z' }, sep,
  ]);
  assert.equal(marked.status, 'urgent');
  assert.equal(marked.remainingFils, 246992);

  // 3. August never reached the app — a first import, or a card added late.
  const alone = statusOf(paid, [sep]);
  assert.equal(alone.status, 'urgent');
  assert.equal(alone.remainingFils, 246992);

  // 4. August's recorded total is lower than the payment, so the surplus used
  //    to spill forward. A later statement's total is already stated net of
  //    any surplus, so there is nothing left to carry.
  const understated = statusOf(paid, [{ ...august, totalDueFils: 20310 }, sep]);
  assert.equal(understated.status, 'urgent');
  assert.equal(understated.remainingFils, 246992);
});

test('a payment made after the statement closed still settles it', () => {
  const sep = septemberDue();
  const settled = statusOf([payment('p', '2026-09-05', 246992)], [sep]);
  assert.equal(settled.status, 'settled');
  assert.equal(settled.remainingFils, 0);
  assert.deepEqual(settled.payments, ['p']);

  // The closing day itself belongs to the cycle that CLOSED: this statement's
  // total is the balance as of that day, so a payment made on it is already
  // inside the figure and crediting it again would count it twice.
  const onTheDay = statusOf([payment('p', '2026-08-28', 246992)], [sep]);
  assert.equal(onTheDay.status, 'urgent');
  const dayAfter = statusOf([payment('p', '2026-08-29', 246992)], [sep]);
  assert.equal(dayAfter.status, 'settled');

  // The day before it does not.
  const dayBefore = statusOf([payment('p', '2026-08-27', 246992)], [sep]);
  assert.equal(dayBefore.status, 'urgent');
  assert.equal(dayBefore.remainingFils, 246992);

  // And a part payment is still a part payment.
  const partial = statusOf([payment('p', '2026-09-10', 100000)], [sep]);
  assert.equal(partial.status, 'urgent');
  assert.equal(partial.remainingFils, 146992);
});

test('a statement stating no statement date falls back to the cycle approximation', () => {
  const sep = septemberDue();
  const { statementDate, ...legacy } = sep;
  assert.equal(statementDate, '2026-08-28');
  // dueDate - 25 days is 2026-08-28 for this card, so a legacy row imported
  // before the parser read the statement date is repaired by the fallback
  // alone — no re-import and no backfill needed.
  assert.equal(statusOf([payment('p', '2026-08-20', 406196)], [legacy]).status, 'urgent');
  assert.equal(statusOf([payment('p', '2026-08-29', 246992)], [legacy]).status, 'settled');
});

test('a cycle SHORTER than the approximation is learned, not floored at it', () => {
  // Found by review, not by a card. The gap inference floored itself at
  // ASSUMED_STATEMENT_DAYS and only widened, so a card that closes sooner than
  // the guess never taught it anything — and a window that opens too early is
  // the false settlement this whole file exists to stop.
  //
  // This card closes 16 days before its deadline and says so on one statement.
  // The next one omits the date, so its window is inferred: at deadline-16 it
  // opens 2026-01-20, and at the old deadline-25 it opened 2026-01-11 — nine
  // days back inside the December cycle.
  const dec = { id: 'dec', accountId: 'enbd-card', statementDate: '2025-12-20',
    dueDate: '2026-01-05', totalDueFils: 100000, minDueFils: 10000, paidFils: 0 };
  const jan = { id: 'sep', accountId: 'enbd-card', statementDate: null,
    dueDate: '2026-02-05', totalDueFils: 200000, minDueFils: 20000, paidFils: 0 };
  // December is marked paid by hand so it cannot absorb the payment itself —
  // the situation that hid the original bug. Asserted on what is still OWED
  // rather than the status word, because this harness's "today" is September and
  // a February deadline reads overdue either way.
  const decPaid = [{ ...dec, paidFils: 100000 }, jan];
  const januaryOwes = date => {
    const state = { ...blank(decPaid), transactions: [payment('p', date, 200000)] };
    return cardsStatus(state, jan).remainingFils;
  };
  assert.equal(januaryOwes('2026-01-12'), 200000, 'Jan 12 is December business');
  assert.equal(januaryOwes('2026-01-19'), 200000, 'still inside the December cycle');
  // Its own cycle starts the day after it closed.
  assert.equal(januaryOwes('2026-01-21'), 0);
});
