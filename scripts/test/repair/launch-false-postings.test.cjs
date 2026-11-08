'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const { createLaunchAlertSession, inspectGenericBankEventForReview } = load('@/lib/launch-alert-parser');
const { parseSms, nonPostingReason } = load('@/lib/sms-parser');
const at = Date.parse('2026-11-05T10:00:00Z');
function session(market, enabled = true) {
  country.setActiveCountry(market);
  markets.setActiveMarket(market);
  markets.setLedgerCurrency(market === 'SA' ? 'SAR' : 'AED', 2);
  return createLaunchAlertSession({ overrides: {}, activeMarket: market,
    pinnedCurrency: market === 'SA' ? 'SAR' : 'AED', bestEffort: { enabled, country: market } });
}
// All messages in this suite are invented. A money figure does not turn a
// challenge, request, offer or conversation into a completed bank movement.
const refused = [
  ['AE', 'FAB', 'Use code 424679 to authorise your card transaction of AED 37.00 at TALABAT on card ending 2517.', 'security-challenge'],
  ['AE', 'ENBD', 'رمز التحقق 432598 لعملية شراء بمبلغ 37.00 درهم لدى NOON.COM. لا تشاركه مع أحد.', 'security-challenge'],
  ['AE', 'FAB', 'تم رفض العملية بمبلغ 37.00 درهم لدى STARBUCKS على البطاقة المنتهية بـ 2665.', 'declined'],
  ['AE', 'FAB', 'We have received your refund request of AED 50.00 for IKEA.', 'pending-processing'],
  ['SA', 'AlRajhiBank', 'احصل على استرداد نقدي 200.00 ريال عند الشراء من STARBUCKS هذا الشهر. تطبق الشروط والأحكام'],
  ['AE', 'ENBD', 'Paid AED 85 for lunch'],
  ['AE', 'ENBD', 'Spent AED 120 on groceries today lol'],
  ['AE', 'ENBD', 'They charged me AED 45 for parking!'],
  ['AE', 'ENBD', 'Received AED 500 from you thanks'],
  ['AE', 'Mum', 'Paid AED 200.00 for the taxi, remind me to send it'],
];
const phishing = 'AED 4,999.00 debited from your account ending 3183. If not you, click http://bit.ly/abc123 immediately.';
for (const sender of ['ENBD', 'ENBD-ALERT', '+971501230000']) refused.push(['AE', sender, phishing]);
const variants = body => [body, body.toUpperCase(), `  ${body.replace(/ /g, '  ')}\n`, `Dear Customer, ${body}`];
for (const [i, [market, named, body, reason]] of refused.entries()) {
  for (const [v, source] of variants(body).entries()) {
    if (reason) test(`core non-posting classifier ${i}/${v}`, () => {
      session(market);
      assert.equal(nonPostingReason(source), reason);
      assert.equal(parseSms(source, {}, { sender: named }), null);
    });
    for (const sender of [named, '']) {
      for (const enabled of [true, false]) test(`live capture refuses ${i}/${v}/${sender || 'blank'}/${enabled}`, () => {
        const reader = session(market, enabled);
        const inspection = reader.inspect(source, sender);
        assert.equal(reader.parse(source, sender, inspection, undefined, at), null);
        assert.equal(reader.parseUnproven(source, sender, inspection, at), null);
      });
    }
  }
}
for (const market of ['AE', 'SA']) {
  const currency = market === 'SA' ? 'SAR' : 'AED';
  for (const body of [
    `Purchase of ${currency} 37.00 with Debit Card ending 1234 at SAMPLE MARKET. Avl Bal ${currency} 500.00`,
    `${currency} 37.00 has been credited to your account ending 1234. Avl Bal ${currency} 500.00`,
  ]) {
    for (const sender of ['+971501230000', 'someone@example.test', 'INFO']) test(`unregistered ${market} sender ${sender} retains Review`, () => {
      const reader = session(market);
      assert.equal(reader.parse(body, sender, reader.inspect(body, sender), undefined, at), null);
      assert.equal(reader.parseUnproven(body, sender, reader.inspect(body, sender), at), null);
      const review = inspectGenericBankEventForReview(body, sender);
      assert.equal(review?.decision, 'review');
      assert.equal(review.amount.value?.currency, currency);
      assert.equal(review.amount.value?.minorUnits, '3700');
      assert.equal(review.direction, body.startsWith('Purchase') ? 'debit' : 'credit');
    });
    test(`completed ${market} movement remains automatic for bank and blank senders`, () => {
      for (const sender of [market === 'AE' ? 'ENBD' : 'AlRajhiBank', '', 'Wafra Automation', 'Wafra Notification']) {
        const reader = session(market);
        const result = reader.parse(body, sender, reader.inspect(body, sender), undefined, at);
        assert.equal(result?.kind, 'transaction');
        assert.equal(result.amountFils, 3700);
        assert.equal(result.currency, currency);
        assert.equal(result.type, body.startsWith('Purchase') ? 'expense' : 'income');
      }
    });
  }
}
for (const sender of ['Wafra Automation', 'Wafra Notification']) test(`${sender} is an absent sender, not a bank attestation`, () => {
  const reader = session('AE');
  const body = 'AED 500.00 has been credited to your account. Avl Bal AED 900.00.';
  assert.equal(reader.parse(body, sender, reader.inspect(body, sender), undefined, at), null);
});
for (const [body, type, amount] of [
  ['Refund of AED 50.00 from IKEA has been credited to your card ending 1234.', 'income', 5000],
  ['Cashback of AED 25.00 credited to your account ending 1234.', 'income', 2500],
  ['Purchase of AED 37.00 with Debit Card ending 1234 at NOON.COM. Do not share your OTP with anyone. Ref: 123456.', 'expense', 3700],
  ['Purchase of AED 37.00 with Debit Card ending 1234 at SAMPLE MARKET. If not you, call 600500000.', 'expense', 3700],
  ['Purchase of AED 37.00 with Debit Card ending 1234 at SAMPLE MARKET. احصل على استرداد نقدي 200.00 ريال عند الشراء هذا الشهر.', 'expense', 3700],
  ['Paid AED 37.00 using your debit card ending 1234 at SAMPLE MARKET. Avl Bal AED 500.00.', 'expense', 3700],
]) test(`completed movement survives request/security vocabulary: ${body}`, () => {
  const reader = session('AE');
  const result = reader.parse(body, 'ENBD', reader.inspect(body, 'ENBD'), undefined, at);
  assert.equal(result?.kind, 'transaction');
  assert.equal(result.type, type);
  assert.equal(result.amountFils, amount);
});
