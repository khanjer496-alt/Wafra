'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const load = require('./load-ts.cjs').createLoader();
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
const { parseSms } = load('@/lib/sms-parser');
const { setActiveCountry } = load('@/lib/country');
const { setActiveMarket, setLedgerCurrency, detectLaunchMarketFromSender } = load('@/lib/markets');
const { currencyMinorUnits } = load('@/lib/currency-metadata');

// Middle East launch round: Qatar, Kuwait, Oman and Egypt alert wording the
// shared grammar did not read, plus three Saudi launch-grammar corrections.
// Every body is synthetic text in the bank's published shape with fictional
// values; nothing here is a consented real alert.
const observedAt = Date.parse('2026-10-12T12:00:00Z');

function session(country, ledger) {
  setActiveCountry(country);
  const exponent = currencyMinorUnits(ledger);
  setLedgerCurrency(ledger, exponent === 0 || exponent === 3 ? exponent : 2);
  setActiveMarket(country === 'AE' || country === 'SA' ? country : 'ZZ');
  return createLaunchAlertSession({ overrides: {}, pinnedCurrency: ledger, fxLookup: () => null,
    bestEffort: { enabled: true, country }, regionHint: country });
}
// The Android SMS seam exactly as the launch evaluator drives it.
function android(row) {
  const reader = session(row.country, row.ledger);
  const inspection = reader.inspect(row.body, row.sender);
  const launch = detectLaunchMarketFromSender(row.sender);
  return launch
    ? reader.parse(row.body, row.sender, inspection, launch, observedAt)
    : reader.parseUnproven(row.body, row.sender, inspection, observedAt);
}
// The iOS History path with the sender present (a notification record).
function history(row) {
  const reader = session(row.country, row.ledger);
  const record = { v: 1, id: createHash('sha256').update(row.body).digest('hex'), text: row.body,
    receivedAt: new Date(observedAt).toISOString(), sender: row.sender };
  return parseHistoricalMessageRecords([JSON.stringify(record)], {}, new Date(observedAt), new Set(), reader);
}

const posts = [
  { id: 'QNB card "has been used for"', country: 'QA', ledger: 'QAR', sender: 'QNB', type: 'expense', minor: 31275,
    body: 'QNB: Your Debit Card ending 4321 has been used for QAR 312.75 at SAMPLE MART DOHA on 03-Oct-2026 18:40. Avl. Bal. QAR 6,410.20' },
  { id: 'a completed QNB spend keeps its posting under a fraud footer', country: 'QA', ledger: 'QAR', sender: 'QNB', type: 'expense', minor: 31275,
    body: 'QNB: Your Debit Card ending 4321 has been used for QAR 312.75 at SAMPLE MART DOHA on 03-Oct-2026 18:40. If you did not make this transaction, call 4440 0000.' },
  { id: 'a completed spend keeps its posting when a fraud footer is its own sentence', country: 'QA', ledger: 'QAR', sender: 'QNB', type: 'expense', minor: 4750,
    body: 'QNB: Purchase transaction of QAR 47.50 at SAMPLE CAFE DOHA was successful. In case your card was used without consent call 4440 0000' },
  { id: 'a completed KFH debit keeps its posting under an Arabic conditional footer', country: 'KW', ledger: 'KWD', sender: 'KFH', type: 'expense', minor: 5000,
    body: 'بيتك: تم خصم مبلغ 5.000 د.ك من حسابكم رقم ****4321 لدى SAMPLE STORE بتاريخ 06/10/2026. في حال تم الخصم دون علمكم اتصلوا بنا' },
  { id: 'CBQ "Purchase transaction of … has been approved"', country: 'QA', ledger: 'QAR', sender: 'CBQ', type: 'expense', minor: 4750,
    body: 'CBQ: Purchase transaction of QAR 47.50 at SAMPLE CAFE DOHA on your card ending 8765 has been approved on 04/10/2026 12:15.' },
  { id: 'Bank Muscat bilingual card spend counts once', country: 'OM', ledger: 'OMR', sender: 'BankMuscat', type: 'expense', minor: 6350,
    body: 'Your Debit Card XXXX4321 has been used for OMR 6.350 at SAMPLE STORE MUSCAT on 05/10/2026 09:30. Avl Bal OMR 118.900\nتم استخدام بطاقتكم XXXX4321 بمبلغ 6.350 ر.ع لدى SAMPLE STORE MUSCAT بتاريخ 05/10/2026. الرصيد المتاح 118.900 ر.ع' },
  { id: 'KFH "تم إرجاع مبلغ" refund back to the account', country: 'KW', ledger: 'KWD', sender: 'KFH', type: 'income', minor: 3125,
    body: 'بيتك: تم إرجاع مبلغ 3.125 د.ك إلى حسابكم رقم ****4321 من SAMPLE SHOP KUWAIT بتاريخ 06/10/2026 (استرداد عملية شراء)' },
  { id: 'InstaPay "You have successfully transferred"', country: 'EG', ledger: 'EGP', sender: 'InstaPay', type: 'expense', minor: 42000, transfer: true,
    body: 'InstaPay\nYou have successfully transferred EGP 420.00 to sample.name@instapay. Reference number: 202610071111' },
];

