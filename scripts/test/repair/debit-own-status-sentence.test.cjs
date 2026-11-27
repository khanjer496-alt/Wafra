'use strict';
// 1.0.1 follow-up to #238/#244 review: a debit whose decline, failure, cancellation or reversal is stated in a sentence
// of its own ("… at NOON.COM. Transaction declined. …", "… This transaction has been reversed.", "تم رفض العملية",
// "تم عكس العملية", "لم تتم العملية") moved no money. Before this fix the debit-plus-note recovery and the whole-body
// reader posted it as an expense on parseSms, the session, history and the iOS bundle. It now posts nothing on any path
// and keeps no Review facts, as when the same words sit in the debit's own sentence. Paired negatives: unrelated footers
// and other subjects' statuses leave a genuine purchase posted. Synthetic bodies only.
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
const history = (body, sender, session) => parseHistoricalMessageRecords([JSON.stringify({ v: 1,
  id: crypto.createHash('sha256').update(`own-status:${historyId++}`).digest('hex'), text: body, sender,
  receivedAt: new Date(at).toISOString() })], {}, new Date(at), new Set(), session);

const EN = [
  'AED 250.00 was debited from your card ending 1234 at NOON.COM.',
  'Purchase of AED 250.00 with Debit Card ending 1234 at NOON.COM. Avl Balance is AED 900.00.',
  'Your card ending 1234 was used for AED 250.00 at NOON.COM.',
];
const AR = [
  ['AE', 'AED', 'ENBD', 'تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM.'],
  ['AE', 'AED', 'ADCB', 'تمت عملية شراء بمبلغ 250.00 درهم لدى NOON باستخدام بطاقتك المنتهية بـ 1234.'],
  ['SA', 'SAR', 'SNB', 'تم خصم مبلغ 250.00 ريال من بطاقتك المنتهية بـ 1234 لدى جرير.'],
];
const NOTE_EN = 'A refund of AED 100.00 has been credited to your card.';
const NOTE_AR = (currency) => `تم استرداد مبلغ 100.00 ${currency === 'SAR' ? 'ريال' : 'درهم'} إلى بطاقتك.`;
const STATUS_EN = ['Transaction declined.', 'This transaction has been reversed.', 'Transaction failed.', 'Transaction cancelled.',
  'Purchase reversed.', 'Your transaction was unsuccessful.', 'Status: Declined.', 'Txn Status: REVERSED.', 'Authorisation reversed.',
  'This transaction has been reversed on 14/11/2026.', 'Transaction reversed (Ref 778812).'];
const STATUS_AR = ['تم رفض العملية.', 'تم عكس العملية.', 'لم تتم العملية.', 'تم إلغاء العملية.', 'العملية مرفوضة.', 'فشلت العملية.',
  'تم استرجاع العملية.', 'تم إلغاء عملية الشراء.', 'تم عكس العملية بتاريخ 14/11/2026.'];

const stood = [];
for (const debit of EN) for (const status of STATUS_EN) for (const note of ['', ` ${NOTE_EN}`]) stood.push(['AE', 'AED', 'ENBD', `${debit} ${status}${note}`]);
for (const [market, currency, sender, debit] of AR) for (const status of STATUS_AR) for (const note of ['', ` ${NOTE_AR(currency)}`]) {
  stood.push([market, currency, sender, `${debit} ${status}${note}`]);
}
// The usual Gulf layout puts the status on a line of its own (review 1, Medium 2; the first posted income at 70c7daf7).
stood.push(['AE', 'AED', 'ENBD', 'AED 250.00 was debited from your card ending 1234 at NOON.COM\nThis transaction has been reversed']);
stood.push(['AE', 'AED', 'ENBD', 'AED 250.00 was debited from your card ending 1234 at NOON.COM\nTransaction cancelled']);
stood.push(['AE', 'AED', 'ENBD', 'تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM\nتم عكس العملية']);
for (const [market, currency, sender, body] of stood) test(`a debit with its own decline or reversal posts nothing (${market} ${sender}): ${body}`, () => {
  const session = setup(market, currency);
  assert.equal(parseSms(body, {}, { sender, observedAt: at }), null, 'parseSms');
  assert.equal(session.parse(body, sender, session.inspect(body, sender), undefined, at), null, 'session');
  assert.notEqual(native(body, sender, market, currency).route, 'parsed', 'native never posts it');
  for (const channel of ['inbox', 'delivery', 'push']) {
    const decision = inspectSourceFreeRefusedAlert({ source: body, sender, observedAt: at, channel, session });
    assert.deepEqual(decision, { kind: 'declined', reason: 'declined' }, `${channel}: declined, as "… was declined" in one sentence`);
  }
  const imported = history(body, sender, session);
  assert.equal(imported.parsed.length, 0, 'history posts nothing');
  assert.ok(!imported.reviewCandidates.some((item) => isMoneyMovementReview(item)), 'history offers nothing to book');
});

