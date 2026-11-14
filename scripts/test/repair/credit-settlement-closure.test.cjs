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
  const event = load('@/lib/launch-alert-parser').inspectGenericBankEventForReview(body, sender);
  const parsed = sms.parseSms(body, {}, { sender, observedAt: at });
  return { merchant: parsed?.merchant ?? null, review: event ? { status: event.status, decision: event.decision, family: event.family, role: event.observations.find(o => o.field.spans.some(s => event.amount.spans.some(a => a.start === s.start && a.end === s.end)))?.role, confirmable: load('@/lib/alert-review-tray').isMoneyMovementReview({ kind: 'universal', event }) } : null, nativeRoute: native.route, sms: shape(sms.parseSms(body, {}, { sender, observedAt: at })),
    session: shape(selected.parse(body, sender, selected.inspect(body, sender), undefined, at)),
    native: native.route === 'parsed' ? `${native.notification.direction}:${native.notification.amount?.minorUnits}` : native.route };
}
const EN = 'AED 250.00 has been refunded to your card ending 1234';
const AR = 'تم استرداد مبلغ AED 250.00 إلى بطاقتك المنتهية 1234';
const NO_POST = [
  'AED 250.00 was debited from your card ending 1234 at NOON.COM. Your refund request is pending click https://bank-confirm.example/verify to confirm your account.',
  'Your refund request for AED 250.00 was successful.',
  'Your reversal request for AED 250.00 was successful.',
  `IF your claim succeeds, ${EN}.`,
  `Subject to approval by the senior operations team of the acquiring merchant bank and the independent verification and settlement department: ${EN}.`,
  `إن وافق التاجر\n${AR}.`,
  `بشرط موافقة التاجر\n${AR}.`,
  ...['If approved,', 'Unless verified,', 'Until cleared:', 'Whether approved,',
    'Subject to merchant approval:', 'Upon approval:', 'Provided that the bank approves,',
    'If the merchant approves,\n'].map(lead => `${lead} ${EN}.`),
  ...['only if the senior operations team of the acquiring merchant bank and the independent payment verification and settlement department approves', 'only if the merchant approves', 'if our acquiring bank verifies the transaction',
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
  assert.ok(!/^(?:credit|debit):/.test(got.native), `native: ${JSON.stringify(got)}`);
});
for (const body of KEEP_DEBIT) test(`request never reverses a debit: ${body}`, () => {
  const got = paths(body);
  assert.equal(got.sms, 'expense:25000', JSON.stringify(got));
  assert.equal(got.session, 'expense:25000', JSON.stringify(got));
  assert.equal(got.native, 'debit:25000', JSON.stringify(got));
});
for (const body of KEEP_CREDIT) test(`settled credit preserved: ${body}`, () => {
  const got = paths(body);
  const retained = got.sms === 'none' && got.session === 'none' && got.review?.status === 'informational' && !got.review.confirmable && got.nativeRoute === 'review';
  assert.ok(retained || (got.sms === 'income:25000' && got.session === 'income:25000'), JSON.stringify(got));
  if (body === `${EN}.` || body === `${AR}.`) assert.equal(got.native, 'credit:25000', JSON.stringify(got));
});
for (const row of require('./credit-settlement-sweep.json')) test(`${row.id} ${row.class}: ${row.requirement}`, () => {
  const got = paths(row.body, row.sender, row.market, row.currency);
  const expected = row.expected === 'none' ? 'none' : `${row.expected}:25000`;
  const retained = row.expected === 'income' && got.sms === 'none' && got.session === 'none' && got.review?.status === 'informational' && !got.review.confirmable && got.nativeRoute === 'review';
  if (retained) return; // CEO 524bd56e: genuine credits may be held, never silently lost.
  assert.equal(got.sms, expected, `${row.body} parseSms ${JSON.stringify(got)}`);
  assert.equal(got.session, row.sessionExpected === 'none' ? 'none' : `${row.sessionExpected}:25000`, `${row.body} session ${JSON.stringify(got)}`);
  if (row.nativeExpected === 'no-post') assert.ok(!/^(?:credit|debit):/.test(got.native), `${row.body} ${JSON.stringify(got)}`);
  if (row.expected === 'none') {
    assert.equal(got.review?.decision, 'review', `${row.id} app Review ${JSON.stringify(got)}`);
    assert.equal(got.review?.status, 'informational', `${row.id} non-confirmable ${JSON.stringify(got)}`);
    assert.equal(got.review?.confirmable, false, row.id);
    assert.equal(got.review?.role, 'transaction', row.id);
    assert.equal(got.nativeRoute, 'review', `${row.id} native Review ${JSON.stringify(got)}`);
  }
  if (row.requireDebitParity) assert.equal(got.native, 'debit:25000', JSON.stringify(got));
  if (row.nativeExpected === 'no-credit') assert.ok(!/^credit:/.test(got.native), `${row.body} ${JSON.stringify(got)}`);
  else if (row.nativeExpected !== 'no-post') assert.equal(got.native, `${row.nativeExpected}:25000`, row.body);
});

