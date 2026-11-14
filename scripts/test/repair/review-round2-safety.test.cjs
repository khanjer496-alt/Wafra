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
const { createLaunchAlertSession, inspectGenericBankEventForReview } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { inspectSourceFreeRefusedAlert } = load('@/lib/auto-import');
const { hasClickLinkPrompt } = load('@/lib/principal-posting-guards');
const at = Date.parse('2026-11-14T10:00:00Z');
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
      if (reason === 'pending-processing' && sender) assertInformationalRefund(layout, result, sender);
      else assert.equal(result.route, 'ignore');
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
  if (type === 'income') {
    for (const p of [parseSms(body, {}, { sender: 'ENBD', observedAt: at }), session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) assertCreditOrReview(p, body, amount);
    return;
  }
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
// Refusal means no automatic posting. Unsettled financial evidence may now be
// retained as informational Review, which cannot be promoted by confirmation.
function assertInformationalRefund(body, result, sender = 'ENBD') {
  assert.equal(result.route, 'review');assert.equal(result.notification.style, 'review');
  const event = inspectGenericBankEventForReview(body, sender);
  assert.equal(event?.decision, 'review');assert.equal(event?.status, 'informational');
  assert.equal(load('@/lib/alert-review-tray').isMoneyMovementReview({ kind: 'universal', event }), false);
  assert.deepEqual(load('@/lib/universal-import').planConfirmedUniversalImport({ hydrated: true }, event,
    { confirmed: true, postingStatus: 'posted' }), { outcome: 'refused', reason: 'not-posted' });
}
// CEO 524bd56e replaces the old automatic-credit exception with visible Review.
function assertCreditOrReview(parsed, body, minor) {
  if (!parsed) {
    assertInformationalRefund(body, confirmationNative(body));
    const held = inspectSourceFreeRefusedAlert({ source: body, sender: 'ENBD', observedAt: at, channel: 'inbox', session: reader('AE') });
    assert.equal(held.kind, 'review'); assert.equal(held.candidate.event.amount.value?.minorUnits, String(minor));
    return;
  }
  assert.equal(parsed.kind, 'transaction'); assert.equal(parsed.type, 'income');
  assert.equal(parsed.amountFils, minor); assert.equal(parsed.currency, 'AED');
}
function assertDebitAndNote(body, minor) {
  const session = reader('AE');
  for (const parsed of [parseSms(body, {}, { sender: 'ENBD', observedAt: at }), session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
    assert.equal(parsed?.type, 'expense'); assert.equal(parsed.amountFils, minor);
  }
  const native = confirmationNative(body);
  assert.equal(native.route, 'parsed'); assert.equal(native.notification.direction, 'debit');
  assert.equal(native.notification.amount.minorUnits, String(minor));
  const held = inspectSourceFreeRefusedAlert({ source: body, sender: 'ENBD', observedAt: at, channel: 'inbox', session });
  assert.equal(held.kind, 'review'); assert.equal(held.candidate.event.status, 'informational');
  assert.equal(held.candidate.event.direction, 'none');
}
function assertNonPostingRefundNative(body, requireRetention = false) {
  const result = confirmationNative(body);
  assert.ok(result.route === 'ignore' || result.route === 'review', body);
  if (requireRetention || result.route === 'review') assertInformationalRefund(body, result);
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
        assertCreditOrReview(parsed, body, minor);
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
      assertNonPostingRefundNative(body, true);
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
      assertCreditOrReview(parsed, body, 10000);
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
          assertCreditOrReview(parsed, body, minor);
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
      assertNonPostingRefundNative(body);
    });
  }
}
for (const [label, merchant] of [['spaced', 'ماركس و سبنسر'], ['glued', 'ماركس وسبنسر']]) {
  test(`Arabic refund merchant with waw posts/${label}`, () => {
    const body = `تم استرداد مبلغ 100.00 درهم إلى بطاقتك المنتهية بـ 1234 من ${merchant}.`;
    const session = reader('AE');
    for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
      assertCreditOrReview(parsed, body, 10000);
    }
  });
}