// Paired negatives: a footer about transactions in general, a fraud or dispute line, a successful status, or another
// subject's decline (the refund request, a previous transaction) leaves the genuine purchase posted on every path.
const FOOTERS_EN = ['To dispute a transaction call 600540000.', 'If this transaction was not made by you, call 600540000.',
  'If this was not you, call us.', 'In case of a failed transaction, the amount will be returned within 7 days.',
  'Your refund request was declined.', 'Transaction successful.', 'Thank you for your purchase.'];
// Not listed: "Transactions may be declined …", "Your previous transaction was declined." and "Declined transactions
// are not charged." already refuse the whole alert at 1.0.0 (a broad decline footer rule); this change leaves them as
// they were.
const FOOTERS_AR = ['في حال لم تقم بهذه العملية يرجى الاتصال بنا.', 'إذا لم تقم بهذه العملية اتصل بنا فوراً.',
  'تمت العملية بنجاح.', 'العملية ناجحة.'];
const kept = [];
for (const debit of EN) for (const footer of FOOTERS_EN) kept.push(['AE', 'AED', 'ENBD', `${debit} ${footer}`]);
for (const [market, currency, sender, debit] of AR) for (const footer of FOOTERS_AR) kept.push([market, currency, sender, `${debit} ${footer}`]);
for (const [market, currency, sender, body] of kept) test(`an unrelated sentence leaves the purchase posted (${market} ${sender}): ${body}`, () => {
  const session = setup(market, currency);
  const parsed = session.parse(body, sender, session.inspect(body, sender), undefined, at);
  assert.equal(parsed?.type, 'expense'); assert.equal(parsed.amountFils, 25000);
  const direct = parseSms(body, {}, { sender, observedAt: at });
  assert.equal(direct?.type, 'expense'); assert.equal(direct.amountFils, 25000);
  const imported = history(body, sender, session);
  assert.equal(imported.parsed.length, 1); assert.equal(imported.parsed[0].type, 'expense');
  const nativeResult = native(body, sender, market, currency);
  assert.notEqual(nativeResult.route === 'parsed' && nativeResult.notification.direction, 'credit', 'native never credits it');
});

// Review 1 (High 1, Medium 1): money that left and will come back, a question-style help line, or a footer whose words
// only start like a status, keep the debit exactly as at 70c7daf7.
for (const [market, currency, sender, body] of [
  ['AE', 'AED', 'ENBD', 'AED 250.00 was debited from your account ending 1234 at ATM DUBAI MALL. Transaction failed. The amount will be reversed within 7 working days.'],
  ['AE', 'AED', 'ENBD', 'AED 250.00 was debited from your card ending 1234 at NOON.COM. Transaction failed. The amount will be refunded to your card within 5 days.'],
  ['AE', 'AED', 'ENBD', 'تم خصم مبلغ 250.00 درهم من حسابك المنتهي بـ 1234 لدى صراف آلي. لم تتم العملية. سيتم إرجاع المبلغ خلال 7 أيام عمل.'],
  ['AE', 'AED', 'ENBD', 'AED 250.00 was debited from your card ending 1234 at NOON.COM. Transaction cancelled? Refunds appear within 5 days.'],
  ['AE', 'AED', 'ENBD', 'AED 250.00 was debited from your card ending 1234 at NOON.COM. Transaction reversed? See the app for details.'],
  ['AE', 'AED', 'ENBD', 'تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM. تم إلغاء العملية؟ تواصل مع التاجر.'],
  ['AE', 'AED', 'ENBD', 'AED 250.00 was debited from your card ending 1234 at NOON.COM. Payment reversed transactions are shown in the app.'],
]) test(`money that left keeps its debit: ${body}`, () => {
  const session = setup(market, currency);
  const parsed = session.parse(body, sender, session.inspect(body, sender), undefined, at);
  assert.equal(parsed?.type, 'expense'); assert.equal(parsed.amountFils, 25000);
  assert.equal(parseSms(body, {}, { sender, observedAt: at })?.type, 'expense');
  assert.equal(history(body, sender, session).parsed[0]?.type, 'expense');
});

