'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const subjects = new Set(['sms-parser', 'bank-alert-interpreter', 'launch-alert-parser', 'local-message-record']);
const cache = new Map();
function current(name) {
  if (cache.has(name)) return cache.get(name);
  const file = path.join(root, 'src/lib', name + '.ts');
  const deps = {};
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)) {
    const dep = match[1].slice(6);
    deps[match[1]] = subjects.has(dep) ? current(dep) : require(path.join(build, dep + '.js'));
  }
  const result = load(file, deps);
  cache.set(name, result);
  return result;
}
const markets = require(path.join(build, 'markets.js'));
markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
const { parseLocalMessageRecord } = current('local-message-record');
const { createLaunchAlertSession } = current('launch-alert-parser');
const receipt = date => `Dear Customer, your payment of AED 42.10 on ${date} for card ending with **1234 has been credited. Thank you.`;
const parse = (text, observedAt, sender = 'Unknown Sender', importedAt = '2026-09-19T12:00:00Z') =>
  parseLocalMessageRecord(JSON.stringify({ v: 1, id: 'a'.repeat(64), text, sender, source: 'message', observedAt }),
    new Date(importedAt), 'AE', createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' }));

test('local Shortcut route uses the original observation to corroborate the known receipt format', () => {
  for (const [bodyDate, observedAt, expected, prior] of [
    ['01/10/2021', '2021-01-10T10:30:00.000Z', '2021-01-10', '2021-10-01'],
    ['09/08/2020', '2020-09-08T10:30:00.000Z', '2020-09-08', '2020-08-09'],
  ]) {
    const result = parse(receipt(bodyDate), observedAt);
    assert.equal(result.kind, 'parsed');
    assert.equal(result.row.date, expected);
    assert.equal(result.row.dateRepairFrom, prior);
    assert.equal(result.row.smsTs, Date.parse(observedAt));
    assert.equal(result.row.sourceEventId, 'a'.repeat(64));
    assert.equal(result.row.amountFils, 4210);
    assert.equal(result.row.cardPaymentSide, 'receipt');
    assert.equal(result.row.raw, undefined, 'source text still leaves no retained ledger body');
    assert.equal(result.row.sender, undefined, 'sender remains ephemeral');
  }
});

test('import time cannot substitute for original message time', () => {
  const result = parse(receipt('01/10/2021'), '2021-01-11T10:30:00.000Z');
  assert.equal(result.kind, 'parsed');
  assert.equal(result.row.date, '2021-10-01');
  assert.equal(result.row.dateRepairFrom, undefined);
});

test('explicit historical transaction dates and statement deadlines remain bank-provided', () => {
  for (const body of [
    'Payment of AED 42.10 has been received towards your ADIB Covered Card ending 1234. Thank you. Transaction date 2021-01-05.',
    'Purchase of AED 42.10 with Credit Card ending 1234 at CARREFOUR on 05 Jan 2021.',
  ]) {
    const result = parse(body, '2021-01-10T10:30:00.000Z', 'ADIB');
    assert.equal(result.kind, 'parsed'); assert.equal(result.row.date, '2021-01-05');
    assert.equal(result.row.dateRepairFrom, undefined);
  }
  const result = parse('Your ADIB Covered Card ending 1234 statement is ready. Total Amount Due AED 8240.00. Minimum Amount Due AED 412.00. Payment due by 05/06/2026.', '2026-05-06T10:30:00.000Z', 'ADIB');
  assert.equal(result.kind, 'parsed'); assert.equal(result.row.kind, 'cardStatement');
  assert.equal(result.row.date, '2026-06-05'); assert.equal(result.row.dateRepairFrom, undefined);
});

test('re-import of the original local Message repairs one existing date without duplicating money', () => {
  const { buildImportPlan } = require(path.join(build, 'import-plan.js'));
  const { materializeImportBatch, applyMaterializedImportBatch } = require(path.join(build, 'ledger-import.js'));
  const observedAt = '2021-01-10T10:30:00.000Z';
  const source = 'a'.repeat(64);
  const old = { id: 'existing-receipt', source: 'sms', smsKey: 'h' + source,
    ts: Date.parse(observedAt), date: '2021-10-01', type: 'income', amountFils: 4210,
    title: 'Card •1234 payment', accountId: 'credit', category: 'other', isTransfer: true,
    cardPaymentSide: 'receipt', captureInstrument: { last4: '1234', kind: 'credit' } };
  const purchase = { id: 'purchase', source: 'manual', date: '2021-06-01', type: 'expense',
    amountFils: 1234, title: 'Synthetic purchase', accountId: 'credit', category: 'shopping' };
  const state = { hydrated: true, accounts: [{ id: 'credit', name: 'Credit Card', kind: 'card',
    cardType: 'credit', last4: '1234', openingFils: 0 }], transactions: [old, purchase],
    budgets: [], bills: [], goals: [], cardDues: [], accountHints: {}, merchantOverrides: {},
    billAliases: {}, lastScanTs: 0, parserVersion: 49,
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } };
  const outcome = parse(receipt('01/10/2021'), observedAt);
  assert.equal(outcome.kind, 'parsed');
  const plan = buildImportPlan([outcome.row], state, 0, new Date('2026-09-19T12:00:00Z'));
  assert.equal(plan.txCount, 0);
  assert.equal(plan.batch.updates[0]?.sourceDateCorrection?.to, '2021-01-10');
  const batch = materializeImportBatch(plan.batch, state, () => { throw new Error('no new money/account/obligation is allowed'); });
  const repaired = applyMaterializedImportBatch(state, batch);
  assert.deepEqual(repaired.transactions.map(t => t.id), ['purchase', 'existing-receipt']);
  const corrected = repaired.transactions.find(t => t.id === old.id);
  assert.equal(corrected.date, '2021-01-10');
  for (const key of ['id', 'ts', 'smsKey', 'amountFils', 'type', 'accountId', 'isTransfer', 'cardPaymentSide']) {
    assert.equal(corrected[key], old[key], key);
  }
  const again = buildImportPlan([outcome.row], repaired, 0, new Date('2026-09-19T12:00:00Z'));
  assert.equal(again.txCount, 0); assert.equal(again.batch.updates.length, 0);
  assert.equal(old.date, '2021-10-01', 'prior snapshot is immutable');
});
