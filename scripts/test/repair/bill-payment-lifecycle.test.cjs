'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { loadStore } = require('../../perf/load-store.cjs');
const load = require('./load-typescript.cjs');
const { reducer, store, build } = loadStore();
const { isValidBackupState: validate } = load(path.resolve(__dirname, '../../../src/lib/backup-validation.ts'), {
  '@/lib/transfer-reconciliation': build('transfer-reconciliation'),
  '@/lib/ledger-money': build('ledger-money'),
  '@/lib/ledger': build('ledger'),
});
const now = new Date(2026, 8, 20, 12);
const payment = { id: 'payment', type: 'expense', amountFils: 30000, category: 'utilities',
  accountId: 'bank', title: 'DEWA', date: '2026-09-20', source: 'manual' };
const bill = { id: 'bill', title: 'DEWA', category: 'utilities', amountFils: 30000, dueDay: 25, paidMonths: [] };
const base = () => reducer({ hydrated: false, accounts: [], transactions: [] }, { type: 'hydrate', state: {
  onboarded: true, language: 'en', marketId: 'AE', ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  accounts: [{ id: 'bank', name: 'Bank', kind: 'bank', openingFils: 100000, color: '#000' }],
  transactions: [], bills: [bill], cardDues: [], budgets: [], goals: [],
} });
const mark = (state, tx = payment) => reducer(state, { type: 'markBillPaid', id: 'bill', month: '2026-09', transaction: tx });
const status = state => build('bills').billsForMonth(state.bills, state.transactions, now)[0].status;