for (const row of posts) test(`posts: ${row.id}`, () => {
  for (const [path, parsed] of [['android', android(row)], ['history', history(row).parsed[0]]]) {
    assert.ok(parsed, `${path}: a completed ${row.country} alert is booked`);
    assert.equal(parsed.kind, 'transaction', path);
    assert.equal(parsed.type, row.type, path);
    assert.equal(parsed.amountFils, row.minor, path);
    assert.equal(parsed.currency, row.ledger, path);
    if (row.transfer !== undefined) assert.equal(!!parsed.transferHint, row.transfer, path);
  }
});

// Paired controls: the same wording when it is not a completed movement.
const neverPosted = [
  ['QA', 'QAR', 'QNB', 'QNB: Your Debit Card ending 4321 transaction of QAR 312.75 at SAMPLE MART DOHA was declined due to insufficient funds.'],
  ['QA', 'QAR', 'QNB', 'QNB: Your Debit Card ending 4321 has been used for QAR 312.75 at SAMPLE MART DOHA. Transaction pending.'],
  ['QA', 'QAR', 'QNB', 'QNB: Your Debit Card ending 4321 will be used for QAR 312.75 at SAMPLE MART DOHA on 20/10/2026.'],
  ['QA', 'QAR', 'QNB', 'QNB: If your Debit Card ending 4321 has been used for QAR 312.75 at SAMPLE MART DOHA without your consent, call 4440 0000.'],
  ['QA', 'QAR', 'QNB', 'QNB: If your Debit Card ending 4321 was used for QAR 312.75 at SAMPLE MART DOHA without your consent, call 4440 0000.'],
  ['KW', 'KWD', 'KFH', 'بيتك: إذا تم إرجاع مبلغ 3.125 د.ك إلى حسابكم رقم ****4321 دون طلبك يرجى الاتصال بنا'],
  ['QA', 'QAR', 'QNB', 'QNB: Did you use your Debit Card ending 4321 for QAR 312.75 at SAMPLE MART DOHA? Reply YES or NO.'],
  ['QA', 'QAR', 'QNB', 'QNB: Your Debit Card ending 4321 has not been used for QAR 312.75 at SAMPLE MART DOHA.'],
  ['QA', 'QAR', 'QNB', 'QNB: Your OTP for QAR 312.75 at SAMPLE MART DOHA with Debit Card ending 4321 is 482913. Do not share it.'],
  ['QA', 'QAR', 'QNB', 'QNB: Get 10% cashback once your Debit Card has been used for QAR 500.00 at SAMPLE MART this weekend. T&Cs apply.'],
  ['QA', 'QAR', 'QNB', 'QNB: SAMPLE NAME has requested QAR 312.75 from you via Fawran. Open QNB Mobile to pay or decline.'],
  ['QA', 'QAR', 'QNB', 'QNB: A pre-authorization of QAR 312.75 has been placed on your card ending 4321 at SAMPLE HOTEL DOHA.'],
  ['QA', 'QAR', 'CBQ', 'CBQ: Purchase transaction of QAR 47.50 at SAMPLE CAFE DOHA on your card ending 8765 has been declined on 04/10/2026 12:15.'],
  ['QA', 'QAR', 'CBQ', 'CBQ: Purchase transaction of QAR 47.50 at SAMPLE CAFE DOHA on your card ending 8765 is pending approval.'],
  ['OM', 'OMR', 'BankMuscat', 'Your Debit Card XXXX4321 transaction for OMR 6.350 at SAMPLE STORE MUSCAT was declined.\nتم رفض عملية بطاقتكم XXXX4321 بمبلغ 6.350 ر.ع لدى SAMPLE STORE MUSCAT'],
  ['KW', 'KWD', 'KFH', 'بيتك: سيتم إرجاع مبلغ 3.125 د.ك إلى حسابكم رقم ****4321 من SAMPLE SHOP KUWAIT خلال 5 أيام عمل'],
  ['KW', 'KWD', 'KFH', 'بيتك: تم استلام طلب إرجاع مبلغ 3.125 د.ك إلى حسابكم رقم ****4321 وهو قيد المعالجة'],
  ['KW', 'KWD', 'KFH', 'بيتك: رمز التحقق لعملية إرجاع مبلغ 3.125 د.ك هو 482913. لا تشارك الرمز مع أي شخص'],
  ['EG', 'EGP', 'InstaPay', 'InstaPay\nYour transfer of EGP 420.00 to sample.name@instapay failed. Please try again.'],
  ['EG', 'EGP', 'InstaPay', 'InstaPay\nYour transfer of EGP 420.00 to sample.name@instapay is pending.'],
  ['EG', 'EGP', 'InstaPay', 'InstaPay\nIf you have transferred EGP 420.00 to an unknown address, call 19623 immediately.'],
  ['EG', 'EGP', 'InstaPay', 'InstaPay\nsample.name@instapay has requested EGP 420.00 from you. Open InstaPay to pay or decline.'],
  ['EG', 'EGP', 'InstaPay', 'InstaPay\nEGP 420.00 is scheduled to be transferred to sample.name@instapay on 20/10/2026.'],
  ['EG', 'EGP', 'InstaPay', 'InstaPay\nUse code 482913 to confirm transferring EGP 420.00 to sample.name@instapay. Never share this code.'],
  ['EG', 'EGP', 'NBE', 'سيتم تنفيذ تحويل لحظي بمبلغ EGP 1,250.00 من حسابكم رقم 4321 غدا'],
  ['EG', 'EGP', 'NBE', 'لم يتم تنفيذ تحويل لحظي بمبلغ EGP 1,250.00 من حسابكم رقم 4321 لعدم كفاية الرصيد'],
  ['EG', 'EGP', 'NBE', 'رمز التحقق لتأكيد تحويل لحظي بمبلغ EGP 1,250.00 من حسابكم هو 482913'],
  // Conditions and questions in the amount's own clause, Arabic and English.
  ['EG', 'EGP', 'NBE', 'إذا تم تنفيذ تحويل لحظي بمبلغ EGP 1,250.00 من حسابكم دون علمكم اتصلوا بنا'],
  ['EG', 'EGP', 'NBE', 'في حال تم تنفيذ تحويل لحظي بمبلغ EGP 1,250.00 من حسابكم دون علمكم اتصلوا بنا'],
  ['EG', 'EGP', 'NBE', 'هل تم تنفيذ تحويل لحظي بمبلغ EGP 1,250.00 من حسابكم؟'],
  ['EG', 'EGP', 'NBE', 'إذا تم إضافة تحويل لحظي لحسابكم رقم 4321 بمبلغ EGP 120.00 دون علمكم اتصلوا بنا'],
  ['EG', 'EGP', 'VF-Cash', 'لو تم استلام مبلغ EGP 500.00 من رقم 01000000000 دون علمك اتصل بنا'],
  ['EG', 'EGP', 'QNB', 'If your Debit Card **2132 had a successful transaction of EGP 16.79 you did not make, call 19700'],
  ['US', 'USD', '', 'If your card has been used for USD 100.00 at SAMPLE STORE without consent call us'],
  ['US', 'USD', '', 'إذا تم تنفيذ تحويل لحظي بمبلغ USD 125.00 من حسابكم دون علمكم اتصلوا بنا'],
  ['QA', 'QAR', 'CBQ', 'CBQ: Purchase transaction of QAR 47.50 at SAMPLE CAFE DOHA will be approved upon confirmation.'],
];
for (const [country, ledger, sender, body] of neverPosted) test(`never posted (${country}): ${body.slice(0, 60)}`, () => {
  const row = { country, ledger, sender, body };
  assert.equal(android(row), null, 'Android seam books nothing');
  assert.equal(history(row).parsed.length, 0, 'History books nothing');
});

