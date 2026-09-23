'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const build = path.resolve(__dirname, '../build');
const markets = require(path.join(build, 'markets.js'));
const historical = load(path.resolve(__dirname, '../../../src/lib/historical-import.ts'), {
  '@/lib/format': require(path.join(build, 'format.js')),
  '@/lib/auto-import': require(path.join(build, 'auto-import.js')),
  '@/lib/alert-review-tray': require(path.join(build, 'alert-review-tray.js')),
  '@/lib/launch-alert-parser': require(path.join(build, 'launch-alert-parser.js')),
  '@/lib/markets': markets,
  '@/lib/alert-institution-grammars': require(path.join(build, 'alert-institution-grammars.js')),
  '@/lib/transfer-evidence': require(path.join(build, 'transfer-evidence.js')),
});
const history = load(path.resolve(__dirname, '../../../src/lib/ios-history-import.ts'), {
  '@/lib/alert-review-tray': require(path.join(build, 'alert-review-tray.js')),
  '@/lib/launch-alert-parser': require(path.join(build, 'launch-alert-parser.js')),
  '@/lib/historical-import': historical,
});
const { buildImportPlan } = require(path.join(build, 'import-plan.js'));
const { materializeImportBatch, applyMaterializedImportBatch } = require(path.join(build, 'ledger-import.js'));
const now = new Date('2026-09-19T12:00:00.000Z');
const observedAt = '2021-01-10T10:30:00.000Z';
const id = 'a'.repeat(64);
const text = 'Dear Customer, your payment of AED 42.10 on 01/10/2021 for card ending with **1234 has been credited. Thank you.';
const record = patch => JSON.stringify({ v: 1, id, text, receivedAt: observedAt, ...patch });
function reset() { markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2); }

test('actual Shortcut history path uses original received time when sender is unavailable', () => {
  reset();
  const result = historical.parseHistoricalMessageRecords([record()], {}, now);
  assert.equal(result.acceptedCount, 1);
  assert.equal(result.parsed[0].date, '2021-01-10');
  assert.equal(result.parsed[0].dateRepairFrom, '2021-10-01');
  assert.equal(result.parsed[0].smsTs, Date.parse(observedAt));
  assert.equal(result.parsed[0].raw, undefined);
  assert.equal(result.parsed[0].sender, undefined);
  const unproven = historical.parseHistoricalMessageRecords([record({ receivedAt: '2021-01-11T10:30:00.000Z' })], {}, now);
  assert.equal(unproven.parsed[0].date, '2021-10-01');
  assert.equal(unproven.parsed[0].dateRepairFrom, undefined);
});

test('completed paged history repairs an exact saved receipt and replay adds no money', async () => {
  reset();
  const native = { async purgeExpired() {}, async getCompletedSession() {
    return { paged: true, chunkIndices: [0], found: 1, attempted: 1, accepted: 1, skipped: 0 };
  }, async readChunk() { return [record()]; }, async discardSession() { throw Error('load cannot discard a valid source'); } };
  const result = await history.loadIosHistorySession({ sessionId: 'PAGED-11111111-1111-4111-8111-111111111111', native, overrides: {}, now });
  assert.equal(result.parsed[0].date, '2021-01-10');
  const old = { id: 'receipt', source: 'sms', smsKey: 'h' + id, ts: Date.parse(observedAt), date: '2021-10-01',
    type: 'income', amountFils: 4210, title: 'Card •1234 payment', accountId: 'card', category: 'other', isTransfer: true,
    cardPaymentSide: 'receipt', captureInstrument: { last4: '1234', kind: 'credit' } };
  const state = { hydrated: true, accounts: [{ id: 'card', name: 'Credit Card', kind: 'card', cardType: 'credit', last4: '1234', openingFils: 0 }],
    transactions: [old], budgets: [], bills: [], goals: [], cardDues: [], accountHints: {}, merchantOverrides: {}, billAliases: {},
    lastScanTs: 0, parserVersion: 49, ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } };
  const plan = buildImportPlan(result.parsed, state, 0, now);
  assert.equal(plan.txCount, 0);
  assert.equal(plan.healedCount, 1);
  const repaired = applyMaterializedImportBatch(state, materializeImportBatch(plan.batch, state, () => { throw Error('no new rows'); }));
  assert.deepEqual(repaired.transactions, [{ ...old, date: '2021-01-10' }]);
  const replay = buildImportPlan(result.parsed, repaired, 0, now);
  assert.equal(replay.txCount, 0);
  assert.equal(replay.healedCount, 0);
});

test('history retains the parsed Saudi issuer when device market starts in UAE', () => {
  markets.setActiveMarket('AE'); markets.setLedgerCurrency(null);
  try {
    const result = historical.parseHistoricalMessageRecords([record({ sender: 'SNB',
      text: 'POS purchase of SAR 125.50 at JARIR BOOKSTORE using Mada Card ending 1234. Available balance SAR 2,500.00.' })], {}, now);
    assert.equal(result.acceptedCount, 1);
    assert.equal(result.parsed[0].bankHint, 'SNB AlAhli');
    assert.equal(result.parsed[0].market, 'SA');
    assert.equal(markets.getActiveMarket().id, 'AE', 'parsing must not change user preferences');
  } finally { reset(); }
});
