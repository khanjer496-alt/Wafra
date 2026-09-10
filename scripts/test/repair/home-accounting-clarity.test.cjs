'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const ledger = require('../build/ledger.js');
const { summarizeMonth } = require('../build/insights.js');
const { summarizeCashOutflow } = require('../build/cash-flow.js');

const account = { id: 'bank', name: 'Bank', kind: 'bank', openingFils: 0, color: '#000000' };
const row = (id, type, amountFils, category, title) => ({
  id, type, amountFils, category, title, accountId: 'bank', date: '2026-09-10', source: 'sms',
});

test('cash and investment movements stay visible records without inflating income or spending', () => {
  const transactions = [
    row('atm', 'expense', 100000, 'cash-withdrawal', 'ATM withdrawal'),
    row('deposit', 'income', 200000, 'other', 'Cash deposit'),
    row('investment', 'expense', 50000, 'investing', 'Brokerage transfer'),
    row('salary', 'income', 300000, 'salary', 'Salary'),
    row('purchase', 'expense', 40000, 'dining', 'Cafe'),
  ];
  const live = ledger.liveAccountIds([account]);
  const internal = ledger.internalTransferIds(transactions, [account]);
  const summary = summarizeMonth(transactions, { mode: 'all' }, live, internal);

  assert.equal(summary.incomeFils, 300000);
  assert.equal(summary.expenseFils, 40000);
  assert.equal(summary.incomeFils - summary.expenseFils, 260000);
  assert.equal(ledger.isMoneyMovementOnly(transactions[0]), true);
  assert.equal(ledger.isMoneyMovementOnly(transactions[1]), true);
  assert.equal(ledger.isMoneyMovementOnly(transactions[2]), true);
  assert.equal(ledger.isMoneyMovementOnly(transactions[3]), false);
  assert.equal(ledger.isMoneyMovementOnly(transactions[4]), false);

  const state = { accounts: [account], transactions, cardDues: [] };
  const cash = summarizeCashOutflow(state, { mode: 'all' }, { live, internal });
  assert.equal(cash.totalFils, 190000, 'withdrawal, investment and purchase still leave the bank');
});

test('Home does not turn unresolved-transfer backlog into the main product experience', () => {
  const home = fs.readFileSync(path.join(root, 'src/screens/journal-home-screen.tsx'), 'utf8');
  const wallet = fs.readFileSync(path.join(root, 'src/app/(tabs)/wallet.tsx'), 'utf8');
  assert.doesNotMatch(home, /TransferReviewNotice|\/review-transfers/);
  assert.match(wallet, /router\.push\('\/review-transfers'\)/);
});

test('Home labels the economic totals as Spending, Income and Net rather than bank cash movement', () => {
  const copy = fs.readFileSync(path.join(root, 'src/lib/reference-copy.ts'), 'utf8');
  assert.match(copy, /moneyIn: 'Income', moneyOut: 'Spending', netLabel: 'Net'/);
  assert.match(copy, /cashflowNote: 'Income minus spending'/);
});