test('Egyptian instant-transfer direction follows whose account the money left or reached', () => {
  const read = (body) => inspectUniversalBankEvent(body);
  const out = read('تم تنفيذ تحويل لحظي بمبلغ EGP 1,250.00 من حسابكم رقم 4321 برقم مرجعي a1b2c3 بتاريخ 07-10-2026 14:05');
  assert.equal(out.status, 'posted');
  assert.equal(out.direction, 'debit');
  assert.equal(out.family, 'transfer');
  const inn = read('تم إضافة تحويل لحظي لحسابكم رقم 4321 بمبلغ EGP 120.00 من SAMPLE NAME رقم مرجعي 1234567890');
  assert.equal(inn.status, 'posted');
  assert.equal(inn.direction, 'credit');
  // A move between the person's own accounts names both sides, so direction
  // is withheld rather than read as money arriving (or leaving).
  for (const body of [
    'حوالة صادرة لحسابك الاستثماري مبلغ: SAR 100 من: **1000 إلى حساب: **2000',
    'حوالة صادرة إلى حسابك الاستثماري مبلغ: SAR 100 من: **1000',
    'تم تنفيذ تحويل بمبلغ EGP 500.00 إلى حسابك الآخر رقم 2000',
    'تم تنفيذ تحويل بمبلغ EGP 500.00 من حسابك رقم 1000 إلى حسابك رقم 2000',
    'تم إيداع مبلغ EGP 500.00 من حسابك رقم 1000',
  ]) assert.equal(read(body).direction === 'credit' || read(body).direction === 'debit', false, body);
});

