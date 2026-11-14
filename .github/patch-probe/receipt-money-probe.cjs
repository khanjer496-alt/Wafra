'use strict';
const fs = require('node:fs');
const path = require('node:path');
const load = require(path.resolve('scripts/universal-test/load-ts.cjs')).createLoader();
load('@/lib/country').setActiveCountry('AE');
load('@/lib/markets').setActiveMarket('AE');
load('@/lib/markets').setLedgerCurrency('AED', 2);
const rows = [
  'Your Credit Card XXX 250.00 AED purchase at NOON',
  'Your Credit Card XXX 250.00 AED purchase at NOON. Your refund request is pending.',
  'Your Credit Card XXX 250.00 AED purchase at NOON. Your charge-back request for AED 40.00 is queued.',
  'Your Credit Card XXX 250.00 AED purchase at MAY CAFE. Your refund request is pending.',
  'Purchase of AED 50.00 with Debit Card ending 1234 at MAY CAFE. Your refund request is pending.',
];
const sourceHash = JSON.parse(fs.readFileSync('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json')).sourceHash;
const report = rows.map(body => {
  const money = load('@/lib/universal-money').extractUniversalMoney(body, { sender: 'ENBD', market: 'AE' });
  return { body, sourceHash,
    money: { amount: money.amount, observations: money.observations },
    rawEvent: load('@/lib/universal-parser').inspectUniversalBankEvent(body, { sender: 'ENBD', market: 'AE' }),
    generic: load('@/lib/launch-alert-parser').inspectGenericBankEventForReview(body, 'ENBD'),
    parsed: load('@/lib/sms-parser').parseSms(body, {}, { sender: 'ENBD', observedAt: Date.parse('2026-11-14T10:00:00Z') }) };
});
fs.writeFileSync('receipt-money-probe.json', JSON.stringify(report, null, 2));
