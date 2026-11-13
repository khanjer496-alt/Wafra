'use strict';
// The shared "credit is settled to the user's own account" predicate (CEO 080fa431 item 3; design v2, Change Reviewer
// 82667841 / 8f1dcaee): the English table, the veto it applies in parseSms and the session, and the income it must leave
// alone. Synthetic bodies only.
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const sms = load('@/lib/sms-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');

country.setActiveCountry('AE');
markets.setActiveMarket('AE');
markets.setLedgerCurrency('AED', 2);
const at = Date.parse('2026-11-05T10:00:00Z');
const session = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED',
  bestEffort: { enabled: true, country: 'AE' } });
const shape = (p) => (p ? `${p.kind === 'transaction' ? p.type : p.kind} ${p.amountFils}` : 'none');
const both = (body) => {
  const p = shape(sms.parseSms(body, {}, { sender: 'ENBD', observedAt: at }));
  const s = shape(session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at));
  return `${p} / ${s}`;
};
const DEBIT = 'AED 250.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026.';

test('English verdicts: completed, headline and coordinated credits are settled', () => {
  for (const body of [
    'AED 250.00 has been refunded to your card.',
    'AED 250.00 was reversed to your account.',
    'AED 250.00 refunded to your card ending 1234.',
    'Refund of AED 250.00 credited to your account.',
    '250.00 AED reversed to your card.',
    'The refund of AED 250.00 has been processed and credited to your card.',
    'NOON.COM has refunded AED 250.00 to your card.',
    'Refund of AED 250.00 has been credited to your card and will appear on your next statement.',
    'Refund for your pending order of AED 250.00 has been credited to your card.',
    'After verification, the refund of AED 250.00 has been credited to your card.',
  ]) assert.equal(both(body), 'income 25000 / income 25000', body);
});

test('English verdicts: conditional, negated, pending, third-party, taken-back and processed-only credits never post', () => {
  for (const body of [
    'If AED 250.00 has been refunded to your card, you will receive an SMS.',
    'Once AED 250.00 has been reversed to your card, you will receive an SMS.',
    'AED 250.00 is not reversed to your card.',
    'AED 250.00 has not been credited to your account.',
    'NOON.COM did not refund AED 250.00 to your card.',
    'AED 250.00 is being refunded to your card.',
    'AED 250.00 will be returned to your card.',
    'NOON.COM will refund AED 250.00 to your card.',
    'NOON.COM is refunding AED 250.00 to your card.',
    'AED 250.00 has been refunded to the merchant.',
    'AED 250.00 has been reversed to your card and was later reversed.',
    'AED 250.00 has been credited to your card in error.',
  ]) assert.equal(both(body), 'none / none', body);
});

test('A later clause with its own completed credit is a credit ("is being reversed and was credited")', () => {
  assert.equal(both('Refund of AED 47.99 to card 1234 is being reversed and was credited to your card.'), 'income 4799 / income 4799');
  assert.equal(both('Refund of AED 125.00 has not been credited and the refund has now been credited to your card.'), 'income 12500 / income 12500');
  assert.equal(both('AED 250.00 has been reversed to your card and was later reversed.'), 'none / none');
});

// Reviewer 956cb08a (Medium): Once/When/Whenever/After/As soon as lead a condition only when something follows the credit
// in the same sentence (a comma, or "you will …"), or when the credit is not completed. Otherwise they only say when a
// completed refund happened. "once again" is not a leader. If/Unless/Until/Whether keep their reading.
test('A temporal lead with a completed refund and nothing after it is not a condition', () => {
  for (const body of [
    'After cancellation AED 250.00 has been refunded to your card ending 1234.',
    'Dear Customer, once again AED 250.00 has been refunded to your card ending 1234.',
    'Once your order was cancelled AED 250.00 was refunded to your card ending 1234.',
    // A comma alone (a balance line) is not a main clause after the credit.
    'After cancellation AED 250.00 has been refunded to your card ending 1234, Avl Bal AED 1,234.00',
  ]) assert.equal(both(body), 'income 25000 / income 25000', body);
  for (const body of [
    'Once AED 250.00 has been reversed to your card, you will receive an SMS.',
    'Once the refund of AED 250.00 has been credited you will receive an SMS.',
    'When AED 250.00 is credited to your card you will be notified.',
    'As soon as AED 250.00 has been credited to your account you can use it.',
    'After AED 250.00 has been refunded to your card, the balance will update.',
    'If AED 250.00 has been refunded to your card you will receive an SMS.',
  ]) assert.equal(both(body), 'none / none', body);
});

