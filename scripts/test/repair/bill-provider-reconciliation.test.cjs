'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// Read shipping sources without rebuilding the shared full-suite directory.
function load(name, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../../src/lib', `${name}.ts`), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)(id => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    assert.ok(id.startsWith('@/lib/'), `unexpected dependency ${id}`);
    return require(path.join(__dirname, '../build', id.slice('@/lib/'.length)));
  }, module, module.exports);
  return module.exports;
}

const bills = load('bills');
const { buildPaymentReminders } = load('reminders', { '@/lib/bills': bills });
const { applyBillAliasToTransactions } = require('../build/bill-alias');
const now = new Date(2026, 8, 20, 12);
const bill = (title = 'DEWA', patch = {}) => ({
  id: 'bill', title, category: 'utilities', amountFils: 30000, dueDay: 25,
  importIdentity: 'account:1234', paidMonths: [], ...patch,
});
const receipt = (title = 'Etisalat', patch = {}) => ({
  id: 'receipt', title, category: 'telecom', type: 'expense', amountFils: 30000,
  accountId: 'bank', date: '2026-09-19', source: 'sms',
  paymentFlowSide: 'receipt', billIdentity: 'consumer:1234', ...patch,
});
const status = (obligation, payment) => bills.billsForMonth([obligation], [payment], now)[0];

test('the same account tail at different providers cannot settle a bill', () => {
  assert.notEqual(status(bill(), receipt()).status, 'paid');
  assert.notEqual(status(bill('SEWA'), receipt('DEWA', { category: 'utilities' })).status, 'paid');
});

test('a partial payment cannot settle an exact bank-stated bill total', () => {
  const exact = bill('DEWA', { autoDetected: true, statedDueDate: '2026-09-25' });
  assert.notEqual(status(exact, receipt('DEWA', { amountFils: 28500 })).status, 'paid');
  assert.equal(status(exact, receipt('DEWA', { amountFils: 30000 })).status, 'paid');
  assert.equal(status(exact, receipt('DEWA', { amountFils: 30100 })).status, 'paid');
  // Manually estimated recurring reminders retain their existing tolerance.
  assert.equal(status(bill('DEWA'), receipt('DEWA', { amountFils: 28500 })).status, 'paid');
  assert.equal(status(bill('DEWA', { autoDetected: true }), receipt('DEWA', { amountFils: 28500 })).status,
    'paid', 'subscription-derived autoDetected amounts are estimates');
  const later = bills.billsForMonth([exact], [receipt('DEWA', { amountFils: 28500, date: '2026-10-19' })],
    new Date(2026, 9, 20, 12))[0];
  assert.equal(later.status, 'paid', 'last month notice must not claim an exact total for a later cycle');
});

test('dated bill imports retain the cycle for which the total was stated', () => {
  const { parseSms } = require('../build/sms-parser');
  const { buildImportPlan } = load('import-plan');
  const parsed = parseSms('Dear Customer, The due date for your e& bill is nearing. A total amount of AED 300.00 including VAT is due on 25-09-2026. To pay your bill, please visit businessonline.etisalat.ae/quickpay.');
  const state = { hydrated: true, accounts: [], transactions: [], bills: [], cardDues: [], budgets: [], goals: [],
    merchantOverrides: {}, accountHints: {}, billAliases: {}, lastScanTs: 0 };
  const plan = buildImportPlan([{ ...parsed, sender: 'Etisalat', smsTs: +now, channel: 'inbox' }], state, +now, now);
  assert.equal(plan.batch.newBills[0].statedDueDate, '2026-09-25');
  const refreshed = bills.mergeImportedBills([bill('Etisalat', { autoDetected: true, importIdentity: undefined })],
    [{ ...plan.batch.newBills[0], id: 'incoming', paidMonths: [] }]);
  assert.equal(refreshed[0].statedDueDate, '2026-09-25');
  const undated = buildImportPlan([{ ...parsed, dueDay: null, date: '2026-09-20',
    sender: 'Etisalat', smsTs: +now, channel: 'inbox' }], state, +now, now);
  assert.equal(undated.batch.newBills[0].statedDueDate, undefined,
    'a collector observation-date fallback is not a stated deadline');
});

test('an unknown payee nickname cannot prove the provider from four digits', () => {
  assert.notEqual(status(bill('E&'), receipt('Nazemhome', { category: 'other' })).status, 'paid');
});

test('known aliases retain same-provider payment matching', () => {
  for (const [reminder, payment] of [['E&', 'Etisalat'], ['e& UAE', 'E Digital App'], ['كهرباء الشارقة', 'SEWA']]) {
    assert.equal(status(bill(reminder), receipt(payment)).status, 'paid', `${reminder} / ${payment}`);
  }
});

test('an explicit user alias supplies the missing provider evidence', () => {
  const rows = applyBillAliasToTransactions([receipt('Nazemhome', { category: 'other' })],
    'Nazemhome', 'consumer:1234', { title: 'E&', category: 'telecom' });
  assert.equal(status(bill('E&'), rows[0]).status, 'paid');
});

test('matching provider aliases cannot override a different account tail', () => {
  assert.notEqual(status(bill('E&'), receipt('Etisalat', { billIdentity: 'consumer:9999' })).status, 'paid');
});

test('one identified receipt settles only its provider when tails collide', () => {
  const rows = bills.billsForMonth([bill('DEWA'), bill('Etisalat', { id: 'telecom' })], [receipt()], now);
  assert.deepEqual(rows.filter(row => row.status === 'paid').map(row => row.bill.id), ['telecom']);
});

test('an unrelated provider receipt leaves the due-date reminders active', () => {
  const state = { accounts: [{ id: 'bank', name: 'Bank', kind: 'bank', openingFils: 0 }],
    transactions: [receipt()], bills: [bill()], cardDues: [], notSubscriptions: [],
    budgets: [], cancelledSubscriptions: {}, ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } };
  assert.deepEqual(buildPaymentReminders(state, now).filter(row => row.kind === 'bill')
    .map(row => row.dateISO), ['2026-09-24', '2026-09-25']);
});
