'use strict';
// 1.0.1, issues #238 and #244. Synthetic bodies only.
// #238: a purchase beside a refund note of ANOTHER figure (oracle D1) is never income and never silently lost: when the
// pair proof cannot post it, capture and history keep an informational Review item that carries the purchase's own figure
// and direction (retention, not confirmation authority, as for the unaccepted pair). A status sentence, a figure-less note
// or a recap of the same purchase keeps the old outcome, so a declined purchase never gains a Review.
// #244 / #238 second gap: a credit that is conditional, pending, a refund request, or "subject to" a condition in its own
// or the next sentence (English and Arabic) never posts as income on parseSms, the session, history or the native bundle;
// it reaches Review as informational money that confirmation cannot book.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const country = load('@/lib/country');
const markets = load('@/lib/markets');
const { parseSms } = load('@/lib/sms-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { inspectSourceFreeRefusedAlert } = load('@/lib/auto-import');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { isMoneyMovementReview } = load('@/lib/alert-review-tray');
const { planConfirmedUniversalImport } = load('@/lib/universal-import');

const at = Date.parse('2026-11-14T10:00:00Z');
const resources = path.resolve(__dirname, '../../../modules/wafra-live-capture/ios/Resources');
const meta = JSON.parse(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.meta.json'), 'utf8'));
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(resources, 'WafraBackgroundParser.js'), 'utf8'), sandbox);
const native = (body, sender, market, currency) => JSON.parse(sandbox.wafraNativeAlertParse(JSON.stringify({ v: 1, body, sender,
  observedAt: at, context: { v: 1, country: market, parserMarket: market, ledgerMoney: { currency, exponent: 2 }, sourceHash: meta.sourceHash } })));

function setup(market, currency) {
  country.setActiveCountry(market); markets.setActiveMarket(market); markets.setLedgerCurrency(currency, 2);
  return createLaunchAlertSession({ overrides: {}, activeMarket: market, pinnedCurrency: currency, bestEffort: { enabled: true, country: market } });
}
let historyId = 0;
function history(body, sender, session) {
  const id = crypto.createHash('sha256').update(`d1-conditional:${historyId++}`).digest('hex');
  return parseHistoricalMessageRecords([JSON.stringify({ v: 1, id, text: body, sender, receivedAt: new Date(at).toISOString() })],
    {}, new Date(at), new Set(), session);
}
const eventOf = (candidate) => candidate.kind === 'universal' ? candidate.event : null;