// Change Reviewer a41046bc (High) and Reviewer 07a65c13 (Medium): a list of main-clause shapes cannot be complete, so a
// temporal leader stays a condition whenever the credit's subject follows it directly, or any modal follows the credit;
// only another phrase between the leader and the subject ("After cancellation AED …") makes it "when it happened".
test('A temporal leader that directly governs the credit stays a condition, whatever the main clause', () => {
  for (const body of [
    "When AED 250.00 has been refunded to your card you'll receive an SMS.",
    'Once AED 250.00 has been refunded to your card an SMS will be sent.',
    'When AED 250.00 has been refunded to your card your balance will update.',
    'After AED 250.00 has been refunded to your card please check your balance.',
    "Once AED 250.00 has been credited to your account we'll notify you.",
    'When AED 250.00 has been refunded to your card you receive an SMS.',
    'As soon as AED 250.00 has been credited to your account Wafra will notify you.',
    'When AED 250.00 has been credited to your account a confirmation will follow.',
    'Once AED 250.00 has been refunded to your card. You will receive an SMS.',
    'Once AED 250.00 has been credited to your account a confirmation SMS will follow.',
    'Once AED 250.00 has been refunded to your card ending 1234 your card limit will be restored.',
    'When AED 250.00 has been credited to your card ending 1234 the merchant will be informed.',
    'Once AED 250.00 has been refunded to your card ending 1234 an SMS will be sent to you.',
    'After AED 250.00 has been refunded to your card ending 1234 your statement will show it.',
    'After NOON.COM has refunded AED 250.00 to your card you will receive an SMS.',
    // Conservative: a modal after the credit keeps the condition, even after "After cancellation".
    'After cancellation AED 250.00 has been refunded to your card ending 1234 and you can use it now.',
  ]) assert.equal(both(body), 'none / none', body);
  // Telegraphic, no auxiliary (Reviewer 07a65c13 Low): the bare participle is completed.
  assert.equal(both('After cancellation AED 250.00 refunded to your card ending 1234.'), 'income 25000 / income 25000');
});

// Change Reviewer 742367fa (High) and Reviewer c204ca32 (Medium/Low): the "when it happened" reading is a narrow positive
// list (an event noun, or that event in the past, then the amount as the passive subject before the credit verb, and no
// lowercase modal after the credit). An agent subject or any other verb after the leader governs the credit.
test('Only an event noun or a past event, then the amount as passive subject, reads as "when it happened"', () => {
  for (const body of [
    'When the merchant has refunded AED 250.00 to your card please check your balance.',
    'Once we have refunded AED 250.00 to your account please check your balance.',
    'When they have refunded AED 250.00 to your card check your balance.',
    'When noon has refunded AED 250.00 to your card please check your balance.',
    'After the store refunded AED 250.00 to your card please verify the balance.',
    'Once the seller has refunded AED 250.00 to your card you receive an SMS.',
    'When the bank has credited AED 250.00 to your account kindly verify it in the app.',
    'When the merchant confirms AED 250.00 has been refunded to your card ending 1234.',
    'Once NOON confirms AED 250.00 has been refunded to your card ending 1234.',
  ]) assert.equal(both(body), 'none / none', body);
  // "May" in a date or a name is not the modal.
  for (const body of [
    'After cancellation AED 250.00 has been refunded to your card ending 1234 on 12 May 2026.',
    'After your return AED 250.00 has been credited to your card ending 1234 by MAY STORES.',
  ]) assert.equal(both(body), 'income 25000 / income 25000', body);
});

// bank-alert-semantics-matrix "re-credit for reversed purchase": the reason for the credit names the debit that was undone;
// it is not this credit being taken back. A reversal of the credit itself still is.
test('A reason phrase ("for reversed purchase") is not a take-back; reversing the credit itself is', () => {
  assert.equal(both('AED 125.00 re-credited to card 1234 for reversed purchase.'), 'income 12500 / income 12500');
  // #217 posted these as income on parseSms; a reversal of the credit itself must still refuse.
  for (const body of [
    'AED 125.00 re-credited to card 1234 for reversed purchase. This credit was reversed.',
    'AED 125.00 re-credited to card 1234 and reversed.',
    'AED 125.00 re-credited to card 1234 for reversed purchase in error.',
  ]) assert.equal(both(body), 'none / none', body);
});