// Review c1379af4 (High at 59d00136): the completed-credit rule must not turn a refusal into income.
// A merchant past the old 40-character window makes the new rule the only thing that can settle the refund.
const longRefundMerchant = 'CARREFOUR HYPERMARKET MALL OF THE EMIRATES';
const refundAck = 'Your refund request has been received.';
for (const [kind, body] of [
  ['credited-to-merchant', `${refundAck} Refund of AED 100.00 from ${longRefundMerchant} has been credited to the merchant for approval.`],
  ['credited-to-beneficiary', `${refundAck} Refund of AED 100.00 from ${longRefundMerchant} was credited to the beneficiary account.`],
  ['posted-to-merchant-then-future', `${refundAck} Refund of AED 100.00 from ${longRefundMerchant} has been posted to the merchant, it will be credited to your card in 5 days.`],
  ['if-conditional', `${refundAck} If the refund of AED 100.00 from ${longRefundMerchant} has been credited to your card, please ignore this message.`],
  ['once-conditional', `${refundAck} Once the refund of AED 100.00 from ${longRefundMerchant} has been credited to your card, you will get an SMS.`],
  ['will-be-notified-when', `${refundAck} You will be notified when the refund of AED 100.00 from ${longRefundMerchant} has been credited to your card.`],
  ['credited-in-error-reversed', `${refundAck} Refund of AED 100.00 from ${longRefundMerchant} was credited to your card in error and has been reversed.`],
  ['until-it-has-been-credited', `${refundAck} Your refund of AED 100.00 from ${longRefundMerchant} is not final until it has been credited to your card.`],
  ['wrong-refund-amount', `Your refund request for AED 100.00 has been received. A previous refund from ${longRefundMerchant} of AED 20.00 has been credited to your card.`],
  // Review 11a5b249 (High): the requested amount must be read from the whole acknowledgement sentence, in either currency order.
  ['wrong-refund-amount-currency-after', `Your refund request for 100.00 AED has been received. A previous refund of AED 20.00 from ${longRefundMerchant} has been credited to your card.`],
  ['wrong-refund-amount-request-of', `We have received your refund request of AED 100.00. A previous refund of AED 20.00 from ${longRefundMerchant} has been credited to your card.`],
  // Review 11a5b249 (Low): a reversal or a hold in the NEXT sentence or "subject to approval" is not an actual credit.
  ['reversed-in-next-sentence', `${refundAck} Refund of AED 100.00 from ${longRefundMerchant} was credited to your card on 10/11. This credit has been reversed as the merchant cancelled it.`],
  ['subject-to-merchant-approval', `${refundAck} Refund of AED 100.00 from ${longRefundMerchant} has been posted to your account subject to merchant approval.`],
]) {
  test(`refund credit rule refuses/${kind}`, () => {
    const session = reader('AE');
    assert.equal(parseSms(body), null);
    assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
    assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
    assertNonPostingRefundNative(body);
  });
}
for (const [kind, body, minor] of [
  ['original-payment-method-dotted', `${refundAck} Refund of AED 100.00 from NOON.COM has been credited to the original payment method.`, 10000],
  ['the-card', `${refundAck} Refund of AED 100.00 from ${longRefundMerchant} has been credited to the card.`, 10000],
  ['successfully-refunded-dotted', `${refundAck} Refund of AED 100.00 from APPLE.COM/BILL has been successfully refunded to your card.`, 10000],
  ['credited-back-to-the-account', `${refundAck} Refund of AED 100.00 from ${longRefundMerchant} has been credited back to the account.`, 10000],
  ['request-states-the-same-amount', `Your refund request for AED 100.00 has been received. Refund of AED 100.00 from ${longRefundMerchant} has been credited to your card.`, 10000],
  // Review 11a5b249 (Low): a leader that a comma separates from the credit does not govern it.
  ['leader-then-comma-after-verification', `${refundAck} After verification, the refund of AED 100.00 from ${longRefundMerchant} has been credited to your card.`, 10000],
]) {
  test(`refund credit rule posts/${kind}`, () => {
    const session = reader('AE');
    assert.equal(nonPostingReason(body), null);
    for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
      assertCreditOrReview(parsed, body, minor);
    }
  });
}

