'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseSms, nonPostingReason } = load('@/lib/sms-parser');
const { isNotAutoPostableMoney } = load('@/lib/best-effort-autopost');
const at = Date.parse('2026-11-05T10:00:00Z');

function session(market = 'AE', enabled = true) {
  country.setActiveCountry(market);
  markets.setActiveMarket(market);
  markets.setLedgerCurrency(market === 'SA' ? 'SAR' : 'AED', 2);
  return createLaunchAlertSession({ overrides: {}, activeMarket: market,
    pinnedCurrency: market === 'SA' ? 'SAR' : 'AED', bestEffort: { enabled, country: market } });
}

function assertPosted(body, sender, amount, type = 'expense') {
  const reader = session();
  const parsed = reader.parse(body, sender, reader.inspect(body, sender), undefined, at);
  assert.equal(parsed?.kind, 'transaction');
  assert.equal(parsed.type, type);
  assert.equal(parsed.amountFils, amount);
  assert.equal(parsed.currency, 'AED');
}

// Synthetic reviewer probes: a greeting cannot turn an offer into a purchase,
// and the purchase amount cannot be consumed as part of that greeting.
for (const greeting of ['عميلنا العزيز ', 'عزيزي عميل البنك ', 'عميلنا العزيز، ']) {
  const body = `${greeting}احصل على استرداد نقدي 200.00 ريال عند الشراء من STARBUCKS`;
  for (const sender of ['AlRajhiBank', '']) for (const enabled of [true, false]) {
    test(`cashback invitation is refused without requiring punctuation: ${greeting}/${sender}/${enabled}`, () => {
      const reader = session('SA', enabled);
      assert.equal(reader.parse(body, sender, reader.inspect(body, sender), undefined, at), null);
      assert.equal(reader.parseUnproven(body, sender, reader.inspect(body, sender), at), null);
      assert.equal(isNotAutoPostableMoney(body), true);
    });
  }
}

for (const body of [
  'Purchase AED 100 at NOON, احصل على استرداد نقدي 5%',
  'شراء 100 درهم من نون، احصل على استرداد نقدي',
  'شراء ١٠٠ درهم من نون، احصل على استرداد نقدي',
]) test(`a purchase amount before a cashback footer stays principal: ${body}`, () => {
  assertPosted(body, 'ENBD', 10000);
  assert.equal(isNotAutoPostableMoney(body), false);
});

for (const verb of ['proceed with', 'continue with', 'validate', 'access', 'unlock', 'finish', 'cancel']) {
  for (const instruction of ['Use code 424679', 'Enter code 4246', 'Use 424679']) {
    const body = `${instruction} to ${verb} your card transaction of AED 37.00 at TALABAT on card ending 2517.`;
    test(`the direct core refuses an arbitrary code challenge: ${instruction}/${verb}`, () => {
      const reader = session();
      assert.equal(parseSms(body, {}, { sender: 'FAB', observedAt: at }), null);
      assert.equal(nonPostingReason(body), 'security-challenge');
      assert.equal(reader.parse(body, 'FAB', reader.inspect(body, 'FAB'), undefined, at), null);
    });
  }
}

for (const instruction of ['Use code 2026', 'Use code 424679', 'Enter code 4246', 'Use 424679']) {
  const body = `Purchase of AED 37.00 with Debit Card ending 1234 at NOON.COM. ${instruction} to get 10% off your next order.`;
  test(`an exact percentage-off code footer preserves a completed purchase: ${instruction}`, () => {
    session();
    assert.equal(nonPostingReason(body), null);
    const core = parseSms(body, {}, { sender: 'ENBD', observedAt: at });
    assert.equal(core?.amountFils, 3700);
    assert.equal(core.type, 'expense');
    assertPosted(body, 'ENBD', 3700);
  });
}

test('a discount footer does not exempt a different code challenge in the same message', () => {
  const body = 'Use code 424679 to proceed with your card transaction of AED 37.00 at NOON.COM. Use code 2026 to get 10% off your next order.';
  session();
  assert.equal(nonPostingReason(body), 'security-challenge');
  assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
});

for (const instruction of ['Use code 2026', 'Enter code 4246']) {
  test(`a percentage-off code without a completed purchase remains an offer: ${instruction}`, () => {
    const body = `${instruction} to get 10% off your next purchase of AED 37.00 at NOON.COM.`;
    const reader = session();
    assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
    assert.equal(reader.parse(body, 'ENBD', reader.inspect(body, 'ENBD'), undefined, at), null);
  });
}

for (const [sender, body, amount, type] of [
  ['WIO', 'Spent AED 85.00 at CARREFOUR. Thanks for banking with WIO', 8500, 'expense'],
  ['ADCB', 'Received AED 12,000.00 from ACME LLC. Thanks for banking with ADCB', 1200000, 'income'],
  ['ENBD', 'Purchase of AED 37.00 with Debit Card ending 1234 at NOON. Thanks for choosing Emirates NBD', 3700, 'expense'],
]) test(`a bank courtesy footer does not erase a completed alert: ${sender}`, () => {
  assertPosted(body, sender, amount, type);
});

for (const body of ['Spent AED 120 on groceries today', 'Paid AED 200 for the taxi']) {
  test(`a contact label does not make colloquial personal spending a bank posting: ${body}`, () => {
    const reader = session();
    assert.equal(reader.parse(body, 'Sara', reader.inspect(body, 'Sara'), undefined, at), null);
  });
}

for (const sender of ['', 'Wafra Automation', 'Wafra Notification']) {
  test(`the existing unverified terse-wallet trade-off stays nonposting: ${sender || 'blank'}`, () => {
    const body = 'Paid AED 45.00 to CAREEM RIDE';
    const reader = session();
    assert.equal(reader.parse(body, sender, reader.inspect(body, sender), undefined, at), null);
    assert.equal(reader.inspect(body, sender), null);
  });
}
