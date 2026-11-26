'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const at = Date.parse('2026-11-05T10:00:00Z');
const purchase = 'شراء بمبلغ 100 ريال بالبطاقة المنتهية 1234 لدى SAMPLE MARKET';

function read(body, sender) {
  country.setActiveCountry('SA');
  markets.setActiveMarket('SA');
  markets.setLedgerCurrency('SAR', 2);
  const session = createLaunchAlertSession({ overrides: {}, activeMarket: 'SA', pinnedCurrency: 'SAR',
    bestEffort: { enabled: true, country: 'SA' } });
  return session.parse(body, sender, session.inspect(body, sender), undefined, at);
}

for (const footer of ['للاستفسار اتصل بإدارة البطاقات', 'للاستفسار اتصل بادارة البطاقات',
  'نحن معك دائما', 'وداعا']) for (const sender of ['', 'AlRajhiBank']) {
  test(`ordinary Arabic footer preserves a SAR purchase: ${footer}/${sender || 'blank'}`, () => {
    const body = `${purchase}. ${footer}`;
    assert.equal(markets.detectLaunchMarketFromAlert(body, sender), 'SA');
    const parsed = read(body, sender);
    assert.equal(parsed?.kind, 'transaction');
    assert.equal(parsed.type, 'expense');
    assert.equal(parsed.amountFils, 10000);
    assert.equal(parsed.currency, 'SAR');
    assert.equal(parsed.card?.last4, '1234');
    const now = new Date(at);
    const record = JSON.stringify({ v: 1, id: '9'.repeat(64), text: body, sender, receivedAt: now.toISOString() });
    const history = parseHistoricalMessageRecords([record], {}, now, new Set());
    assert.equal(history.parsed.length, 1);
    assert.equal(history.reviewCandidates.length, 0);
    assert.equal(history.ignoredCount, 0);
    assert.equal(history.parsed[0].amountFils, 10000);
    assert.equal(history.parsed[0].currency, 'SAR');
    assert.equal(history.parsed[0].type, 'expense');
  });
}

for (const amount of ['100 د.إ', 'د.إ100', '100د.إ', '100 دإ', '100 د.ا', '100 دا']) {
  test(`a true dirham abbreviation remains currency evidence: ${amount}`, () => {
    assert.equal(markets.detectLaunchMarketFromAlert(`Purchase of ${amount} with card ending 1234`), 'AE');
  });
}
for (const amount of ['100 ر.س', '100ر.س', 'ر.س 100', 'SAR 100', '100 ريال']) {
  test(`a true riyal amount remains Saudi evidence beside administration wording: ${amount}`, () => {
    assert.equal(markets.detectLaunchMarketFromAlert(`Purchase of ${amount}. للاستفسار اتصل بإدارة البطاقات`), 'SA');
  });
}
for (const body of [
  `${purchase}. Foreign amount AED 50.00`,
  `${purchase}. Foreign amount 50 د.إ`,
  `Purchase of AED 100.00. Foreign amount SAR 50.00`,
]) test(`real mixed-currency evidence remains unresolved without a bank sender: ${body}`, () => {
  assert.equal(markets.detectLaunchMarketFromAlert(body), null);
  assert.equal(read(body, ''), null);
});

for (const body of [
  'Use code 424679 to proceed with your card transaction of SAR 100.00 at SAMPLE MARKET. نحن معك دائما',
  'تم استلام طلب استرداد مبلغ 100 ريال من SAMPLE MARKET. للاستفسار اتصل بإدارة البطاقات',
  'عميلنا العزيز احصل على استرداد نقدي 200.00 ريال عند الشراء من STARBUCKS. نحن معك دائما',
  `${purchase}. اضغط https://example.invalid/login للاستفسار عن إدارة البطاقات`,
]) for (const sender of ['', 'AlRajhiBank']) {
  test(`correct routing cannot admit a challenge, request, offer or link: ${body}/${sender || 'blank'}`, () => {
    assert.equal(read(body, sender), null);
  });
}