// Oracle v2.2 (CEO 73c34ef8, Q1 narrowed; Change Reviewer 4eee941b): a processed refund is settled when the instrument is
// named by number or a balance/limit line follows, unless a later sentence says it is not there yet; a bare one is Review.
// A non-refund "processed" alert (salary, bill payment) is not a credit clause and keeps its existing behaviour.
test('"processed": instrument number or balance line settles; bare, dated or not-yet is Review (oracle v2.2)', () => {
  for (const body of [
    'Refund of AED 150.00 has been processed to your Debit Card ending 4502. Avl Balance is AED 400.00',
    'Refund of AED 150.00 has been processed to your Credit Card ending 4110. Avl Cr. Limit is AED 400.00',
    'Refund of AED 150.00 from NOON has been processed to your card ending 1234.',
    'The refund of AED 150.00 has been processed to your card. Your available balance is AED 900.00.',
  ]) assert.equal(both(body), 'income 15000 / income 15000', body);
  for (const body of [
    'The refund of AED 250.00 has been processed to your card.',
    'NOON.COM has processed a refund of AED 250.00 to your account.',
    'The refund of AED 250.00 has been processed to your card on 12/11/2026.',
    'Refund of AED 250.00 has been processed to your card ending 1234. It will reflect in your account within 5-7 working days.',
    'Refund of AED 250.00 has been processed to your card ending 1234. Avl Balance is AED 400.00. It will reflect in your account within 5-7 working days.',
    'Refund of AED 250.00 has been processed to your card ending 1234. It may take 5 working days to appear.',
  ]) assert.equal(both(body), 'none / none', body);
});

test('A non-refund "processed" alert keeps its behaviour: no salary or payment stops posting', () => {
  const salary = 'A credit transaction of AED 18,000.00 has been processed on your account XXXX1234 on 26/09/2026. Description: SALARY';
  assert.equal(shape(sms.parseSms(salary, {}, { sender: 'ENBD', observedAt: at })), 'income 1800000');
  const payment = 'Dear Customer, Your payment to the account number 0501232543 has been processed. Amount Due: AED 408.45 Amount Paid: AED 408.45';
  assert.equal(shape(sms.parseSms(payment)), 'expense 40845');
  assert.equal(sms.hasOnlyUnsettledCredit('Payroll AED 7,500.00 processed to account 1234.'), false);
  // bank-alert-semantics-matrix: the destination on the next line is still the instrument.
  assert.equal(sms.hasOnlyUnsettledCredit('Payroll AED 7,500.00 processed to\naccount 1234.'), false);
});

// Change Reviewer 2aa1f668 (High): with no refund wording and no separate debit, "processed to your account" is not a refund
// credit clause, so a salary or deposit keeps its income. Beside a debit, "It has been processed to your card." is still D7.
test('"processed to your account" with no refund wording and no debit keeps its income (salary, WPS, cash deposit)', () => {
  for (const [body, fils] of [
    ['Your salary of AED 5,000.00 has been processed to your account.', 500000],
    ['WPS salary of AED 8,500.00 has been processed to your account. Thank you for banking with us.', 850000],
    ['Your cash deposit of AED 1,000.00 has been processed to your account.', 100000],
  ]) {
    assert.equal(both(body), `income ${fils} / income ${fils}`, body);
    assert.equal(sms.hasOnlyUnsettledCredit(body), false, body);
  }
  assert.equal(sms.parseSms(`${DEBIT} It has been processed to your card.`, {}, { sender: 'ENBD', observedAt: at }), null, 'D7 beside a debit');
});

