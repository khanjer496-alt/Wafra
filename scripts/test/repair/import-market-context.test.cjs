'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const load = require('./load-typescript.cjs');
const build = path.resolve(__dirname, '../build');
const markets = require(path.join(build, 'markets.js'));
const file = path.resolve(__dirname, '../../../src/lib/import-plan.ts');
const deps = {};
for (const match of fs.readFileSync(file, 'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)) {
  deps[match[1]] = require(path.join(build, match[1].slice(6) + '.js'));
}
const { buildImportPlan } = load(file, deps);
const { createLaunchAlertSession } = require(path.join(build, 'launch-alert-parser.js'));
const blank = { hydrated: true, accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: {}, merchantOverrides: {}, lastScanTs: 0, parserVersion: 0 };

test('planning uses proven import currency for issuer resolution without changing device market', () => {
  for (const [device, issuerMarket, sender, bank, currency] of [
    ['AE', 'SA', 'SNB', 'SNB AlAhli', 'SAR'], ['SA', 'AE', 'ENBD', 'Emirates NBD', 'AED'],
  ]) {
    markets.setActiveMarket(device); markets.setLedgerCurrency(null);
    const session = createLaunchAlertSession({ overrides: {} });
    const text = `Purchase of ${currency} 42.10 with Debit Card ending 1234 at CARREFOUR. Available balance ${currency} 100.00.`;
    const parsed = session.parse(text, sender, session.inspect(text, sender));
    assert.ok(parsed);
    const { raw: _raw, ...structured } = parsed;
    const row = { ...structured, bankHint: bank, market: issuerMarket, smsTs: Date.parse('2026-09-18T10:00:00Z'), sourceEventId: 'a'.repeat(64) };
    const result = buildImportPlan([row], blank, 0, new Date('2026-09-19'));
    assert.equal(result.batch.newAccounts[0].bankName, bank);
    assert.equal(result.batch.transactions[0].captureInstrument.bankIdentity, markets.bankIdentityForName(bank));
    assert.equal(result.batch.snapshots['0'].fils, 10000);
    assert.equal(result.batch.importMoney.currency, currency);
    assert.equal(markets.getActiveMarket().id, device);
    assert.equal(markets.pinnedLedgerCurrencyCode(), null);
  }
  markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
});

test('a currency conflict still rejects atomically and restores market context', () => {
  markets.setActiveMarket('AE'); markets.setLedgerCurrency(null);
  const session = createLaunchAlertSession({ overrides: {} });
  const parsed = session.parse('Purchase of SAR 42.10 with Debit Card ending 1234 at CARREFOUR.', 'SNB');
  assert.ok(parsed);
  const state = { ...blank, ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } };
  assert.throws(() => buildImportPlan([parsed], state, 0), /currency|money/i);
  assert.equal(markets.getActiveMarket().id, 'AE');
  assert.equal(state.transactions.length, 0);
  markets.setLedgerCurrency('AED', 2);
});
