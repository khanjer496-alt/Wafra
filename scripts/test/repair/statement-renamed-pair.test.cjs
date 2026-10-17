'use strict';
// A TRANSFER the person renamed is still the movement a statement row describes.
// Statement <-> alert pairing on the SAME resolved account compared the
// person's own title with the bank's descriptor, so renaming an alert (or a
// statement row) before the other copy arrived duplicated it. Pairing on the
// renamed row is allowed only when it is the ONE same-direction, same-amount
// row on that account inside the posting window. Fictional figures.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const build = (name) => require(path.join(__dirname, '../build', `${name}.js`));
const { buildImportPlan } = build('import-plan');
const { materializeImportBatch, applyMaterializedImportBatch } = build('ledger-import');
build('markets').setActiveMarket('AE');
build('markets').setLedgerCurrency('AED', 2);
const NOW = new Date('2026-09-20T09:00:00Z');
const base = () => ({ hydrated: true, privateMode: false, marketId: 'AE',
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: {}, merchantOverrides: {}, billAliases: {}, lastScanTs: 0, parserVersion: 0 });
const alert = (changes = {}) => ({ kind: 'transaction', type: 'income', amountFils: 5000, currency: 'AED',
  merchant: 'Incoming transfer', date: '2026-08-28', dueDay: null, minDueFils: null,
  card: { last4: '0002', kind: 'account' }, reference: null, transferHint: true, snapshotFils: null, snapshotKind: null,
  categoryGuess: 'other', categoryDeliberate: true, bankHint: 'FAB', smsTs: Date.parse('2026-08-28T10:00:00Z'),
  channel: 'inbox', sourceEventId: 'a'.repeat(64), ...changes });
const statement = (changes = {}) => ({ kind: 'transaction', type: 'income', amountFils: 5000, currency: 'AED',
  merchant: 'Incoming transfer', date: '2026-08-28', dueDay: null, minDueFils: null,
  card: { last4: '0002', kind: 'account' }, reference: null, transferHint: true, snapshotFils: null, snapshotKind: null,
  categoryGuess: 'other', categoryDeliberate: true, bankHint: 'FAB', captureSource: 'pdf',
  smsTs: Date.parse('2026-08-28T12:00:00Z'), statementImportId: 'f'.repeat(32), statementRowIndex: 7, ...changes });
let serial = 0;
const apply = (rows, state = base()) => {
  const plan = buildImportPlan(rows, state, 0, NOW);
  return applyMaterializedImportBatch(state, materializeImportBatch(plan.batch, state, (p) => `${p}-${++serial}`));
};
// As the store does when the person types a title: userEdited and titleEdited.
const rename = (state, pick) => ({ ...state, transactions: state.transactions.map((t) => pick(t)
  ? { ...t, title: 'Rewards from the bank', category: 'shopping', userEdited: true, titleEdited: true } : t) });

test('an alert the person renamed is not duplicated by the statement row', () => {
  const after = apply([statement()], rename(apply([alert()]), () => true));
  assert.equal(after.transactions.length, 1);
  assert.equal(after.transactions[0].title, 'Rewards from the bank');
  assert.equal(after.transactions[0].category, 'shopping');
});
test('a statement row the person renamed is not duplicated by the alert', () => {
  const after = apply([alert()], rename(apply([statement()]), () => true));
  assert.equal(after.transactions.length, 1);
  assert.equal(after.transactions[0].title, 'Rewards from the bank');
});
test('two equal same-day movements stay two when one of them was renamed', () => {
  const two = apply([alert(), alert({ sourceEventId: 'b'.repeat(64), smsTs: Date.parse('2026-08-28T15:00:00Z') })]);
  assert.equal(two.transactions.length, 2);
  const after = apply([statement(), statement({ statementRowIndex: 8 })], rename(two, (t) => t.ts === Date.parse('2026-08-28T15:00:00Z')));
  assert.equal(after.transactions.length, 2);
});
test('a renamed row is not taken for a statement row of another amount or direction', () => {
  const renamed = rename(apply([alert()]), () => true);
  assert.equal(apply([statement({ amountFils: 5100 })], renamed).transactions.length, 2);
  assert.equal(apply([statement({ type: 'expense' })], renamed).transactions.length, 2);
});
test('a category-only edit is not a rename: a different merchant stays separate', () => {
  const shop = (row) => ({ ...row, type: 'expense', transferHint: false, categoryGuess: 'shopping' });
  let state = apply([shop(alert({ merchant: 'CINEMA CITY' }))]);
  state = { ...state, transactions: state.transactions.map((t) => ({ ...t, category: 'entertainment', userEdited: true })) };
  state = apply([shop(statement({ merchant: 'GROCERY MART DUBAI' }))], state);
  assert.equal(state.transactions.length, 2);
});
test('an ATM withdrawal and a shop of the same amount never pair on generic wording', () => {
  const debit = (row, merchant) => ({ ...row, type: 'expense', transferHint: false, merchant, categoryGuess: 'other' });
  let state = apply([debit(alert(), 'ATM withdrawal')]);
  state = apply([debit(statement(), 'CARREFOUR CITY CENTRE')], state);
  assert.equal(state.transactions.length, 2);
});
test('a renamed purchase is never paired with a different merchant by money and day alone', () => {
  const shop = (row, merchant) => ({ ...row, type: 'expense', transferHint: false, merchant, categoryGuess: 'dining' });
  const renamed = rename(apply([shop(alert(), 'TALABAT')]), () => true);
  assert.equal(apply([shop(statement(), 'BOOK SHOP')], renamed).transactions.length, 2);
});
test('a salary the person renamed on the statement still pairs with the bank\'s Salary alert', () => {
  const salary = (row) => ({ ...row, type: 'income', transferHint: false, amountFils: 2853750, categoryGuess: 'income' });
  const renamed = rename(apply([salary(statement({ merchant: 'Salary Transfer-REF PAY 07' }))]), () => true);
  const after = apply([salary(alert({ merchant: 'Salary' }))], renamed);
  assert.equal(after.transactions.length, 1);
  assert.equal(after.transactions[0].title, 'Rewards from the bank');
});
test('a salary confirmed from Review (reviewConfirmed) is not treated as renamed', () => {
  const salary = (row) => ({ ...row, type: 'income', transferHint: false, amountFils: 2853750, categoryGuess: 'income' });
  const confirmed = { ...rename(apply([salary(statement({ merchant: 'Salary Transfer-REF PAY 07' }))]), () => true) };
  confirmed.transactions = confirmed.transactions.map((t) => ({ ...t, reviewConfirmed: true }));
  assert.equal(apply([salary(alert({ merchant: 'Salary' }))], confirmed).transactions.length, 2);
});
test('statement rows never enter Review, so a re-read has nothing pending there to resurrect', () => {
  const wallet = { id: 'w1', type: 'expense', amountFils: 5000, category: 'shopping', accountId: 'acc', title: 'Apple Pay',
    date: '2026-08-28', source: 'sms', smsKey: 'wallet:x', walletBound: false, ts: Date.parse('2026-08-28T09:00:00Z') };
  const state = { ...base(), accounts: [{ id: 'acc', name: 'FAB Account •0002', kind: 'bank', last4: '0002', bankName: 'FAB', openingFils: 0, color: '#000' }],
    transactions: [wallet] };
  const plan = buildImportPlan([statement({ type: 'expense', transferHint: false, merchant: 'SHOP' })], state, 0, NOW);
  assert.equal((plan.walletNearMatches ?? []).length, 0);
});