test('Beside a debit: an unsettled note leaves the expense, a figure of its own or a third party goes to Review', () => {
  assert.equal(both(`${DEBIT} It is not reversed to your card.`), 'expense 25000 / expense 25000');
  assert.equal(both(`${DEBIT} It is being reversed to your card.`), 'expense 25000 / expense 25000');
  assert.equal(both(`${DEBIT} Once it has been reversed to your card, you will receive an SMS.`), 'expense 25000 / expense 25000');
  assert.equal(both(`${DEBIT} It has been reversed to your card.`), 'income 25000 / income 25000');
  // Booked as AED 250.00 income before the predicate: a pending refund footer turned a purchase into a refund.
  assert.equal(both('Purchase of AED 250.00 at NOON.COM with card ending 1234 was successful. Refund will be processed if the order is cancelled.'),
    'expense 25000 / expense 25000');
  assert.equal(sms.parseSms(`${DEBIT} It, AED 100.00, has been refunded to your card.`, {}, { sender: 'ENBD', observedAt: at }), null);
  assert.equal(sms.parseSms(`${DEBIT} If a refund of AED 100.00 has been credited to your card, you will receive an SMS.`, {},
    { sender: 'ENBD', observedAt: at }), null, 'D1 before D2 (oracle v2.1)');
  assert.equal(sms.parseSms(`${DEBIT} It has been refunded to the merchant.`, {}, { sender: 'ENBD', observedAt: at }), null);
});

test('Not a credit clause: adjectives, nouns and rewards are left to the existing rules', () => {
  const clauseless = [
    'A returned cheque fee of AED 50.00 was debited from your account ending 1234.',
    `${DEBIT.replace('12/11/2026.', '12/11/2026 (reversed charges apply).')}`,
    'Your Credit Card ending 1234 was used for AED 250.00 at NOON.COM.',
  ];
  for (const body of clauseless) assert.equal(sms.hasOnlyUnsettledCredit(body), false, body);
  assert.equal(sms.hasOnlyUnsettledCredit('Cashback of AED 12.50 will be credited to your account.'), false);
});

test('Veto only: income from other evidence keeps its own path', () => {
  for (const body of [
    'You have received AED 500.00 from AHMED via Aani to your account ending 1234.',
    'AED 5,000.00 salary transfer received in your account ending 1234.',
    'Your salary of AED 15,000.00 has been credited to your account ending 1234.',
  ]) {
    const p = sms.parseSms(body, {}, { sender: 'ENBD', observedAt: at });
    assert.equal(sms.hasOnlyUnsettledCredit(body), false, body);
    if (p) assert.equal(p.type, 'income', body);
  }
});

// ── The Arabic table (PR 2; design v2's AR column): the same verdicts on تم/سيتم/جاري/لم يتم + the verbal noun and on the
// merchant forms قام/سيقوم/يقوم/لم يقم التاجر … ب…. Synthetic bodies in the oracle's grammar.
const DEBIT_AR = 'تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM.';

test('Arabic: completed, headline, merchant and coordinated credits stay income', () => {
  for (const body of [
    'تم استرداد مبلغ 250.00 درهم إلى بطاقتك.',
    'تم إيداع مبلغ 250.00 درهم إلى حسابك.',
    'قام التاجر NOON.COM باسترداد مبلغ 250.00 درهم إلى بطاقتك.',
    'تم معالجة وإيداع مبلغ 250.00 درهم إلى بطاقتك.',
    'استرداد مبلغ 250.00 درهم إلى بطاقتك.',
    'إيداع مبلغ 250.00 درهم في حسابك.',
    'تم إيداع مبلغ 250.00 درهم في حسابك ولا يلزم أي إجراء.',
  ]) assert.equal(both(body), 'income 25000 / income 25000', body);
});

test('Arabic: conditional, pending, negated, third-party and taken-back credits never post', () => {
  for (const body of [
    'بمجرد أن يتم إيداع مبلغ 250.00 درهم إلى حسابك، ستصلك رسالة.',
    'عندما يتم استرداد مبلغ 250.00 درهم إلى بطاقتك، ستصلك رسالة.',
    'بعد أن يتم معالجة وإيداع مبلغ 250.00 درهم إلى بطاقتك، ستصلك رسالة.',
    'جاري إيداع مبلغ 250.00 درهم إلى حسابك.',
    'يقوم التاجر NOON.COM باسترداد مبلغ 250.00 درهم إلى بطاقتك.',
    'لم يتم معالجة وإيداع مبلغ 250.00 درهم إلى بطاقتك.',
    'لم يقم التاجر NOON.COM بإيداع مبلغ 250.00 درهم إلى حسابك.',
    'تم استرداد مبلغ 250.00 درهم إلى التاجر.',
    'تم إيداع مبلغ 250.00 درهم إلى المستفيد.',
    'تم استرداد مبلغ 250.00 درهم إلى بطاقتك وتم عكسه لاحقاً.',
    'تم إيداع مبلغ 250.00 درهم إلى بطاقتك عن طريق الخطأ.',
  ]) assert.equal(both(body), 'none / none', body);
});