test('an own-account move is never booked as income or spending', () => {
  for (const [country, ledger] of [['EG', 'EGP'], ['US', 'USD']]) {
    const body = `تم تنفيذ تحويل بمبلغ ${ledger} 500.00 إلى حسابك الآخر رقم 2000`;
    assert.equal(android({ country, ledger, sender: '', body }), null, body);
    assert.equal(history({ country, ledger, sender: '', body }).parsed.length, 0, body);
  }
});

test('a Gulf refund is never booked as spending, even when its purchase is named', () => {
  for (const body of [
    'بيتك: تم إرجاع مبلغ 3.125 د.ك لعملية شراء لدى SAMPLE SHOP',
    'بيتك: تم إرجاع مبلغ 3.125 د.ك لعملية شراء لدى SAMPLE SHOP (استرداد عملية شراء)',
  ]) {
    const row = { country: 'KW', ledger: 'KWD', sender: 'KFH', body };
    for (const parsed of [android(row), history(row).parsed[0]]) {
      assert.ok(!parsed || parsed.type === 'income', body);
    }
  }
});

test('a Gulf instant-payment rail names a transfer, and a card "was used for" is a purchase', () => {
  // The rail must sit in the amount's own clause; a rail named on a later
  // line is not read (it is not this lane's evidence that the line belongs).
  const fawran = inspectUniversalBankEvent('Current Acc xxx4321 debited with QAR 100.00 for Fawran instant payment, ref SAMPLE at 21:06, 04-Oct-26');
  assert.equal(fawran.family, 'transfer');
  assert.equal(fawran.direction, 'debit');
  const lined = inspectUniversalBankEvent('Debit Card **4321\nwas used for QAR 25.70\nat SAMPLE CENTER\nat 17:38\n04-Oct-26');
  assert.equal(lined.family, 'purchase');
  assert.equal(lined.direction, 'debit');
  // A CliQ request to pay names the rail but moved no money: never booked.
  assert.equal(android({ country: 'JO', ledger: 'JOD', sender: 'ArabBank',
    body: 'Arab Bank: SAMPLE NAME has sent you a CliQ request to pay JOD 35.000. Open Arabi Mobile to accept or reject.' }), null);
});

