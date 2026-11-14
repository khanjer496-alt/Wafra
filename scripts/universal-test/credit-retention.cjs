'use strict';
// A held credit is acceptable only when its exact money survives as a
// non-confirmable informational item on both shipping Review paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let native;
function assertCreditRetained(load, body, { minor, currency = 'AED', country = 'AE', sender = 'EmiratesNBD', reviewOnly = false }) {
  load('@/lib/country').setActiveCountry(country);
  load('@/lib/markets').setActiveMarket(['AE', 'SA'].includes(country) ? country : 'ZZ');
  load('@/lib/markets').setLedgerCurrency(currency, 2);
  const launch = load('@/lib/launch-alert-parser');
  const at = Date.parse('2026-11-14T10:00:00Z');
  const session = launch.createLaunchAlertSession({ overrides: {}, pinnedCurrency: currency,
    regionHint: country, bestEffort: { enabled: true, country }, fxLookup: () => null });
  const inspection = session.inspect(body, sender);
  const parsed = [load('@/lib/sms-parser').parseSms(body, {}, { sender, observedAt: at }),
    ['AE', 'SA'].includes(country) ? session.parse(body, sender, inspection, country, at)
      : session.parseUnproven(body, sender, inspection, at)];
  for (const result of parsed) if (result) {
    assert.equal(reviewOnly, false, 'the original-text policy requires Review');
    assert.equal(result.kind, 'transaction');
    assert.equal(result.type, 'income');
    assert.equal(result.amountFils, minor);
    assert.equal(result.currency, currency);
  }
  if (parsed.some(result => !result)) {
    const event = launch.inspectGenericBankEventForReview(body, sender);
    assert.equal(event?.status, 'informational', 'a held credit remains visible');
    assert.equal(event.decision, 'review');
    assert.equal(event.amount.value?.currency, currency);
    assert.equal(event.amount.value?.minorUnits, String(minor));
    assert.equal(load('@/lib/alert-review-tray').isMoneyMovementReview({ kind: 'universal', event }), false);
  }
  if (!native) {
    const root = path.resolve(__dirname, '../../modules/wafra-live-capture/ios/Resources');
    const sandbox = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(root, 'WafraBackgroundParser.js'), 'utf8'), sandbox);
    native = { sandbox, meta: JSON.parse(fs.readFileSync(path.join(root, 'WafraBackgroundParser.meta.json'))) };
  }
  const result = JSON.parse(native.sandbox.wafraNativeAlertParse(JSON.stringify({ v: 1, body, sender, observedAt: at,
    context: { v: 1, country, parserMarket: ['AE', 'SA'].includes(country) ? country : 'ZZ',
      ledgerMoney: { currency, exponent: 2 }, sourceHash: native.meta.sourceHash } })));
  assert.ok(result.route === 'review' || (!reviewOnly && result.route === 'parsed'), JSON.stringify(result));
  assert.equal(result.notification?.direction, 'credit');
  assert.equal(result.notification?.amount?.minorUnits, String(minor));
  assert.equal(result.notification?.amount?.currency, currency);
}
module.exports = { assertCreditRetained };