test('Arabic "processed" (oracle v2.2): the card number settles it; "سيظهر المبلغ … خلال 5-7 أيام" keeps it pending', () => {
  assert.equal(both('تم معالجة استرداد مبلغ 250.00 درهم إلى بطاقتك المنتهية بـ 1234.'), 'income 25000 / income 25000');
  assert.equal(both('تم معالجة استرداد مبلغ 250.00 درهم إلى بطاقتك المنتهية بـ 1234. سيظهر المبلغ في حسابك خلال 5-7 أيام عمل.'),
    'none / none');
});

test('Arabic beside a debit: an unsettled note leaves the expense on both paths; a figure of its own or a take-back refuses', () => {
  for (const note of [
    'بمجرد أن يتم إيداع المبلغ إلى حسابك، ستصلك رسالة.',
    'إذا تم استرداد المبلغ إلى بطاقتك، ستصلك رسالة.',
    'لم يتم استرداد المبلغ إلى بطاقتك.',
    'سيتم استرداد المبلغ إلى بطاقتك.',
  ]) assert.equal(both(`${DEBIT_AR} ${note}`), 'expense 25000 / expense 25000', note);
  for (const note of ['تم استرداد المبلغ إلى بطاقتك وتم عكسه لاحقاً.', 'تم إيداع مبلغ 100.00 درهم إلى حسابك.']) {
    assert.equal(both(`${DEBIT_AR} ${note}`), 'none / none', note);
  }
});

test('Arabic cashback ("استرداد نقدي") is not a refund credit: purchase and cashback keep their own paths', () => {
  assert.equal(both(`${DEBIT_AR} تم إيداع مبلغ 5.00 درهم كاسترداد نقدي.`), 'expense 25000 / expense 25000');
  assert.equal(both('تم إيداع مبلغ 25.00 درهم كاسترداد نقدي إلى حسابك.'), 'income 2500 / income 2500');
});

// Change Reviewer 2aa1f668 (High), in Arabic: "معالجة" with no refund noun after it and no debit is ordinary income.
test('Arabic: a processed salary keeps its income; a processed note beside a debit is still D7', () => {
  assert.equal(both('تمت معالجة راتبك بمبلغ 5,000.00 درهم إلى حسابك.'), 'income 500000 / income 500000');
  assert.equal(sms.parseSms(`${DEBIT_AR} تم معالجة المبلغ إلى بطاقتك.`, {}, { sender: 'ENBD', observedAt: at }), null, 'D7');
});

// Reviewer 956cb08a (Medium), in Arabic: عند/عندما/بمجرد/بعد أن/حين/متى lead a condition only when a future main clause
// follows the credit ("ستصلك رسالة", "سنرسل") or the credit is not completed; إذا and في حال always do. A noun right after a
// leader ("عند استرداد …") is the leader's object, not a completed credit.
test('Arabic: a temporal lead with a completed refund and nothing after it is not a condition', () => {
  assert.equal(both('عند إلغاء الطلب تم استرداد مبلغ 250.00 درهم إلى بطاقتك المنتهية بـ 1234.'), 'income 25000 / income 25000');
  for (const body of [
    'عند استرداد مبلغ 250.00 درهم إلى بطاقتك ستصلك رسالة.',
    'عندما يتم إيداع مبلغ 250.00 درهم في حسابك سنرسل لك إشعاراً.',
    'بمجرد أن يتم استرداد مبلغ 250.00 درهم إلى بطاقتك، ستصلك رسالة.',
    'إذا تم استرداد مبلغ 250.00 درهم إلى بطاقتك ستصلك رسالة.',
  ]) assert.equal(both(body), 'none / none', body);
});

