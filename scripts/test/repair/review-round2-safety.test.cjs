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
const { hasClickLinkPrompt } = load('@/lib/principal-posting-guards');
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

// Reviewer a86f70f2: issuer confirmation is a completed debit, not a link request.
const confirmedDebit = 'We confirm that AED 85.00 was debited from your account ending 1234 for purchase at AMAZON.COM.';
function confirmationNative(body) {
  return JSON.parse(sandbox.wafraNativeAlertParse(JSON.stringify({ v: 1, body, sender: 'ENBD', observedAt: at,
    context: { v: 1, country: 'AE', parserMarket: 'AE', ledgerMoney: { currency: 'AED', exponent: 2 },
      sourceHash: meta.sourceHash } })));
}
for (const [layout, body, expectedMinor = 8500] of [
  ['original', confirmedDebit],
  ['spacing', confirmedDebit.replace(/ /g, '  ')],
  ['www-host', confirmedDebit.replace('AMAZON.COM', 'www.amazon.com')],
  ['www-host-spacing', confirmedDebit.replace('AMAZON.COM', 'www.amazon.com').replace(/ /g, '  ')],
  ['after-sentence', `Transaction alert. ${confirmedDebit}`],
  ['after-sentence-spacing', `Transaction alert. ${confirmedDebit}`.replace(/ /g, '  ')],
  ['dear-newline', `Dear Customer\n${confirmedDebit}`],
  ['dear-newline-spacing', `Dear Customer\n${confirmedDebit}`.replace(/ /g, '  ')],
  ['dear-comma', `Dear Customer, ${confirmedDebit}`],
  ['dear-comma-spacing', `Dear Customer, ${confirmedDebit}`.replace(/ /g, '  ')],
  ['dear-unpunctuated', `Dear Customer ${confirmedDebit}`],
  ['dear-unpunctuated-spacing', `Dear Customer ${confirmedDebit}`.replace(/ /g, '  ')],
  ['after-question-sentence', `Did we? ${confirmedDebit}`],
  ['after-question-sentence-spacing', `Did we? ${confirmedDebit}`.replace(/ /g, '  ')],
  ['purchase-article', confirmedDebit.replace('for purchase', 'for a purchase')],
  ['purchase-article-spacing', confirmedDebit.replace('for purchase', 'for a purchase').replace(/ /g, '  ')],
  ['comma-amount', confirmedDebit.replace('AED 85.00', 'AED 4,999.00'), 499900],
  ['comma-amount-spacing', confirmedDebit.replace('AED 85.00', 'AED 4,999.00').replace(/ /g, '  '), 499900],
  ['no-final-period', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM')],
  ['no-final-period-spacing', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM').replace(/ /g, '  ')],
  ['host-then-place', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM, Dubai.')],
  ['host-then-place-spacing', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM, Dubai.').replace(/ /g, '  ')],
  // Reviewer c2094537: card-descriptor and closing-punctuation tails are not URL continuations.
  ['card-descriptor', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM*2K1AB3CD0.')],
  ['card-descriptor-spacing', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM*2K1AB3CD0.').replace(/ /g, '  ')],
  ['closing-bracket', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM).')],
  ['closing-bracket-spacing', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM).').replace(/ /g, '  ')],
  ['ideographic-stop', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM。')],
  ['ideographic-stop-spacing', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM。').replace(/ /g, '  ')],
  ['closing-quote', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM”.')],
  ['closing-quote-spacing', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM”.').replace(/ /g, '  ')],
  ['ellipsis', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM…')],
  ['ellipsis-spacing', confirmedDebit.replace('AMAZON.COM.', 'AMAZON.COM…').replace(/ /g, '  ')],
]) {
  test(`issuer confirmation retains completed debit/${layout}`, () => {
    const session = reader('AE');
    assert.equal(hasClickLinkPrompt(body), false, 'merchant hostname is not a navigation target');
    assert.equal(nonPostingReason(body), null);
    for (const parsed of [parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
      assert.equal(parsed?.kind, 'transaction');
      assert.equal(parsed.type, 'expense');
      assert.equal(parsed.amountFils, expectedMinor);
      assert.equal(parsed.currency, 'AED');
    }
    const history = parseHistoricalMessageRecords([JSON.stringify({ v: 1, id: '9'.repeat(64), text: body,
      sender: 'ENBD', receivedAt: new Date(at).toISOString() })], {}, new Date(at), new Set(), session);
    assert.equal(history.parsed.length, 1);
    assert.equal(history.parsed[0].amountFils, expectedMinor);
    assert.equal(history.parsed[0].type, 'expense');
    assert.equal(history.parsed[0].currency, 'AED');
    const native = confirmationNative(body);
    assert.equal(native.route, 'parsed');
    assert.equal(native.notification.direction, 'debit');
    assert.deepEqual(native.notification.amount, { currency: 'AED', minorUnits: String(expectedMinor), exponent: 2 });
  });
}
for (const [index, source] of [
  'AED 4,999.00 debited from your account ending 3183. Verify at www.enbd-secure.test now',
  'AED 4,999.00 debited from your card ending 3183. Reply YES to confirm or tap hxxp://enbd-verify.test',
  'Your account is suspended. AED 4,999.00 debited. Update details: enbd-secure.test/login',
  `${confirmedDebit} Please confirm at enbd-secure.test/login.`,
  confirmedDebit.replace('We confirm', 'Please confirm'),
  confirmedDebit.replace('We confirm', 'Can we confirm'),
  confirmedDebit.replace('We confirm', 'Did we confirm'),
  'Bank notice '.repeat(8) + confirmedDebit.replace('We confirm', 'Can we confirm'),
  confirmedDebit.replace('AMAZON.COM', 'enbd-secure.test:443/login'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM?login=1'),
  confirmedDebit.replace('AMAZON.COM', 'www.amazon.com?login=1'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM#login'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM:443'),
  confirmedDebit.replace('AMAZON.COM', 'enbd-secure.test/login'),
  confirmedDebit.replace('We confirm', 'Can\nwe confirm'),
  confirmedDebit.replace('We confirm', 'Did,\nwe confirm'),
  `Dear Customer,\n${confirmedDebit.replace('We confirm', 'Can we confirm')}`,
  // Reviewer 612e8db2: only a closed sentence end may follow the declared host.
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM：443/login'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM%2Flogin'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM%3Flogin=1'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM／login'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM\\login'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM@enbd-secure.test'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM./login'),
  // Reviewer c2094537: widening the end rule must not reopen a URL continuation.
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM*X/login'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM*2K1AB3CD0@enbd-secure.test'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM*evil.test/login'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM)/login'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM]/login'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM"/login'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM。/login'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM\u200B/login'),
  confirmedDebit.replace('AMAZON.COM', 'AMAZON.COM\uFEFF/login'),
].entries()) for (const body of [source, source.replace(/ /g, '  ')]) {
  test(`issuer confirmation cannot hide a link instruction/${index}/${body === source ? 'original' : 'spacing'}`, () => {
    const session = reader('AE');
    assert.equal(hasClickLinkPrompt(body), true);
    assert.equal(nonPostingReason(body), 'link-request');
    assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
    assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
    assert.equal(confirmationNative(body).route, 'ignore');
  });
}

// CEO decision ba68ceef: an acknowledgement sentence plus a COMPLETED credit posts whatever the
// merchant length; pending, requested or under-process refunds stay refused. The 40-character
// REFUND_RE window used to drop the settled credit for a 12+ character or dotted merchant, so the
// acknowledgement then won and the credit was refused as pending-processing.
const refundAckMerchants = [
  ['5', 'ADNOC'], ['12', 'GOLDEN SANDS'], ['30', 'GOLDEN SANDS GRAND RESTAURANTS'],
  // No coordinator word (AND/BUT) in the long names: refundScope treats it as a new subject; that is a separate matter.
  ['60', 'GOLDEN SANDS GRAND RESTAURANTS CAFE LOUNGE DUBAI MALLS NORTH'],
  ['dotted-8', 'NOON.COM'], ['dotted-14', 'APPLE.COM/BILL'],
];
for (const [label, merchant] of refundAckMerchants) {
  assert.equal(merchant.length, Number(label.replace('dotted-', '')));
  for (const [amountText, minor] of [['100.00', 10000], ['1,948.85', 194885]]) {
    const body = `Your refund request has been received. Refund of AED ${amountText} from ${merchant} has been credited to your card ending 1234.`;
    test(`refund acknowledgement plus completed credit posts/${label}/${amountText}`, () => {
      const session = reader('AE');
      assert.equal(nonPostingReason(body), null);
      for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
        session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
        assert.equal(parsed?.kind, 'transaction');
        assert.equal(parsed.type, 'income');
        assert.equal(parsed.amountFils, minor);
        assert.equal(parsed.currency, 'AED');
      }
      // The iOS native bundle ignores this two-sentence shape at every merchant length (unchanged); only the TypeScript paths post it.
    });
  }
}
const pendingRefundBodies = [
  ['future', (m) => `Your refund request has been received. Refund of AED 100.00 from ${m} will be credited to your card ending 1234 within 5 working days.`],
  ['under-process', (m) => `Your refund request is under process. Refund of AED 100.00 from ${m} is being processed.`],
  ['requested', (m) => `Your refund request has been received. Refund of AED 100.00 from ${m} has been requested and is pending approval.`],
  ['awaiting-merchant', (m) => `Your refund request has been received. Refund of AED 100.00 from ${m} will be processed once the merchant confirms.`],
];
for (const [label, merchant] of refundAckMerchants.slice(0, 4)) {
  for (const [kind, make] of pendingRefundBodies) {
    const body = make(merchant);
    test(`refund request stays refused/${kind}/${label}`, () => {
      const session = reader('AE');
      assert.equal(parseSms(body), null);
      assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
      assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
      assert.equal(confirmationNative(body).route, 'ignore');
    });
  }
}
// Arabic: a completed refund names the merchant outside the settled clause, so its result never
// depended on merchant length; a received or future refund request stays refused.
for (const merchant of ['نون اي', 'مطعم الشام ال', 'مطعم الشام للمأكولات والمشروبات',
  'مطعم الشام للمأكولات والمشروبات الشرقية والغربية في دبي مول فرع']) {
  test(`Arabic refund completed credit posts/${merchant.length}`, () => {
    const body = `تم استرداد مبلغ 100.00 درهم إلى بطاقتك المنتهية بـ 1234 من ${merchant}.`;
    const session = reader('AE');
    for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
      assert.equal(parsed?.kind, 'transaction');
      assert.equal(parsed.type, 'income');
      assert.equal(parsed.amountFils, 10000);
      assert.equal(parsed.currency, 'AED');
    }
  });
  test(`Arabic refund request stays refused/${merchant.length}`, () => {
    const body = `تم استلام طلب استرداد مبلغ 100.00 درهم من ${merchant}. سيتم استرداد المبلغ إلى بطاقتك خلال 5 أيام عمل.`;
    const session = reader('AE');
    assert.equal(parseSms(body), null);
    assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
    assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
  });
}

// CEO decision 3a8291ad: "and" inside a merchant name is not a second clause. Build 190 posted these
// refunds; the RC base refused them because refundScope read "AND <words> has" as a new subject.
const andMerchants = [['marks', 'MARKS AND SPENCER'], ['hm', 'H AND M'], ['barnes', 'BARNES AND NOBLE'],
  ['mixed-case', 'Marks and Spencer'], ['four-words', 'TOM AND JERRYS CAFE']];
for (const [label, merchant] of andMerchants) {
  for (const [lead, withAck] of [['plain', ''], ['ack', 'Your refund request has been received. ']]) {
    for (const [amountText, minor] of [['100.00', 10000], ['1,948.85', 194885]]) {
      const body = `${withAck}Refund of AED ${amountText} from ${merchant} has been credited to your card ending 1234.`;
      test(`refund credit from a merchant named with AND posts/${label}/${lead}/${amountText}`, () => {
        const session = reader('AE');
        assert.equal(nonPostingReason(body), null);
        for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
          session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
          assert.equal(parsed?.kind, 'transaction');
          assert.equal(parsed.type, 'income');
          assert.equal(parsed.amountFils, minor);
          assert.equal(parsed.currency, 'AED');
        }
      });
    }
  }
}
for (const [label, merchant] of andMerchants.slice(0, 3)) {
  for (const [kind, make] of [
    ['future', (m) => `Refund of AED 100.00 from ${m} will be credited to your card ending 1234 within 5 working days.`],
    ['pending-approval', (m) => `Refund of AED 100.00 from ${m} is pending approval.`],
    ['in-progress', (m) => `Your refund of AED 100.00 from ${m} is in progress.`],
    ['ack-requested', (m) => `Your refund request has been received. Refund of AED 100.00 from ${m} has been requested and is pending approval.`],
  ]) {
    const body = make(merchant);
    test(`refund from a merchant named with AND stays refused/${kind}/${label}`, () => {
      const session = reader('AE');
      assert.equal(parseSms(body), null);
      assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
      assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
      assert.equal(confirmationNative(body).route, 'ignore');
    });
  }
}
for (const [label, merchant] of [['spaced', 'ماركس و سبنسر'], ['glued', 'ماركس وسبنسر']]) {
  test(`Arabic refund merchant with waw posts/${label}`, () => {
    const body = `تم استرداد مبلغ 100.00 درهم إلى بطاقتك المنتهية بـ 1234 من ${merchant}.`;
    const session = reader('AE');
    for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
      assert.equal(parsed?.kind, 'transaction');
      assert.equal(parsed.type, 'income');
      assert.equal(parsed.amountFils, 10000);
      assert.equal(parsed.currency, 'AED');
    }
  });
}
