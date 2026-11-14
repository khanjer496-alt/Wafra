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
    // Red on 49e11028 too: a pending reversal sentence with its own amount beside a purchase turned the purchase into income.
    'Purchase of AED 40.00 at NOON with card 1234. Reversal of AED 40.00 is under process.',
    'Purchase of AED 40.00 at NOON. Reversal of AED 40.00 has been initiated.',
  ]) assert.equal(paths(body, 'ENBD').js, 'expense 4000 / expense 4000', body);
});

// #249 review round 1 (Change Reviewer ad205bc6 High/Medium/Low, Reviewer 85a61c6d Medium/Low at 0f2fe7c0; probed again
// at fe26426a). Telegraphic and other in-process statuses, a "reversal fee" debit, and the completed controls that a
// ";"/"،" or a debit-first clause must not lose.
test('RC 396 F2 round 1: telegraphic and further in-process statuses never post', () => {
  for (const body of [
    'Reversal of AED 40.00 under process.',
    'Reversal of AED 40.00 - in progress.',
    'Reversal of AED 40.00: pending.',
    'Reversal of AED 40.00 is in-process.',
    'Reversal AED 40.00 - Status: Under Process',
    'Reversal of AED 40.00: in process',
    'Reversal of AED 40.00 is in queue and will be completed shortly.',
    'Reversal of AED 40.00 is being initiated.',
    'Reversal of AED 40.00 has been raised.',
    'Reversal for AED 40.00 has been requested.',
    'Reversal of AED 40.00 has been lodged.',
    'Reversal for AED 40.00 initiated. It will reflect in 5 days.',
    'Refund of AED 40.00 is awaited.',
    'استرداد مبلغ 40.00 درهم جاري المعالجة',
    'استرجاع مبلغ 40.00 درهم قيد الدراسة',
  ]) {
    const got = paths(body);
    assert.equal(got.js, 'none / none', body);
    assert.ok(!/^credit /.test(got.native), `${body} native ${got.native}`);
  }
});

test('RC 396 F2 round 1: a debit beside an in-process reversal, or for a reversal fee, stays an expense', () => {
  for (const body of [
    'AED 40.00 was debited from your card ending 1234 at NOON. Reversal: under process.',
    'AED 40.00 was debited from your card ending 1234 for a reversal fee. Your reversal request is under process.',
    'AED 40.00 was debited from your card ending 1234 for a reversal fee.',
    'AED 40.00 was debited from your card ending 1234 at NOON, refund of your previous order is pending.',
    'AED 40.00 was debited from your card ending 1234 at NOON. Reversal of AED 40.00 is under process.',
    'AED 40.00 was debited from your card ending 1234 at NOON; reversal is in process.',
  ]) assert.equal(paths(body, 'ENBD').js, 'expense 4000 / expense 4000', body);
});

test('RC 396 F2 round 1 controls: a completed credit beside a pending one, or after a pending past, keeps its 40.00', () => {
  for (const body of [
    'تم استرداد مبلغ 40.00 درهم إلى بطاقتك المنتهية بـ 1234، وطلبك الآخر قيد المعالجة',
    'Reversal of AED 40.00 processed to your card ending 1234; the other reversal is pending.',
    'Reversal of AED 40.00 has been credited to your account. Your other reversal is under process.',
    'Your refund of AED 40.00, which was pending since 10/11, has now been credited to your card.',
    'Refund of AED 40.00 has been initiated and credited to your card ending 1234.',
    'Refund for your pending order of AED 40.00 has been credited to your card.',
    'Refund of AED 40.00 has been credited to your card ending 1234; your other refund is pending.',
    'Reversal of AED 40.00 which was under process has been credited to your card ending 1234.',
    'Reversal of AED 40.00 has been credited to your card ending 1234 as requested.',
    // Review round 2 (Reviewer 1fce73a5 Low 1, EN): a telegraphic credit before the other reversal's status.
    'Reversal of AED 40.00 credited to your card ending 1234, your other reversal is under process.',
    'Refund of AED 40.00 credited to your card ending 1234, your other refund is pending.',
  ]) assert.equal(paths(body).js, 'income 4000 / income 4000', body);
  // …but a telegraphic credit after the status, or under a modal or a condition, is not a completed one.
  for (const body of [
    'Reversal of AED 40.00 is pending, amount credited to your card upon approval.',
    'Reversal of AED 40.00 is under process; once credited to your card you will be notified.',
    'Reversal of AED 40.00 is under process and will be credited to your card.',
    'Reversal of AED 40.00, which was requested on 10/11, is under process.',
  ]) assert.equal(paths(body).js, 'none / none', body);
});

// #249 review round 3 (Change Reviewer a3da9de8 Medium/Low, Reviewer 696b9c8f Medium/Info, at 2da4fa7a; probed at 8cca7923).
test('RC 396 F2 round 3: a status right after the noun, an amount-first refund, and "; status:" never post', () => {
  for (const body of [
    'AED 40.00 refund is under process.',
    'AED 40.00 reversal is pending.',
    'Reversal of AED 40.00; status: under process',
  ]) {
    const got = paths(body);
    assert.equal(got.js, 'none / none', body);
    assert.ok(!/^credit /.test(got.native), `${body} native ${got.native}`);
  }
  assert.equal(paths('AED 40.00 was debited from your card ending 1234 at NOON - reversal pending.', 'ENBD').js,
    'expense 4000 / expense 4000');
});

test('RC 396 F2 round 3 controls: a telegraphic "processed to your card" before an unrelated status keeps its 40.00', () => {
  for (const body of [
    'Reversal of AED 40.00 processed to your card ending 1234 - in progress orders are not affected.',
    'AED 40.00 refund has been credited to your card ending 1234.',
    'Refund of AED 40.00 has been credited to your card ending 1234. For refunds pending over 7 days, call us.',
  ]) assert.equal(paths(body).js, 'income 4000 / income 4000', body);
});