// CEO decision 51818dc1: REFUND_RE's own settled test must run through the same guards. With a merchant inside the old
// 40-character window these bodies used to settle and post income: credited to the merchant or a beneficiary, a
// conditional or negated sentence, a credit made in error and reversed, and a previous refund of another amount.
const shortRefundMerchant = 'IKEA';
const refundAckAmount = 'Your refund request for AED 100.00 has been received.';
for (const [kind, body] of [
  ['credited-to-merchant', `${refundAck} Refund of AED 100.00 from ${shortRefundMerchant} has been credited to the merchant for approval.`],
  ['credited-to-beneficiary', `${refundAck} Refund of AED 100.00 from ${shortRefundMerchant} was credited to the beneficiary account.`],
  ['posted-to-merchant-then-future', `${refundAck} Refund of AED 100.00 from ${shortRefundMerchant} has been posted to the merchant, it will be credited to your card in 5 days.`],
  ['if-conditional', `${refundAck} If the refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card, please ignore this message.`],
  ['once-conditional', `${refundAck} Once the refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card, you will get an SMS.`],
  ['notified-when', `${refundAck} You will be notified when the refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card.`],
  ['credited-in-error-reversed', `${refundAck} Refund of AED 100.00 from ${shortRefundMerchant} was credited to your card in error and has been reversed.`],
  ['wrong-refund-amount', `${refundAckAmount} A previous refund from ${shortRefundMerchant} of AED 20.00 has been credited to your card.`],
  ['ack-amount-once', `${refundAckAmount} Once the refund has been credited to your card, you will receive an SMS.`],
  ['ack-amount-if-already', `${refundAckAmount} If the refund has already been credited to your card, please ignore this message.`],
  ['ack-amount-not-yet', `${refundAckAmount} The refund has not been credited to your card yet.`],
  ['ack-amount-after', `${refundAckAmount} You will get an SMS after the refund has been posted to your card.`],
  ['no-ack-once', 'Once the refund of AED 100.00 has been credited to your card ending 1234, you will receive an SMS.'],
  ['no-ack-if', 'If the refund of AED 100.00 has been credited to your card, please ignore this message.'],
  ['no-ack-to-merchant', `Refund of AED 100.00 from ${shortRefundMerchant} has been credited to the merchant for approval.`],
  ['no-ack-in-error-reversed', `Refund of AED 100.00 from ${shortRefundMerchant} was credited to your card in error and has been reversed.`],
  ['no-ack-not-yet', 'The refund of AED 100.00 has not been credited to your card yet.'],
  ['no-ack-after', 'You will get an SMS after the refund of AED 100.00 has been posted to your card.'],
  ['no-ack-long-merchant-to-merchant', `Refund of AED 100.00 from ${longRefundMerchant} has been credited to the merchant for approval.`],
  ['owner-is-not-a-card', `${refundAck} Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your merchant for approval.`],
]) {
  test(`refund hardening refuses/${kind}`, () => {
    const session = reader('AE');
    assert.equal(parseSms(body), null);
    assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
    assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
    assertNonPostingRefundNative(body);
  });
}
for (const [kind, body, minor] of [
  ['plain-short-merchant', `Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card ending 1234.`, 10000],
  ['plain-credited-to-your-card-from', 'Refund of AED 89.00 has been credited to your card from DELIVEROO', 8900],
  ['plain-dotted-merchant-original-method', 'Refund of AED 100.00 from NOON.COM has been credited to the original payment method.', 10000],
  ['plain-long-merchant', `Refund of AED 100.00 from ${longRefundMerchant} has been credited to your card ending 1234.`, 10000],
  ['plain-credited-back-to-account', `Refund of AED 100.00 from ${shortRefundMerchant} has been credited back to your account.`, 10000],
  ['plain-multiword-owner', `Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your Mashreq Platinum Credit Card ending 1234.`, 10000],
  ['plain-then-conditional-footer-sentence', `Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card ending 1234. If you did not request this refund, call 600 500000.`, 10000],
  ['plain-and-merchant', 'Refund of AED 100.00 from MARKS AND SPENCER has been credited to your card ending 1234.', 10000],
  ['ack-short-merchant', `${refundAck} Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card ending 1234.`, 10000],
  ['ack-amount-same-short-merchant', `${refundAckAmount} Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card ending 1234.`, 10000],
  ['ack-long-merchant', `${refundAck} Refund of AED 100.00 from ${longRefundMerchant} has been credited to your card ending 1234.`, 10000],
  ['ack-after-verification-comma', `${refundAck} After verification, the refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card.`, 10000],
]) {
  test(`refund hardening posts/${kind}`, () => {
    const session = reader('AE');
    assert.equal(nonPostingReason(body), null);
    for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
      assertCreditOrReview(parsed, body, minor);
    }
  });
}
// Arabic: a completed refund posts at a short and a long merchant; an acknowledgement plus credit is refused by the
// separate Arabic rule at every length, so it cannot be a must-post (pinned as unchanged).
test('refund hardening Arabic completed refunds post/short and long', () => {
  const session = reader('AE');
  for (const merchant of ['نون', 'مطعم الشام للمأكولات والمشروبات الشرقية والغربية في دبي مول فرع']) {
    const body = `تم استرداد مبلغ 100.00 درهم إلى بطاقتك المنتهية بـ 1234 من ${merchant}.`;
    for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
      assertCreditOrReview(parsed, body, 10000);
    }
  }
});
test('refund hardening Arabic acknowledgement plus credit stays refused/unchanged', () => {
  const session = reader('AE');
  const body = 'تم استلام طلب استرداد مبلغ 100.00 درهم من نون. تم استرداد المبلغ إلى بطاقتك المنتهية بـ 1234.';
  assert.equal(parseSms(body), null);
  assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
});