// Review 1 (High 2): a credit sentence of its own (a refund, a credit back) keeps its income or its Review, whatever
// purchase words describe it, in every launch market.
for (const [market, currency, sender, body, income] of [
  ['AE', 'AED', 'ENBD', 'AED 250.00 charged at NOON.COM on 10/11 has been credited back to your card ending 1234. Transaction reversed.', true],
  ['AE', 'AED', 'ENBD', 'Refund of AED 250.00 for your purchase at NOON.COM has been credited to your card ending 1234. Purchase reversed.', false],
  ['AE', 'AED', 'ENBD', 'تم استرداد مبلغ 250.00 درهم لعملية الشراء لدى NOON إلى بطاقتك المنتهية بـ 1234. تم عكس العملية.', false],
  // Review 2 (High): a refund or reversal written as a noun or a heading, whatever "purchase" names the refunded purchase.
  ['AE', 'AED', 'ENBD', 'Reversal of AED 250.00 for your purchase at NOON.COM on card ending 1234. Transaction reversed.', false],
  ['AE', 'AED', 'ENBD', 'Refund of AED 250.00 for your purchase at NOON.COM. Purchase reversed.', false],
  ['AE', 'AED', 'ENBD', 'Transaction reversed\nRefund of AED 250.00 for your purchase at NOON.COM to your card ending 1234', false],
  ['AE', 'AED', 'ENBD', 'Refund\nAED 250.00\nPurchase at NOON.COM\nCard ending 1234\nStatus: Reversed', true],
  ['AE', 'AED', 'ENBD', 'Reversal: AED 250.00 for purchase at NOON.COM, card ending 1234. Status: Reversed.', false],
]) test(`a refund with a reversal line keeps its income or Review: ${body}`, () => {
  const session = setup(market, currency);
  assert.equal(history(body, sender, session).declined.length, 0, 'history keeps no declined row that could sweep a stored refund');
  const parsed = session.parse(body, sender, session.inspect(body, sender), undefined, at);
  if (income) { assert.equal(parsed?.type, 'income'); assert.equal(parsed.amountFils, 25000); }
  else {
    assert.equal(parsed, null);
    const decision = inspectSourceFreeRefusedAlert({ source: body, sender, observedAt: at, channel: 'inbox', session });
    assert.equal(decision.kind, 'review', 'its Review stays');
  }
  assert.notEqual(parseSms(body, {}, { sender, observedAt: at })?.type, 'expense');
});

// US and Europe: the same rule on the worldwide path.
for (const [market, currency, sender, body] of [
  ['US', 'USD', 'CHASE', 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET. Charge reversed.'],
  ['DE', 'EUR', 'Revolut', 'Revolut: You spent EUR 24.86 at LIDL BERLIN with card ending 4421. Transaction reverted.'],
  ['GB', 'GBP', 'BARCLAYS', 'Barclays: Your card ending 4421 was used for GBP 24.86 at TESCO STORES. Payment cancelled.'],
]) test(`a reversed or cancelled card charge posts nothing (${market})`, () => {
  country.setActiveCountry(market); markets.setLedgerCurrency(currency, 2);
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: currency, bestEffort: { enabled: true, country: market } });
  const inspection = session.inspect(body, sender);
  assert.equal(session.parse(body, sender, inspection, undefined, at) ?? session.parseUnproven(body, sender, inspection, at), null);
  assert.equal(parseSms(body, {}, { sender, observedAt: at }), null);
  assert.equal(inspectSourceFreeRefusedAlert({ source: body, sender, observedAt: at, channel: 'inbox', session }).kind, 'declined');
});
test('a US noun-form refund with a reversal line keeps its Review', () => {
  country.setActiveCountry('US'); markets.setLedgerCurrency('USD', 2);
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'USD', bestEffort: { enabled: true, country: 'US' } });
  const body = 'Chase Bank alert: Refund of USD 24.86 for your purchase at NORTH STAR MARKET on card ending 4421. Purchase reversed.';
  assert.notEqual(parseSms(body, {}, { sender: 'CHASE', observedAt: at })?.type, 'expense');
  assert.equal(inspectSourceFreeRefusedAlert({ source: body, sender: 'CHASE', observedAt: at, channel: 'inbox', session }).kind, 'review');
});

// The same words in the debit's own sentence keep their shipped outcome (refused), so both forms now agree.
for (const body of ['AED 250.00 was debited from your card ending 1234 at NOON.COM and was declined.',
  'Purchase of AED 250.00 at NOON.COM with card ending 1234 was declined.']) test(`same-sentence decline is unchanged: ${body}`, () => {
  const session = setup('AE', 'AED');
  assert.equal(parseSms(body, {}, { sender: 'ENBD', observedAt: at }), null);
  assert.equal(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at), null);
});
