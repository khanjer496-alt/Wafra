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
const { inspectSourceFreeRefusedAlert } = load('@/lib/auto-import');
const at = Date.parse('2026-11-05T10:00:00Z');

function session(market = 'AE') {
  const currency = market === 'SA' ? 'SAR' : 'AED';
  country.setActiveCountry(market);
  markets.setActiveMarket(market);
  markets.setLedgerCurrency(currency, 2);
  return createLaunchAlertSession({ overrides: {}, activeMarket: market, pinnedCurrency: currency,
    bestEffort: { enabled: true, country: market } });
}

for (const currency of ['USD', 'SAR', 'EUR']) {
  test(`a new receipt in ${currency} cannot invent an AED settlement through fallback FX`, () => {
    const body = `Thank you for your payment of ${currency} 500.00 on your Mashreq credit card ending 1234`;
    const reader = session();
    assert.equal(parseSms(body, {}, { sender: 'MASHREQ', observedAt: at }), null);
    const inspection = reader.inspect(body, 'MASHREQ');
    assert.equal(reader.parse(body, 'MASHREQ', inspection, undefined, at), null);
    const held = inspectSourceFreeRefusedAlert({ source: body, sender: 'MASHREQ', observedAt: at,
      channel: 'inbox', session: reader, existingInspection: inspection });
    assert.equal(held.kind, 'review');
    const money = held.candidate?.event?.amount.value ?? held.candidate?.amount;
    assert.deepEqual(JSON.parse(JSON.stringify(money)), { currency, minorUnits: '50000', exponent: 2 });
  });
}

for (const [market, sender, token, currency] of [
  ['AE', 'MASHREQ', 'Dhs', 'AED'], ['AE', 'MASHREQ', 'Dhs.', 'AED'],
  ['SA', 'AlRajhiBank', 'SAR', 'SAR'], ['SA', 'AlRajhiBank', 'SR', 'SAR'],
]) test(`same-currency receipt aliases retain a transfer: ${market}/${token}`, () => {
  const reader = session(market);
  const body = `Thank you for your payment of ${token} 500.00 on your credit card ending 1234`;
  for (const parsed of [parseSms(body, {}, { sender, observedAt: at }),
    reader.parse(body, sender, reader.inspect(body, sender), undefined, at)]) {
    assert.equal(parsed?.kind, 'cardPayment');
    assert.equal(parsed.amountFils, 50000);
    assert.equal(parsed.currency, currency);
    assert.equal(parsed.cardPaymentSide, 'receipt');
  }
});

// Synthetic messages reported from build 393 through Android's actual SMS
// inbox. These are source regressions, not a claim that this candidate ran there.
for (const [sender, body, reason] of [
  ['FAB', 'Use code 424679 to authorise your card transaction of AED 37.00 at TALABAT on card ending 2517.', 'security-challenge'],
  ['FAB', 'We have received your refund request of AED 50.00 for IKEA.', 'pending-processing'],
]) test(`Android 393 non-movement never posts in core or capture: ${sender}/${reason}`, () => {
  const reader = session();
  assert.equal(parseSms(body, {}, { sender, observedAt: at }), null);
  assert.equal(nonPostingReason(body), reason);
  assert.equal(reader.parse(body, sender, reader.inspect(body, sender), undefined, at), null);
});

for (const [sender, body, amount, tail] of [
  ['MASHREQ', 'Thank you for your payment of AED 500.00 on your Mashreq credit card ending 1234', 50000, '1234'],
  ['ADCB', 'Payment received AED 300.00 on your card ending 4455. Thank you', 30000, '4455'],
]) for (const source of [body, `${sender}: ${body}`, body.replace(/ /g, '  ')]) {
  test(`Android 393 own-card receipt is a transfer, not spending: ${source}`, () => {
    const reader = session();
    const core = parseSms(source, {}, { sender, observedAt: at });
    const captured = reader.parse(source, sender, reader.inspect(source, sender), undefined, at);
    for (const parsed of [core, captured]) {
      assert.equal(parsed?.kind, 'cardPayment');
      assert.equal(parsed.transferHint, true);
      assert.equal(parsed.cardPaymentSide, 'receipt');
      assert.equal(parsed.amountFils, amount);
      assert.equal(parsed.currency, 'AED');
      assert.equal(parsed.card?.last4, tail);
    }
  });
}

for (const sender of ['ENBD', 'ENBD-ALERT']) for (const literal of ['4,999.00', '3,111.00']) {
  const body = `Dear customer, AED ${literal} debited from your account ending 3183. If not you, click http://bit.ly/abc123 immediately.`;
  test(`Android 393 click-link debit cannot post under any named bank header: ${sender}/${literal}`, () => {
    const reader = session();
    assert.equal(parseSms(body, {}, { sender, observedAt: at }), null);
    assert.equal(reader.parse(body, sender, reader.inspect(body, sender), undefined, at), null);
  });
}