// Review 341abedb (Change Reviewer, on the amount-binding patch). An amount glued to its currency ("AED100") must still be
// read as the requested amount; a credit that can still be taken back (temporary, on hold, under review, provisional, or
// cancelled in the next sentence) is not income; an ordinary footer must not refuse a genuine credit; and a request
// reference ("REF 556677") is not a currency amount.
const holdAck = 'Your refund request has been received.';
for (const [kind, body] of [
  ['finding1-glued-currency', `Your refund request for AED100 has been received. A previous refund of AED 20.00 from ${longRefundMerchant} has been credited to your card.`],
  ['finding1-glued-currency-short-merchant', `Your refund request for AED100 has been received. A previous refund of AED 20.00 from ${shortRefundMerchant} has been credited to your card.`],
  ['finding2-temporary-credit-pending-investigation', `${holdAck} Refund of AED 100.00 from ${longRefundMerchant} has been credited to your card as a temporary credit pending investigation.`],
  ['finding2-on-hold', `${holdAck} Refund of AED 100.00 from ${longRefundMerchant} has been credited to your account and is on hold.`],
  ['finding2-under-review', `${holdAck} Refund of AED 100.00 from ${longRefundMerchant} has been credited to your card and is under review.`],
  ['finding2-provisionally', `${holdAck} Refund of AED 100.00 from ${longRefundMerchant} has been credited to your card provisionally.`],
  ['finding2-cancelled-next-sentence', `${holdAck} Refund of AED 100.00 from ${longRefundMerchant} has been credited to your card. The credit was cancelled by the merchant.`],
  ['finding2-no-ack-on-hold', `Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card and is on hold.`],
  ['finding2-no-ack-cancelled-next-sentence', `Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card. This refund has been withdrawn by the merchant.`],
  ['finding2-no-ack-and-later-cancelled', `Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card but was later cancelled.`],
  ['finding2-credit-is-temporary-next-sentence', `Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card. The credit is temporary and under review.`],
]) {
  test(`refund hardening refuses/${kind}`, () => {
    const session = reader('AE');
    assert.equal(parseSms(body), null);
    assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
    assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
  });
}
for (const [kind, body, minor] of [
  ['finding3-footer-may-be-reversed', `Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card ending 1234. Disputed transactions may be reversed.`, 10000],
  ['finding3-footer-if-credited-in-error', `Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card ending 1234. If credited in error, call 600 54 0000.`, 10000],
  ['finding3-ack-footer-may-be-reversed', `${holdAck} Refund of AED 100.00 from ${longRefundMerchant} has been credited to your card ending 1234. Disputed transactions may be reversed.`, 10000],
  ['finding3-ack-footer-if-credited-in-error', `${holdAck} Refund of AED 100.00 from ${longRefundMerchant} has been credited to your card ending 1234. If credited in error, call 600 54 0000.`, 10000],
  ['finding3-credit-for-a-cancelled-order', `Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card ending 1234 for your cancelled order.`, 10000],
  ['finding3-footer-about-cancelled-orders', `Refund of AED 100.00 from ${shortRefundMerchant} has been credited to your card ending 1234. Orders that were cancelled are refunded within 5 days.`, 10000],
  ['finding4-request-reference-is-not-a-currency', `Your refund request REF 556677 has been received. Refund of AED 100.00 from ${longRefundMerchant} has been credited to your card ending 1234.`, 10000],
  ['finding4-amount-before-refund-word', `Your refund request for AED 100.00 has been received. AED 100.00 refund from ${longRefundMerchant} has been credited to your card ending 1234.`, 10000],
  ['finding4-amount-after-destination', `Your refund request for AED 100.00 has been received. Refund from ${longRefundMerchant} has been credited to your card ending 1234 for AED 100.00.`, 10000],
  ['finding4-glued-currency-same-amount', `Your refund request for AED100 has been received. Refund of AED 100.00 from ${longRefundMerchant} has been credited to your card ending 1234.`, 10000],
]) {
  test(`refund hardening posts/${kind}`, () => {
    const session = reader('AE');
    assert.equal(nonPostingReason(body), null);
    for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
      assertCreditOrReview(parsed, body, minor);
    }
  });
}

