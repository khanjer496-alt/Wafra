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
const { isNotAutoPostableMoney } = load('@/lib/best-effort-autopost');
const at = Date.parse('2026-11-05T10:00:00Z');
const resources = path.resolve(__dirname, '../../../modules/wafra-live-capture/ios/Resources');
const meta = JSON.parse(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.meta.json')));
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.js'), 'utf8'), sandbox);
const prefix = 'Your card ending 1354 was used for AED 37.00 at CARREFOUR.';
const footers = ['Do not share your verification code.', 'Do not share your verification code with anyone.',
  'Please do not disclose your security code.', 'Keep your one-time code confidential.',
  'Never share your OTP.', 'Do not share the code with anyone, including bank staff.'];

function session() {
  country.setActiveCountry('AE');
  markets.setActiveMarket('AE');
  markets.setLedgerCurrency('AED', 2);
  return createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED',
    bestEffort: { enabled: true, country: 'AE' } });
}
function native(body, sender) {
  return JSON.parse(sandbox.wafraNativeAlertParse(JSON.stringify({ v: 1, body, sender, observedAt: at,
    context: { v: 1, country: 'AE', parserMarket: 'AE', ledgerMoney: { currency: 'AED', exponent: 2 },
      sourceHash: meta.sourceHash } })));
}
function purchase(parsed) {
  assert.equal(parsed?.kind, 'transaction');
  assert.equal(parsed.type, 'expense');
  assert.equal(parsed.amountFils, 3700);
  assert.equal(parsed.currency, 'AED');
  assert.equal(parsed.card?.last4, '1354');
}

for (const footer of footers) for (const balance of ['', ' Avl Bal AED 5,000.00.']) {
  for (const sender of ['ENBD', '']) for (const spaced of [false, true]) {
    test(`QA-029 posted warning footer: ${footer}/${!!balance}/${sender || 'blank'}/${spaced}`, () => {
      const body = `${prefix}${balance} ${footer}`.replace(/ /g, spaced ? '  ' : ' ');
      const reader = session();
      purchase(parseSms(body, {}, { sender, observedAt: at }));
      assert.equal(nonPostingReason(body), null);
      assert.equal(isNotAutoPostableMoney(body), false);
      purchase(reader.parse(body, sender, reader.inspect(body, sender), undefined, at));
      const history = parseHistoricalMessageRecords([JSON.stringify({ v: 1, id: '6'.repeat(64), text: body,
        sender, receivedAt: new Date(at).toISOString() })], {}, new Date(at), new Set(), reader);
      assert.equal(history.parsed.length, 1);
      purchase(history.parsed[0]);
      assert.equal(history.reviewCandidates.length, 0);
      const preview = native(body, sender);
      assert.equal(preview.route, 'parsed');
      assert.equal(preview.notification.style, 'movement');
      assert.deepEqual(preview.notification.amount, { currency: 'AED', minorUnits: '3700', exponent: 2 });
    });
  }
}
for (const footer of footers) for (const sender of ['ENBD', '']) {
  test(`QA-029 warning plus a separate reference stays posted: ${footer}/${sender || 'blank'}`, () => {
    const reader = session(), body = `${prefix} ${footer} Ref: 123456.`;
    purchase(reader.parse(body, sender, reader.inspect(body, sender), undefined, at));
  });
  test(`QA-029 warning without money cannot create a posting: ${footer}/${sender || 'blank'}`, () => {
    const reader = session();
    assert.equal(parseSms(footer, {}, { sender, observedAt: at }), null);
    assert.equal(reader.parse(footer, sender, reader.inspect(footer, sender), undefined, at), null);
    assert.equal(native(footer, sender).route, 'ignore');
  });
}
for (const body of [
  'Your verification code 482913 for purchase of AED 37.00 at CARREFOUR. Do not share your verification code.',
  `${prefix} Do not share your verification code. Use code 482913 to proceed with your AED 37.00 purchase.`,
  `${prefix} Do not share your verification code 482913.`,
  `${prefix} Keep your one-time code 482913 confidential.`,
  `${prefix} Do not share your security code; enter code 482913 to confirm your purchase.`,
  `${prefix} Never share your OTP. Confirm AED 37.00 purchase with code 482913.`,
]) for (const sender of ['ENBD', '']) {
  test(`QA-029 an actual challenge survives warning masking: ${body}/${sender || 'blank'}`, () => {
    const reader = session();
    assert.equal(parseSms(body, {}, { sender, observedAt: at }), null);
    assert.equal(nonPostingReason(body), 'security-challenge');
    assert.equal(reader.parse(body, sender, reader.inspect(body, sender), undefined, at), null);
    assert.equal(native(body, sender).route, 'ignore');
  });
}