for (const footer of [
  'Click https://www.enbd.example/statements for details.',
  'Click:https://www.enbd.example/statements.',
  'Click to view your statement:\nhttps://www.enbd.example/statements.',
  'Please click on the link https://www.enbd.example/statements.',
  'View the statement by clicking https://www.enbd.example/statements.',
  'Click here to view the statement.',
  'اضغط على الرابط https://www.enbd.example/statements.',
]) for (const sender of ['ENBD', 'ENBD-ALERT', '']) {
  const body = `Purchase of AED 37.00 with Debit Card ending 2517 at TALABAT. ${footer}`;
  test(`a click-link request never posts even with a bank sender: ${sender || 'blank'}/${footer}`, () => {
    const reader = session();
    assert.equal(parseSms(body, {}, { sender, observedAt: at }), null);
    assert.equal(nonPostingReason(body), 'link-request');
    assert.equal(reader.parse(body, sender, reader.inspect(body, sender), undefined, at), null);
    assert.equal(reader.parseUnproven(body, sender, reader.inspect(body, sender), at), null);
  });
}

for (const body of [
  'Purchase of AED 37.00 with Debit Card ending 2517 at CLICK.COM.',
  'Purchase of AED 37.00 with Debit Card ending 2517 at CLICK HERE MARKET.',
  'Purchase of AED 37.00 with Debit Card ending 2517 at TALABAT. Do not click the link https://www.enbd.example/unverified in unexpected messages.',
  'Purchase of AED 37.00 with Debit Card ending 2517 at TALABAT. Avoid clicking the link https://www.enbd.example/unverified in unexpected messages.',
  'Purchase of AED 37.00 with Debit Card ending 2517 at TALABAT. If not you, call 600500000.',
]) test(`a merchant or negative security instruction is not a click request: ${body}`, () => {
  const reader = session();
  for (const parsed of [parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
    reader.parse(body, 'ENBD', reader.inspect(body, 'ENBD'), undefined, at)]) {
    assert.equal(parsed?.kind, 'transaction');
    assert.equal(parsed.amountFils, 3700);
    assert.equal(parsed.currency, 'AED');
    assert.equal(parsed.type, 'expense');
  }
});

for (const body of [
  'Thank you for your payment of AED 37.00. On your credit card ending 1234, the available limit is AED 500.',
  'Thank you for your payment of AED 37.00 to NOON using your credit card ending 1234.',
  'Payment received AED 300.00 on your debit card ending 4455. Thank you',
]) test(`a separate card clause, purchase instrument or explicit debit card cannot become a credit repayment: ${body}`, () => {
  session();
  assert.notEqual(parseSms(body, {}, { sender: 'ENBD', observedAt: at })?.kind, 'cardPayment');
});

for (const sender of ['+971501230000', 'someone@example.test', 'INFO']) {
  test(`a qualified receipt cannot bypass the unregistered-sender capture gate: ${sender}`, () => {
    const body = 'Thank you for your payment of AED 500.00 on your Mashreq credit card ending 1234';
    const reader = session();
    assert.equal(reader.parse(body, sender, reader.inspect(body, sender), undefined, at), null);
    assert.equal(reader.parseUnproven(body, sender, reader.inspect(body, sender), at), null);
  });
}

test('bundled iOS parser refuses the device non-movements and click prompts without losing a purchase control', () => {
  const directory = path.resolve(__dirname, '../../../modules/wafra-live-capture/ios/Resources');
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'WafraBackgroundParser.meta.json')));
  const sandbox = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(directory, 'WafraBackgroundParser.js'), 'utf8'), sandbox);
  const parse = (body, sender = 'ENBD') => JSON.parse(sandbox.wafraNativeAlertParse(JSON.stringify({
    v: 1, body, sender, observedAt: at, context: { v: 1, country: 'AE', parserMarket: 'AE',
      ledgerMoney: { currency: 'AED', exponent: 2 }, sourceHash: metadata.sourceHash },
  })));
  const purchase = 'Purchase of AED 37.00 with Debit Card ending 2517 at TALABAT.';
  const control = parse(purchase);
  assert.equal(control.route, 'parsed');
  assert.deepEqual(control.notification.amount, { currency: 'AED', minorUnits: '3700', exponent: 2 });
  for (const [sender, body] of [
    ['FAB', 'Use code 424679 to authorise your card transaction of AED 37.00 at TALABAT on card ending 2517.'],
    ['FAB', 'We have received your refund request of AED 50.00 for IKEA.'],
    ['ENBD', 'Dear customer, AED 4,999.00 debited from your account ending 3183. If not you, click http://bit.ly/abc123 immediately.'],
    ['ENBD-ALERT', 'Dear customer, AED 3,111.00 debited from your account ending 3183. If not you, click http://bit.ly/abc123 immediately.'],
    ['ENBD', `${purchase} Click https://www.enbd.example/statements for details.`],
    ['ENBD', `${purchase} Click:https://www.enbd.example/statements.`],
    ['ENBD', `${purchase} Click to view your statement:\nhttps://www.enbd.example/statements.`],
    ['ENBD', `${purchase} اضغط على الرابط https://www.enbd.example/statements.`],
  ]) assert.equal(parse(body, sender).route, 'ignore', `${sender}/${body}`);
});