test('Egyptian ATM wording with its article is a cash withdrawal', () => {
  const atm = inspectUniversalBankEvent('بنك مصر: تم سحب مبلغ EGP 3,000.00 من ماكينة الصراف الآلي باستخدام بطاقتك المنتهية بـ 4321 بتاريخ 07/10/2026');
  assert.equal(atm.family, 'cash-withdrawal');
  assert.equal(atm.direction, 'debit');
});

// ── Saudi launch grammar (sms-parser) ───────────────────────────────────────
const saudi = (body, sender) => {
  setActiveCountry('SA'); setActiveMarket('SA'); setLedgerCurrency('SAR', 2);
  return parseSms(body, {}, { sender, observedAt, fxLookup: () => null });
};

test('a telecom crediting a prepaid Sawa line is airtime, not bank money', () => {
  assert.equal(saudi('Sawa recharge credit of 50.00 SAR added to your line\nCheck your Sawa balance by dialing *166#', 'stc'), null);
  assert.equal(saudi('Sawa recharge service credit\nAmount: 25.00 SAR\nCheck your Sawa balance', 'stc'), null);
  // The bank's own payment FOR a Sawa recharge is still a real debit, even
  // when the bank also points at the line's balance.
  for (const body of [
    'Purchase of SAR 50.00 at STC SAWA RECHARGE with mada card ending 1234 on 05/10/2026. Balance SAR 900.00',
    'Your Sawa recharge of SAR 50.00 was paid from your account 1234. Check your Sawa balance.',
    'Your Sawa recharge of SAR 50.00 was paid from your credit card 1234. Check your Sawa balance.',
  ]) {
    const paid = saudi(body, 'SNB-AlAhli');
    assert.ok(paid, body);
    assert.equal(paid.type, 'expense');
    assert.equal(paid.amountFils, 5000);
  }
});

test('an SNB cash-withdrawal correction is money back, not a second withdrawal', () => {
  const correction = saudi('تصحيح سحب نقدي\nمبلغ 120.00 SAR\nمدى *4321', 'SNB-AlAhli');
  assert.ok(correction);
  assert.equal(correction.type, 'income');
  assert.equal(correction.amountFils, 12000);
  assert.equal(correction.merchant, 'Refund');
  const withdrawal = saudi('سحب نقدي\nمبلغ 120.00 SAR\nمدى *4321', 'SNB-AlAhli');
  assert.ok(withdrawal);
  assert.equal(withdrawal.type, 'expense');
  const colon = saudi('تصحيح سحب نقدي:\nمبلغ 120.00 SAR\nمدى *4321', 'SNB-AlAhli');
  assert.ok(colon);
  assert.equal(colon.type, 'income');
  // A correction that also states a debit is not guessed either way.
  assert.equal(saudi('تصحيح سحب نقدي\nتم خصم مبلغ 120.00 SAR\nمدى *4321', 'SNB-AlAhli'), null);
  // Only the heading line counts; a correction mentioned later does not.
  const later = saudi('سحب نقدي\nمبلغ 120.00 SAR\nمدى *4321\nتصحيح سحب نقدي متاح عبر التطبيق', 'SNB-AlAhli');
  assert.ok(!later || later.type === 'expense');
});

test('an Al Rajhi "Credit Card:Payment" field list pays the card, never spending', () => {
  const payment = saudi('Credit Card:Payment\nCard:Visa 4321\nAmount:SR 150', 'AlRajhiBank');
  assert.ok(payment);
  assert.equal(payment.kind, 'cardPayment');
  assert.equal(payment.amountFils, 15000);
  assert.deepEqual(payment.card, { last4: '4321', kind: 'credit' });
  assert.equal(payment.transferHint, true);
  // A purchase heading on the same field list is not a card payment.
  const purchase = saudi('Credit Card:Purchase\nCard:Visa 4321\nAmount:SR 150\nAt:SAMPLE STORE', 'AlRajhiBank');
  assert.ok(!purchase || purchase.kind !== 'cardPayment');
  // The payment heading with a merchant or due-date line is some other message.
  for (const body of [
    'Credit Card:Payment\nCard:Visa 4321\nAmount:SR 150\nAt:SAMPLE STORE',
    'Credit Card:Payment\nCard:Visa 4321\nAmount:SR 150\nDue date: 05/11/2026',
  ]) {
    const other = saudi(body, 'AlRajhiBank');
    assert.ok(!other || other.kind !== 'cardPayment', body);
  }
});
