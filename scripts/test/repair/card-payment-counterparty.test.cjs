'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');

const build = name => require(path.resolve(__dirname, '../build', name));
function load(name) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/lib', `${name}.ts`), 'utf8');
  const module = { exports: {} };
  Function('require', 'module', 'exports', ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(id => build(id.replace(/^@\/lib\//, '')), module, module.exports);
  return module.exports;
}
const cards = load('cards');
const { parseSms } = build('sms-parser');
const planner = load('import-plan');
const accounts = [
  { id: 'bank', name: 'Bank', kind: 'bank', bankName: 'ADCB', last4: '0004', openingFils: 0 },
  { id: 'a', name: 'Card A', kind: 'card', cardType: 'credit', bankName: 'ADCB', last4: '1111', openingFils: 0 },
  { id: 'b', name: 'Card B', kind: 'card', cardType: 'credit', bankName: 'ADCB', last4: '2222', openingFils: 0 },
];
const now = new Date(2026, 8, 20, 12);
const empty = { hydrated: true, accounts, transactions: [], bills: [], cardDues: [], budgets: [], goals: [],
  merchantOverrides: {}, accountHints: {}, billAliases: {}, lastScanTs: 0,
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } };

function alertRow(text, id) {
  const parsed = parseSms(text);
  assert.ok(parsed);
  const plan = planner.buildImportPlan([{ ...parsed, date: '2026-09-20', sender: 'ADCB',
    smsTs: +now, channel: 'inbox' }], empty, +now, now);
  assert.equal(plan.batch.transactions.length, 1);
  return { ...plan.batch.transactions[0], id };
}
const debit = digits => ({ ...alertRow(`AED 1,000.00 has been debited from your account XXX0004 towards the payment of your Credit Card ${digits}.`, `debit-${digits}`),
  // Older importers filed this known card-payment side on its funding bank.
  type: 'expense', accountId: 'bank' });
const receipt = digits => alertRow(`Payment of AED 1,000.00 received towards your Credit Card ending ${digits}.`, `receipt-${digits}`);
const rows = (transactions, accountRows = accounts) => cards.cardPaymentRows({
  accounts: accountRows, transactions, cardDues: [],
});

test('different stated cards cannot collapse equal same-day payments', () => {
  const bank = debit('1111');
  const received = receipt('2222');
  assert.equal(bank.captureInstrument.last4, '1111');
  assert.equal(received.captureInstrument.last4, '2222');
  for (const transactions of [[bank, received], [received, bank]]) {
    const actual = rows(transactions);
    assert.equal(actual.length, 2);
    assert.equal(actual.reduce((total, row) => total + row.amountFils, 0), 200000);
    assert.equal(actual.find(row => row.id === received.id).cashOutAccountId, undefined);
  }
});

test('matching card observations collapse and retain the funding date and account', () => {
  const bank = { ...debit('1111'), date: '2026-09-19' };
  const actual = rows([bank, receipt('1111')]);
  assert.equal(actual.length, 1);
  assert.equal(actual[0].cashOutAccountId, 'bank');
  assert.equal(actual[0].cashOutDate, '2026-09-19');
});

test('a source bank account instrument is not mistaken for the destination card', () => {
  const bank = { ...debit('1111'), captureInstrument: { last4: '0004', kind: 'account', bankIdentity: 'ADCB' },
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source',
      counterparty: { last4: '1111', kind: 'unknown', bankIdentity: 'ADCB' } } };
  assert.equal(rows([bank, receipt('1111')]).length, 1);
  assert.equal(rows([bank, receipt('2222')]).length, 2);
});

test('matching digits at contradictory card issuers cannot collapse', () => {
  const bank = { ...debit('1111'), captureInstrument: { last4: '1111', kind: 'credit', bankIdentity: 'FAB' } };
  assert.equal(rows([bank, receipt('1111')]).length, 2);
});

test('an unidentified legacy debit can match one compatible receiving card', () => {
  const { captureInstrument, ...unknown } = debit('1111');
  assert.equal(rows([unknown, receipt('1111')]).length, 1);
});

test('an unidentified debit cannot choose between two different receiving cards', () => {
  const { captureInstrument, ...unknown } = debit('1111');
  assert.equal(rows([unknown, receipt('1111'), receipt('2222')]).length, 3);
});

test('a receipt cannot choose between equally compatible funding accounts', () => {
  const first = debit('1111');
  const second = { ...first, id: 'other-funding', accountId: 'other-bank' };
  assert.equal(rows([first, second, receipt('1111')], [...accounts,
    { ...accounts[0], id: 'other-bank', last4: '0005' }]).length, 3);
});

test('two same-card movements retain one-to-one cardinality', () => {
  const bank = debit('1111');
  const received = receipt('1111');
  const actual = rows([bank, { ...bank, id: 'second-debit' }, received, { ...received, id: 'second-receipt' }]);
  assert.equal(actual.length, 2);
  assert.equal(actual.reduce((total, row) => total + row.amountFils, 0), 200000);
});

test('identified cards match independently when equal-date row order crosses', () => {
  const receivedA = { ...receipt('1111'), id: 'z-receipt-A' };
  const receivedB = { ...receipt('2222'), id: 'a-receipt-B' };
  for (const transactions of [[debit('1111'), debit('2222'), receivedB, receivedA],
    [receivedA, receivedB, debit('2222'), debit('1111')]]) {
    const actual = rows(transactions);
    assert.equal(actual.length, 2);
    assert.ok(actual.every(row => row.cardPaymentSide === 'receipt' && row.cashOutAccountId === 'bank'));
  }
});

test('cashback and refunds cannot act as card-payment receipts', () => {
  for (const label of ['Cashback', 'Refund']) {
    const refund = alertRow(`${label} of AED 1,000.00 has been credited to your Credit Card ending 1111.`, label);
    assert.equal(refund.cardPaymentSide, undefined);
    assert.equal(rows([debit('1111'), refund]).length, 1);
    assert.equal(rows([debit('1111'), refund])[0].cardPaymentSide, 'debit');
  }
});

test('an observed payment still counts once across two overlapping statements', () => {
  const dues = ['2026-09-25', '2026-10-25'].map((dueDate, index) => ({
    id: `due-${index}`, accountId: 'a', dueDate, totalDueFils: 100000, minDueFils: 5000, paidFils: 0,
  }));
  const state = { accounts, transactions: [receipt('1111')], cardDues: dues };
  assert.deepEqual(dues.map(due => cards.duePaidFils(state, due)), [100000, 0]);
});

test('merging statement timestamps retains exactly the corresponding transaction owner', () => {
  const prior = { id: 'due', accountId: 'a', dueDate: '2026-09-25', totalDueFils: 100000,
    minDueFils: 5000, paidFils: 0, settledAt: '2026-09-18T12:00:00Z', settledByTransactionId: 'old-payment' };
  const incoming = { ...prior, id: 'incoming', settledAt: '2026-09-20T12:00:00Z', settledByTransactionId: 'new-payment' };
  assert.equal(cards.mergeImportedCardDues([prior], [incoming], accounts)[0].settledByTransactionId, 'new-payment');
  assert.equal(cards.mergeImportedCardDues([incoming], [prior], accounts)[0].settledByTransactionId, 'new-payment');
  const unlinked = { ...incoming, settledByTransactionId: undefined };
  assert.equal(cards.mergeImportedCardDues([prior], [unlinked], accounts)[0].settledByTransactionId, undefined);
});