// Regression from the final #176 head (universal test "negation applies to coordinated refund verbs until an explicit
// new clause"): a negated credit followed, in the same sentence, by a new clause whose credit is completed is a credit.
// A negated credit with only a future or no new credit, or a credit in a different sentence, stays refused.
for (const [kind, body] of [
  ['negated-then-future-credit', 'Refund of AED 125.00 has not been credited and the refund will be credited to your card in 5 days.'],
  ['negated-then-credit-in-next-sentence', 'The first refund of AED 125.00 has not been credited. The second refund has been credited to your card.'],
  ['negated-then-credit-to-merchant', 'Refund of AED 125.00 has not been credited and the refund has now been credited to the merchant.'],
]) {
  test(`refund hardening refuses/${kind}`, () => {
    const session = reader('AE');
    assert.equal(parseSms(body), null);
    assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
    assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
  });
}
// Universal test "negation applies to coordinated refund verbs until an explicit new clause": "has not been credited and was
// debited from your account" is an expense (the new clause has its own auxiliary); without that auxiliary the negation
// still covers the debit and the message stays refused.
for (const auxiliary of ['was', 'has been']) {
  test(`refund hardening posts/negated-credit-then-${auxiliary.replace(' ', '-')}-debited-is-an-expense`, () => {
    const session = reader('AE');
    const body = `Refund of AED 125.00 has not been credited and ${auxiliary} debited from your account.`;
    for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
      assert.equal(parsed?.type, 'expense');
      assert.equal(parsed.amountFils, 12500);
    }
  });
}
for (const verb of ['debited from your account', 'charged to your card']) {
  test(`refund hardening refuses/negation-covers-the-coordinated-${verb.split(' ')[0]}`, () => {
    const body = `Refund of AED 125.00 has not been credited and ${verb}.`;
    assert.equal(parseSms(body), null);
    assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
  });
}
test('refund hardening posts/negated-then-new-clause-credited', () => {
  const session = reader('AE');
  const body = 'Refund of AED 125.00 has not been credited and the refund has now been credited to your card.';
  assert.equal(nonPostingReason(body), null);
  for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
    session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
    assertCreditOrReview(parsed, body, 12500);
  }
});