test('a higher corrected notice revokes the old paid claim without deleting its expense', () => {
  const initial = base();
  initial.bills = [{ ...initial.bills[0], autoDetected: true, importIdentity: 'consumer:1234',
    statedDueDate: '2026-09-25', noticeObservedAt: 1000 }];
  const paid = mark(initial);
  // Execute the current correction policy at the reducer's state boundary.
  // The shared build is refreshed for the full import test below.
  const fs = require('node:fs'), ts = require('typescript');
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/lib/store.tsx'), 'utf8');
  const file = ts.createSourceFile('store.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'reconcileBillPaymentClaims');
  const body = ts.transpileModule(fn.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const reconcile = Function('isSpending', `${body}; return reconcileBillPaymentClaims;`)(build('ledger').isSpending);
  const next = reconcile(paid, { ...paid, bills: [{ ...paid.bills[0], amountFils: 40000, paidMonths: [] }] });
  assert.equal(next.transactions.length, 1);
  assert.equal(next.transactions[0].amountFils, 30000);
  assert.equal(next.transactions[0].billPayment, undefined);
  assert.equal(validate(next), true);
});

test('backup retains valid notice provenance without turning estimates into exact dues', () => {
  const current = base();
  const notice = { ...current.bills[0], autoDetected: true, statedDueDate: '2026-09-25' };
  assert.equal(validate({ ...current, bills: [notice] }), true);
  assert.equal(validate(current), true, 'legacy and manually estimated bills remain compatible');
  for (const patch of [{ statedDueDate: '2026-09-31' }, { statedDueDate: '2026-09-26' },
    { statedDueDate: null }, { autoDetected: false }]) {
    assert.equal(validate({ ...current, bills: [{ ...notice, ...patch }] }), false);
  }
});

test('deleting a recorded bill payment reopens its obligation and reminders', () => {
  const paid = mark(base());
  assert.deepEqual(paid.transactions[0].billPayment, { billId: 'bill', month: '2026-09' });
  const deleted = reducer(paid, { type: 'deleteTransaction', id: 'payment' });
  assert.equal(deleted.transactions.length, 0);
  assert.deepEqual(deleted.bills[0].paidMonths, []);
  assert.notEqual(status(deleted), 'paid');
  assert.deepEqual(build('reminders').buildPaymentReminders(deleted, now).filter(r => r.kind === 'bill')
    .map(r => r.dateISO), ['2026-09-24', '2026-09-25']);
});

test('financial edits revoke the exact explicit claim; cosmetics preserve it', () => {
  for (const patch of [{ amountFils: 10000 }, { type: 'income' }, { accountId: 'other' },
    { date: '2026-08-20' }, { isTransfer: true }]) {
    const edited = reducer(mark(base()), { type: 'editTransaction', id: 'payment', patch });
    assert.deepEqual(edited.bills[0].paidMonths, [], JSON.stringify(patch));
    assert.equal(edited.transactions[0].billPayment, undefined);
  }
  for (const patch of [{ title: 'Electricity' }, { note: 'Paid online' }, { category: 'other' },
    { amountFils: 30000 }, { isTransfer: false }]) {
    const edited = reducer(mark(base()), { type: 'editTransaction', id: 'payment', patch });
    assert.deepEqual(edited.bills[0].paidMonths, ['2026-09']);
    assert.deepEqual(edited.transactions[0].billPayment, { billId: 'bill', month: '2026-09' });
  }
});

test('repeated mark-paid cannot create a second expense or pay a deleted bill', () => {
  const paid = mark(base());
  assert.equal(mark(paid, { ...payment, id: 'repeat' }).transactions.length, 1);
  const removed = reducer(base(), { type: 'deleteBill', id: 'bill' });
  assert.equal(mark(removed).transactions.length, 0);
});

test('a bank payment arriving before confirmation prevents a duplicate manual expense', () => {
  const initial = base();
  const arrived = { ...initial, transactions: [{ ...payment, id: 'bank-receipt', source: 'sms' }] };
  assert.equal(status(arrived), 'paid');
  const confirmed = mark(arrived);
  assert.equal(confirmed.transactions.length, 1);
  assert.equal(confirmed.transactions[0].id, 'bank-receipt');
  assert.deepEqual(confirmed.bills[0].paidMonths, []);
});

test('mark-paid rechecks the requested money month, including salary-month boundaries', () => {
  const initial = reducer(base(), { type: 'setMonthStartDay', day: 25 });
  const arrived = { ...initial, transactions: [{ ...payment, id: 'bank-receipt', source: 'sms', date: '2026-10-01' }] };
  assert.equal(mark(arrived).transactions.length, 1, 'October 1 paid the September salary month');
  const nextMonth = reducer(arrived, { type: 'markBillPaid', id: 'bill', month: '2026-10', transaction: payment });
  assert.equal(nextMonth.transactions.length, 2, 'September money month payment cannot silence October');
  build('format').setMonthStartDay(1);
});

test('an ambiguous or archived payment does not block an explicit manual confirmation', () => {
  const initial = base();
  const receipt = { ...payment, id: 'bank-receipt', source: 'sms' };
  const ambiguous = { ...initial, bills: [bill, { ...bill, id: 'second-bill' }], transactions: [receipt] };
  assert.equal(mark(ambiguous).transactions.length, 2, 'one receipt claimed by two bills proves neither paid');
  const archived = { ...initial, accounts: [...initial.accounts,
    { ...initial.accounts[0], id: 'old-bank', archived: true }],
  transactions: [{ ...receipt, accountId: 'old-bank' }] };
  assert.equal(mark(archived).transactions.length, 2, 'excluded account activity cannot prove payment');
});

test('deleting a bill keeps its expense and removes the obsolete association', () => {
  const removed = reducer(mark(base()), { type: 'deleteBill', id: 'bill' });
  assert.equal(removed.bills.length, 0);
  assert.equal(removed.transactions.length, 1);
  assert.equal(removed.transactions[0].amountFils, 30000);
  assert.equal(removed.transactions[0].billPayment, undefined);
  assert.equal(validate(removed), true);
});

test('deleting the funding account also revokes the linked paid claim', () => {
  const removed = reducer(mark(base()), { type: 'deleteAccount', id: 'bank' });
  assert.equal(removed.transactions.length, 0);
  assert.deepEqual(removed.bills[0].paidMonths, []);
});

test('legacy paid months and unrelated payments are never linked by inference', () => {
  const initial = base();
  const legacy = { ...initial, bills: [{ ...bill, paidMonths: ['2026-09'] }], transactions: [payment] };
  const deleted = reducer(legacy, { type: 'deleteTransaction', id: 'payment' });
  assert.deepEqual(deleted.bills[0].paidMonths, ['2026-09']);
});

test('restoring a different ledger does not revoke claims that reuse transaction ids', () => {
  const prior = mark(base());
  const replacement = { ...prior, bills: [{ ...prior.bills[0], id: 'restored-bill' }],
    transactions: [{ ...prior.transactions[0], billPayment: { billId: 'restored-bill', month: '2026-09' } }] };
  const restored = reducer(prior, { type: 'restore', state: replacement });
  assert.deepEqual(restored.bills[0].paidMonths, ['2026-09']);
  assert.deepEqual(restored.transactions[0].billPayment, { billId: 'restored-bill', month: '2026-09' });
});

test('loading a demo ledger does not revoke incoming claims that reuse transaction ids', () => {
  const prior = mark(base());
  const replacement = { ...prior, bills: [{ ...prior.bills[0], id: 'demo-bill' }],
    transactions: [{ ...prior.transactions[0], billPayment: { billId: 'demo-bill', month: '2026-09' } }] };
  const demo = reducer(prior, { type: 'loadDemo', state: replacement });
  assert.deepEqual(demo.bills[0].paidMonths, ['2026-09']);
  assert.deepEqual(demo.transactions[0].billPayment, { billId: 'demo-bill', month: '2026-09' });
});

test('removing one link does not revoke a remaining linked expense in legacy state', () => {
  const paid = mark(base());
  const duplicated = { ...paid, transactions: [...paid.transactions, { ...paid.transactions[0], id: 'second' }] };
  const removed = reducer(duplicated, { type: 'deleteTransaction', id: 'payment' });
  assert.deepEqual(removed.bills[0].paidMonths, ['2026-09']);
});

test('backup preserves the link and refuses malformed or dangling settlement evidence', () => {
  const paid = mark(base());
  assert.equal(validate(paid), true);
  const restored = store.parseBackupForRestore(JSON.stringify({ app: 'wafra', version: 1, data: paid }));
  assert.ok(restored);
  assert.deepEqual(restored.transactions[0].billPayment, { billId: 'bill', month: '2026-09' });
  assert.deepEqual(reducer(restored, { type: 'deleteTransaction', id: 'payment' }).bills[0].paidMonths, []);
  for (const link of [{ billId: 'missing', month: '2026-09' }, { billId: 'bill', month: '2026-13' },
    { billId: 'bill', month: '2026-08' }, { month: '2026-09' }, 'bill']) {
    assert.equal(validate({ ...paid, transactions: [{ ...paid.transactions[0], billPayment: link }] }), false);
  }
  for (const patch of [{ type: 'income' }, { isTransfer: true }, { source: 'sms' }]) {
    assert.equal(validate({ ...paid, transactions: [{ ...paid.transactions[0], ...patch }] }), false);
  }
  assert.equal(validate({ ...paid, transactions: [...paid.transactions, { ...paid.transactions[0], id: 'duplicate' }] }), false);
});