// #238: other debit wordings beside a refund of another figure. Before 1.0.1 these gave an amount-free credit Review (or
// nothing): the purchase was lost.
const D1_GULF = [
  ['AE', 'AED', 'ENBD', 'Debit Card Purchase of AED 250.00 at NOON.COM, card ending 1234. A refund of AED 100.00 has been credited to your card.'],
  ['AE', 'AED', 'ADCB', 'AED 250.00 has been deducted from your account ending 1234 at NOON.COM. Refund of AED 100.00 credited to your card.'],
  ['AE', 'AED', 'FAB', 'AED 250.00 has been deducted from your account ending 1234 at NOON.COM. A refund of AED 100.00 will be credited within 7 days.'],
  ['AE', 'AED', 'ENBD', 'تمت عملية شراء بمبلغ 250.00 درهم لدى NOON باستخدام بطاقتك المنتهية بـ 1234. تم استرداد مبلغ 100.00 درهم إلى بطاقتك.'],
  ['AE', 'AED', 'ENBD', 'تم استخدام بطاقتك المنتهية بـ 1234 لشراء بمبلغ 250.00 درهم لدى NOON. تم إيداع مبلغ 100.00 درهم في حسابك.'],
  ['AE', 'AED', 'ADCB', 'عملية شراء بمبلغ 250.00 درهم لدى NOON بواسطة بطاقتك المنتهية بـ 1234. سيتم استرداد مبلغ 100.00 درهم خلال 7 أيام.'],
  ['SA', 'SAR', 'SNB', 'تمت عملية شراء بمبلغ 250.00 ريال لدى جرير باستخدام بطاقتك المنتهية بـ 1234. تم استرداد مبلغ 100.00 ريال إلى بطاقتك.'],
];
for (const [market, currency, sender, body] of D1_GULF) test(`#238 D1 purchase reaches Review as the purchase (${market} ${sender}): ${body.slice(0, 48)}`, () => {
  const session = setup(market, currency);
  const parsed = parseSms(body, {}, { sender, observedAt: at });
  assert.notEqual(parsed?.type, 'income', 'parseSms never books the note as income');
  assert.equal(session.parse(body, sender, session.inspect(body, sender), undefined, at), null, 'D1 is not posted automatically');
  const nativeResult = native(body, sender, market, currency);
  assert.notEqual(nativeResult.notification?.direction === 'credit' && nativeResult.route === 'parsed', true, 'native never credits');
  for (const channel of ['inbox', 'delivery', 'push']) {
    const decision = inspectSourceFreeRefusedAlert({ source: body, sender, observedAt: at, channel, session });
    assert.equal(decision.kind, 'review', `${channel}: Review, not a refusal`);
    const event = eventOf(decision.candidate);
    assert.ok(event, channel);
    assert.equal(event.direction, 'debit', `${channel}: the purchase's direction`);
    assert.deepEqual(event.amount.value, { currency, exponent: 2, minorUnits: '25000' }, `${channel}: the purchase's figure, not the note's`);
    assert.equal(event.status, 'informational', channel);
    assert.equal(isMoneyMovementReview(decision.candidate), false, `${channel}: retained, never booked by one tap`);
    for (const direction of ['debit', 'credit']) assert.equal(planConfirmedUniversalImport({ hydrated: true, transactions: [] }, event,
      { confirmed: true, postingStatus: 'posted', direction, amount: event.amount.value }).outcome, 'refused', `${channel}: ${direction}`);
  }
  const imported = history(body, sender, session);
  assert.equal(imported.parsed.length, 0);
  assert.equal(imported.reviewCandidates.length, 1);
  assert.equal(eventOf(imported.reviewCandidates[0])?.direction, 'debit');
  assert.equal(eventOf(imported.reviewCandidates[0])?.amount.value?.minorUnits, '25000');
});

// The same outside the Gulf: the generic reading keeps the purchase's figure, informational like the unaccepted pair.
for (const [market, currency, sender, body] of [
  ['US', 'USD', 'CHASE', 'Chase: $250.00 debited from your card ending 1234 at AMAZON. A refund of $100.00 was credited to your card.'],
  ['DE', 'EUR', 'Sparkasse', 'Chase: €250.00 debited from your card ending 1234 at AMAZON. A refund of €100.00 was credited to your card.'],
]) test(`#238 D1 outside the Gulf keeps the purchase's figure (${market})`, () => {
  country.setActiveCountry(market); markets.setLedgerCurrency(currency, 2);
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: currency, bestEffort: { enabled: true, country: market } });
  const inspection = session.inspect(body, sender);
  assert.equal(session.parse(body, sender, inspection, undefined, at) ?? session.parseUnproven(body, sender, inspection, at), null);
  const decision = inspectSourceFreeRefusedAlert({ source: body, sender, observedAt: at, channel: 'inbox', session });
  assert.equal(decision.kind, 'review');
  const event = eventOf(decision.candidate);
  assert.equal(event?.direction, 'debit');
  assert.equal(event?.amount.value?.minorUnits, '25000');
  assert.equal(event?.amount.value?.currency, currency);
  assert.equal(isMoneyMovementReview(decision.candidate), false);
});