for (const row of require('./credit-settlement-review-probes.json')) test(`${row.id}: reviewer probe`, () => {
  const got = paths(row.body, row.sender);
  if (row.id === 'reviewer-focused:S5' && got.sms !== 'none') assert.equal(got.merchant, 'أمازون', row.body);
  const target = row.expected === 'none' ? 'none' : `${row.expected}:${row.minorUnits}`;
  const informational = got.review?.decision === 'review' && got.review.status === 'informational' && !got.review.confirmable;
  const retained = informational && got.nativeRoute === 'review';
  const acceptedReview = (row.expected === 'income' || row.acceptInformationalReview) && got.sms === 'none' && got.session === 'none' && retained;
  assert.ok(acceptedReview || got.sms === target, `${row.body} parseSms ${JSON.stringify(got)}`);
  assert.ok(acceptedReview || got.session === target, `${row.body} session ${JSON.stringify(got)}`);
  if (row.expected === 'none' && row.requireReview) {
    assert.ok(retained, `${row.body} must be retained as informational Review on app/native ${JSON.stringify(got)}`);
    assert.equal(got.review.role, 'transaction', row.body);
  }
  if (row.expected === 'expense') assert.ok(!/^credit:/.test(got.native), JSON.stringify(got));
  if (row.requireDebitParity) assert.equal(got.native, `debit:${row.minorUnits}`, JSON.stringify(got));
});
test('O1: pending N06 refund is informational and cannot be confirmed into the ledger', () => {
  const got = paths('ADCB: Reversal of AED 40.00 is under process. You will be notified when the amount is refunded.', 'ADCB');
  assert.equal(got.sms, 'none');assert.equal(got.session, 'none');
  assert.equal(got.review?.status, 'informational');assert.equal(got.review?.decision, 'review');assert.equal(got.review?.role, 'transaction');
  assert.equal(got.review?.confirmable, false);assert.equal(got.nativeRoute, 'review');
  const event = load('@/lib/launch-alert-parser').inspectGenericBankEventForReview('ADCB: Reversal of AED 40.00 is under process. You will be notified when the amount is refunded.', 'ADCB');
  assert.deepEqual(load('@/lib/universal-import').planConfirmedUniversalImport({ hydrated: true }, event, { confirmed: true, postingStatus: 'posted' }), { outcome: 'refused', reason: 'not-posted' });
});

test('a pending request cannot turn a quoted previous refund into current income', () => {
  const got = paths('Your refund request for AED 100.00 has been received. A previous refund of AED 20.00 from NOON.COM has been credited to your card.');
  assert.equal(got.sms, 'none');assert.equal(got.session, 'none');assert.ok(!/^credit:/.test(got.native));
});

test('the shared existing Arabic veto also makes Review informational after normalization', () => {
  const got = paths('نود اعلامك، ان تم استرداد مبلغ AED 250.00 إلى بطاقتك. فِيرجى تجاهل هذه الرسالة.');
  assert.equal(got.sms, 'none');assert.equal(got.session, 'none');
  assert.equal(got.review?.status, 'informational');assert.equal(got.review?.confirmable, false);assert.equal(got.nativeRoute, 'review');
});

test('a completed continuation cannot release an explicit condition inside the prior-state clause', () => {
  const body = 'Reversal of AED 250.00 which was under process if approved has been credited to your card ending 1234.';
  assert.equal(load('@/lib/credit-settlement-guards').creditSourceDisposition(body), 'review');
  const got = paths(body);assert.equal(got.sms, 'none');assert.equal(got.session, 'none');assert.equal(got.review?.status, 'informational');assert.equal(got.nativeRoute, 'review');
});