// Change Reviewer a41046bc / Reviewer 07a65c13, in Arabic: a temporal leader that directly governs the credit (only أن and the
// aspect, or a merchant verb, between them) stays a condition whatever main clause follows; only another phrase between the
// leader and the credit ("عند إلغاء الطلب تم استرداد …") makes it "when it happened".
test('Arabic: a temporal leader that directly governs the credit stays a condition, whatever the main clause', () => {
  for (const body of [
    'عندما تم استرداد مبلغ 250.00 درهم إلى بطاقتك تصلك رسالة.',
    'بمجرد أن تم إيداع مبلغ 250.00 درهم في حسابك يرجى مراجعة رصيدك.',
    'بعد أن تم استرداد مبلغ 250.00 درهم إلى بطاقتك يتم تحديث رصيدك.',
    'عندما تم إيداع مبلغ 250.00 درهم في حسابك. ستصلك رسالة.',
    'متى تم استرداد مبلغ 250.00 درهم إلى بطاقتك نرسل لك إشعاراً.',
    'عندما قام التاجر NOON.COM باسترداد مبلغ 250.00 درهم إلى بطاقتك تصلك رسالة.',
    'عند استرداد مبلغ 250.00 درهم إلى بطاقتك. ستصلك رسالة.',
  ]) assert.equal(both(body), 'none / none', body);
  assert.equal(both('عند إلغاء الطلب تم استرداد مبلغ 250.00 درهم إلى بطاقتك المنتهية بـ 1234.'), 'income 25000 / income 25000');
});

// Change Reviewer 742367fa / Reviewer c204ca32, in Arabic: "when it happened" is the narrow positive shape (an event noun such
// as "عند إلغاء الطلب" / "عند مراجعة طلبك" / "عند إرجاع المنتج", then تم + the credit). Any other verb after the leader governs.
// "إرجاع المنتج" (a product return) is not a money movement.
test('Arabic: only an event noun, then تم + the credit, reads as "when it happened"; another verb governs', () => {
  for (const body of [
    'عند إرجاع المنتج تم استرداد مبلغ 250.00 درهم إلى بطاقتك.',
    'عند مراجعة طلبك تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234.',
  ]) assert.equal(both(body), 'income 25000 / income 25000', body);
  for (const body of [
    'عندما يؤكد التاجر تم استرداد مبلغ 250.00 درهم إلى بطاقتك.',
    'متى استلمنا طلبك تم إيداع مبلغ 250.00 درهم في حسابك.',
    'عندما يوافق البنك تم إيداع مبلغ 250.00 درهم في حسابك.',
  ]) assert.equal(both(body), 'none / none', body);
});

// #231 review (Change Reviewer b47be539, Reviewer e4fcce75). Regressions first: a real Arabic purchase in other wording, a
// refund OF an erroneous charge, a payment to the merchant then an own destination, an unrelated later "قيد المراجعة", and a
// balance figure in the note's own sentence must keep their path. Then Arabic false income the table missed (base-equal).
test('Arabic review fixes: purchases and genuine refunds keep their path; the missed conditional, pending and negated forms never post', () => {
  for (const body of [
    'تمت عملية شراء بمبلغ 250.00 درهم لدى NOON باستخدام بطاقتك. سيتم استرداد مبلغ 250.00 درهم في حال إلغاء الطلب.',
    'تمت عملية شراء بقيمة AED 250.00 بواسطة بطاقتك لدى NOON. سيتم استرداد مبلغ AED 250.00 في حال إلغاء الطلب.',
    'عملية شراء بمبلغ 250.00 درهم لدى NOON باستخدام بطاقتك. لم يتم استرداد مبلغ 250.00 درهم.',
    'تم استخدام بطاقتك لشراء بمبلغ 250.00 درهم لدى NOON. سيتم استرداد مبلغ 250.00 درهم إذا تم إلغاء الطلب.',
    'تم خصم مبلغ 250.00 درهم من بطاقتك لدى NOON. سيتم استرداد المبلغ خلال 5 أيام، الرصيد المتاح 750.00 درهم.',
    'AED 250.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026. A refund will be credited within 5 days, available balance AED 750.00.',
  ]) assert.equal(both(body), 'expense 25000 / expense 25000', body);
  for (const body of [
    'تم استرداد مبلغ 250.00 درهم إلى بطاقتك عن عملية تم خصمها بالخطأ.',
    'تم استرداد مبلغ 250.00 درهم الذي تم خصمه عن طريق الخطأ إلى بطاقتك.',
    'تم إيداع مبلغ 250.00 درهم في حسابك كتعويض عن الخصم بالخطأ.',
    'تم استرداد مبلغ 250.00 درهم المدفوع إلى التاجر NOON إلى بطاقتك المنتهية بـ 1234.',
    'تم استرداد مبلغ 250.00 درهم إلى بطاقتك. طلبك الآخر قيد المراجعة.',
    'قمنا باسترداد مبلغ 250.00 درهم إلى بطاقتك.',
  ]) assert.equal(both(body), 'income 25000 / income 25000', body);
  for (const body of [
    'سنقوم باسترداد مبلغ 250.00 درهم إلى بطاقتك.',
    'نقوم حالياً باسترداد مبلغ 250.00 درهم إلى بطاقتك.',
    'إن تم استرداد مبلغ 250.00 درهم إلى بطاقتك ستصلك رسالة.',
    'فور استرداد مبلغ 250.00 درهم إلى بطاقتك ستصلك رسالة.',
    'بعد استرداد مبلغ 250.00 درهم إلى بطاقتك ستصلك رسالة.',
    'لدى استرداد مبلغ 250.00 درهم إلى بطاقتك ستصلك رسالة.',
    'من المتوقع استرداد مبلغ 250.00 درهم إلى بطاقتك خلال 7 أيام.',
    'في حالة تم استرداد مبلغ 250.00 درهم إلى بطاقتك، ستصلك رسالة.',
    'لم يتم بعد استرداد مبلغ 250.00 درهم إلى بطاقتك.',
    'لم يتم رد مبلغ 250.00 درهم إلى بطاقتك.',
  ]) assert.equal(both(body), 'none / none', body);
});

