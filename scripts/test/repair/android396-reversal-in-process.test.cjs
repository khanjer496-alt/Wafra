'use strict';
// Android RC 396 hard gate F2 (App QA Lead, Shared/wafra-qa/android-release-2026-11-13/REPORT-396.md; synthetic corpus N06):
// "ADCB: Reversal of AED 40.00 is under process. You will be notified when the amount is refunded." posted a +40.00 Refund
// on source 49e11028. A refund or reversal that the bank says is still under process, pending, in progress, awaiting,
// under review, initiated or submitted has not arrived: no path may post it. A completed reversal still posts.
// Synthetic bodies only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const sms = load('@/lib/sms-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');

country.setActiveCountry('AE');
markets.setActiveMarket('AE');
markets.setLedgerCurrency('AED', 2);
const at = Date.parse('2026-11-05T10:00:00Z');
const session = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED',
  bestEffort: { enabled: true, country: 'AE' } });
const resources = path.resolve(__dirname, '../../../modules/wafra-live-capture/ios/Resources');
const meta = JSON.parse(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.meta.json')));
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.js'), 'utf8'), sandbox);

const shape = (p) => (p ? `${p.kind === 'transaction' ? p.type : p.kind} ${p.amountFils}` : 'none');
const paths = (body, sender = 'ADCB') => {
  const p = shape(sms.parseSms(body, {}, { sender, observedAt: at }));
  const s = shape(session.parse(body, sender, session.inspect(body, sender), undefined, at));
  const n = JSON.parse(sandbox.wafraNativeAlertParse(JSON.stringify({ v: 1, body, sender, observedAt: at,
    context: { v: 1, country: 'AE', parserMarket: 'AE', ledgerMoney: { currency: 'AED', exponent: 2 }, sourceHash: meta.sourceHash } })));
  const native = n.route === 'parsed' ? `${n.notification.direction} ${n.notification.amount?.minorUnits}` : n.route;
  return { js: `${p} / ${s}`, native };
};

test('RC 396 F2: a reversal or refund still under process never posts (EN)', () => {
  for (const body of [
    'ADCB: Reversal of AED 40.00 is under process. You will be notified when the amount is refunded.',
    'Reversal of AED 40.00 is under process.',
    'ADCB: REVERSAL OF AED 40.00 IS UNDER PROCESS. YOU WILL BE NOTIFIED WHEN THE AMOUNT IS REFUNDED.',
    'Reversal of AED 40.00 is under processing.',
    'Reversal of AED 40.00 is in process.',
    'Reversal of AED 40.00 is in progress.',
    'Reversal of AED 40.00 is pending.',
    'Reversal of AED 40.00 is awaiting processing.',
    'Reversal of AED 40.00 is under review.',
    'Reversal of AED 40.00 has been initiated.',
    'Reversal of AED 40.00 has been submitted.',
    'Reversal of AED 40.00 to your card ending 1234 is still under process.',
    'Your reversal request for AED 40.00 is under process.',
    'Refund of AED 40.00 to your card ending 1234 is under process.',
    'Your refund of AED 40.00 to your card is currently pending.',
  ]) {
    const got = paths(body);
    assert.equal(got.js, 'none / none', body);
    assert.ok(!/^credit /.test(got.native), `${body} native ${got.native}`);
  }
});

test('RC 396 F2: a reversal or refund still under process never posts (AR)', () => {
  for (const body of [
    'عكس مبلغ 40.00 درهم قيد المعالجة. سيتم إشعارك عند استرداد المبلغ.',
    'عملية استرداد مبلغ 40.00 درهم تحت الإجراء.',
    'عكس مبلغ 40.00 درهم إلى بطاقتك المنتهية بـ 1234 قيد الانتظار.',
    'استرجاع مبلغ 40.00 درهم تحت المعالجة، سيتم إشعارك عند اكتماله.',
    'طلب عكس مبلغ 40.00 درهم قيد المراجعة.',
  ]) {
    const got = paths(body);
    assert.equal(got.js, 'none / none', body);
    assert.ok(!/^credit /.test(got.native), `${body} native ${got.native}`);
  }
});

test('RC 396 F2 controls: a completed reversal or refund still posts its 40.00', () => {
  for (const body of [
    'ADCB: Reversal of AED 40.00 has been credited to your account.',
    'Reversal of AED 40.00 credited to your account ending 1234.',
    'Reversal of AED 40.00 has been processed to your card ending 1234.',
    'Reversal of AED 40.00 is completed and credited to your card.',
    'Reversal of AED 40.00 was successful. The amount is credited to your card.',
    'ADCB: Reversal of AED 40.00 has been credited. You will be notified of any further updates.',
    'Reversal of AED 40.00 has been credited to your account. Other reversal requests are under process.',
    'Refund for your pending order of AED 40.00 has been credited to your card.',
    'تم استرداد مبلغ 40.00 درهم إلى بطاقتك المنتهية بـ 1234.',
    'تم استرداد مبلغ 40.00 درهم إلى بطاقتك. طلبك الآخر قيد المراجعة.',
  ]) assert.equal(paths(body).js, 'income 4000 / income 4000', body);
});

test('RC 396 F2 controls: a refund in process as a side note beside a debit leaves the debit to post', () => {
  for (const body of [
    'AED 40.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026. The refund is being processed to your card.',
    'AED 40.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026. Your reversal is under process.',
    'AED 40.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026. If the refund is being processed to your card, you will receive an SMS.',
    // Red on 49e11028: the bare "reversal" in an unsettled note turned the debit into income.
    'AED 40.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026. Your reversal request is under process.',
    'AED 40.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026. The reversal is pending with the merchant.',
  ]) assert.equal(paths(body, 'ENBD').js, 'expense 4000 / expense 4000', body);
});