// Review 1 (High 2): a purchase that is declined, failed, cancelled, reversed, on hold or in process, or recapped as refunded,
// keeps its 1.0.0 outcome: never a debit Review that could book spending that never happened, never income.
for (const body of [
  'Debit Card Purchase of AED 250.00 at NOON.COM. Transaction declined due to insufficient funds. A refund of AED 100.00 has been credited to your card.',
  'Debit Card Purchase of AED 250.00 at NOON.COM. Transaction failed. A refund of AED 100.00 has been credited to your card.',
  'Debit Card Purchase of AED 250.00 at NOON.COM. Transaction cancelled. A refund of AED 100.00 has been credited to your card.',
  'Debit Card Purchase of AED 250.00 at NOON.COM. This transaction has been reversed. A refund of AED 100.00 has been credited to your card.',
  'Debit Card Purchase of AED 250.00 at NOON.COM. Amount on hold. A refund of AED 100.00 has been credited to your card.',
  'Debit Card Purchase of AED 250.00 at NOON.COM. Partial refund of AED 100.00 credited. Purchase of AED 250.00 at NOON.COM has been refunded in full.',
  'Debit Card Purchase of AED 250.00 at NOON.COM. Your refund of AED 250.00 for this purchase is being processed.',
  'Total amount due AED 2,500.00, minimum payment AED 125.00 to be paid by 25/11. A refund of AED 100.00 has been credited to your card ending 1234.',
  'تمت عملية شراء بمبلغ 250.00 درهم لدى NOON باستخدام بطاقتك المنتهية بـ 1234. تم رفض العملية. تم استرداد مبلغ 100.00 درهم إلى بطاقتك.',
  'تمت عملية شراء بمبلغ 250.00 درهم لدى NOON باستخدام بطاقتك المنتهية بـ 1234. العملية قيد المعالجة. تم استرداد مبلغ 100.00 درهم إلى بطاقتك.',
]) test(`#238 a purchase with its own status or recap gains no debit Review: ${body.slice(0, 60)}`, () => {
  const session = setup('AE', 'AED');
  assert.notEqual(parseSms(body, {}, { sender: 'ENBD', observedAt: at })?.type, 'income');
  assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
  const decision = inspectSourceFreeRefusedAlert({ source: body, sender: 'ENBD', observedAt: at, channel: 'inbox', session });
  if (decision.kind === 'review') {
    assert.equal(isMoneyMovementReview(decision.candidate), false, 'nothing to confirm');
    assert.notEqual(eventOf(decision.candidate)?.direction, 'debit', 'no debit Review for a purchase that did not stand');
  }
});

// The strict D1 pair keeps its shipped policy (CEO 524bd56e): the debit posts, the note is informational.
test('#238 the proven D1 pair keeps posting its debit with an informational note', () => {
  const session = setup('AE', 'AED');
  for (const body of ['AED 250.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026. A refund of AED 100.00 has been credited to your card.',
    'تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM. تم استرداد مبلغ 100.00 درهم إلى بطاقتك.']) {
    const parsed = session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at);
    assert.equal(parsed?.type, 'expense'); assert.equal(parsed.amountFils, 25000);
    const decision = inspectSourceFreeRefusedAlert({ source: body, sender: 'ENBD', observedAt: at, channel: 'inbox', session, acceptedExpense: parsed });
    assert.equal(decision.kind, 'review');
    assert.equal(decision.candidate.event.direction, 'none');
    assert.equal(decision.candidate.event.amount.value?.minorUnits, '10000');
    assert.equal(isMoneyMovementReview(decision.candidate), false);
  }
});

