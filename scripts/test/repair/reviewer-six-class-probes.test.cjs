'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const fixture = require('../fixtures/reviewer-six-class-probe12.json');
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const { parseSms } = load('@/lib/sms-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const at = Date.parse('2026-11-05T10:00:00Z');

function assertMoney(parsed, row) {
  assert.equal(parsed?.kind, 'transaction');
  assert.equal(parsed.type, row.type);
  assert.equal(parsed.amountFils, row.minorUnits);
  assert.equal(parsed.currency, row.currency);
}

// Reverting the challenge, decline, request, offer or sender guards can book
// these exact non-events; over-broad guards can erase the eight real receipts.
for (const row of fixture.cases) {
  test(`${row.id} ${row.family}: ${row.expected}`, () => {
    country.setActiveCountry(row.market);
    markets.setActiveMarket(row.market);
    markets.setLedgerCurrency(row.market === 'SA' ? 'SAR' : 'AED', 2);
    const session = createLaunchAlertSession({ overrides: {}, activeMarket: row.market,
      pinnedCurrency: row.market === 'SA' ? 'SAR' : 'AED',
      bestEffort: { enabled: true, country: row.market } });
    const core = parseSms(row.body, {}, { sender: row.sender, observedAt: at });
    const captured = session.parse(row.body, row.sender,
      session.inspect(row.body, row.sender), undefined, at);
    if (row.expected === 'refuse') {
      assert.equal(core, null, 'the direct parser must not book a non-event');
      assert.equal(captured, null, 'capture must not book a non-event');
    } else {
      assertMoney(captured, row);
      if (core) assertMoney(core, row);
    }
  });
}
