'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const dependencies = Object.fromEntries([
  'capture-source-identity', 'cards', 'markets', 'dedupe', 'bill-alias', 'format', 'heal',
  'transfer-evidence', 'transfer-reconciliation', 'ledger', 'ledger-money', 'sms-parser', 'balances', 'i18n',
  'alert-review-tray', 'parsed-review-event',
].map(name => [`@/lib/${name}`, require(`../build/${name}`)]));
const { buildImportPlan } = load(path.join(root, 'src/lib/import-plan.ts'), dependencies);
const { mergeImportedCardDues } = load(path.join(root, 'src/lib/cards.ts'), dependencies);
const { parseSms } = dependencies['@/lib/sms-parser'];
const accounts = [{ id: 'adib-card', name: 'ADIB card', kind: 'card', cardType: 'credit', last4: '1234', bankName: 'ADIB' }];
const due = { id: 'statement', accountId: 'adib-card', totalDueFils: 4210, minDueFils: 123456,
  dueDate: '2026-09-25', paidFils: 1800, settledAt: '2026-09-18' };
const smsTs = Date.UTC(2026, 8, 19, 12);
const parsed = parseSms('ADIB Covered card Mini stmt. Total amount due AED 42.10 on card ending **1234. Min due AED 1234.56 by 25SEP26. Please pay before due date.', {}, { sender: 'ADIB' });
const input = [{ ...parsed, smsTs, sender: 'ADIB', channel: 'inbox', sourceEventId: 'a123' }];
const state = cardDues => ({ hydrated: true, accounts, transactions: [], budgets: [], bills: [], goals: [],
  cardDues, accountHints: {}, merchantOverrides: {}, billAliases: {}, lastScanTs: 0, parserVersion: 47,
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } });
const plan = cardDues => buildImportPlan(input, state(cardDues), smsTs, new Date(smsTs));

test('re-reading the same statement repairs an impossible saved minimum and preserves payments', () => {
  assert.equal(parsed.minDueFils, null);
  const repairedPlan = plan([due]);
  assert.equal(repairedPlan.batch.newDues.length, 1, 'the corrected statement must reach the due merge');
  const repaired = mergeImportedCardDues([due], repairedPlan.batch.newDues, accounts);
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0].id, due.id);
  assert.equal(repaired[0].totalDueFils, due.totalDueFils);
  assert.equal(repaired[0].paidFils, due.paidFils);
  assert.equal(repaired[0].settledAt, due.settledAt);
  assert.equal(repaired[0].minDueEstimated, true);
  assert.equal(repaired[0].minDueFils, dependencies['@/lib/cards'].estimatedMinimumFils(due.totalDueFils));
  assert.equal(plan(repaired).batch.newDues.length, 0, 'repeat reread is idempotent');
  assert.equal(due.minDueFils, 123456, 'the prior snapshot remains unchanged');
});

test('missing reparse minimum never replaces a valid bank-stated minimum', () => {
  const valid = { ...due, minDueFils: 1000 };
  assert.equal(plan([valid]).batch.newDues.length, 0);
  const merged = mergeImportedCardDues([valid], [{ ...due, minDueFils: 211, minDueEstimated: true, paidFils: 0 }], accounts);
  assert.equal(merged[0].minDueFils, 1000);
  assert.equal(merged[0].minDueEstimated, undefined);
});

test('an estimate for a different total does not qualify as the same-statement repair', () => {
  const merged = mergeImportedCardDues([due], [{ ...due, totalDueFils: 5000, minDueFils: 250,
    minDueEstimated: true, paidFils: 0 }], accounts);
  assert.equal(merged[0].minDueFils, due.minDueFils);
  assert.equal(merged[0].paidFils, due.paidFils);
});
