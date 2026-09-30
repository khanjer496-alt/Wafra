// Public regressions preserve the reported bank wording with synthetic card/amount values.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSms } = require('../build/sms-parser.js');
const { buildImportPlan } = require('../build/import-plan.js');
const { materializeImportBatch, applyMaterializedImportBatch } = require('../build/ledger-import.js');
const { openDues } = require('../build/cards.js');
const { buildPaymentReminders } = require('../build/reminders.js');
const { setActiveMarket, setLedgerCurrency } = require('../build/markets.js');
setActiveMarket('AE');
setLedgerCurrency('AED', 2);

// Exact statement and receipt supplied by the user after the initial report.
const statement = 'Cr.Card XXX9426 Billing alert: Total due to avoid fin. charges: AED9249.64. Due date Sep 30 2026; Pay min. AED462.48 by due date to avoid AED241.50 late fees.';
const receipt = 'Your payment of AED 9251 against Credit Card no. XXX9426 was received at 12:10 PM on 30/09/2026. Thank you.';
const now = new Date(2026, 8, 29, 12);
const base = () => ({ hydrated: true, marketId: 'AE', privateMode: true,
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: {}, merchantOverrides: {}, billAliases: {}, notSubscriptions: [],
  lastScanTs: 0, parserVersion: 49 });
let serial = 0;
function importMessage(state, body, sender, time, at = now) {
  const smsTs = Date.parse(time);
  const parsed = parseSms(body);
  assert.ok(parsed, 'fixture must reach the real importer');
  const row = { ...parsed, smsTs, sender, channel: 'inbox' };
  const plan = buildImportPlan([row], state, smsTs, at);
  return applyMaterializedImportBatch(state,
    materializeImportBatch(plan.batch, state, prefix => `${prefix}-${++serial}`));
}

test('a statement creates a card, preserves its bank minimum, and reaches the reminder plan without spending', () => {
  const state = importMessage(base(), statement, 'ADCB', '2026-09-29T08:00:00Z');
  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0].last4, '9426');
  assert.equal(state.accounts[0].cardType, 'credit');
  assert.equal(state.transactions.length, 0);
  assert.equal(state.cardDues.length, 1);
  assert.equal(state.cardDues[0].totalDueFils, 924964);
  assert.equal(state.cardDues[0].minDueFils, 46248);
  assert.equal(openDues(state, now)[0].minimumKnown, true);
  assert.equal(state.cardDues[0].dueDate, '2026-09-30');
  const reminders = buildPaymentReminders(state, now);
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].kind, 'card');
  assert.equal(reminders[0].dateISO, '2026-09-30');
  const replay = importMessage(state, statement, 'ADCB', '2026-09-29T08:00:00Z');
  assert.equal(replay.cardDues.length, 1);
  assert.equal(replay.transactions.length, 0);
});

test('an ambiguous funding transfer cannot silence the due; a card receipt settles it', () => {
  let state = importMessage(base(), statement, 'ADCB', '2026-09-29T08:00:00Z');
  const afterPayment = new Date(2026, 8, 30, 12, 15);
  state = importMessage(state, 'Dear Customer, your funds transfer request of AED 9,251.00 ' +
    'to IBAN/Account/Card XXXX9426 has been processed successfully from your account/card XXXX0002 ' +
    'on 30/09/2026 12:10', 'FAB', '2026-09-30T08:10:00Z', afterPayment);
  assert.equal(openDues(state, afterPayment).length, 1);
  state = importMessage(state, receipt, 'ADCB', '2026-09-30T08:10:00Z', afterPayment);
  assert.equal(openDues(state, afterPayment).length, 0);
  const card = state.accounts.find(a => a.last4 === '9426');
  const payments = state.transactions.filter(tx => tx.accountId === card.id && tx.type === 'income');
  assert.equal(payments.length, 1);
  assert.equal(payments[0].amountFils, 925100);
  assert.equal(payments[0].date, '2026-09-30');
  const replay = importMessage(state, receipt, 'ADCB', '2026-09-30T08:10:00Z', afterPayment);
  assert.equal(replay.transactions.length, state.transactions.length);
});

test('a receipt received before reminder time removes the upcoming reminder', () => {
  // Synthetic earlier receipt: the actual one arrived after the due-day09:00
  // reminder, so it cannot prove cancellation of a still-future notification.
  const at = new Date(2026, 8, 29, 12, 15);
  const unpaid = importMessage(base(), statement, 'ADCB', '2026-09-29T08:00:00Z');
  assert.equal(buildPaymentReminders(unpaid, at).filter(r => r.kind === 'card').length, 1);
  const paid = importMessage(unpaid, receipt.replace('30/09/2026', '29/09/2026'),
    'ADCB', '2026-09-29T08:10:00Z', at);
  assert.equal(buildPaymentReminders(paid, at).filter(r => r.kind === 'card').length, 0);
});