// Review 1e2ad89f (Change Reviewer): a debit alert whose only amount is in its own debit sentence, plus a refund sentence
// with no amount. A negated "refunded" or a conditional refund credit settles nothing, so the debit posts as an expense
// (it used to post income, or be dropped). A completed refund sentence without its own amount is a second movement, so the
// alert never auto-posts (it used to book the debit amount as income). A negated "refunded" with its own amount is refused.
const sideNoteDebit = 'AED 250.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026.';
const sideNotePurchase = 'Purchase of AED 50.00 with Debit Card ending 1234 at CARREFOUR.';
const negatedFeeNote = ' The annual fee is not refunded to your card.';
const conditionalRefundNote = ' When a refund is credited to your card you will receive an SMS.';
// The native bundle posts only when its own event reader agrees with the parser. It ignores the plain "was debited from
// your card" debit with or without a note, and it still declines the "When a refund is credited ..." footer on the
// confirmed debit (as before this fix); it never posts any of these as a credit. A future refund footer ("The refund will
// be credited ...") was already removed by the parser's future-footer rule, so the debit posts, now on every path.
for (const [kind, base, note, minor, nativeRoute] of [
  ['no-note', sideNoteDebit, '', 25000, 'ignore'],
  ['negated-refunded-fee', sideNoteDebit, negatedFeeNote, 25000, 'ignore'],
  ['negated-refunded-has-not-been', sideNoteDebit, ' The annual fee has not been refunded to your card.', 25000, 'ignore'],
  ['conditional-when-refund-credited', sideNoteDebit, conditionalRefundNote, 25000, 'ignore'],
  ['conditional-if-refund-credited', sideNoteDebit, ' If a refund is credited to your card, you will receive an SMS.', 25000, 'ignore'],
  ['plural-refunds-if-any', sideNoteDebit, ' Refunds, if any, will be credited to your card.', 25000, 'ignore'],
  ['future-refund-footer', sideNoteDebit, ' The refund will be credited to your card in 5 days.', 25000, 'ignore'],
  // Deliberate oracle change (refund matrix, CEO 711485d5 D3 and 1014684b D4): a "not refunded" note, or a refund still being
  // processed, beside a completed debit posts the debit as an expense. Before the matrix these four were "never auto-posts";
  // they still never post income.
  ['purchase-not-refunded', sideNoteDebit, ' Your purchase has not been refunded to your card.', 25000, 'ignore'],
  ['the-refund-is-being-processed', sideNoteDebit, ' The refund is being processed.', 25000, 'ignore'],
  ['a-refund-of-the-same-is-being-processed', sideNoteDebit, ' A refund of the same is being processed.', 25000, 'ignore'],
  ['it-is-being-refunded', sideNoteDebit, ' It is being refunded to your card.', 25000, 'ignore'],
  ['purchase-alert-no-note', sideNotePurchase, '', 5000, 'parsed'],
  ['purchase-alert-negated-fee', sideNotePurchase, negatedFeeNote, 5000, 'parsed'],
  ['confirmed-debit-no-note', confirmedDebit, '', 8500, 'parsed'],
  ['confirmed-debit-negated-fee', confirmedDebit, negatedFeeNote, 8500, 'parsed'],
  ['confirmed-debit-when-refund-credited', confirmedDebit, conditionalRefundNote, 8500, 'ignore'],
]) {
  test(`refund hardening side note posts the debit/${kind}`, () => {
    const session = reader('AE');
    const body = base + note;
    assert.equal(nonPostingReason(body), null);
    for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
      assert.equal(parsed?.kind, 'transaction');
      assert.equal(parsed.type, 'expense');
      assert.equal(parsed.amountFils, minor);
      assert.equal(parsed.currency, 'AED');
    }
    const native = confirmationNative(body);
    assert.equal(native.route, 'parsed');
    if (native.route === 'parsed') {
      assert.equal(native.notification.direction, 'debit');
      assert.deepEqual(native.notification.amount, { currency: 'AED', minorUnits: String(minor), exponent: 2 });
    }
  });
}
for (const [kind, base, note] of [
  ['refund-for-cancelled-order-credited', sideNoteDebit, ' Refund for your cancelled order has been credited to your card.'],
  ['refund-processed-to-card', sideNoteDebit, ' Your refund has been processed to your card.'],
  ['confirmed-debit-refund-credited', confirmedDebit, ' Refund for your cancelled order has been credited to your card.'],
  ['the-refund-for-another-order-credited', sideNoteDebit, ' The refund for your cancelled order has been credited to your card.'],
  // Review f757be84 (Change Reviewer, on fix3b): a debit sentence only stops being a separate debit when it says the debit
  // itself was reversed, not when a word like "returned" or "reversed" sits anywhere in it; and a refund of the debit only
  // counts as the same movement when it is completed, never while it "is being processed" or "is being refunded".
  ['returned-cheque-fee-debit-then-another-refund', 'A returned cheque fee of AED 50.00 was debited from your account ending 1234.', ' Refund for your cancelled order has been credited to your card.'],
  ['reversed-charges-apply-then-another-refund', 'AED 250.00 was debited from your card ending 1234 at NOON.COM (reversed charges apply).', ' Refund for your cancelled order has been credited to your card.'],
]) {
  test(`refund hardening side note is ambiguous and never auto-posts/${kind}`, () => {
    if (kind !== 'reversed-charges-apply-then-another-refund') { assertDebitAndNote(base + note, base === sideNotePurchase || base.startsWith('A returned cheque') ? 5000 : base === confirmedDebit ? 8500 : 25000); return; }
    const session = reader('AE');
    const body = base + note;
    assert.equal(parseSms(body), null);
    assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
    assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
    assert.notEqual(confirmationNative(body).route, 'parsed'); // Ambiguous original debit; no direction is invented.
  });
}
for (const [kind, body] of [
  ['is-not-refunded', 'AED 100.00 is not refunded to your card ending 1234.'],
  ['has-not-been-refunded', 'AED 100.00 has not been refunded to your card ending 1234.'],
]) {
  test(`refund hardening refuses/negated-refunded-with-its-own-amount-${kind}`, () => {
    const session = reader('AE');
    assert.equal(parseSms(body), null);
    assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
    assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
    assertNonPostingRefundNative(body);
  });
}
// Review ae81e7b9 (Change Reviewer, on fix3): a refund of the debited purchase itself is one movement and still posts as
// income. A debit sentence that also says it was reversed is not a separate debit, and an unqualified "The refund has been
// credited" or "A refund of the same has been credited" names that same movement.
for (const [kind, body] of [
  ['reversed-debit-then-the-refund', 'AED 250.00 charged at NOON.COM on 01/11 has been reversed. The refund has been credited to your card ending 1234.'],
  ['charged-then-a-refund-of-the-same', 'Your card ending 1234 was charged AED 250.00 at NOON.COM on 01/11. A refund of the same has been credited to your card.'],
  ['debit-then-the-refund-credited', `${sideNoteDebit} The refund has been credited to your card.`],
]) {
  test(`refund hardening posts/same-movement-refund-${kind}`, () => {
    if (kind === 'debit-then-the-refund-credited' || kind === 'charged-then-a-refund-of-the-same') { assertDebitAndNote(body, 25000); return; }
    const session = reader('AE');
    assert.equal(nonPostingReason(body), null);
    for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
      assertCreditOrReview(parsed, body, 25000);
    }
    const native = confirmationNative(body);
    assert.notEqual(native.route === 'parsed' ? native.notification.direction : null, 'debit', 'native never books the refund as a purchase');
  });
}
test('refund hardening posts/genuine-refund-with-a-negated-fee-footer', () => {
  const session = reader('AE');
  const body = 'Refund of AED 100.00 from IKEA has been credited to your card ending 1234. The delivery fee is not refunded.';
  assert.equal(nonPostingReason(body), null);
  for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
    session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
    assertCreditOrReview(parsed, body, 10000);
  }
});

