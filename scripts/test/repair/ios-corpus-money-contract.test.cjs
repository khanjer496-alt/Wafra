'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = require('../fixtures/ios-corpus-money.json');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const { parseIosBackgroundAlert } = load('@/lib/ios-background-alert-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const root = path.resolve(__dirname, '../../..');
const resources = path.join(root, 'modules/wafra-live-capture/ios/Resources');
const metadata = JSON.parse(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.meta.json')));
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.js'), 'utf8'), sandbox);

test('frozen native money findings are exactly ten currency and five overlapping amount claims', () => {
  assert.deepEqual(fixture.cases.map(({ id }) => id),
    Array.from({ length: 10 }, (_, i) => `A${String(179 + i).padStart(4, '0')}`));
  assert.equal(fixture.cases.filter(({ legacyClasses }) => legacyClasses.includes('WRONG_CURRENCY')).length, 10);
  assert.equal(fixture.cases.filter(({ legacyClasses }) => legacyClasses.includes('WRONG_AMOUNT')).length, 5);
});

for (const row of fixture.cases) for (const sender of ['ENBD', '']) {
  test(`${row.id}/${sender || 'blank'}: source-money preview and ledger-money parse stay distinct`, () => {
    const input = { v: 1, body: row.body, sender, observedAt: Date.parse('2026-11-05T10:00:00Z'),
      context: { v: 1, country: 'AE', parserMarket: 'AE', ledgerMoney: { currency: 'AED', exponent: 2 },
        sourceHash: metadata.sourceHash } };
    const direct = JSON.parse(JSON.stringify(parseIosBackgroundAlert(input)));
    const bundled = JSON.parse(sandbox.wafraNativeAlertParse(JSON.stringify(input)));
    assert.deepEqual(bundled, direct, 'generated code must agree with shipping source');
    assert.equal(bundled.route, 'parsed');
    assert.equal(bundled.notification.style, 'movement');
    assert.equal(bundled.notification.family, 'purchase');
    assert.equal(bundled.notification.direction, 'debit');
    assert.deepEqual(bundled.notification.amount, row.expectedSource);
    assert.notDeepEqual({ currency: bundled.notification.amount.currency,
      minorUnits: bundled.notification.amount.minorUnits }, row.legacyExpected,
      'the original harness compared an ISO source preview with an AED ledger expectation');

    const session = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED',
      fxLookup: () => null, bestEffort: { enabled: false, country: 'AE' } });
    const parsed = session.parse(row.body, sender, session.inspect(row.body, sender), undefined, input.observedAt);
    assert.equal(parsed?.kind, 'transaction');
    assert.equal(parsed.type, 'expense');
    assert.equal(parsed.currency, row.expectedLedger.currency);
    assert.equal(String(parsed.amountFils), row.expectedLedger.minorUnits);
    assert.equal(parsed.fxSource, row.expectedLedger.fxSource);
    assert.equal(parsed.originalCurrency, row.expectedSource.currency);
    assert.equal(String(parsed.originalMinorUnits), row.expectedSource.minorUnits);
    assert.equal(parsed.originalExponent, row.expectedSource.exponent);
  });
}