// #244 and #238's second gap. The first nine (the issues' own bodies) were already held at 1.0.0 and stay as regression
// guards. Before 1.0.1 the rest (Arabic "subject to" collection or approval (خاضع/يخضع), "conditional" (مشروط),
// "provisional" (مبدئي), "under collection" (تحت التحصيل), "not available", and English "conditional" / "is under
// clearing") posted as income on every path.
const HELD = [
  ['AE', 'AED', 'ENBD', 'Refund request of AED 250.00 has been accepted and will reflect within 7 working days.'],
  ['AE', 'AED', 'ENBD', 'نود إعلامك أنه إن تم استرداد مبلغ 250.00 درهم إلى بطاقتك، ستصلك رسالة.'],
  ['AE', 'AED', 'ENBD', 'AED 250.00 has been credited to your account ending 1234. The cheque is subject to clearance.'],
  ['AE', 'AED', 'ADCB', 'AED 250.00 has been credited to your account ending 1234 subject to clearance.'],
  ['AE', 'AED', 'ADCB', 'AED 250.00 has been refunded to your card ending 1234 upon merchant confirmation.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك في حال الموافقة.'],
  ['AE', 'AED', 'ENBD', 'تم استرداد مبلغ 250.00 درهم إلى بطاقتك المنتهية بـ 1234 عند التحقق.'],
  ['AE', 'AED', 'ENBD', 'إنْ تمَّ استرداد مبلغ 250.00 درهم إلى بطاقتك ستصلك رسالة.'],
  ['AE', 'AED', 'ENBD', 'نَوَدُّ إعلامَك، إنْ تمَّ استرداد مبلغ 250.00 درهم إلى بطاقتك ستصلك رسالة.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234. الشيك خاضع للتحصيل.'],
  ['AE', 'AED', 'FAB', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234 خاضع للتحصيل.'],
  ['AE', 'AED', 'ENBD', 'تم استرداد مبلغ 250.00 درهم إلى بطاقتك المنتهية بـ 1234. يخضع المبلغ لموافقة التاجر.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234. الإيداع مشروط بتحصيل الشيك.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234. هذا إيداع مبدئي.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234. الشيك تحت التحصيل.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234. المبلغ غير متاح حتى تحصيل الشيك.'],
  ['AE', 'AED', 'ENBD', 'AED 250.00 has been credited to your account ending 1234. This credit is conditional.'],
  ['AE', 'AED', 'ENBD', 'AED 250.00 has been credited to your account ending 1234. The cheque is under clearing.'],
  ['AE', 'AED', 'EmiratesIslamic', 'تم إيداع 250.00 درهم في حسابك رقم XXX-XXXXXX-0015 وهي خاضعة لعملية تدقيق من خلال شيك رقم 987654.'],
  ['SA', 'SAR', 'SNB', 'تم إيداع مبلغ 250.00 ريال في حسابك المنتهي بـ 1234. المبلغ خاضع للتحصيل.'],
  ['SA', 'SAR', 'AlRajhiBank', 'تم إيداع مبلغ 250.00 ريال في حسابك المنتهي بـ 1234. الإيداع مشروط بتحصيل الشيك.'],
];
for (const [market, currency, sender, body] of HELD) test(`#244 an unsettled credit never posts and is held for Review (${market} ${sender}): ${body.slice(0, 48)}`, () => {
  const session = setup(market, currency);
  assert.notEqual(parseSms(body, {}, { sender, observedAt: at })?.type, 'income', 'parseSms');
  assert.equal(session.parse(body, sender, session.inspect(body, sender), undefined, at), null, 'session');
  const nativeResult = native(body, sender, market, currency);
  assert.notEqual(nativeResult.route, 'parsed', 'native never posts it');
  const decision = inspectSourceFreeRefusedAlert({ source: body, sender, observedAt: at, channel: 'inbox', session });
  assert.equal(decision.kind, 'review', 'Review, not a refusal');
  const event = eventOf(decision.candidate);
  assert.equal(event?.status, 'informational');
  assert.equal(event.direction, 'credit');
  assert.equal(event.amount.value?.minorUnits, '25000');
  assert.equal(isMoneyMovementReview(decision.candidate), false, 'no confirm-to-book action');
  assert.equal(planConfirmedUniversalImport({ hydrated: true }, { ...event, status: 'posted' },
    { confirmed: true, postingStatus: 'posted', direction: 'credit', amount: event.amount.value }).outcome, 'refused');
  const imported = history(body, sender, session);
  assert.equal(imported.parsed.length, 0, 'history posts nothing');
  assert.ok(!imported.reviewCandidates.some((item) => isMoneyMovementReview(item)), 'history holds it as information');
});

// Paired controls: the new condition words must not take a completed credit's income (review 1: High 1, Medium 3, Low 4).
const SETTLED = [
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234 بطلب من شركة الأمل.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234 لتسوية المطالبة رقم 5566.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234. شكرا لطلبك.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع راتبك بمبلغ 12000.00 درهم في حسابك المنتهي بـ 1234. الخدمات المصرفية خاضعة للشروط والأحكام.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234. خدمة الرسائل غير متاحة للرد.'],
  ['AE', 'AED', 'ENBD', 'AED 250.00 has been credited to your account ending 1234. Note: cheques under clearing are not included in your available balance.'],
  ['SA', 'SAR', 'SNB', 'إيداع راتب: 12000.00 ريال حساب: 1234. الخدمة خاضعة لشروط وأحكام البنك.'],
  // Review 2 (Low 1): fees, a regulator's approval, a periodic review, an outage and offer footers are not conditions.
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234. التحويلات خاضعة لرسوم العملية حسب جدول الرسوم.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع راتبك بمبلغ 12000.00 درهم في حسابك المنتهي بـ 1234. الخدمة خاضعة لموافقة مصرف الإمارات المركزي ولوائحه.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234. الخدمة غير متاحة حاليا.'],
  ['AE', 'AED', 'ENBD', 'AED 250.00 has been credited to your account ending 1234. Some cheques are under clearing.'],
  ['AE', 'AED', 'ENBD', 'Salary of AED 250.00 has been credited to your account ending 1234. Conditional cashback offers apply on card spends.'],
  ['AE', 'AED', 'ENBD', 'Cheque cleared: AED 250.00 has been credited to your account ending 1234.'],
  ['AE', 'AED', 'ENBD', 'Refund of AED 250.00 has been credited to your card ending 1234. Thank you for banking with us.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234. الرصيد المتاح 900.00 درهم.'],
  ['AE', 'AED', 'ENBD', 'تم استرداد مبلغ 250.00 درهم إلى بطاقتك المنتهية بـ 1234. شكراً لتعاملكم معنا.'],
  ['AE', 'AED', 'ENBD', 'تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234. للاستفسار يرجى الاتصال على 600540000.'],
  ['SA', 'SAR', 'SNB', 'تم إيداع مبلغ 250.00 ريال في حسابك المنتهي بـ 1234.'],
];
for (const [market, currency, sender, body] of SETTLED) test(`a completed credit keeps its income (${market}): ${body.slice(0, 48)}`, () => {
  const session = setup(market, currency);
  const parsed = session.parse(body, sender, session.inspect(body, sender), undefined, at);
  const figure = /12000\.00/.test(body) ? 1200000 : 25000;
  assert.equal(parsed?.type, 'income'); assert.equal(parsed.amountFils, figure);
  assert.equal(parseSms(body, {}, { sender, observedAt: at })?.type, 'income');
  const nativeResult = native(body, sender, market, currency);
  // Native leaves this Saudi salary field list to Review at 1.0.0 too; it must never post it as a debit.
  if (/^إيداع راتب:/.test(body)) assert.notEqual(nativeResult.route === 'parsed' && nativeResult.notification.direction, 'debit');
  else { assert.equal(nativeResult.route, 'parsed'); assert.equal(nativeResult.notification.direction, 'credit'); }
});

// Review 2 (Low 2): "provisional" also marks a card hold. A pre-authorisation stays out of the ledger and is informational.
test('a provisional authorisation is never confirmable spending', () => {
  const session = setup('AE', 'AED');
  const body = 'A provisional authorization of AED 250.00 was placed on your card ending 1234 at HILTON.';
  assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
  const decision = inspectSourceFreeRefusedAlert({ source: body, sender: 'ENBD', observedAt: at, channel: 'inbox', session });
  if (decision.kind === 'review') assert.equal(isMoneyMovementReview(decision.candidate), false);
});
