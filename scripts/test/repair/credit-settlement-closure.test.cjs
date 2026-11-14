'use strict';
// Store-gate F1–F4 and the independent sweep: synthetic messages only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const load = require('../../universal-test/load-ts.cjs').createLoader();
load('@/lib/country').setActiveCountry('AE');
load('@/lib/markets').setActiveMarket('AE');
load('@/lib/markets').setLedgerCurrency('AED', 2);
const sms = load('@/lib/sms-parser');
const session = load('@/lib/launch-alert-parser').createLaunchAlertSession({ overrides: {}, activeMarket: 'AE',
  pinnedCurrency: 'AED', bestEffort: { enabled: true, country: 'AE' } });
const at = Date.parse('2026-11-14T10:00:00Z');
const resources = path.resolve(__dirname, '../../../modules/wafra-live-capture/ios/Resources');
const meta = JSON.parse(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.meta.json')));
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.js'), 'utf8'), sandbox);
function paths(body, sender = 'ENBD', market = 'AE', currency = 'AED') {
  load('@/lib/country').setActiveCountry(market);
  load('@/lib/markets').setActiveMarket(market);
  load('@/lib/markets').setLedgerCurrency(currency, 2);
  const selected = market === 'AE' ? session : load('@/lib/launch-alert-parser').createLaunchAlertSession({ overrides: {}, activeMarket: market, pinnedCurrency: currency, bestEffort: { enabled: true, country: market } });
  const shape = p => p ? `${p.kind === 'transaction' ? p.type : p.kind}:${p.amountFils}` : 'none';
  const native = JSON.parse(sandbox.wafraNativeAlertParse(JSON.stringify({ v: 1, body, sender, observedAt: at,
    context: { v: 1, country: market, parserMarket: market, ledgerMoney: { currency, exponent: 2 }, sourceHash: meta.sourceHash } })));
  return { sms: shape(sms.parseSms(body, {}, { sender, observedAt: at })),
    session: shape(selected.parse(body, sender, selected.inspect(body, sender), undefined, at)),
    native: native.route === 'parsed' ? `${native.notification.direction}:${native.notification.amount?.minorUnits}` : native.route };
}
const EN = 'AED 250.00 has been refunded to your card ending 1234';
const AR = 'تم استرداد مبلغ AED 250.00 إلى بطاقتك المنتهية 1234';
const NO_POST = [
  ...['If approved,', 'Unless verified,', 'Until cleared:', 'Whether approved,',
    'Subject to merchant approval:', 'Upon approval:', 'Provided that the bank approves,',
    'If the merchant approves,\n'].map(lead => `${lead} ${EN}.`),
  ...['only if the merchant approves', 'if our acquiring bank verifies the transaction',
    'when the issuer clears the funds', 'upon successful verification', 'subject to final merchant approval',
    'upon receipt of funds', 'only after approval', 'only after the bank verifies the payment'].map(tail => `${EN} ${tail}.`),
  ...['If approved,', 'Subject to merchant approval:'].map(lead => `${lead} ${EN.toUpperCase()}.`),
  ...['إن وافق التاجر،', 'إذا وافق البنك،', 'في حال وافق التاجر،', 'عند موافقة التاجر،',
    'بشرط موافقة التاجر:', 'شريطة التحقق:', 'بعد موافقة البنك:'].map(lead => `${lead} ${AR}.`),
  ...['في انتظار الموافقة', 'بانتظار التسوية', 'قيد التسوية', 'جارٍ التحقق', 'رهن الموافقة',
    'مرهون بالموافقة', 'شريطة موافقة التاجر', 'إذا وافق التاجر'].map(tail => `${AR} ${tail}.`),
  ...['subject to approval', 'under review', 'queued', 'provisional', 'pending', 'awaiting verification'].map(status =>
    `Refund of AED 250.00 to your card is ${status}.`),
  'Refund of AED 250.00 to your card.',
  'استرداد مبلغ AED 250.00 إلى بطاقتك في انتظار التسوية.',
  'استرداد مبلغ ٢٥٠.٠٠ درهم إلى بطاقتك في انتظار التسوية.',
  'تم استرداد مبلغ 250.00 درهم إلى بطاقتك رهن الموافقة.',
  'تم استرداد مبلغ ٢٥٠.٠٠ درهم إلى بطاقتك في انتظار الموافقة.',
];
const DEBIT = 'AED 250.00 was debited from your card ending 1234 at NOON.COM.';
const KEEP_DEBIT = ['reversal', 'refund', 'chargeback'].flatMap(noun =>
  ['is queued', 'is queuing', 'is in queue', 'is pending', 'pending', 'awaiting approval', 'is scheduled', 'has been accepted', ''].map(status =>
    `${DEBIT} Your ${noun} request ${status}.`));
const KEEP_CREDIT = [
  `${EN}.`, `${AR}.`,
  'After verification, the refund of AED 250.00 has been credited to your card.',
  'Once your order was cancelled AED 250.00 was refunded to your card ending 1234.',
  'After cancellation AED 250.00 has been refunded to your card ending 1234.',
  'Refund of AED 250.00 has now been credited to your card after your request was approved.',
  `${EN}, if the transaction has been authorised by you please ignore this message.`,
  `${EN}; your replacement card will be dispatched once approved.`,
  `${AR}. طلبك الآخر قيد المراجعة.`,
];
for (const body of NO_POST) test(`no automatic posting: ${body}`, () => {
  const got = paths(body);
  assert.equal(got.sms, 'none', `parseSms: ${JSON.stringify(got)}`);
  assert.equal(got.session, 'none', `session: ${JSON.stringify(got)}`);
  if (!process.env.SOURCE_ONLY) assert.ok(!/^(?:credit|debit):/.test(got.native), `native: ${JSON.stringify(got)}`);
});
for (const body of KEEP_DEBIT) test(`request never reverses a debit: ${body}`, () => {
  const got = paths(body);
  assert.equal(got.sms, 'expense:25000', JSON.stringify(got));
  assert.equal(got.session, 'expense:25000', JSON.stringify(got));
  if (!process.env.SOURCE_ONLY) assert.ok(!/^credit:/.test(got.native), JSON.stringify(got));
});
for (const body of KEEP_CREDIT) test(`settled credit preserved: ${body}`, () => {
  const got = paths(body);
  assert.equal(got.sms, 'income:25000', JSON.stringify(got));
  assert.equal(got.session, 'income:25000', JSON.stringify(got));
});
for (const row of require('./credit-settlement-sweep.json')) test(`${row.id} ${row.class}: ${row.requirement}`, () => {
  const got = paths(row.body, row.sender, row.market, row.currency);
  const expected = row.expected === 'none' ? 'none' : `${row.expected}:25000`;
  assert.equal(got.sms, expected, `${row.body} parseSms ${JSON.stringify(got)}`);
  assert.equal(got.session, row.sessionExpected === 'none' ? 'none' : `${row.sessionExpected}:25000`, `${row.body} session ${JSON.stringify(got)}`);
  if (!process.env.SOURCE_ONLY) {
    if (row.nativeExpected === 'no-post') assert.ok(!/^(?:credit|debit):/.test(got.native), `${row.body} ${JSON.stringify(got)}`);
    else if (row.nativeExpected === 'no-credit') assert.ok(!/^credit:/.test(got.native), `${row.body} ${JSON.stringify(got)}`);
    else assert.equal(got.native, `${row.nativeExpected}:25000`, row.body);
  }
});