// CEO decision 51818dc1 (c): a genuine debit that carries a link-WORD footer ("tap here", "click the link", no URL) must
// reach Review with its exact money, never be silently dropped; it still never auto-posts. A footer with a real URL
// stays refused as a link request.
for (const [kind, source] of [
  ['tap-here-to-block', 'Purchase of AED 50.00 with Debit Card ending 1234 at CARREFOUR. Avl Bal AED 1,000.00. If not you, tap here to block your card.'],
  ['click-the-link-to-report', 'AED 50.00 was debited from your account ending 1234 at CARREFOUR. If you did not make this transaction, click the link to report it.'],
  ['click-below-to-report', 'Purchase of AED 50.00 with Credit Card ending 1234 at CARREFOUR. To report a problem with this purchase, click below.'],
]) {
  test(`genuine debit with a link-word footer reaches Review/${kind}`, () => {
    const session = reader('AE');
    assert.equal(parseSms(source), null, 'never auto-posts');
    assert.equal(session.parse(source, 'ENBD', session.inspect(source, 'ENBD'), undefined, at), null);
    const held = inspectSourceFreeRefusedAlert({ source, sender: 'ENBD', observedAt: at, channel: 'inbox', session });
    assert.equal(held.kind, 'review');
    const money = held.candidate?.event?.amount.value ?? held.candidate?.amount;
    assert.deepEqual(JSON.parse(JSON.stringify(money)), { currency: 'AED', minorUnits: '5000', exponent: 2 });
  });
}
test('debit with a footer that names a real URL stays refused as a link request', () => {
  const session = reader('AE');
  const source = 'AED 581.48 debited from your account ending 1234. If not you, tap https://secure-rakbank.example/login to cancel.';
  assert.equal(parseSms(source), null);
  const held = inspectSourceFreeRefusedAlert({ source, sender: 'ENBD', observedAt: at, channel: 'inbox', session });
  assert.equal(held.kind, 'declined');
  assert.equal(held.reason, 'link-request');
});

