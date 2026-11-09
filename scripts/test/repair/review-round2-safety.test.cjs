'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const { parseSms, nonPostingReason } = load('@/lib/sms-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { inspectSourceFreeRefusedAlert } = load('@/lib/auto-import');
const at = Date.parse('2026-11-05T10:00:00Z');
const root = path.resolve(__dirname, '../../..');
const resources = path.join(root, 'modules/wafra-live-capture/ios/Resources');
const meta = JSON.parse(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.meta.json')));
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.js'), 'utf8'), sandbox);

function reader(market) {
  country.setActiveCountry(market);
  markets.setActiveMarket(market);
  markets.setLedgerCurrency(market === 'SA' ? 'SAR' : 'AED', 2);
  return createLaunchAlertSession({ overrides: {}, activeMarket: market,
    pinnedCurrency: market === 'SA' ? 'SAR' : 'AED', bestEffort: { enabled: true, country: market } });
}
const refused = [];
for (const prefix of ['استخدم الرمز', 'أدخل الرمز', 'رمز']) {
  for (const code of ['482913', ': 482913', '= 482913', '٤٨٢٩١٣']) {
    refused.push(['SA', 'AlRajhiBank', `${prefix} ${code} لإتمام عملية الشراء بمبلغ 500.00 ريال`, 'security-challenge']);
  }
}
for (const prefix of ['تعذر إتمام عملية الشراء', 'تعذر تنفيذ عملية الشراء', 'تعذر إكمال عملية الشراء', 'تعذرت عملية الشراء']) {
  refused.push(['SA', 'AlRajhiBank', `${prefix} بمبلغ 37.00 ريال لدى STARBUCKS`, 'declined']);
}
for (const status of ['being processed', 'in progress', 'under review', 'under process']) {
  for (const subject of ['Your refund request', 'Your request for a refund']) {
    refused.push(['AE', 'FAB', `${subject} for AED 50.00 is ${status}`, 'pending-processing']);
  }
}
refused.push(['AE', 'FAB', 'Your refund request for AED 50.00 is being processed. The refund will be credited to your card.', 'pending-processing']);
// Exact sender/body/context from the delayed f8 review; not only the FAB variant.
refused.push(['AE', 'ENBD', 'Your refund request for AED 50.00 is being processed', 'pending-processing']);
for (const body of [
  'استمتع بخصم 20% عند الشراء بمبلغ 500.00 ريال من STARBUCKS',
  'خصم 20% على مشترياتك من STARBUCKS عند الدفع بمبلغ 500.00 ريال',
  'عزيزي العميل، استمتع بخصم ٢٠٪ عند الشراء بمبلغ ٥٠٠٫٠٠ ريال من STARBUCKS',
]) refused.push(['SA', 'AlRajhiBank', body, null]);
for (const verb of ['Authorise', 'Authorize', 'Approve', 'Confirm']) {
  refused.push(['AE', 'FAB', `${verb} AED 500.00 purchase at AMAZON with code 482913`, 'security-challenge']);
}
refused.push(['AE', 'FAB', 'FAB: Authorise AED 500.00 purchase at AMAZON with code 482913', 'security-challenge']);
refused.push(['AE', 'ENBD', 'Transferred AED 500 to you, check your account', null]);
refused.push(['AE', 'ENBD', 'ENBD: Transferred AED 500 to you, check your account', null]);
for (const number of ['+971501230000', '+971 50 123 0000', '00971501230000', '+966501230000']) {
  refused.push(['AE', 'ENBD', `AED 4,999.00 debited from your account ending 3183. Call ${number} to cancel.`, null]);
}
for (const [index, [market, named, body, reason]] of refused.entries()) {
  for (const sender of [named, '']) for (const layout of [body, `  ${body.replace(/ /g, '  ')}\n`]) {
    test(`round2 refused ${index}/${sender || 'blank'}/${layout === body ? 'original' : 'spacing'}`, () => {
      const session = reader(market);
      assert.equal(parseSms(layout, {}, { sender, observedAt: at }), null);
      assert.equal(nonPostingReason(layout), reason);
      assert.equal(session.parse(layout, sender, session.inspect(layout, sender), undefined, at), null);
      const record = JSON.stringify({ v: 1, id: '8'.repeat(64), text: layout, sender,
        receivedAt: new Date(at).toISOString() });
      assert.equal(parseHistoricalMessageRecords([record], {}, new Date(at), new Set(), session).parsed.length, 0);
      const result = JSON.parse(sandbox.wafraNativeAlertParse(JSON.stringify({ v: 1, body: layout, sender,
        observedAt: at, context: { v: 1, country: market, parserMarket: market,
          ledgerMoney: { currency: market === 'SA' ? 'SAR' : 'AED', exponent: 2 }, sourceHash: meta.sourceHash } })));
      assert.equal(result.route, 'ignore');
    });
  }
}

for (const [market, sender, body, type, amount] of [
  ['AE', 'ENBD', 'Purchase of AED 37.00 with Debit Card ending 1234 at NOON.COM. Never share your OTP or PIN with anyone.', 'expense', 3700],
  ['SA', 'AlRajhiBank', 'شراء بمبلغ 37.00 ريال بالبطاقة المنتهية 1234 لدى NOON. لا تشارك رمز التحقق مع أحد', 'expense', 3700],
  ['SA', 'AlRajhiBank', 'تم خصم 500.00 ريال من بطاقتك المنتهية 1234 لدى STARBUCKS', 'expense', 50000],
  ['SA', 'AlRajhiBank', 'تم خصم 500.00 ريال من بطاقتك المنتهية 1234 لدى STARBUCKS. استمتع بخصم 20% عند الشراء مرة أخرى', 'expense', 50000],
  ['SA', 'AlRajhiBank', 'تم خصم 37.00 ريال من بطاقتك المنتهية 1234 لدى NOON. إذا تعذر إتمام عملية الشراء اتصل بالبنك', 'expense', 3700],
  ['AE', 'FAB', 'Refund of AED 50.00 from IKEA has been credited to your card ending 1234.', 'income', 5000],
  ['AE', 'ENBD', 'Purchase of AED 37.00 with Debit Card ending 1234 at SAMPLE MARKET. If not you, call 600540000', 'expense', 3700],
  ['SA', 'AlRajhiBank', 'Purchase of SAR 37.00 with Debit Card ending 1234 at SAMPLE MARKET. If not you, call 920000000', 'expense', 3700],
  ['AE', 'ENBD', 'Purchase of AED 37.00 with Debit Card ending 1234 at SAMPLE MARKET. Merchant phone: +971501230000.', 'expense', 3700],
  ['AE', 'ENBD', 'Purchase of AED 37.00 with Debit Card ending 1234 at SAMPLE MARKET. Never call +971501230000 to cancel.', 'expense', 3700],
  ['AE', 'ENBD', 'AED 500.00 has been transferred to your account ending 1234.', 'income', 50000],
  ['AE', 'ENBD', 'AED 500.00 has been transferred from your account ending 1234.', 'expense', 50000],
]) test(`round2 recall control: ${body}`, () => {
  const session = reader(market);
  const parsed = session.parse(body, sender, session.inspect(body, sender), undefined, at);
  assert.equal(parsed?.kind, 'transaction');
  assert.equal(parsed.type, type);
  assert.equal(parsed.amountFils, amount);
  assert.equal(parsed.currency, market === 'SA' ? 'SAR' : 'AED');
});

test('a mobile callback holds exact debit money for Review without declaring it imaginary', () => {
  const source = 'AED 4,999.00 debited from your account ending 3183. Call +971501230000 to cancel.';
  const session = reader('AE');
  assert.equal(nonPostingReason(source), null, 'a callback is not evidence for deleting a stored debit');
  const held = inspectSourceFreeRefusedAlert({ source, sender: 'ENBD', observedAt: at, channel: 'inbox', session });
  assert.equal(held.kind, 'review');
  const money = held.candidate?.event?.amount.value ?? held.candidate?.amount;
  assert.deepEqual(JSON.parse(JSON.stringify(money)), { currency: 'AED', minorUnits: '499900', exponent: 2 });
});

for (const [body, type, amount] of [
  ['Purchase of AED 100.00 with Credit Card ending 1234 at NOON.COM. خصم 20% على مشترياتك القادمة', 'expense', 10000],
  ['Your refund request has been received. Refund of AED 50.00 from IKEA has been credited to your card ending 1234.', 'income', 5000],
]) test(`a separate offer or request acknowledgement cannot erase a posted principal: ${body}`, () => {
  const session = reader('AE');
  for (const parsed of [parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
    session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
    assert.equal(parsed?.kind, 'transaction');
    assert.equal(parsed.type, type);
    assert.equal(parsed.amountFils, amount);
    assert.equal(parsed.currency, 'AED');
  }
});
