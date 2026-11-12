'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const { createLaunchAlertSession, inspectGenericBankEventForReview, hasPersonalMessagePrefix } = load('@/lib/launch-alert-parser');
const { parseSms, nonPostingReason } = load('@/lib/sms-parser');
const local = load('@/lib/local-message-record');
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
  ['AE', 'FAB', 'Use code 4246 to confirm your card transaction of AED 37.00 at TALABAT on card ending 2517.', 'security-challenge'],
  ['AE', 'ENBD', 'رمز التحقق 432598 لعملية شراء بمبلغ 37.00 درهم لدى NOON.COM. لا تشاركه مع أحد.', 'security-challenge'],
  ['AE', 'FAB', 'تم رفض العملية بمبلغ 37.00 درهم لدى STARBUCKS على البطاقة المنتهية بـ 2665.', 'declined'],
  ['AE', 'FAB', 'We have received your refund request of AED 50.00 for IKEA.', 'pending-processing'],
  ['SA', 'AlRajhiBank', 'احصل على استرداد نقدي 200.00 ريال عند الشراء من STARBUCKS هذا الشهر. تطبق الشروط والأحكام'],
  ['AE', 'ENBD', 'Paid AED 85 for lunch'],
  ['AE', 'ENBD', 'Spent AED 120 on groceries today lol'],
  ['AE', 'ENBD', 'They charged me AED 45 for parking!'],
  ['AE', 'ENBD', 'Received AED 500 from you thanks'],
  ['AE', 'Mum', 'Paid AED 200.00 for the taxi, remind me to send it'],
  ['AE', 'ENBD', 'Use code 2026 to get 10% off your next order of AED 37.00 at NOON.COM.'],
];
for (const greeting of ['عزيزي العميل، ', 'عميلنا العزيز، ', 'مرحباً! ']) {
  refused.push(['SA', 'AlRajhiBank', `${greeting}احصل على استرداد نقدي 200.00 ريال عند الشراء من STARBUCKS`]);
}
for (const prefix of ['lol ', 'Hi ', 'Just ', 'Hey, just ']) {
  refused.push(['AE', 'ENBD', `${prefix}paid AED 85 for lunch`]);
}
refused.push(['AE', 'ENBD', 'Paid AED 85 from my account for lunch']);
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
for (const sender of ['ENBD-ALERT', 'FAB-Alerts', 'BOB-SMS', 'BANK_ALERTS', 'Dubai Islamic Bank',
  'Commercial Bank of Dubai', 'مصرف الراجحي', 'الأهلي', 'com.mybank.app Card purchase']) {
  test(`named issuer header preserves completed debit: ${sender}`, () => {
    const reader = session('AE');
    const body = 'Purchase of AED 37.00 with Debit Card ending 1234 at SAMPLE MARKET. Avl Bal AED 500.00';
    const result = reader.parse(body, sender, reader.inspect(body, sender), undefined, at);
    assert.equal(result?.kind, 'transaction');
    assert.equal(result.type, 'expense');
    assert.equal(result.amountFils, 3700);
    assert.equal(result.currency, 'AED');
    assert.equal(reader.parse(phishing, sender, reader.inspect(phishing, sender), undefined, at), null);
  });
}
for (const [sender, body, type, amount] of [
  ['WIO', 'Spent AED 85.00 at CARREFOUR', 'expense', 8500],
  ['CAREEMPAY', 'Paid AED 45.00 to CAREEM RIDE', 'expense', 4500],
  ['ADCB', 'Received AED 12,000.00 from ACME LLC', 'income', 1200000],
]) test(`terse named issuer alert keeps its source money: ${sender}`, () => {
  const reader = session('AE');
  assert.equal(hasPersonalMessagePrefix(body, sender), false);
  assert.equal(hasPersonalMessagePrefix(body, ''), true);
  const result = reader.parse(body, sender, reader.inspect(body, sender), undefined, at);
  assert.equal(result?.kind, 'transaction');
  assert.equal(result.type, type);
  assert.equal(result.amountFils, amount);
  assert.equal(result.currency, 'AED');
  if (sender !== 'CAREEMPAY') {
    const record = JSON.stringify({ v: 1, id: '12345678-1234-4123-8123-123456789abc',
      text: body, sender, source: 'message', observedAt: new Date(at).toISOString() });
    const market = local.preflightLocalMessageRecord(record, new Date(at)).market;
    const outcome = local.parseLocalMessageRecord(record, new Date(at), market, session('AE'));
    assert.equal(outcome.kind, 'parsed');
    assert.equal(outcome.row.amountFils, amount);
    assert.equal(outcome.row.type, type);
    assert.equal(outcome.row.currency, 'AED');
  }
});
for (const [body, type, amount] of [
  ['Refund of AED 50.00 from IKEA has been credited to your card ending 1234.', 'income', 5000],
  ['Cashback of AED 25.00 credited to your account ending 1234.', 'income', 2500],
  ['Purchase of AED 37.00 with Debit Card ending 1234 at NOON.COM. Do not share your OTP with anyone. Ref: 123456.', 'expense', 3700],
  ['Purchase of AED 37.00 with Debit Card ending 1234 at SAMPLE MARKET. If not you, call 600500000.', 'expense', 3700],
  ['Purchase of AED 37.00 with Debit Card ending 1234 at SAMPLE MARKET. احصل على استرداد نقدي 200.00 ريال عند الشراء هذا الشهر.', 'expense', 3700],
  ['Purchase of AED 37.00 with Debit Card ending 1234 at SAMPLE MARKET. عزيزي العميل، احصل على استرداد نقدي 200.00 ريال عند الشراء هذا الشهر.', 'expense', 3700],
  ['Purchase of AED 37.00 with Debit Card ending 1234 at NOON.COM. Use code 2026 to get 10% off your next order.', 'expense', 3700],
  ['Purchase of AED 37.00 with Debit Card ending 1234 at NOON.COM. Use code 424679 to get 10% off your next order.', 'expense', 3700],
  ['Paid AED 37.00 using your debit card ending 1234 at SAMPLE MARKET. Avl Bal AED 500.00.', 'expense', 3700],
]) test(`completed movement survives request/security vocabulary: ${body}`, () => {
  const reader = session('AE');
  const result = reader.parse(body, 'ENBD', reader.inspect(body, 'ENBD'), undefined, at);
  assert.equal(result?.kind, 'transaction');
  assert.equal(result.type, type);
  assert.equal(result.amountFils, amount);
});