// FIX4 (CEO 676bbe7a, Change Reviewer: High): a completed refund of a card purchase is income on every path. parseSms read
// "Purchase amount of AED 250.00 at NOON.COM on your Debit Card has been refunded." as income, but the launch session and the
// native bundle booked it as a AED 250 purchase: the interpreter only kept the parser's refund when the shop name had no dot
// and the card came right before "has been refunded", and otherwise let its purchase reading win. The same dot hid the
// request in "Your refund request for the purchase amount of AED 250.00 at NOON.COM has been received.", posted as a purchase.
for (const [kind, body] of [
  ['dotted-shop-no-card-digits', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card has been refunded.'],
  ['dotted-shop-with-card-digits', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card ending 1234 has been refunded.'],
  ['plain-shop-no-card-digits', 'Purchase amount of AED 250.00 at NOON on your Debit Card has been refunded.'],
  ['www-shop-successfully-to-card', 'Purchase amount of AED 250.00 at WWW.NOON.COM on your Credit Card ending 1234 has been successfully refunded to your card.'],
  ['purchase-of-card-then-dotted-shop-refunded', 'Purchase of AED 250.00 with Debit Card ending 1234 at NOON.COM has been refunded.'],
  ['purchase-of-card-then-shop-refunded', 'Purchase of AED 250.00 with Debit Card ending 1234 at NOON has been refunded.'],
  ['purchase-of-dotted-shop-then-card-reversed', 'Purchase of AED 250.00 at NOON.COM with Debit Card ending 1234 has been reversed.'],
  // Review 4637ac64: a hedged footer about reversals in general is not this refund being taken back.
  ['refunded-then-hedged-footer', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card has been refunded. Disputed transactions may be reversed.'],
]) {
  test(`refund hardening posts/completed-purchase-refund-${kind}`, () => {
    const session = reader('AE');
    assert.equal(nonPostingReason(body), null);
    for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
      assertCreditOrReview(parsed, body, 25000);
    }
    const native = confirmationNative(body);
    assert.notEqual(native.route === 'parsed' ? native.notification.direction : null, 'debit', 'native never books the refund as a purchase');
  });
}
// CEO 1014684b (b): a completed purchase refund to the user's OWN ACCOUNT is income on all three paths, as "to your card"
// is; native booked it as a debit.
for (const [kind, body] of [
  ['own-account-with-digits', 'Purchase amount of AED 250.00 at NOON.COM on your account ending 1234 has been refunded.'],
  ['own-account-plain-shop', 'Purchase amount of AED 250.00 at NOON on your account ending 1234 has been refunded.'],
]) {
  test(`refund hardening posts/completed-purchase-refund-to-own-${kind}`, () => {
    const session = reader('AE');
    assert.equal(nonPostingReason(body), null);
    for (const parsed of [parseSms(body), parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
      session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
      assertCreditOrReview(parsed, body, 25000);
    }
    const native = confirmationNative(body);
    assert.equal(native.route, 'parsed', 'native posts it');
    assert.equal(native.notification.direction, 'credit');
    assert.deepEqual(native.notification.amount, { currency: 'AED', minorUnits: '25000', exponent: 2 });
  });
}
// The same purchase while its refund is pending, requested or negated stays refused on every path.
for (const [kind, body] of [
  ['will-be-refunded', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card will be refunded.'],
  ['has-not-been-refunded', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card has not been refunded.'],
  ['refund-pending', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card is pending refund.'],
  ['refund-request-received', 'Your refund request for the purchase amount of AED 250.00 at NOON.COM has been received.'],
  // Review 4637ac64 (Change Reviewer, on fix4): a bare "has been refunded" that is taken back later is not income either.
  ['refunded-then-reversed-by-merchant', 'Purchase of AED 250.00 with Debit Card ending 1234 at NOON.COM has been refunded. The refund was reversed by the merchant.'],
  ['amount-refunded-then-cancelled', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card has been refunded. This refund has been cancelled.'],
  ['refunded-and-on-hold', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card has been refunded to your card and is on hold.'],
]) {
  test(`refund hardening refuses/purchase-refund-${kind}`, () => {
    const session = reader('AE');
    assert.equal(parseSms(body), null);
    assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
    assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
    assert.notEqual(confirmationNative(body).route, 'parsed');
  });
}

// Known limits of fix3, pinned so a change is deliberate (CEO 676bbe7a).
// 1. The native bundle declines the confirmed debit with a conditional refund footer (its event reader disagrees); the
//    parser and the launch session post the expense. Native never books a credit for it.
test('refund hardening known limit/native declines a confirmed debit with a conditional refund footer', () => {
  const session = reader('AE');
  const body = `${confirmedDebit}${conditionalRefundNote}`;
  for (const parsed of [parseSms(body, {}, { sender: 'ENBD', observedAt: at }),
    session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at)]) {
    assert.equal(parsed?.type, 'expense');
    assert.equal(parsed.amountFils, 8500);
  }
  assertDebitAndNote(body, 8500);
});
// 2. "Purchase of ..." is not a separate debit sentence, so a conditional refund footer on that shape keeps the older
//    refusal (pending-processing): the purchase is not posted, and nothing is posted as income.
test('refund hardening known limit/a conditional refund footer on a "Purchase of" alert keeps the old refusal', () => {
  const session = reader('AE');
  const body = `${sideNotePurchase}${conditionalRefundNote}`;
  assert.equal(nonPostingReason(body), 'pending-processing');
  assertDebitAndNote(body, 5000);
});