// Change Reviewer 1ae30382 (pre-existing on main 429d32f0): ALL-CAPS leaders and a trailing condition or time window. In a
// sentence with no lowercase letters, IF/ONCE/WHEN/AFTER/… lead a condition at the sentence start or after a comma (not a
// merchant name such as "AFTER EIGHT CAFE" mid-sentence), and caps modals count ("YOU WILL"; "MAY" only before a verb). A
// trailing "if approved / upon verification" leaves the credit conditional, and "within N working days" after a refund verb
// leaves it pending, in English and Arabic.
test('ALL-CAPS leaders and a trailing condition or time window never post', () => {
  for (const body of [
    'IF AED 250.00 HAS BEEN REFUNDED TO YOUR CARD YOU WILL GET AN SMS.',
    'WHEN AED 250.00 HAS BEEN REFUNDED TO YOUR CARD, YOU WILL RECEIVE AN SMS.',
    'DEAR CUSTOMER, ONCE AED 250.00 HAS BEEN CREDITED TO YOUR ACCOUNT YOU WILL BE NOTIFIED.',
    'AFTER CANCELLATION AED 250.00 HAS BEEN REFUNDED TO YOUR CARD YOU WILL RECEIVE AN SMS.',
    'WHEN THE MERCHANT HAS REFUNDED AED 250.00 TO YOUR CARD PLEASE CHECK YOUR BALANCE.',
    'IF AED 250.00 HAS BEEN REFUNDED TO YOUR CARD YOU MAY CHECK YOUR BALANCE.',
    'AED 250.00 has been credited to your card if approved.',
    'AED 250.00 has been refunded to your card upon verification.',
    'AED 250.00 refunded to your card within 7 working days.',
    'After cancellation AED 250.00 refunded to your card within 7 working days.',
    'AED 250.00 HAS BEEN REFUNDED TO YOUR CARD WITHIN 5-7 WORKING DAYS.',
    'تم إيداع مبلغ 250.00 درهم في حسابك في حال الموافقة.',
    'تم استرداد مبلغ 250.00 درهم إلى بطاقتك خلال 7 أيام عمل.',
  ]) assert.equal(both(body), 'none / none', body);
  for (const body of [
    'AED 250.00 HAS BEEN REFUNDED TO YOUR CARD ENDING 1234.',
    'REFUND FROM AFTER EIGHT CAFE OF AED 250.00 CREDITED TO YOUR CARD ENDING 1234.',
    'AFTER CANCELLATION AED 250.00 HAS BEEN REFUNDED TO YOUR CARD ENDING 1234 ON 12 MAY 2026.',
    'Refund of AED 250.00 has been credited to your card and will appear on your next statement.',
  ]) assert.equal(both(body), 'income 25000 / income 25000', body);
  // A time window on a non-refund credit is not a pending refund: the salary keeps its income.
  assert.equal(both('Your salary of AED 5,000.00 has been credited to your account, available within 2 hours.'),
    'income 500000 / income 500000');
});

// Reviewer b329245d (Low, base-equal): "إن" (if) also leads after "و" and after a salutation comma; "أن" (that) mid-sentence
// still does not ("نود إعلامك أن تم استرداد …" keeps its income).
test('Arabic: إن after و or after a salutation comma is a leader; أن mid-sentence is not', () => {
  for (const body of [
    'وإن تم استرداد مبلغ 250.00 درهم إلى بطاقتك ستصلك رسالة.',
    'عزيزي العميل، إن تم استرداد مبلغ 250.00 درهم إلى بطاقتك ستصلك رسالة.',
  ]) assert.equal(both(body), 'none / none', body);
  assert.equal(both('نود إعلامك أن تم استرداد مبلغ 250.00 درهم إلى بطاقتك.'), 'income 25000 / income 25000');
});

// #242 review (Reviewer b895dc2e, Change Reviewer 0c8c32fa). A time window that a later display verb takes ("… has been
// credited … and will reflect within 5 working days") does not leave the completed credit pending, as C12 and the same text
// as two sentences already say; a window bound to the credit itself still does. Only a refund verb or the word "refund" makes
// a window a pending refund, not a name or "returns". A condition in a later clause with its own subject ("; your replacement
// card will be dispatched once approved") or a reassurance footer ("if the transaction has been authorised by you please
// ignore …") is not a condition on the credit. Caps WILL/CAN after BY/FROM/AT is a name. Arabic ان after a verb of informing
// ("نود إعلامك، أن تم …", "يسرنا إبلاغك: أن تم …") is "that", not "if".
test('#242 review: genuine credits keep their income; windows and conditions bound to the credit still never post', () => {
  for (const body of [
    'Refund of AED 250.00 has been credited to your card ending 1234 and will reflect within 5 working days.',
    'AED 250.00 has been refunded to your card ending 1234 and will be visible within 3-5 business days.',
    'AED 250.00 HAS BEEN REFUNDED TO YOUR CARD ENDING 1234 AND WILL REFLECT WITHIN 5 WORKING DAYS.',
    'تم استرداد مبلغ 250.00 درهم إلى بطاقتك وسيظهر في كشف حسابك خلال 5 أيام عمل.',
    'Refund of AED 250.00 has been credited to your card ending 1234, if the transaction has been authorised by you please ignore this message.',
    'AED 250.00 has been refunded to your card ending 1234; your replacement card will be dispatched once approved.',
    'AFTER CANCELLATION AED 250.00 HAS BEEN REFUNDED TO YOUR CARD ENDING 1234 BY WILL TRADING LLC.',
    'AFTER CANCELLATION AED 250.00 HAS BEEN REFUNDED TO YOUR CARD ENDING 1234 FROM CAN TRAVEL LLC.',
    'نود إعلامك، أن تم استرداد مبلغ 250.00 درهم إلى بطاقتك.',
    'يسرنا إبلاغك: أن تم استرداد مبلغ 250.00 درهم إلى بطاقتك.',
  ]) assert.equal(both(body), 'income 25000 / income 25000', body);
  for (const body of [
    'Transfer of AED 500.00 from RETURN LOGISTICS LLC has been credited to your account ending 1234 within 2 hours.',
    'Investment returns of AED 500.00 have been credited to your account ending 1234 within 2 days.',
    'AED 500.00 from REVERSE MORTGAGE CO has been credited to your account ending 1234 within 1 day.',
  ]) assert.equal(both(body), 'income 50000 / income 50000', body);
  for (const body of [
    'AED 250.00 has been refunded to your card and will be credited within 7 working days.',
    'Refund of AED 250.00 has been credited to your card within 7 working days.',
    'AED 250.00 has been refunded to your card ending 1234; your account will be credited once approved.',
    'AED 250.00 has been refunded to your card ending 1234, the refund will be confirmed once approved.',
    'AED 250.00 has been credited to your card if approved by the merchant.',
    'تم استرداد مبلغ 250.00 درهم إلى بطاقتك وسيتم إيداعه خلال 7 أيام عمل.',
    'عزيزي العميل، أن تم استرداد مبلغ 250.00 درهم إلى بطاقتك ستصلك رسالة.',
  ]) assert.equal(both(body), 'none / none', body);
});
