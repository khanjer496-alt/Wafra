'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const load = require('./load-ts.cjs').createLoader();
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { parseSms, nonPostingReason, moneyNoticeKind } = load('@/lib/sms-parser');
const { setActiveCountry } = load('@/lib/country');
const { setActiveMarket, setLedgerCurrency, detectLaunchMarketFromSender, withMarketPackForParsing } = load('@/lib/markets');

// UAE/Saudi launch-grammar safety round. The alert lab generated messages the
// launch grammar BOOKED although they never moved money (a negated, questioned,
// requested, conditional or promotional figure; a body whose only figure is a
// balance), and booked incoming money as spending. Every body here is
// synthetic text with fictional names, numbers and amounts; none is a real
// alert. Each refusal is paired with the posted wording it must not disturb.
const observedAt = Date.parse('2026-10-12T12:00:00Z');

function session(country) {
  const ledger = country === 'AE' ? 'AED' : 'SAR';
  setActiveCountry(country);
  setLedgerCurrency(ledger, 2);
  setActiveMarket(country);
  return createLaunchAlertSession({ overrides: {}, pinnedCurrency: ledger, fxLookup: () => null,
    bestEffort: { enabled: true, country }, regionHint: country });
}
// The Android SMS seam exactly as the launch evaluator drives it.
function android(row) {
  const reader = session(row.country);
  const inspection = reader.inspect(row.body, row.sender);
  const launch = detectLaunchMarketFromSender(row.sender);
  return launch
    ? reader.parse(row.body, row.sender, inspection, launch, observedAt)
    : reader.parseUnproven(row.body, row.sender, inspection, observedAt);
}
// The iOS History path; `sender` '' is the real senderless iPhone record.
function history(row, sender = row.sender) {
  const reader = session(row.country);
  const record = { v: 1, id: createHash('sha256').update(row.body + sender).digest('hex'), text: row.body,
    receivedAt: new Date(observedAt).toISOString(), ...(sender ? { sender } : {}) };
  return parseHistoricalMessageRecords([JSON.stringify(record)], {}, new Date(observedAt), new Set(), reader).parsed;
}
const legacy = (country, body, sender) => {
  session(country);
  return withMarketPackForParsing(country, () => parseSms(body, {}, { sender, observedAt, fxLookup: () => null }));
};

// ── Completed alerts that must keep (or newly get) the right booking ─────────
const posts = [
  // Controls: the refusal cues sit in a FOOTER, never in the amount's clause.
  { id: 'a purchase keeps its row under a conditional fraud footer', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 4500,
    body: 'Your Debit Card ending 4321 was used for AED 45.00 at SAMPLE CAFE on 05/10/2026. Avl bal AED 5,000.00. If you did not make this transaction, call 600 000000.' },
  { id: 'a purchase keeps its row under a yes/no confirmation footer', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 4500,
    body: 'Your Debit Card ending 4321 was used for AED 45.00 at SAMPLE CAFE on 05/10/2026. Not you? Reply NO to block your card.' },
  { id: 'a purchase keeps its row with an available-balance trailer', country: 'AE', sender: 'FAB', type: 'expense', minor: 12050,
    body: 'Purchase of AED 120.50 at SAMPLE MART with Credit Card ending 4321 on 05/10/2026. Your available balance is AED 7,450.00' },
  { id: 'a purchase keeps its row after a limit sentence', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 5000,
    body: 'Your daily purchase limit is AED 5,000.00. Purchase of AED 50.00 at SAMPLE SHOP with card ending 1234 on 05/10/2026.' },
  { id: 'a purchase keeps its row when a fraud footer runs into its clause', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 5000,
    body: 'Purchase of AED 50.00 at SAMPLE SHOP with card ending 1234 on 12/10/2026, if this transaction was not processed by you call 600 000000' },
  { id: 'an Arabic debit keeps its row when "في حال لم يتم الخصم" runs into its clause', country: 'SA', sender: 'AlRajhiBank', type: 'expense', minor: 10000,
    body: 'تم خصم مبلغ 100.00 ريال من حسابك 1234 لدى SAMPLE SHOP في حال لم يتم الخصم من قبلك اتصل 920000000' },
  { id: '":-" is a field separator, not a minus sign', country: 'SA', sender: 'AlRajhiBank', type: 'income', minor: 100000,
    body: 'حوالة واردة\nالمبلغ:- 1,000.00 ريال\nمن: SAMPLE PERSON' },
  { id: 'an Arabic debit keeps its row under a "في حال" footer', country: 'SA', sender: 'AlRajhiBank', type: 'expense', minor: 5000,
    body: 'تم خصم مبلغ 50.00 ر.س من بطاقتك المنتهية بـ 4321 لدى SAMPLE STORE بتاريخ 05/10/2026. في حال لم تقم بهذه العملية اتصل بنا' },
  { id: 'an Arabic debit keeps its row when a separate clause negates a fee', country: 'SA', sender: 'AlRajhiBank', type: 'expense', minor: 5000,
    body: 'تم خصم مبلغ 50.00 ر.س من بطاقتك المنتهية بـ 4321 لدى SAMPLE STORE بتاريخ 05/10/2026.\nلم يتم خصم أي رسوم على هذه العملية' },
  // Incoming money that was booked as an EXPENSE.
  { id: '"Payment received … from <payer>" is income', country: 'AE', sender: 'EmiratesNBD', type: 'income', minor: 18245,
    body: 'Emirates NBD: Payment received: AED182.45 from SAMPLE PERSON\nIf you don\'t recognise this, call us on 600 000000.' },
  { id: '"Payment received" from a payer, Saudi riyal suffix', country: 'SA', sender: 'RiyadBank', type: 'income', minor: 468400,
    body: 'Payment received: 4,684.00 SR from SAMPLE LOGISTICS' },
  { id: '"Deposit received" field list with a From: line is income', country: 'SA', sender: 'SNB-AlAhli', type: 'income', minor: 236235,
    body: 'SNB: Deposit received | Date: 2026-10-10 15:58 | Transaction amount: SAR2,362.35 | From: SAMPLE PERSON\nBal: SAR24,027.26' },
  { id: '"Incoming transfer" field list with a Sender: line is income', country: 'AE', sender: 'FAB', type: 'income', minor: 218514,
    body: 'FAB: Incoming transfer\nAmount: 2,185.14 AED\nSender: SAMPLE PERSON\nWhen: 01/10/2026 10:53\nAccount: *8433\nAvl bal 28,074.03 AED' },
  { id: 'Arabic "تم إرجاع مبلغ … إلى بطاقتك" is a refund', country: 'SA', sender: 'alinma', type: 'income', minor: 39803,
    body: 'Alinma: تم إرجاع مبلغ 398.03 ر.س إلى بطاقتك المنتهية بـ 7557 من SAMPLE PHARMACY بتاريخ 22/09/2026 19:14.' },
  { id: 'Arabic "أعاد <shop> مبلغ … إلى بطاقتك" is a refund, opt-out footer and all', country: 'SA', sender: 'SNB-AlAhli', type: 'income', minor: 23621,
    body: 'أعاد SAMPLE PHARMACY مبلغ 236.21 ريال إلى بطاقتك المنتهية بـ 5576 بتاريخ 02-Oct-2026 22:14. لإلغاء الاشتراك في الرسائل أرسل STOP' },
  { id: 'a "Refund |" first field is a refund', country: 'SA', sender: 'SNB-AlAhli', type: 'income', minor: 63300,
    body: 'SNB: Refund | Merchant: SAMPLE STORE | Card: ·4937 | Transaction amount: SAR 633.00' },
  { id: 'a "Refund |" first field with a "+" amount is a refund', country: 'AE', sender: 'ADCB', type: 'income', minor: 2667,
    body: 'Refund | Merchant: SAMPLE STORE | Transaction amount: +26.67 Dhs | Card: ·4185\nYour balance is now 31,069.42 Dhs.' },
  { id: 'a signed "+" refund field the reader takes keeps its row', country: 'AE', sender: 'ADCB', type: 'income', minor: 92150,
    body: 'Refund\nMerchant: SAMPLE STORE\nCard: ·1095\nTransaction amount: +921.50 Dhs\nIf you don\'t recognise this, call us on 600 000000.' },
];

for (const row of posts) test(`posts: ${row.id}`, () => {
  for (const [path, parsed] of [['android', android(row)], ['history', history(row)[0]]]) {
    assert.ok(parsed, `${path}: the completed alert is booked`);
    assert.equal(parsed.kind, 'transaction', path);
    assert.equal(parsed.type, row.type, path);
    assert.equal(parsed.amountFils, row.minor, path);
  }
});

// ── Notices that quote money but never moved it ──────────────────────────────
// [market, sender, body, the notice kind moneyNoticeKind must name (or null
// when another guard refuses it)]
const neverPosted = [
  // Negated in the amount's own clause.
  ['AE', 'EmiratesNBD', 'Your payment of AED 12.00 to SAMPLE RIDES was not paid.', 'negated'],
  ['AE', 'Mashreq', 'Mashreq: 41.00 AED has not been transferred to SAMPLE PERSON.', 'negated'],
  ['SA', 'AlRajhiBank', 'SAR 50.00 wasn\'t charged to your card ending 4321; the transaction at SAMPLE STORE was cancelled.', 'negated'],
  ['SA', 'AlRajhiBank', 'لم يتم سداد مبلغ 344.00 ر.س إلى SAMPLE STORE.', 'negated'],
  ['SA', 'AlRajhiBank', 'لم يتم خصم مبلغ 50.00 ر.س من بطاقتك لدى SAMPLE STORE، تم إلغاء العملية', 'negated'],
  ['AE', 'FAB', 'FAB: لم يتم خصم 647.36 د.إ من البطاقة رقم ****2575، تم إلغاء العملية لدى SAMPLE MART.', 'negated'],
  // A question / yes-no challenge about the amount.
  ['AE', 'EmiratesNBD', 'Did you make a AED168.06 purchase at SAMPLE SHOP? Reply YES or NO.', 'question'],
  ['AE', 'FAB', 'Fraud alert: did you attempt a AED 250.00 transaction at SAMPLE SHOP? Reply Y if yes, N if no.', 'question'],
  ['SA', 'SNB-AlAhli', 'هل قمت بعملية شراء بمبلغ 120.00 ر.س لدى SAMPLE SHOP؟ أرسل نعم أو لا', 'question'],
  ['SA', 'AlRajhiBank', 'هل قمت بتحويل 500.00 ر.س إلى SAMPLE PERSON؟ للتأكيد أرسل 1 وللإلغاء أرسل 2.', 'question'],
  // A money request.
  ['AE', 'ADCB', 'Payment request: SAMPLE PERSON is asking you to pay 206.00 AED.', 'request'],
  ['AE', 'ADCB', 'SAMPLE PERSON requested AED 75.00 from you. Tap to pay.', 'request'],
  ['SA', 'AlRajhiBank', 'لديك طلب دفع بمبلغ 150.00 ر.س من SAMPLE PERSON.', 'request'],
  ['SA', 'AlRajhiBank', 'طلب SAMPLE PERSON منك مبلغ 150.00 ر.س. اضغط للدفع.', 'request'],
  // A hypothetical condition opening the amount's clause.
  ['AE', 'ADCB', 'ADCB\nIf you make a purchase over 291.07 AED at SAMPLE LOUNGE, we will send you an alert.', 'conditional'],
  ['SA', 'RiyadBank', 'Riyad Bank: If your card is charged SAR 80.00 by SAMPLE STORE without your consent, you can dispute it within 60 days.', 'conditional'],
  ['AE', 'Mashreq', 'إذا قمت بعملية شراء بأكثر من 363.63 د.إ لدى SAMPLE FOOD فسنرسل لك تنبيهاً.', 'conditional'],
  ['SA', 'SNB-AlAhli', 'SNB: في حال تم خصم 400.00 ر.س من بطاقتك لدى SAMPLE STORE دون علمك يمكنك الاعتراض خلال 60 يوماً.', 'conditional'],
  // A promotion whose figure is a threshold to qualify for.
  ['AE', 'FAB', 'Spend Dhs 5,000.00 at SAMPLE MART with your card ending 4414 and earn double points. Offer ends Sunday.', 'promotion'],
  ['AE', 'FAB', 'احصل على استرداد نقدي 10% عند الشراء بأكثر من 5,000.00 د.إ لدى SAMPLE MART!', 'promotion'],
  ['SA', 'SNB-AlAhli', 'احصل على استرداد نقدي 10% عند الشراء بأكثر من ٥٬٠٠٠٫٠٠ ريال لدى SAMPLE STATION!', 'promotion'],
  // Only a balance — never the amount of anything.
  ['AE', 'EmiratesNBD', 'Your available balance on your Visa Debit ••1650 is AED 37,108.90', 'balance-only'],
  ['SA', 'RiyadBank', 'Riyad Bank: Your available balance on your checking account ...7229 is SR 12,768.41.', 'balance-only'],
  ['SA', 'SNB-AlAhli', 'رصيد بطاقتك المتاح هو 4,500.00 ر.س.', 'balance-only'],
  ['SA', 'urpay', 'الحد اليومي للمشتريات 50.00 USD لبطاقتك الجديدة.\nرصيدك الحالي SAR 356.67.', 'balance-only'],
  // Personal chat and an Arabic bill reminder.
  ['AE', '', 'lol just spent AED 41.00 at SAMPLE SHOP 😂', 'personal-chat'],
  ['SA', '', 'دفعت 39.00 ريال في SAMPLE CAFE عن العشاء، حوّل لي نصيبك', 'personal-chat'],
  ['SA', '', 'تذكير: فاتورة SALARY BAR بمبلغ 250.00 ريال مستحقة في 27/10/2026', 'reminder'],
  // Pending / future wording other guards refuse; both were booked before.
  ['AE', 'EmiratesNBD', 'Your purchase of Dhs 55.00 at SAMPLE.COM is pending and will post in 1-3 business days.', null],
  ['SA', 'RiyadBank', 'Riyad Bank\nSR 688.70 will be debited from your checking account ...5304 on 27/10/2026 for SAMPLE BILLER.\nDidn\'t make this? Call 920 000000 now.', null],
];

for (const [country, sender, body, kind] of neverPosted) test(`never posted (${country}): ${body.slice(0, 60)}`, () => {
  const row = { country, sender, body };
  assert.equal(android(row), null, 'Android seam books nothing');
  assert.equal(history(row).length, 0, 'History (with sender) books nothing');
  assert.equal(history(row, '').length, 0, 'senderless History books nothing');
  assert.equal(moneyNoticeKind(body), kind);
});

test('a refused money notice is not evidence for deleting a stored row', () => {
  // nonPostingReason drives the ledger repair that DELETES older rows; these
  // shapes are refused at parse time only.
  for (const body of [
    'Your payment of AED 12.00 to SAMPLE RIDES was not paid.',
    'Did you make a AED168.06 purchase at SAMPLE SHOP? Reply YES or NO.',
    'Your available balance on your Visa Debit ••1650 is AED 37,108.90',
  ]) assert.equal(nonPostingReason(body), null, body);
});

// ── A balance is never the amount ────────────────────────────────────────────
test('a signed amount field never lets the balance under it become the amount', () => {
  for (const [country, sender, body] of [
    ['AE', 'EmiratesNBD', 'Emirates NBD: Refund credited\nWhen: 28/09/2026 21:28\nAccount: ****4659\nAmount: Dhs +263.12\nAt: Sample.Com\nAvailable credit: Dhs 39,937.11.'],
    ['SA', 'AlRajhiBank', 'ATM withdrawal\nAmount: -400.00 SAR\nAvailable credit: 7,792.70 SAR.\nNot you? Call 920 000000.'],
    ['SA', 'urpay', 'استرداد, لدى: SAMPLE VIDEO, المبلغ: ر.س +307.13\nرصيدك الحالي ر.س 43,240.98.'],
    ['SA', 'urpay', 'حوالة صادرة; المبلغ: -٣٩٢٫٢٥ ريال; في: 2026-10-05 13:54; إلى: SAMPLE PERSON; الحساب: ·5320\nرصيدك الحالي ١٧٬٨٥٠٫٨١ ريال.'],
    ['AE', 'FAB', 'سحب صراف آلي; الموقع: SAMPLE ATM; المبلغ: -1,000.00 د.إ; في: 6 أكتوبر 2026\nرصيدك الحالي 9,099.59 د.إ.'],
    // A "+" field the reader takes, but whose words read as spending.
    ['AE', 'ADCB', 'Purchase | Merchant: SAMPLE STORE | Transaction amount: +26.67 Dhs | Card: ·4185\nYour balance is now 31,069.42 Dhs.'],
  ]) {
    const row = { country, sender, body };
    for (const parsed of [legacy(country, body, sender), android(row), history(row)[0]]) {
      assert.ok(!parsed || parsed.amountFils < 100000, `never a balance-sized row: ${body}`);
      assert.equal(parsed ?? null, null, body);
    }
  }
});

test('the current-balance and available-credit lines are balances, not amounts', () => {
  // With the transaction's own figure readable, the trailer never competes.
  const ar = legacy('SA', 'تم خصم مبلغ 75.00 ر.س من بطاقتك المنتهية بـ 4321 لدى SAMPLE STORE بتاريخ 05/10/2026\nرصيدك الحالي ر.س 43,240.98', 'AlRajhiBank');
  assert.equal(ar?.amountFils, 7500);
  // With it unreadable, the trailer is not promoted to the amount.
  assert.equal(legacy('AE', 'Refund credited\nAccount: ****4659\nAt: Sample.Com\nAvailable credit: Dhs 39,937.11.', 'EmiratesNBD'), null);
});

test('a biller receipt or a card settlement under "payment received" is never income', () => {
  // A biller names the reader as the payer; a card settlement names the card.
  // Only a launch BANK sender's "payment received … from <payer>" is income.
  for (const [sender, body] of [
    ['SAMPLEUTIL', 'SAMPLE UTILITY: Payment received AED 350.00 from SAMPLE NAME towards account 2001234567. Thank you.'],
    ['SAMPLEUTIL', 'SAMPLE UTILITY: Payment received AED 350.00 from SAMPLE NAME. Ref 12345'],
    ['', 'Payment received: AED 350.00 from SAMPLE NAME. Thank you'],
    ['EmiratesNBD', 'Payment received: AED 350.00 from SAMPLE NAME for your SAMPLE TELECOM account 0501234567. Thank you.'],
    ['EmiratesNBD', 'Payment received: AED 900.00 from SAMPLE NAME for your credit card ending 1234.'],
    ['EmiratesNBD', 'Payment received AED 1,000.00 from SAMPLE NAME to your Credit Card ending 1234'],
    ['EmiratesNBD', 'Payment received: AED 1,500.00 from SAMPLE NAME. Credit card 1234 available limit AED 9,000.00'],
  ]) {
    const parsed = legacy('AE', body, sender);
    assert.ok(!parsed || parsed.kind !== 'transaction' || parsed.type === 'expense', body);
  }
});

test('a card re-issue fee is not money returned', () => {
  const parsed = legacy('SA', 'تم إعادة إصدار بطاقتك بنجاح، تم خصم رسوم 30.00 ريال من حسابك وستصل إلى بطاقتك', 'AlRajhiBank');
  assert.ok(!parsed || parsed.type === 'expense', parsed?.type);
});

test('a shop named REFUND SHOP never turns a purchase into income', () => {
  // Its "refund" sits in the Merchant: field's value, which is a name.
  for (const [sender, body] of [
    ['', 'Sample Bank: Card transaction, Amt: AED 39.27, Card: ·4168, Merchant: REFUND SHOP'],
    ['EmiratesNBD', 'Purchase of AED 39.27 with Card ending 4168 on 05/10/2026\nMerchant: REFUND SHOP\nAvl bal AED 2,000.00'],
  ]) {
    const row = { country: 'AE', sender, body };
    for (const parsed of [legacy('AE', body, sender), android(row), history(row)[0]]) {
      assert.ok(!parsed || parsed.type === 'expense', body);
    }
  }
  const purchase = legacy('AE', 'Purchase of AED 39.27 with Card ending 4168 on 05/10/2026\nMerchant: REFUND SHOP\nAvl bal AED 2,000.00', 'EmiratesNBD');
  assert.equal(purchase?.type, 'expense');
  assert.equal(purchase?.amountFils, 3927);
});

test('the opt-out footer is never a payee', () => {
  // Without the refund verb the message names no movement: still never a
  // purchase "at" the footer's words.
  const parsed = legacy('SA', 'SAMPLE STORE مبلغ 236.21 ريال بطاقتك المنتهية بـ 5576. لإلغاء الاشتراك في الرسائل أرسل STOP', 'SNB-AlAhli');
  assert.ok(!parsed || !/الرسائل|STOP/.test(parsed.merchant), parsed?.merchant);
});

// ── Round 2: shapes the alert lab added after round 1 ───────────────────────
// Each refusal is paired with the completed wording it must not disturb.
const round2Posts = [
  { id: 'a "Not you?" sentence after a completed spend is a footer, not a question', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 4500,
    body: 'Your Debit Card ending 4321 has been used for AED 45.00 at SAMPLE CAFE. Not you? Call 600 000000.' },
  { id: 'a statement-descriptor note is not a hold', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 4500,
    body: 'Purchase of AED 45.00 at SAMPLE SHOP with card ending 4321 on 05/10/2026. The charge may appear on your statement as SAMPLE*SHOP.' },
  { id: 'an ATM withdrawal keeps its row under a daily-limit sentence', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 50000,
    body: 'ATM withdrawal of AED 500.00 from card ending 4321 at SAMPLE ATM on 05/10/2026. Your daily withdrawal limit is AED 5,000.00.' },
  { id: 'a purchase made WITH a credit card is not a card-bill payment', country: 'AE', sender: 'ADCB', type: 'expense', minor: 5000,
    body: 'Purchase of AED 50.00 to SAMPLE SHOP with Credit Card ending 1234. Avl limit AED 5,000.00' },
  { id: 'salary credited to a savings account is income, not an own-account move', country: 'AE', sender: 'EmiratesNBD', type: 'income', minor: 1000000,
    body: 'Salary of AED 10,000.00 has been credited to your savings account 1234.' },
  { id: 'money returned TO your card is a refund, not a returned payment', country: 'AE', sender: 'EmiratesNBD', type: 'income', minor: 5000,
    body: 'AED 50.00 has been returned to your card ending 1234 by SAMPLE SHOP.' },
  { id: 'a transfer to another person stays spending', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 50000,
    body: 'You have transferred AED 500.00 to SAMPLE PERSON from your account 1234.' },
  { id: 'an Arabic card spend keeps its row under an "إذا لم تكن أنت" footer', country: 'SA', sender: 'AlRajhiBank', type: 'expense', minor: 4500,
    body: 'تم خصم مبلغ 45.00 ر.س من بطاقتك المنتهية بـ 4321 لدى SAMPLE CAFE بتاريخ 05/10/2026. إذا لم تكن أنت اتصل بنا' },
];
for (const row of round2Posts) test(`round 2 posts: ${row.id}`, () => {
  for (const [path, parsed] of [['android', android(row)], ['history', history(row)[0]]]) {
    assert.ok(parsed, `${path}: the completed alert is booked`);
    assert.equal(parsed.kind, 'transaction', path);
    assert.equal(parsed.type, row.type, path);
    assert.equal(parsed.amountFils, row.minor, path);
  }
});

// [market, sender, body, the notice kind moneyNoticeKind must name]
const round2Never = [
  ['AE', 'Mashreq', 'Your Visa card xxxx4321 may have been used for Dhs 120.00 at SAMPLE RIDES.', 'hedged'],
  ['AE', 'EmiratesNBD', 'It looks like AED 147.52 may have been spent at SAMPLE SHOP with your card ending 4321.', 'hedged'],
  ['AE', 'ADCB', 'ADCB: ربما تم استخدام بطاقتك المنتهية بـ 4321 لعملية بمبلغ 482.00 د.إ لدى SAMPLE FOOD.', 'hedged'],
  ['SA', 'AlRajhiBank', 'قد يكون تم خصم 90.00 ر.س لدى SAMPLE STORE.', 'hedged'],
  ['AE', 'EmiratesNBD', 'Your Visa Debit ••4321 has been used for AED 60.00 at SAMPLE.COM, didn\'t make this?', 'question'],
  ['AE', 'FAB', 'FAB: Your account xxxx4321 was used for Dhs 75.00 at SAMPLE STATION or was it not you?', 'question'],
  ['AE', 'ADCB', 'ADCB: AED 40.00 at SAMPLE PHARMACY on your card ending 4321 or did you not make it?', 'question'],
  ['AE', 'FAB', 'تم استخدام بطاقتك المنتهية بـ 4321 بمبلغ 55.00 د.إ لدى SAMPLE FOOD، ألست أنت؟', 'question'],
  ['SA', 'AlRajhiBank', '55.00 ر.س لدى SAMPLE MART عبر البطاقة رقم ****4321، أم لم تكن أنت؟', 'question'],
  ['AE', 'EmiratesNBD', 'Example: A charge of AED 30.00 at SAMPLE SHOP was approved.', 'example'],
  ['AE', 'EmiratesNBD', 'Sample alert. You made a AED 18.14 purchase at SAMPLE SHOP.', 'example'],
  ['SA', 'AlRajhiBank', 'Al Rajhi: مثال: عملية شراء بمبلغ ر.س 64.00 لدى SAMPLE STATION', 'example'],
  ['SA', 'SNB-AlAhli', 'على سبيل المثال، ستظهر عملية شراء بمبلغ 324.00 ريال لدى SAMPLE FOOD هكذا.', 'example'],
  ['AE', 'ADCB', 'ADCB: ATM withdrawal of 1,000.00 AED limit reached for today.', 'limit'],
  ['SA', 'SNB-AlAhli', 'Contactless payments of up to SAR 300.00 are available with your new card.', 'limit'],
  ['AE', 'EmiratesNBD', 'Your daily card spending limit of AED 5,000.00 has been reached.', 'limit'],
  ['AE', 'ADCB', 'سحب نقدي حتى 2,000.00 AED: تم بلوغ الحد اليومي.', 'limit'],
  ['SA', 'SNB-AlAhli', 'SNB: A charge of SR 210.00 at SAMPLE PHARMACY may appear on your Visa card xxxx4321', 'hold'],
  ['AE', 'EmiratesNBD', 'A charge of AED 90.00 at SAMPLE SHOP requires approval.', 'hold'],
  ['AE', 'EmiratesNBD', 'Your card ending in 4321 has been used for AED 1.00 at SAMPLE HYPERMARKET for card verification.', 'hold'],
  ['AE', 'ADCB', 'ADCB: عملية شراء بمبلغ 75.00 د.إ لدى SAMPLE HYPERMARKET بانتظار موافقتك.', 'hold'],
  ['SA', 'RiyadBank', 'Riyad Bank: Debit card payment of 187.67 SR at SAMPLE MART was returned.', 'returned'],
  ['AE', 'Mashreq', 'Mashreq: Your 300.00 Dhs payment to SAMPLE UTILITY was sent back to you.', 'returned'],
  ['SA', 'AlRajhiBank', 'ارتدت حوالتك بمبلغ 500.00 ر.س إلى SAMPLE PERSON ولم تتم.', null],
  ['AE', 'ADCB', 'ADCB: You received Dhs 460.05 via Zelle. Enroll to receive it.', 'unclaimed'],
  ['AE', 'ADCB', 'You received 250.00 Dhs from SAMPLE PERSON. Accept within 7 days.', 'unclaimed'],
  ['SA', 'AlRajhiBank', 'أرسل لك SAMPLE PERSON مبلغ 200.00 ر.س. هل تقبله؟', 'unclaimed'],
  ['AE', 'FAB', 'FAB: Your payment of Dhs 294.42 to SAMPLE PERSON is being sent.', 'not-yet'],
  ['SA', 'AlRajhiBank', 'جارٍ إرسال حوالتك بمبلغ 300.00 ر.س إلى SAMPLE PERSON.', 'not-yet'],
  ['SA', 'AlRajhiBank', 'لم تصل حوالتك بمبلغ 300.00 ر.س إلى SAMPLE PERSON بعد.', 'not-yet'],
  ['AE', 'EmiratesNBD', 'A charge of AED 55.00 at SAMPLE MUSIC renews tomorrow.', 'not-yet'],
  ['AE', 'EmiratesNBD', 'Emirates NBD: Nothing was charged to your Visa Debit ••4321 for the 77.75 AED order at SAMPLE MUSIC', 'negated'],
  ['SA', 'AlRajhiBank', 'We have charged nothing from your account for SAR 120.00', 'negated'],
  ['AE', 'FAB', 'FAB: لم يقم SAMPLE STATION بخصم 324.00 درهم.', 'negated'],
];
for (const [country, sender, body, kind] of round2Never) test(`round 2 never posted (${country}): ${body.slice(0, 60)}`, () => {
  const row = { country, sender, body };
  assert.equal(android(row), null, 'Android seam books nothing');
  assert.equal(history(row).length, 0, 'History (with sender) books nothing');
  assert.equal(history(row, '').length, 0, 'senderless History books nothing');
  if (kind) assert.equal(moneyNoticeKind(body), kind);
});

test('card-bill payments, own-account moves and bills received are never spending or income', () => {
  for (const [country, sender, body] of [
    ['AE', 'EmiratesNBD', 'Your bill payment of AED 900.00 to AMERICAN EXPRESS was completed. Avl bal AED 9,000.00'],
    ['AE', 'FAB', 'FAB: You sent AED 900.00 to your SAMPLE BANK card ending 1234'],
    ['SA', 'SNB-AlAhli', 'You transferred SAR 900.00 to your SAMPLE BANK credit card.'],
    ['AE', 'Mashreq', 'تم دفع 900.00 د.إ إلى AMERICAN EXPRESS لسداد مستحقات البطاقة.'],
    ['SA', 'AlRajhiBank', 'تم سداد 900.00 ر.س لبطاقتك الائتمانية من SAMPLE BANK.'],
    ['SA', 'AlRajhiBank', 'You transferred SR 700.00 to your savings account.'],
    ['AE', 'FAB', 'FAB: You sent Dhs 700.00 to your Savings account.'],
    ['SA', 'AlRajhiBank', 'Al Rajhi: You received 700.00 SR from your Savings account into your Checking.'],
    ['SA', 'SNB-AlAhli', 'SNB: تم تحويل 700.00 ريال إلى حساب التوفير الخاص بك.'],
    ['SA', 'SNB-AlAhli', 'تم تحويل 700.00 ر.س إلى حساب التوفير الخاص بك.'],
    ['AE', 'EmiratesNBD', 'You have received a new bill from SAMPLE UTILITY for AED 350.00, due 25/10/2026.'],
    ['AE', 'EmiratesNBD', 'Emirates NBD: New bill received: SAMPLE UTILITY, 350.00 Dhs, due 25-10-2026'],
  ]) {
    const row = { country, sender, body };
    for (const parsed of [legacy(country, body, sender), android(row), history(row)[0], history(row, '')[0]]) {
      assert.ok(!parsed || parsed.kind !== 'transaction' || parsed.transferHint === true, body);
    }
  }
});

test('a payee confirming it received your payment is never income', () => {
  for (const [country, sender, body] of [
    ['AE', 'EmiratesNBD', 'Emirates NBD: SAMPLE PERSON has received your 500.00 AED transfer.'],
    ['SA', 'SNB-AlAhli', 'SAMPLE PERSON received your payment of SAR 250.00.'],
    ['SA', 'AlRajhiBank', 'استلم SAMPLE PERSON حوالتك بمبلغ 250.00 ر.س.'],
  ]) {
    const row = { country, sender, body };
    for (const parsed of [legacy(country, body, sender), android(row), history(row)[0]]) {
      assert.ok(!parsed || parsed.type !== 'income', body);
    }
  }
  // "We received your payment" is the bank's card-payment receipt, unchanged.
  const receipt = legacy('AE', 'We received your payment of AED 1,234.56 towards your credit card ending 1234.', 'EmiratesNBD');
  assert.ok(!receipt || receipt.kind !== 'transaction' || receipt.type !== 'expense', JSON.stringify(receipt));
});

// ── Gulf neighbours and the Levant/Egypt (universal reader + ME packs) ──────
const { currencyMinorUnits } = load('@/lib/currency-metadata');
function neighbour(row) {
  setActiveCountry(row.country);
  const exponent = currencyMinorUnits(row.ledger);
  setLedgerCurrency(row.ledger, exponent === 0 || exponent === 3 ? exponent : 2);
  setActiveMarket('ZZ');
  const reader = createLaunchAlertSession({ overrides: {}, pinnedCurrency: row.ledger, fxLookup: () => null,
    bestEffort: { enabled: true, country: row.country }, regionHint: row.country });
  const inspection = reader.inspect(row.body, row.sender);
  const android = reader.parseUnproven(row.body, row.sender, inspection, observedAt);
  const record = { v: 1, id: createHash('sha256').update(row.body).digest('hex'), text: row.body,
    receivedAt: new Date(observedAt).toISOString() };
  const ios = parseHistoricalMessageRecords([JSON.stringify(record)], {}, new Date(observedAt), new Set(), reader).parsed;
  return [android, ios[0] ?? null];
}
test('neighbour-market notices that never moved money are never booked', () => {
  for (const [country, ledger, sender, body] of [
    ['QA', 'QAR', 'QNB', 'على سبيل المثال، ستظهر عملية شراء بمبلغ 325.54 QAR لدى SAMPLE STORE هكذا.'],
    ['KW', 'KWD', 'KFH', 'على سبيل المثال، ستظهر عملية شراء بمبلغ 1,709.818 دينار كويتي لدى SAMPLE STORE هكذا.'],
    ['EG', 'EGP', 'NBE', 'NBE: على سبيل المثال، ستظهر عملية شراء بمبلغ 6,497.21 جنيه لدى SAMPLE STORE هكذا.'],
    ['JO', 'JOD', 'ArabBank', 'على سبيل المثال، ستظهر عملية شراء بمبلغ 28.697 دينار لدى SAMPLE STORE هكذا.'],
    ['EG', 'EGP', 'NBE', 'NBE: إذا قمت بعملية شراء بأكثر من 4,000.00 جنيه لدى SAMPLE STORE فسنرسل لك تنبيهاً.'],
    ['OM', 'OMR', 'BankMuscat', 'تم استخدام بطاقتك المنتهية بـ 9659 بمبلغ 13.000 OMR لدى SAMPLE.COM، ألست أنت؟'],
    ['QA', 'QAR', 'QNB', 'QNB: You received QAR 700.00 from your Savings account into your Checking.'],
    ['QA', 'QAR', 'QNB', 'QNB\nA charge of QAR 701.46 at SAMPLE MUSIC renews tomorrow.\nYour balance is now QAR 37,192.68.'],
  ]) {
    for (const parsed of neighbour({ country, ledger, sender, body })) assert.equal(parsed, null, body);
  }
});
test('a neighbour payee receipt is never income, and the completed spend still books', () => {
  for (const [country, ledger, sender, body] of [
    ['QA', 'QAR', 'QNB', 'QNB: SAMPLE PERSON has received your 500.00 QAR transfer.'],
    ['OM', 'OMR', 'BankMuscat', 'Bank Muscat\nSAMPLE PERSON has received your RO 13.000 transfer.'],
  ]) {
    for (const parsed of neighbour({ country, ledger, sender, body })) assert.ok(!parsed || parsed.type !== 'income', body);
  }
  const [spend] = neighbour({ country: 'QA', ledger: 'QAR', sender: 'QNB',
    body: 'QNB: Your Debit Card ending 4321 has been used for QAR 312.75 at SAMPLE MART DOHA on 03-Oct-2026 18:40. Avl. Bal. QAR 6,410.20' });
  assert.equal(spend?.type, 'expense');
  assert.equal(spend?.amountFils, 31275);
});

// Review controls: completed alerts whose footer or trailer carries a
// round-2 word, which must keep their booking.
const round2Controls = [
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Your Credit Card ending 1234 was used for AED 50.00 at SAMPLE HYPERMARKET on 12/10/2026, Not you? Call 600 000000'],
  ['AE', 'EmiratesNBD', 'expense', 12000, 'Purchase of AED 120.00 with Credit Card ending 1234 at SAMPLE MART was successful. Register to receive e-statements in the app.'],
  ['AE', 'EmiratesNBD', 'expense', 50000, 'ATM cash withdrawal of AED 500.00 from card ending 1234 at SAMPLE ATM on 12/10/2026, daily limit remaining AED 4,500.00'],
  ['AE', 'EmiratesNBD', 'income', 5000, 'Refund of AED 50.00 was returned to card ending 1234 from SAMPLE.COM'],
  ['AE', 'EmiratesNBD', 'income', 20000, 'Refund payment of AED 200.00 to your credit card ending 1234 from SAMPLE.COM has been processed.'],
  ['AE', 'EmiratesNBD', 'expense', 9900, 'Your Credit Card ending 1234 was charged AED 99.00 at PAYPAL *SAMPLE which may appear on your statement as SAMPLE AB.'],
  ['AE', 'EmiratesNBD', 'expense', 25000, 'Your transaction of AED 250.00 at SAMPLE SHOP was approved. International transactions may take 3 days to post.'],
  ['AE', 'EmiratesNBD', 'expense', 5500, 'Your Credit Card ending 1234 was charged AED 55.00 at SAMPLE MUSIC, subscription renews on 12/11.'],
];
for (const [country, sender, type, minor, body] of round2Controls) test(`round 2 control keeps its row: ${body.slice(0, 60)}`, () => {
  const parsed = legacy(country, body, sender);
  assert.equal(parsed?.type, type, body);
  assert.equal(parsed?.amountFils, minor, body);
});

test('a fee schedule clause never shadows the negated movement after it', () => {
  for (const body of [
    'Charges AED 5.00 apply. Your card was not charged AED 150.00 at SAMPLE MART.',
    'Fee: AED 1.00. Your transfer of AED 300.00 to SAMPLE PERSON has not been processed.',
    // …and a fee that was itself NOT charged is never booked either.
    'Fee AED 25.00 was not charged for your transfer to SAMPLE PERSON.',
    'Fee SAR 5.75 is not charged on this transfer.',
    'رسوم التحويل 5.75 ريال لم يتم خصمها',
  ]) {
    const row = { country: 'AE', sender: 'EmiratesNBD', body };
    assert.equal(android(row), null, body);
    assert.equal(history(row).length, 0, body);
  }
});

// ── Round 4: the final Gulf review's confirmed bypasses ─────────────────────
// [market, sender, body]: never booked on Android, History, senderless History.
const round4Never = [
  // A refusal clause that wraps onto the next line.
  ['AE', 'EmiratesNBD', 'Your payment of AED 12.00 to SAMPLE RIDES\nwas not paid.'],
  ['SA', 'AlRajhiBank', 'لم يتم\nخصم مبلغ 50.00 ر.س من بطاقتك لدى SAMPLE STORE'],
  ['SA', 'SNB-AlAhli', 'لم يُخصم مبلغ 50.00 ر.س من بطاقتك لدى SAMPLE STORE'],
  ['SA', 'AlRajhiBank', 'شراء بطاقة مدى\nمبلغ: 50.00 SAR\nلدى: SAMPLE STORE\nالحالة: لم يتم الخصم'],
  // Questions: full-width or missing mark, a leading or trailing challenge.
  ['AE', 'EmiratesNBD', 'Did you make a AED 168.06 purchase at SAMPLE SHOP？'],
  ['AE', 'EmiratesNBD', 'Did you make a AED 168.06 purchase at SAMPLE SHOP'],
  ['AE', 'EmiratesNBD', 'Did you make a purchase of AED 168.06 at SAMPLE SHOP\n?'],
  ['AE', 'EmiratesNBD', 'Was this you? AED 168.06 purchase at SAMPLE SHOP on card ending 1234'],
  ['AE', 'EmiratesNBD', 'AED 168.06 purchase at SAMPLE SHOP on card ending 1234 - was this you? Reply Y or N'],
  ['SA', 'SNB-AlAhli', 'هل أجريت عملية شراء بمبلغ 120.00 ر.س لدى SAMPLE SHOP'],
  ['SA', 'SNB-AlAhli', 'هل هذه عمليتك؟ شراء بمبلغ 120.00 ر.س لدى SAMPLE SHOP'],
  ['SA', 'AlRajhiBank', 'شراء عبر نقاط البيع\nبطاقة: **1234\nلدى: SAMPLE SHOP\nمبلغ: 120.00 SAR\nهل قمت بهذه العملية؟'],
  ['SA', 'AlRajhiBank', 'تم إرجاع مبلغ 236.21 ر.س إلى بطاقتك؟ تواصل معنا'],
  // Example heads without a colon or full stop.
  ['AE', 'EmiratesNBD', 'Example\nPurchase of AED 89.50 with Credit Card ending 4844 at SAMPLE MART'],
  ['AE', 'EmiratesNBD', 'e.g. Purchase of AED 89.50 with Credit Card ending 4844 at SAMPLE MART'],
  ['AE', 'EmiratesNBD', 'Here is an example of our new alert: Purchase of AED 89.50 with Credit Card ending 4844 at SAMPLE MART'],
  ['AE', 'EmiratesNBD', 'Sample alert\nPurchase of AED 89.50 with Credit Card ending 4844 at SAMPLE MART'],
  ['SA', 'AlRajhiBank', 'مثال\nشراء عبر نقاط البيع\nبطاقة: **1234\nلدى: SAMPLE SHOP\nمبلغ: 120.00 SAR'],
  ['SA', 'AlRajhiBank', 'شكل الرسالة الجديدة:\nشراء عبر نقاط البيع\nبطاقة: **1234\nلدى: SAMPLE SHOP\nمبلغ: 120.00 SAR'],
  // Hedges.
  ['AE', 'EmiratesNBD', 'Your card ending 1234 appears to have been charged AED 89.50 at SAMPLE MART.'],
  ['AE', 'EmiratesNBD', 'It seems AED 89.50 was charged on your card ending 1234 at SAMPLE MART.'],
  ['AE', 'EmiratesNBD', 'Possible transaction: AED 89.50 at SAMPLE MART on card ending 1234.'],
  ['SA', 'AlRajhiBank', 'ربما\nتم خصم مبلغ 120.00 ر.س من بطاقتك لدى SAMPLE SHOP'],
  ['SA', 'AlRajhiBank', 'يحتمل أنه تم خصم مبلغ 120.00 ر.س من بطاقتك لدى SAMPLE SHOP'],
  // Conditions and offers.
  ['AE', 'EmiratesNBD', 'If\nyou make a purchase of AED 500.00 at SAMPLE SHOP, we will send an alert.'],
  ['SA', 'AlRajhiBank', 'عند الشراء بمبلغ 500.00 ر.س من SAMPLE SHOP تحصل على استرداد نقدي'],
  // Requests, pending, forecasts, refund headings over a debit.
  ['AE', 'ADCB', 'Charges AED 5 apply on the payment request of AED 206.00 from SAMPLE PERSON'],
  ['AE', 'ADCB', 'Incoming payment request\nAmount: AED 500.00\nSender: SAMPLE PERSON'],
  ['AE', 'EmiratesNBD', 'Payment received from SAMPLE SHOP: AED 120.00 refund pending'],
  ['SA', 'AlRajhiBank', 'Card refund\nMerchant: SAMPLE STORE\nAmount: SAR 633.00\nStatus: Pending'],
  ['AE', 'EmiratesNBD', 'Refund | Fee: AED 25.00 charged for refund processing | Card 1234'],
  ['SA', 'AlRajhiBank', 'Refund | Merchant: SAMPLE STORE | Card: ·4937 | Transaction amount: SAR 633.00 debited'],
  ['AE', 'EmiratesNBD', 'Your Debit Card ending 1234 has been used for AED 245.50 at SAMPLE MART, will be approved shortly.'],
  ['AE', 'EmiratesNBD', 'Your Debit Card ending 1234 has been used for AED 245.50 at SAMPLE MART. The transaction is under process.'],
  // A refund that also states a withdrawal/payment: direction unproven.
  ['AE', 'EmiratesNBD', 'تم إرجاع مبلغ 724.87 درهم إلى حسابك. تم سحب مبلغ 724.87 درهم من حسابك لدى SAMPLE'],
  // An SNB correction heading over a withdrawal field.
  ['SA', 'SNB-AlAhli', 'تصحيح سحب نقدي\nمبلغ: 500 SAR\nبطاقة: 1234\nصراف: 4521'],
  ['SA', 'SNB-AlAhli', 'تصحيح سحب نقدي\nسحب نقدي\nمبلغ: 500 SAR\nبطاقة: 1234'],
  // A short reference token is not money and cannot move the refusal clause.
  ['AE', 'EmiratesNBD', 'Ref RO 2231. Your payment of AED 12.00 to SAMPLE RIDES was not paid.'],
  // A fee refund beside a withdrawal word: direction unproven.
  ['SA', 'SNB-AlAhli', 'تم إرجاع مبلغ 236.21 ر.س في حسابك عن رسوم سحب نقدي'],
];
for (const [country, sender, body] of round4Never) test(`round 4 never posted (${country}): ${body.slice(0, 60)}`, () => {
  const row = { country, sender, body };
  assert.equal(android(row), null, 'Android seam books nothing');
  assert.equal(history(row).length, 0, 'History (with sender) books nothing');
  assert.equal(history(row, '').length, 0, 'senderless History books nothing');
});

test('an Al Rajhi card-payment field list that is pending or future-dated is never booked', () => {
  for (const body of [
    'Credit Card:Payment\nCard:Visa 7868\nAmount:SR 80 pending',
    'Credit Card:Payment\nCard:Visa 7868\nAmount:SR 80\nOn:30/12/2026',
  ]) {
    const row = { country: 'SA', sender: 'AlRajhiBank', body };
    assert.equal(legacy('SA', body, 'AlRajhiBank'), null, body);
    assert.equal(android(row), null, body);
    assert.equal(history(row).length, 0, body);
  }
  // The completed payment keeps its card-payment row.
  const paid = legacy('SA', 'Credit Card:Payment\nCard:Visa 7868\nAmount:SR 80', 'AlRajhiBank');
  assert.equal(paid?.kind, 'cardPayment');
  assert.equal(paid?.amountFils, 8000);
});

test('a credit-card payment receipt is never income', () => {
  for (const [sender, body] of [
    ['ADCB', 'Payment received: AED 500.00 from SAMPLE NAME. Avl limit AED 12,500.00'],
    ['FAB', 'Payment received AED 2,000.00 from SAMPLE NAME for Visa Infinite xxxx1234. Available limit AED 30,000.00'],
    ['Mashreq', 'Payment received: AED 1,500.00 from SAMPLE BANK A/C xx5678 to Platinum xx1234'],
    ['EmiratesNBD', 'Payment received: AED 500.00 from SAMPLE NAME towards Visa ending 1234.'],
    ['EmiratesNBD', 'Payment received AED 500.00 from SAMPLE NAME on your Visa 1234'],
    ['EmiratesNBD', 'Payment received for your Visa ending 1234: AED 500.00 from SAMPLE NAME. Thank you.'],
    ['Mashreq', 'Payment received: AED 1,250.00 from SAMPLE UTILITY. Thank you for your payment.'],
    ['EmiratesNBD', 'Payment received\nAmount: AED 500.00\nFrom: SAMPLE NAME\nVisa Signature 1234'],
  ]) {
    const row = { country: 'AE', sender, body };
    for (const parsed of [legacy('AE', body, sender), android(row), history(row)[0], history(row, '')[0]]) {
      assert.ok(!parsed || parsed.kind === 'cardPayment' || parsed.type !== 'income', body);
    }
  }
});

test('the booked amount is the movement, never a fee price clause before it', () => {
  for (const [body, minor] of [
    ['VAT AED 1.25 applicable. Purchase of AED 25.00 at SAMPLE SHOP with card ending 1234.', 2500],
    ['Charges AED 5.25 applicable. Fund transfer of AED 500 to SAMPLE PERSON was successful.', 50000],
    ['Charges: AED 10.00 per withdrawal apply to cash of AED 500.00 withdrawn from ATM with card 1234.', 50000],
  ]) {
    const parsed = legacy('AE', body, 'EmiratesNBD');
    assert.equal(parsed?.type, 'expense', body);
    assert.equal(parsed?.amountFils, minor, body);
    const row = { country: 'AE', sender: 'EmiratesNBD', body };
    for (const booked of [android(row), history(row)[0]]) {
      assert.ok(!booked || booked.amountFils === minor, `${body}: ${booked?.amountFils}`);
    }
  }
  // A fee alert that DID charge the fee keeps the fee as its amount.
  assert.equal(legacy('AE', 'Fee: AED 25.00 debited from your account 1234.', 'EmiratesNBD')?.amountFils, 2500);
});

test('an SNB correction heading books income only with no withdrawal field', () => {
  const ok = legacy('SA', 'تصحيح سحب نقدي:\nمبلغ: 500 SAR\nبطاقة: 1234\nرصيد: 100 SAR', 'SNB-AlAhli');
  assert.equal(ok?.type, 'income');
  assert.equal(ok?.amountFils, 50000);
});

test('own-account transfers keep booking as transfer-flagged rows', () => {
  for (const [sender, body] of [
    ['EmiratesNBD', 'You have transferred AED 500.00 from account 1234 to your credit card 4110.'],
    ['EmiratesNBD', 'AED 5,000.00 was transferred between your accounts successfully.'],
    ['EmiratesNBD', 'Transfer received: AED 5,000.00 from SAMPLE NAME (your account 0002) into account 0004'],
  ]) {
    const row = { country: 'AE', sender, body };
    const booked = android(row);
    assert.equal(booked?.transferHint, true, `android: ${body}`);
    const ios = history(row, '');
    assert.ok(ios.length === 0 || ios[0].transferHint === true, `history: ${body}`);
  }
  // On senderless History the move at least reaches Review, never a silent drop.
  const reader = session('AE');
  const text = 'AED 5,000.00 was transferred between your accounts successfully.';
  const record = { v: 1, id: createHash('sha256').update('own-move:' + text).digest('hex'), text,
    receivedAt: new Date(observedAt).toISOString() };
  const out = parseHistoricalMessageRecords([JSON.stringify(record)], {}, new Date(observedAt), new Set(), reader);
  assert.ok(out.parsed.length === 1 ? out.parsed[0].transferHint === true : out.reviewCandidates.length > 0,
    JSON.stringify({ parsed: out.parsed.length, review: out.reviewCandidates.length, ignored: out.ignoredCount }));
});

// Paired controls: completed alerts with the same words must keep booking.
const round4Controls = [
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Purchase\nAmount: AED 50.00\nMerchant: SAMPLE SHOP\nCard: 1234\nIf you have not made this transaction call 600 000000'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Your card ending 1234 was used for AED 50.00 at SAMPLE SHOP.\nNot you? Call 600 000000.'],
  ['SA', 'AlRajhiBank', 'expense', 5000, 'شراء\nبطاقة: 1234\nمبلغ: 50 SAR\nلدى: SAMPLE SHOP\nلو لم تكن أنت اتصل بنا'],
  ['AE', 'EmiratesNBD', 'income', 18245, 'Payment received: AED 182.45 from SAMPLE PERSON to your account ending 1234.'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'AED 50.00 debited from your account 1234 at SAMPLE SHOP. Daily limit remaining AED 4,950.00'],
  ['AE', 'EmiratesNBD', 'expense', 2500, 'تم خصم 25.00 درهم رسوم طلب تحويل دولي من حسابك 1234'],
  // A future credit beside the completed payment never makes it income.
  ['SA', 'SNB-AlAhli', 'expense', 23621, 'تم دفع مبلغ 236.21 ر.س إلى SAMPLE TELECOM، وسيتم إعادة مبلغ 10 ر.س إلى حسابك'],
  // A funds-transfer REQUEST that has been processed is the transfer itself.
  ['AE', 'EmiratesNBD', 'expense', 150000, 'Dear Customer, your funds transfer request of AED 1,500.00 to IBAN/Account/Card XXXX4410 has been processed successfully from your account XXXX9001 on 02/03/2026.'],
  ['AE', 'EmiratesNBD', 'expense', 20600, 'Payment request: AED 206.00 to SAMPLE UTILITY has been debited from account 1234.'],
];
for (const [country, sender, type, minor, body] of round4Controls) test(`round 4 control keeps its row: ${body.slice(0, 60)}`, () => {
  const parsed = legacy(country, body, sender);
  assert.equal(parsed?.type, type, body);
  assert.equal(parsed?.amountFils, minor, body);
});

// ── Round 4b: alert-lab round-3 shapes ──────────────────────────────────────
const round4bNever = [
  // A sign glued to the figure that contradicts the movement.
  ['AE', 'EmiratesNBD', 'Dhs 286.13+ was spent at SAMPLE RIDES on your card ending 5573 on 26/09/2026 19:41.'],
  ['SA', 'SNB-AlAhli', 'شراء: 163.39 SAR+ لدى SAMPLE PHARMACY · بطاقتك المنتهية بـ 3205'],
  ['AE', 'EmiratesNBD', 'تم استخدام بطاقتك المنتهية بـ 8863 في عملية شراء بقيمة 37.65 د.إ+ لدى SAMPLE MART بتاريخ 07/10/2026 20:48.'],
  ['AE', 'EmiratesNBD', '-AED 361.72 has been paid into your account xxxx5375 from SAMPLE PERSON on 27-Sep-2026 20:05.'],
  // A status line or a status word after a completed-looking alert.
  ['AE', 'ADCB', 'شراء عبر نقاط البيع; بطاقة: xxxx2087; مبلغ: 11.08 د.إ; من: SAMPLE STATION\nهل قمت بهذه العملية؟ أرسل نعم'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE SHOP with card ending 1234.\nPENDING'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE SHOP with card ending 1234.\nStatus: failed'],
  ['AE', 'EmiratesNBD', 'You received AED 50.00 from SAMPLE PERSON.\nTap to accept this payment'],
  ['SA', 'SNB-AlAhli', 'تم خصم 50.00 ر.س من بطاقتك المنتهية بـ 1234 لدى SAMPLE SHOP.\nقيد المعالجة'],
  ['AE', 'EmiratesNBD', 'شراء بمبلغ 367.60 د.إ من SAMPLE FOOD ملغاة'],
  ['SA', 'alinma', 'Alinma: شراء: 83.27 ر.س لدى SAMPLE RETAIL ملغاة · بطاقتك المنتهية بـ 9530 · 01-Oct-2026 17:39'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE SHOP ON HOLD'],
  ['AE', 'EmiratesNBD', 'An internet purchase of AED 355.87 at SAMPLE STATION PRE-AUTH was charged to your Visa Debit ••5571 on 21/09/2026.'],
  ['AE', 'EmiratesNBD', 'Emirates NBD: شراء عبر الإنترنت\nمبلغ: 164.95 د.إ\nالتاجر: SAMPLE.COM ملغاة\nبطاقة: XXXX1259'],
  ['AE', 'EmiratesNBD', 'You spent Dhs 426.00 at SAMPLE BANK CREDIT CARD PAYMENT\nAvl bal Dhs 32,883.21'],
  ['SA', 'alinma', 'تم سداد فاتورة MASTERCARD ABRECHNUNG بمبلغ 1,534.07 ريال من حسابكم رقم ****6679.'],
  ['AE', 'FAB', 'Card transaction\nTransaction amount: 14,086.17 Dhs\nMerchant: AMERICAN EXPRESS EUROPE\nCard: ·7712'],
  ['AE', 'Mashreq', 'Mashreq: SAMPLE MART ON HOLD refunded AED 789.27 to your credit card ·8701.'],
  ['AE', 'Wio', 'Online payment of AED687.34 to BARCLAYCARD Avl Cr. Limit: AED35,739.61'],
  ['AE', 'Liv', 'An online transaction of AED 445.28 with AMERICAN EXPRESS EUROPE was made on your card ending in 5458.'],
  ['AE', 'ADCB', 'ADCB\nسداد فاتورة; المبلغ: د.إ 746.00; إلى: AMERICAN EXPRESS; الحساب: ·7848'],
  ['SA', 'AlRajhiBank', 'Al Rajhi: شراء إنترنت: ٢٧٩٫٠٠ ريال لدى AMERICAN EXPRESS EUROPE · 8 أكتوبر 2026'],
  ['SA', 'AlRajhiBank', 'شراء أونلاين 403.95 ر.س - SAMPLE BANK CREDIT CARD\nرصيدك الحالي 29,763.03 ر.س.'],
  // A threshold, not an amount.
  ['AE', 'EmiratesNBD', 'Your card ending 1234 was charged more than AED 500.00 at SAMPLE SHOP.'],
  ['SA', 'SNB-AlAhli', 'تم خصم أكثر من 500.00 ريال من بطاقتك المنتهية بـ 3220 لدى SAMPLE PHARMACY.'],
  // A lookalike-domain lure.
  ['SA', 'alinma', 'Alinma: شراء: 81.17 ر.س لدى SAMPLE PHARMACY\nللتحقق ادخل على sample-secure.com'],
  ['AE', 'EmiratesNBD', 'Card purchase of AED 412.42 at SAMPLE AIR on 04/10/2026 21:36.\nVerify at secure-sample.app'],
];
for (const [country, sender, body] of round4bNever) test(`round 4b never posted (${country}): ${body.slice(0, 60)}`, () => {
  const row = { country, sender, body };
  assert.equal(android(row), null, 'Android seam books nothing');
  assert.equal(history(row).length, 0, 'History (with sender) books nothing');
  assert.equal(history(row, '').length, 0, 'senderless History books nothing');
});

test('a call-back footer from a phone or e-mail sender is never booked', () => {
  for (const sender of ['+971 50 123 4567', 'alerts@sample-mail.com']) {
    const body = 'Purchase of AED 50.00 at SAMPLE SHOP with card ending 1234. Didn\'t make it? Call 800 123 4567';
    assert.equal(legacy('AE', body, sender), null, sender);
  }
  assert.equal(legacy('AE', 'AED 327.28 has been paid into your account ending in 7879 from SAMPLE PERSON.\nContact fraud dept 600.54.0000', 'alerts@sample-mail.com'), null);
  const lure = { country: 'SA', sender: 'alerts@sample-mail.com', body: 'Alinma: عملية شراء ٤١٦٫١٧ ريال - SAMPLE BOOKS\nإذا لم تقم بهذه العملية اتصل فوراً على 920000000' };
  assert.equal(android(lure), null);
  // From the bank's own sender the same footer is an ordinary fraud line.
  assert.equal(legacy('AE', 'Purchase of AED 50.00 at SAMPLE SHOP with card ending 1234. Didn\'t make it? Call 800 123 4567', 'EmiratesNBD')?.amountFils, 5000);
});

test('a payment to a card issuer or your own ISA is never spending or income', () => {
  for (const [country, sender, body] of [
    ['AE', 'EmiratesNBD', 'You spent Dhs 426.00 at SAMPLE BANK CREDIT CARD PAYMENT\nAvl bal Dhs 32,883.21'],
    ['SA', 'SNB-AlAhli', 'Your 582.17 SAR payment to VISA CARD PAYMENT was sent on 27-Sep-2026 18:58 from your account xxxx3741.'],
    ['SA', 'SNB-AlAhli', 'Payment sent SAR 1,207.94 - MASTERCARD ABRECHNUNG Avl bal SAR 52,217.39'],
    ['AE', 'EmiratesNBD', 'AED 327.28 has been paid into your account ending in 7879 from YOUR ISA on 21-Sep-2026 07:14.'],
    ['SA', 'SNB-AlAhli', 'تم إيداع مبلغ 4,689.07 ريال في حسابك المنتهي بـ 6556 من SAVINGS ACCOUNT.'],
    ['AE', 'EmiratesNBD', 'Your transfer of AED 7,176.89 to MY SAVINGS was completed on 2026-09-21 22:03.'],
    ['SA', 'SNB-AlAhli', 'SNB: Money out | Transaction amount: SAR7,271.82 | Card: ·2209 | Payee: MY SAVINGS | Date: 2026-09-30 19:51'],
  ]) {
    const row = { country, sender, body };
    for (const parsed of [legacy(country, body, sender), android(row), history(row)[0]]) {
      assert.ok(!parsed || parsed.kind !== 'transaction' || parsed.transferHint === true, body);
    }
  }
});

test('neighbour thresholds are never booked', () => {
  for (const [country, ledger, sender, body] of [
    ['KW', 'KWD', 'KFH', 'KFH: تم خصم أكثر من 500.000 دينار كويتي من بطاقتك المنتهية بـ 7317 لدى SAMPLE MARKET.'],
    ['QA', 'QAR', 'CBQ', 'CBQ\nتم خصم أكثر من 500.00 ر.ق من بطاقتك المنتهية بـ 4100 لدى SAMPLE STATION.'],
  ]) {
    for (const parsed of neighbour({ country, ledger, sender, body })) assert.ok(!parsed || parsed.transferHint === true, body);
  }
});

// Controls: the same shapes completed or consistent must keep booking.
const round4bControls = [
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Purchase of AED 50.00 at PENDING GOODS LTD with card ending 1234.'],
  ['AE', 'EmiratesNBD', 'income', 5000, 'AED 50.00+ credited to your account 1234 from SAMPLE PERSON.'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Payment sent AED 50.00 - SAMPLE SHOP. Avl bal AED 5,000.00'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Debit card payment of AED 50.00 at SAMPLE SHOP with card ending 1234.'],
  ['AE', 'EmiratesNBD', 'income', 1000000, 'Salary of AED 10,000.00 has been credited to your savings account 1234.'],
  // The compact reversal alert IS the reverse posting; a phone number beside
  // the shop is no signed figure.
  ['AE', 'EmiratesNBD', 'income', 60000, 'ATM WDL AED 600.00 DR A/C 1234 REVERSED'],
  ['AE', 'EmiratesNBD', 'expense', 3000, 'Purchase of AED 30.00 with Debit Card ending 1354 at SP SAMPLE +971501234567 NEW YORK US. Avl Balance is AED 100.00.'],
  // A purchase PAID WITH a credit card is never a card-bill payment.
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Purchase of AED 50.00 at SAMPLE SHOP with your ADCB Credit Card.'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'PURCHASE OF AED 50.00 AT SAMPLE SHOP WITH YOUR FAB CREDIT CARD ENDING 1234.'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'AED 50.00 has been charged to your ENBD Credit Card at SAMPLE SHOP.'],
];
for (const [country, sender, type, minor, body] of round4bControls) test(`round 4b control keeps its row: ${body.slice(0, 60)}`, () => {
  const parsed = legacy(country, body, sender);
  assert.equal(parsed?.type, type, body);
  assert.equal(parsed?.amountFils, minor, body);
});

// ── Long blank, mask and digit runs stay linear ──────────────────────────────
// Each of these shapes used to cost from half a second to over a minute in
// parseSms alone: four adjacent optional blanks in the account pattern, a mask
// run split across the masked-PAN groups or nested in the masked-account
// repeat, and suffix figures retried from every digit of a long run. The
// bound is generous (the measured cost is now a few milliseconds per body);
// it only catches a return to super-linear backtracking.
const pad = (head, fill, tail, size) => head + fill.repeat(Math.ceil((size - head.length - tail.length) / fill.length)) + tail;
const runShapes = [
  ['account no ', ' ', ' if calling from'],
  ['account no ', '\n', ' شراء بمبلغ 50.00 ر.س لدى SAMPLE STORE'],
  ['account no ', 'X', ''],
  ['في: 2026', 'X', ' at SAMPLE SHOP on card ending 1234.'],
  ['في: 2026', '•', ''],
  ['Payment received', ' ', 'AED 5.00'],
  ['Payment received', '1', ''],
  ['Balance ', '1,', ' شراء بمبلغ 50.00 ر.س لدى SAMPLE STORE'],
  ['Balance ', ' 1', ' شراء بمبلغ 50.00 ر.س لدى SAMPLE STORE'],
  ['You made a $20.00 purchase at SAMPLE SHOP with your Visa no ', '1', ' x'],
];
for (const size of [4096, 8192]) test(`parseSms stays linear on ${size}-byte blank, mask and digit runs`, () => {
  legacy('AE', 'AED 1.00 at SAMPLE', 'EmiratesNBD');
  for (const [head, fill, tail] of runShapes) {
    const body = pad(head, fill, tail, size);
    const started = process.hrtime.bigint();
    legacy('AE', body, 'EmiratesNBD');
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 2500, `${JSON.stringify(head)} + ${JSON.stringify(fill)} took ${Math.round(ms)} ms`);
  }
});
// Paired positives: the bounded patterns read the same identities and figures.
const runControls = [
  ['Purchase of AED 50.00 at SAMPLE SHOP with card 4567 XXXX XXXX 1234.', 5000, '1234'],
  ['Purchase of AED 50.00 at SAMPLE SHOP with card 4567********1234.', 5000, '1234'],
  ['AED 50.00 debited from account no. 095-XXX11XXX-0001 for SAMPLE BILL.', 5000, '0001'],
  ['AED 50.00 debited from a/c no: XXX917 at SAMPLE SHOP.', 5000, '917'],
  ['AED 50.00 debited from your account ending 4321 at SAMPLE SHOP.', 5000, '4321'],
  ['Purchase of 50.00 AED at SAMPLE SHOP with card ending 1234.', 5000, '1234'],
  ['Purchase of 1,250.00 AED at SAMPLE SHOP with card ending 1234.', 125000, '1234'],
];
for (const [body, minor, last4] of runControls) test(`bounded identity and figure patterns keep: ${body.slice(0, 60)}`, () => {
  const parsed = legacy('AE', body, 'EmiratesNBD');
  assert.equal(parsed?.amountFils, minor, body);
  assert.equal(parsed?.card?.last4, last4, body);
});
test('a foreign suffix figure keeps its whole digit run', () => {
  session('AE');
  const parsed = withMarketPackForParsing('AE', () => parseSms('Purchase of 1,250.50 USD at SAMPLE SHOP with card ending 1234.', {},
    { sender: 'EmiratesNBD', observedAt, fxLookup: () => 3.6725 }));
  assert.equal(parsed?.originalCurrency, 'USD');
  assert.equal(parsed?.originalAmountMinor, 125050);
});

// ── A reversed INCOMING credit is never income ──────────────────────────────
// A trailing "REVERSED" status on money the user RECEIVED means the credit was
// taken back; the reversal-as-refund reading booked it as income again.
const reversedIncoming = [
  ['AE', 'Mashreq', 'Mashreq: You received 3,212.93 Dhs from SAMPLE TRADING LTD.\nREVERSED'],
  ['SA', 'urpay', 'You received SAR 1,250.00 from SAMPLE PERSON REVERSED'],
  ['AE', 'EmiratesNBD', 'Your incoming transfer of AED 700.00 has been credited to your account 1234.\nREVERSED'],
];
for (const [country, sender, body] of reversedIncoming) test(`a reversed incoming credit never books income: ${body.slice(0, 50)}`, () => {
  const parsed = legacy(country, body, sender);
  assert.ok(!parsed || parsed.type !== 'income', `legacy booked ${parsed?.type}`);
  for (const row of [android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!row || row.type !== 'income', `${body}: booked ${row?.type}`);
  }
});
const reversalCredits = [
  ['AE', 'EmiratesNBD', 'income', 50000, 'A reversal of AED 500.00 has been credited to your account 1234.'],
  ['AE', 'EmiratesNBD', 'income', 50000, 'AED 500.00 has been reversed to your Card ending 1234.'],
  ['AE', 'EmiratesNBD', 'income', 60000, 'ATM WDL AED 600.00 DR A/C 1234 REVERSED'],
  ['AE', 'EmiratesNBD', 'income', 5000, 'Refund of AED 50.00 from SAMPLE SHOP has been credited to your card ending 1234.'],
];
for (const [country, sender, type, minor, body] of reversalCredits) test(`a reversal credit keeps its row: ${body.slice(0, 50)}`, () => {
  const parsed = legacy(country, body, sender);
  assert.equal(parsed?.type, type, body);
  assert.equal(parsed?.amountFils, minor, body);
});
// A sentence that says the CREDIT was reversed stays money out on both capture
// paths, as before (the trailing-status rule must not take it).
test('a reversed salary credit sentence still books money out', () => {
  const row = { country: 'AE', sender: 'EmiratesNBD', body: 'Salary credit AED 6,400.00 to your account has been reversed.' };
  const booked = android(row);
  assert.equal(booked?.type, 'expense');
  assert.equal(booked?.amountFils, 640000);
  const fromHistory = history(row);
  assert.equal(fromHistory.length, 1);
  assert.equal(fromHistory[0].type, 'expense');
});

// ── Review round 5: completed alerts the refusal rules must leave alone ─────
// Each of these booked correctly before the round-4 rules and must keep doing
// so on BOTH capture paths: a savings or current account that PAID or was
// PAID (not a transfer destination), an Amex/Barclaycard instrument or shop,
// an issuer-branded card as the instrument, a spaced dash or a secondary
// cashback sign, fraud-footer questions, completed requests, a real bank
// domain, a Platinum ACCOUNT, and a fee that was debited.
const round5Keep = [
  ['AE', 'EmiratesNBD', 'income', 1000000, 'Salary of AED 10,000.00 has been credited to your savings account 1234.'],
  ['AE', 'EmiratesNBD', 'income', 1000000, 'Your salary of AED 10,000.00 was transferred to your savings account 1234.'],
  ['AE', 'EmiratesNBD', 'expense', 50000, 'AED 500.00 has been debited from your savings account XXX1234 for a purchase at SAMPLE MART.'],
  ['AE', 'EmiratesNBD', 'expense', 50000, 'AED 500.00 transferred from your savings account XXX1234 to SAMPLE PERSON.'],
  ['SA', 'AlRajhiBank', 'expense', 5000, 'تم خصم مبلغ 50.00 ر.س من Current Account رقم 1234 لدى SAMPLE STORE'],
  ['AE', 'EmiratesNBD', 'expense', 12000, 'Purchase of AED 120.00 at SAMPLE MART with your AMEX card ending 1001 on 10/10/2026.'],
  ['AE', 'EmiratesNBD', 'expense', 12000, 'Purchase of AED 120.00 at SAMPLE MART with your American Express Card ending 1001.'],
  ['SA', 'SAB', 'expense', 8000, 'Purchase of SAR 80.00 at SAMPLE BOOKS with your American Express card ending 1001.'],
  ['AE', 'ADCBAlert', 'expense', 7500, 'Purchase of AED 75.00 at AMEX TRAVEL DUBAI with card ending 1234.'],
  ['AE', 'ADCBAlert', 'expense', 7500, 'Purchase of AED 75.00 at AMEX LOUNGE DXB with card ending 1234.'],
  ['AE', 'EmiratesNBD', 'expense', 7500, 'Purchase of AED 75.00 at BARCLAYCARD ARENA SHOP with card ending 1234.'],
  ['AE', 'ADCBAlert', 'expense', 5000, 'A purchase of AED 50.00 at SAMPLE MART was made with ADCB CREDIT CARD.'],
  ['AE', 'EmiratesNBD', 'income', 5000, 'Refund - AED 50.00 credited to your card ending 1234 from SAMPLE MART.'],
  ['AE', 'EmiratesNBD', 'income', 1500000, 'Salary - AED 15,000.00 credited to your account 1234.'],
  ['AE', 'EmiratesNBD', 'income', 50000, 'Transfer received - AED 500.00 from SAMPLE PERSON to your account 1234.'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Purchase of AED 50.00 at SAMPLE MART with card ending 1234. Cashback +AED 2.50 credited.'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Purchase of AED 50.00 at SAMPLE MART on card 1234 Not done by you? Call 600000000'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Purchase of AED 50.00 at SAMPLE MART on card 1234 - Not recognised? Call 600000000'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Purchase of AED 50.00 at SAMPLE MART on card 1234, suspicious? Call 600000000'],
  ['AE', 'EmiratesNBD', 'expense', 50000, 'Your transfer request of AED 500.00 to SAMPLE PERSON is completed.'],
  ['AE', 'EmiratesNBD', 'expense', 45000, 'Your payment request for AED 450.00 to SAMPLE UTILITY was successful.'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Purchase of AED 50.00 at SAMPLE MART with card ending 1234. Not you? Verify on www.emiratesnbd.com'],
  ['AE', 'EmiratesNBD', 'income', 500000, 'Funds received AED 5,000.00 from SAMPLE TRADING LLC to your Platinum account 1234.'],
  ['AE', 'EmiratesNBD', 'expense', 2500, 'Fees AED 25.00 applicable and debited from your account 1234.'],
];
for (const [country, sender, type, minor, body] of round5Keep) test(`round 5 keeps its row on both paths: ${body.slice(0, 60)}`, () => {
  const row = { country, sender, body };
  const booked = [android(row), ...history(row)];
  assert.equal(booked.length, 2, `${body}: History produced ${booked.length - 1} rows`);
  for (const parsed of booked) {
    assert.equal(parsed?.type, type, body);
    assert.equal(parsed?.amountFils, minor, body);
    assert.ok(!parsed.transferHint, `${body}: transfer-flagged`);
    assert.notEqual(parsed.merchant, 'Own account transfer', body);
  }
});
// A move from the person's account into their OWN credit card is an own
// transfer on both paths (the shape of F814), never plain spending.
test('a transfer into your own credit card is transfer-flagged on both paths', () => {
  const row = { country: 'AE', sender: 'ADCBAlert', body: 'AED 500.00 has been transferred from your account XXX5678 to your credit card XXX1234.' };
  for (const parsed of [android(row), ...history(row)]) {
    assert.ok(!parsed || parsed.transferHint === true, `booked ${parsed?.type} without a transfer flag`);
  }
});
// A sweep from the person's own current account into their savings account
// (the shape of F1365) is an own move on both paths.
test('a current-to-savings move is transfer-flagged on both paths', () => {
  const row = { country: 'AE', sender: 'EmiratesNBD', body: 'AED 300.00 sent from Current A/C XXX4321 to your Savings Account XXX8765' };
  const booked = [android(row), ...history(row)];
  assert.equal(booked.length, 2);
  for (const parsed of booked) assert.equal(parsed?.transferHint, true, JSON.stringify(parsed));
});
// Gulf glued signs on a three-decimal figure contradict the stated direction.
test('a Gulf glued sign that contradicts the direction is never booked', () => {
  for (const [country, ledger, sender, body] of [
    ['KW', 'KWD', 'NBK', 'NBK: Money received: -KWD 175.058 from SAMPLE PAYROLL · 07-Oct-2026 14:21'],
    ['OM', 'OMR', 'BankMuscat', 'Bank Muscat: -OMR 361.729 has been paid into your account xxxx5375 from SAMPLE PERSON on 27-Sep-2026 20:05.'],
  ]) {
    for (const parsed of neighbour({ country, ledger, sender, body })) assert.ok(!parsed, `${body}: booked ${parsed?.type}`);
  }
});

// Re-review: reversal CREDITS (a "… REVERSAL" reference is money returned),
// savings accounts named outside the move, a bare "with AMEX" or issuer-card
// label beside a named merchant, and digital banks' own .io/.me sites keep
// their readings. History may hold a row in Review, never read it differently.
const round5bKeep = [
  ['AE', 'ADCBAlert', 'income', 7500, 'AED 75.00 credited to A/C XXX1234 on 12/10/2026. Ref: SAMPLE PURCHASE REVERSAL'],
  ['AE', 'EmiratesNBD', 'income', 5000, 'Amount AED 50.00 credited to your card ending 1234 - POS REVERSAL'],
  ['AE', 'ADCBAlert', 'income', 60000, 'AED 600.00 deposited into your account XXX1234 - ATM REVERSAL'],
  ['AE', 'ADCBAlert', 'income', 125000, 'AED 1,250.00 has been credited into your account XXX1234 as Merchant Reversal.'],
  ['SA', 'SAB', 'income', 30000, 'ايداع مبلغ 300.00 ر.س في حسابك 1234 - Purchase reversal'],
  ['AE', 'ADCBAlert', 'income', 12000, 'AED 120.00 credited to your account XXX1234 due to transaction reversal.'],
  ['AE', 'ADCBAlert', 'expense', 12000, 'AED 120.00 was debited on 12/10/2026 from your savings account for a purchase at SAMPLE MART.'],
  ['AE', 'ADCBAlert', 'income', 300000, 'AED 3,000.00 credited on 12/10/2026 to your savings account. Salary from SAMPLE EMPLOYER LLC.'],
  ['AE', 'ADCBAlert', 'expense', 12000, 'Purchase of AED 120.00 at SAMPLE MART on card 1234. Move money to your savings account in the app.'],
  ['AE', 'ADCBAlert', 'expense', 30000, 'Purchase of AED 300.00 with Amex at SAMPLE MART on 12/10/2026.'],
  ['AE', 'ADCBAlert', 'expense', 30000, 'Transaction of AED 300.00 with AMEX was approved at SAMPLE MART on 12/10/2026.'],
  ['AE', 'ADCBAlert', 'expense', 30000, 'Purchase of AED 300.00 at SAMPLE MART with AMEX on 12/10/2026.'],
  ['AE', 'ADCBAlert', 'expense', 30000, 'Purchase of AED 300.00 at SAMPLE MART. Paid with ADCB CREDIT CARD - thank you.'],
  ['AE', 'ADCBAlert', 'expense', 30000, 'Purchase of AED 300.00 at SAMPLE MART on 12/10/2026 - ADCB CREDIT CARD.'],
  ['AE', 'Wio', 'expense', 15000, 'AED 150.00 spent at SAMPLE MART on card 1234. Not you? Confirm on wio.io'],
  ['AE', 'Liv', 'expense', 15000, 'AED 150.00 spent at SAMPLE MART on card 1234. Not you? Confirm on liv.me'],
];
for (const [country, sender, type, minor, body] of round5bKeep) test(`round 5b keeps its reading: ${body.slice(0, 60)}`, () => {
  const row = { country, sender, body };
  const booked = android(row);
  assert.equal(booked?.type, type, body);
  assert.equal(booked?.amountFils, minor, body);
  assert.ok(!booked.transferHint, `${body}: transfer-flagged`);
  for (const parsed of history(row)) {
    assert.equal(parsed.type, type, body);
    assert.equal(parsed.amountFils, minor, body);
    assert.ok(!parsed.transferHint, `${body}: History transfer-flagged`);
  }
});

// ── Template drift: label-preserving rewordings keep their direction/amount ──
// A "Payment received" heading with the payer on the NEXT line, under a
// date-first prefix, or as a "From" field label on its own line is still money
// in; a figure after a clock ("08:46 SAR 3,707.63") is the figure, not "46
// SAR"; a merchant that "returned" money to your card refunded it.
const driftIncome = [
  ['AE', 'EmiratesNBD', 227138, 'Payment received\nAED 2,271.38 from SAMPLE PERSON'],
  ['AE', 'EmiratesNBD', 191315, 'Payment received\nAED1,913.15 from SAMPLE PERSON Txt STOP to end. Msg&data rates may apply.'],
  ['SA', 'AlRajhiBank', 3032457, 'Al Rajhi\nPayment received\nSAR30,324.57 from SAMPLE EMPLOYER PAYROLL'],
  ['SA', 'AlRajhiBank', 338851, 'Payment received\n3,388.51 SR from SAMPLE PERSON'],
  ['SA', 'AlRajhiBank', 3032457, '2026-09-24 20:59 Al Rajhi: Payment received: SAR30,324.57 from SAMPLE EMPLOYER PAYROLL'],
  ['SA', 'AlRajhiBank', 3032457, '2026-09-24 20:59 - Al Rajhi: Payment received: SAR30,324.57 from SAMPLE EMPLOYER PAYROLL'],
  ['AE', 'EmiratesNBD', 2480380, '2026-09-25 21:58 - Payment received: AED24,803.80 from SAMPLE PERSON'],
  ['AE', 'FAB', 3193412, 'FAB\nDeposit received | Date\n2026-09-20 15:29 | Transaction amount\n31,934.12 Dhs | Card\n·8326 | From\nSAMPLE TRADING LTD'],
  ['SA', 'AlRajhiBank', 72811, 'SAMPLE STORE 34521 returned 728.11 SR to your credit card ·1783 on 2026-10-11 20:19. Available balance: 17,927.45 SR.'],
];
for (const [country, sender, minor, body] of driftIncome) test(`drift keeps money in: ${body.slice(0, 60).replace(/\n/g, ' / ')}`, () => {
  const row = { country, sender, body };
  const booked = android(row);
  assert.equal(booked?.type, 'income', body);
  assert.equal(booked?.amountFils, minor, body);
  for (const parsed of history(row)) assert.notEqual(parsed.type, 'expense', `${body}: History booked an expense`);
});
test('a date-first transfer keeps its figure on both paths', () => {
  const row = { country: 'SA', sender: 'RiyadBank', body: '03-Oct-2026 08:46 SAR 3,707.63 was transferred from your account xxxx9961 to SAMPLE PERSON.' };
  for (const parsed of [android(row), ...history(row)]) {
    assert.equal(parsed?.type, 'expense');
    assert.equal(parsed?.amountFils, 370763);
  }
});
// Guards: the same headings that pay a biller or name the reader's own card
// are never income; drifted refunds/incoming credits are never an expense.
const driftNeverIncome = [
  ['AE', 'EmiratesNBD', 'Payment received\nAED 350.00 from SAMPLE PERSON towards account 2001234567'],
  ['AE', 'EmiratesNBD', 'Payment received\nAED 350.00 from SAMPLE PERSON to your Credit Card ending 1234'],
  ['AE', 'EmiratesNBD', 'Payment received\nAED 350.00 from your account 1234'],
];
for (const [country, sender, body] of driftNeverIncome) test(`drift guard never books income: ${body.slice(0, 50).replace(/\n/g, ' / ')}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body })]) {
    // A card settlement (the card side of the payment) is the right reading.
    assert.ok(!parsed || parsed.type !== 'income' || parsed.kind === 'cardPayment', `${body}: booked income`);
  }
});
for (const [country, sender, body] of [
  ['SA', 'AlRajhiBank', 'Al Rajhi:  حوالة  واردة  بمبلغ  +5,258.27  SAR  من  SAMPLE PERSON'],
  ['AE', 'Mashreq', 'Mashreq: Refund\nAmount: AED 75.00\nMerchant: SAMPLE SHOP\nCard: ·1234'],
]) test(`drift never books money in as an expense: ${body.slice(0, 40).replace(/\n/g, ' / ')}`, () => {
  const row = { country, sender, body };
  for (const parsed of [android(row), ...history(row)]) assert.ok(!parsed || parsed.type !== 'expense', `${body}: booked an expense`);
});
test('an issuer payee followed by the paying card in brackets is never spending', () => {
  const row = { country: 'SA', sender: 'RiyadBank', body: 'Riyad Bank\nSpent 83.06 USD at AMERICAN EXPRESS (debit card ***7369) If you don\'t recognise this, call us on 920 000 000.' };
  for (const parsed of [legacy(row.country, row.body, row.sender), android(row)]) {
    assert.ok(!parsed || parsed.kind === 'cardPayment' || parsed.transferHint === true, `booked ${parsed?.type}`);
  }
});

// ══ Safety round 5 (final review 2) ══════════════════════════════════════════
// Every body is synthetic (SAMPLE names, fictional numbers). `none` means no
// row on either path (Review is fine); `card` allows only a card settlement.
const bookedOnBoth = (row) => [android(row), ...history(row)];
const isCardSide = (p) => !p || p.kind === 'cardPayment' || p.transferHint === true;
const r5Never = [
  // Bypasses of the not-a-posting grammar.
  ['AE', 'EmiratesNBD', 'Your payment of AED 12.00 to SAMPLE TAXI\r\nwas not paid.'],
  ['SA', 'AlRajhiBank', 'لم يتم\r\nخصم مبلغ 50.00 ر.س من بطاقتك لدى SAMPLE STORE'],
  ['AE', 'EmiratesNBD', 'Your payment of AED 12.00 to SAMPLE TAXI\n\nwas not paid.'],
  ['AE', 'EmiratesNBD', 'Your payment of AED 12.00 to SAMPLE TAXI\nWas not paid.'],
  ['SA', 'AlRajhiBank', 'لم يتم\n\nخصم مبلغ 50.00 ر.س من بطاقتك لدى SAMPLE STORE'],
  ['SA', 'AlRajhiBank', 'تم خصم مبلغ 50.00 ر.س من بطاقتك لدى SAMPLE STORE\nلم يتم'],
  ['SA', 'AlRajhiBank', 'شراء بمبلغ 50.00 ر.س لدى SAMPLE STORE\nغير ناجحة'],
  ['SA', 'AlRajhiBank', 'لن يتم خصم مبلغ 50.00 ر.س من بطاقتك لدى SAMPLE STORE'],
  ['SA', 'AlRajhiBank', 'تعذر خصم مبلغ 50.00 ر.س من بطاقتك لدى SAMPLE STORE'],
  ['SA', 'AlRajhiBank', 'ما تم خصم 50.00 ر.س من بطاقتك لدى SAMPLE STORE'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card 1234 couldn\'t be completed'],
  ['SA', 'AlRajhiBank', 'هل تؤكد عملية شراء بمبلغ 50.00 ر.س لدى SAMPLE STORE'],
  ['SA', 'AlRajhiBank', 'يرجى تأكيد عملية شراء بمبلغ 50.00 ر.س لدى SAMPLE STORE بالرد بنعم'],
  ['SA', 'AlRajhiBank', 'هل أنت من قام بعملية شراء بمبلغ 50.00 ر.س لدى SAMPLE STORE'],
  ['AE', 'EmiratesNBD', 'Please verify: purchase of AED 50.00 at SAMPLE MART with card 1234'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card 1234. Was this you? Reply Y or N'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card 1234. Was it you? Reply YES'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card 1234. Is this you? Reply 1'],
  ['SA', 'AlRajhiBank', 'مثلاً: تم خصم 50.00 ر.س من بطاقتك لدى SAMPLE STORE'],
  ['SA', 'AlRajhiBank', 'نموذج: تم خصم 50.00 ر.س من بطاقتك لدى SAMPLE STORE'],
  ['SA', 'AlRajhiBank', 'قد يتم خصم 50.00 ر.س من بطاقتك لدى SAMPLE STORE'],
  ['SA', 'AlRajhiBank', 'يبدو أنه تم خصم 50.00 ر.س من بطاقتك لدى SAMPLE STORE'],
  ['SA', 'AlRajhiBank', 'احصل على استرداد نقدي 50 ر.س عند شرائك من SAMPLE STORE'],
  // A standalone trailing status line or sentence after the movement.
  ['SA', 'SNB-AlAhli', 'A monthly account fee of 64.20 SR was charged to your savings account *7320.\nREVERSED'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card 1234.\nREVERSED'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card 1234. REVERSED'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card 1234\nDECLINED'],
];
for (const [country, sender, body] of r5Never) test(`round 5 never books: ${body.slice(0, 60).replace(/\s+/g, ' ')}`, () => {
  for (const parsed of [legacy(country, body, sender), ...bookedOnBoth({ country, sender, body })]) {
    assert.ok(!parsed, `${body}: booked ${parsed?.type} ${parsed?.amountFils}`);
  }
});
// Never income (money left, was taken back, or landed with someone else).
const r5NoIncome = [
  ['AE', 'EmiratesNBD', 'Refund of AED 50.00 to SAMPLE MART debited from your card 1234.'],
  ['AE', 'EmiratesNBD', 'Transfer received from SAMPLE PERSON AED 500.00 reversed.'],
  ['AE', 'EmiratesNBD', 'Payment received: AED 182.45 from SAMPLE PERSON was reversed.'],
  ['SA', 'AlRajhiBank', 'تم عكس حوالة واردة بمبلغ 500 ر.س من SAMPLE PERSON'],
  ['SA', 'AlRajhiBank', 'عكس قيد إيداع راتب بمبلغ 5000 ر.س'],
  ['AE', 'EmiratesNBD', 'SAMPLE PERSON received AED 500.00 from you.'],
  ['AE', 'EmiratesNBD', 'AED 500.00 credited to SAMPLE PERSON from your account 1234.'],
  ['SA', 'AlRajhiBank', 'تم إيداع 500 ر.س في حساب SAMPLE PERSON'],
  ['AE', 'Mashreq', 'Payment received: AED 1,500.00 from SAMPLE PERSON.'],
];
for (const [country, sender, body] of r5NoIncome) test(`round 5 never income: ${body.slice(0, 60)}`, () => {
  for (const parsed of [legacy(country, body, sender), ...bookedOnBoth({ country, sender, body })]) {
    assert.ok(!parsed || parsed.type !== 'income' || parsed.kind === 'cardPayment', `${body}: booked income`);
  }
});
// Another person's account is never an own-account transfer.
const r5NotOwn = [
  ['AE', 'EmiratesNBD', 'Transfer of AED 500.00 to SAMPLE PERSON from your savings account was successful.'],
  ['AE', 'EmiratesNBD', 'AED 1,000.00 transferred from your savings account to SAMPLE PERSON.'],
  ['AE', 'EmiratesNBD', 'AED 1,000.00 transferred from your savings account to SAMPLE PERSON account 4455.'],
  ['AE', 'EmiratesNBD', 'You have sent AED 500.00 to your current account at another bank, beneficiary SAMPLE PERSON.'],
  ['AE', 'EmiratesNBD', 'Payment of AED 500.00 to your savings pot for rent to SAMPLE LANDLORD LLC.'],
  ['SA', 'AlRajhiBank', 'تم تحويل 500 ر.س لحساب التوفير الخاص بمحمد'],
];
for (const [country, sender, body] of r5NotOwn) test(`round 5 not an own transfer: ${body.slice(0, 60)}`, () => {
  for (const parsed of [legacy(country, body, sender), ...bookedOnBoth({ country, sender, body })]) {
    assert.ok(!parsed || (!parsed.transferHint && !/own account/i.test(parsed.merchant ?? '')), `${body}: own transfer`);
  }
});
// Card and loan payment receipts, and card-bill payments: the card side only.
const r5Card = [
  ['AE', 'ADCBAlert', 'Payment received: AED 500.00\nFrom: SAMPLE PERSON\nTo: Card xxxx1234'],
  ['AE', 'ADCBAlert', 'Payment received: AED 500.00\nFrom: SAMPLE PERSON\nCard No: xxxx1234'],
  ['AE', 'ADCBAlert', 'Payment received: AED 500.00 from SAMPLE PERSON\nCard: xxxx1234'],
  ['AE', 'ADCBAlert', 'Payment received AED 500.00 from SAMPLE PERSON. Available credit AED 12,000.00'],
  ['AE', 'FAB', 'Payment received AED 500.00 from SAMPLE PERSON. Outstanding balance AED 1,200.00'],
  ['AE', 'FAB', 'Payment received: AED 500.00 from SAMPLE PERSON. New limit available AED 9,000.00'],
  ['AE', 'Mashreq', 'Payment received AED 500.00 from SAMPLE PERSON. Total due AED 0.00. Min due AED 0.00'],
  ['AE', 'EmiratesNBD', 'Payment received: AED 500.00 from SAMPLE PERSON. Your minimum due is now AED 0.00'],
  ['AE', 'ADCBAlert', 'AED 500.00 payment received from SAMPLE PERSON on card xxxx1234'],
  ['AE', 'EmiratesNBD', 'Funds received: AED 5,000.00 from SAMPLE PERSON. Your loan instalment of AED 5,000.00 is paid.'],
  ['AE', 'EmiratesNBD', 'تم استلام دفعة بمبلغ 500 درهم لبطاقتك الائتمانية المنتهية 1234'],
  ['AE', 'EmiratesNBD', 'تم دفع 1500 درهم لبطاقة فيزا 1234'],
  ['SA', 'AlRajhiBank', 'تم سداد 1500 ر.س لبطاقة الائتمان 1234'],
  ['AE', 'ADCBAlert', 'Transfer of AED 1,500 to ADCB Credit Card 1234 completed.'],
  ['AE', 'FAB', 'AED 1,500.00 has been debited from your account 1234 for payment to card 5678'],
  ['SA', 'AlRajhiBank', 'Al Rajhi\nCredit Card:Payment\nCard:Visa 7868\nAmount:SR 1500\nRemaining:SR 0'],
];
for (const [country, sender, body] of r5Card) test(`round 5 card side only: ${body.slice(0, 60).replace(/\n/g, ' / ')}`, () => {
  for (const parsed of [legacy(country, body, sender), ...bookedOnBoth({ country, sender, body })]) {
    assert.ok(isCardSide(parsed), `${body}: booked ${parsed?.type} ${parsed?.merchant}`);
  }
});
// Paired positives: the readings these rules must keep.
const r5Keep = [
  ['SA', 'AlRajhiBank', 'expense', 50000, 'رسوم 5 ر.س تطبق. تم خصم 500 ر.س من حسابك لدى SAMPLE STORE'],
  ['SA', 'AlRajhiBank', 'expense', 50000, 'رسوم الخدمة 5.75 ر.س. تم خصم 500.00 ر.س من حسابك لدى SAMPLE STORE'],
  ['SA', 'AlRajhiBank', 'expense', 50000, 'رسوم ٥٫٠٠ ر.س تطبق. تم خصم ٥٠٠٫٠٠ ر.س من حسابك لدى SAMPLE STORE'],
  ['SA', 'AlRajhiBank', 'expense', 500, 'تم خصم رسوم 5.00 ر.س من حسابك 1234'],
  ['SA', 'AlRajhiBank', 'income', 5000, 'عكس عملية شراء\nبطاقة: 1234\nمبلغ: 50 SAR\nلدى: SAMPLE STORE'],
  ['AE', 'EmiratesNBD', 'income', 60000, 'ATM WDL AED 600.00 DR A/C 1234 REVERSED'],
  ['AE', 'EmiratesNBD', 'income', 5000, 'POS REVERSAL AED 50.00 SAMPLE MART card 1234'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Purchase of AED 50.00 at SAMPLE MART with card 1234. Not you? Reply NO to block your card.'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Purchase of AED 50.00 at SAMPLE MART with card 1234.\nPlease call 600 000000 if you did not make it.'],
  ['AE', 'EmiratesNBD', 'expense', 50000, 'AED 500.00 transferred from your account 1234 to SAMPLE PERSON.'],
  ['AE', 'EmiratesNBD', 'income', 50000, 'You received AED 500.00 from SAMPLE PERSON.'],
  ['AE', 'EmiratesNBD', 'income', 1000000, 'Salary of AED 10,000.00 has been credited to your account 1234.'],
  ['SA', 'AlRajhiBank', 'income', 50000, 'تم إيداع 500 ر.س في حسابك 1234'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Purchase of AED 50.00 at SAMPLE MART with your Visa card ending 1234.'],
  ['AE', 'EmiratesNBD', 'income', 227138, 'Payment received\nAED 2,271.38 from SAMPLE PERSON'],
];
for (const [country, sender, type, minor, body] of r5Keep) test(`round 5 keeps: ${body.slice(0, 60).replace(/\n/g, ' / ')}`, () => {
  const parsed = android({ country, sender, body });
  assert.equal(parsed?.type, type, body);
  assert.equal(parsed?.amountFils, minor, body);
  for (const h of history({ country, sender, body })) assert.ok(h.type === type && h.amountFils === minor, `${body}: History ${h.type} ${h.amountFils}`);
});
test('own-account moves keep their transfer flag', () => {
  for (const body of ['You have transferred AED 500.00 from account 1234 to your credit card 4110.',
    'AED 5,000.00 was transferred between your accounts successfully.',
    'AED 300.00 sent from Current A/C XXX4321 to your Savings Account XXX8765',
    'Your transfer of AED 700.00 to MY SAVINGS was completed.']) {
    for (const parsed of bookedOnBoth({ country: 'AE', sender: 'EmiratesNBD', body })) assert.ok(!parsed || parsed.transferHint === true, `${body}: ${parsed?.merchant}`);
  }
});

// ── Negative drift: the refusals hold under case, connector and line drift ──
const r5DriftNever = [
  ['AE', 'EmiratesNBD', '906.29 Aed At Sample Mart On Your Visa Card Xxxx1456, Or Did You Not Make It?'],
  ['AE', 'EmiratesNBD', 'Sample Alert. You Made A 878.04 Aed Purchase At Sample Mart.'],
  ['AE', 'EmiratesNBD', 'You made a 906.29 AED purchase at SAMPLE MART. Sample alert.'],
  ['AE', 'FAB', 'مثلاً – تم خصم 582.43 د.إ لدى SAMPLE STORE.'],
  ['AE', 'EmiratesNBD', 'Emirates NBD – Please verify – purchase of AED 839.80 at SAMPLE MART with your Visa card xxxx9728.'],
  ['AE', 'EmiratesNBD', 'If You Make A Purchase Over 493.70 Aed At Sample Cafe, We Will Send You An Alert.'],
  ['AE', 'EmiratesNBD', 'Your Visa Card Xxxx1444 May Have Been Used For 399.92 Aed At Sample Mart.'],
  ['SA', 'SNB-AlAhli', 'Snb: Atm Withdrawal Of Sar 500.00 Limit Reached For Today.'],
  ['AE', 'EmiratesNBD', 'Spend 500.00 Aed At Sample Mart With Your Visa Card Xxxx1456 And Earn Double Points. Offer Ends Sunday.'],
  ['SA', 'AlRajhiBank', 'ما تم خصم المبلغ\nAl Rajhi: سحبت 1,000.00 ريال نقداً من جهاز الصراف SAMPLE ATM بتاريخ 01/10/2026.'],
  ['SA', 'AlRajhiBank', 'Al Rajhi\nسحب نقدي: 60.00 ريال · SAMPLE ATM · 21/09/2026 17:03\nما تم خصم المبلغ\nRef: 774407'],
  ['SA', 'AlRajhiBank', 'شراء عبر الإنترنت\nالتاجر: SAMPLE SHOP\nالتاريخ: 30/09/2026 10:49\nمبلغ: 14,411.23 SAR | ما تم خصم المبلغ'],
  ['AE', 'EmiratesNBD', 'تم دفع د.إ 640.31 لفاتورة SAMPLE من الحساب رقم XXX4075 بتاريخ 2026-10-09 10:41.\nقيد المعالجة - Emirates NBD'],
  ['AE', 'EmiratesNBD', 'AED 6,679.85 was transferred from your checking account ...3380 to SAMPLE PERSON. Avl bal AED 82,244.70\nPlease verify this payment\nXXXX3380'],
  ['AE', 'EmiratesNBD', 'A TRANSACTION OF AED236.80 AT SAMPLE MART NOT COMPLETED WAS MADE ON YOUR CARD ENDING IN 6623 ON 2026-09-28 17:31.'],
  ['AE', 'EmiratesNBD', 'Purchase: 5.28 SAR at Sample Mart · Mastercard ...7974 Your balance is now AED 16,141.38.\nREVERSED Ref no. 910673'],
  ['AE', 'EmiratesNBD', 'New bill received | SAMPLE MART, 674.03 Dhs, due 2026-10-21.'],
  ['AE', 'ADCBAlert', 'You transferred 732.38 Dhs to yuor ADCB credit card.'],
  ['AE', 'EmiratesNBD', 'رمز  التحقق لعملية شراء بمبلغ 12,523.61 د.إ  لدى SAMPLE SHOP هو 102735.  لا  تشارك  هذا الرمز.'],
  ['AE', 'EmiratesNBD', 'SAMPLE PERSON transferred you a request for 674.03 Dhs for SAMPLE MART.'],
  ['AE', 'EmiratesNBD', 'SAMPLE PERSON transferred you 878.35 Dhs. Accept it?'],
  ['AE', 'EmiratesNBD', 'Reply 1 Purchase of 732.38 Dhs at SAMPLE MART. Is this you?'],
  ['AE', 'EmiratesNBD', 'SAMPLE MART returned -AED479.76 to your Mastercard ...8717 on 2026-09-22 16:29. Available balance: AED25,464.11.'],
  ['AE', 'EmiratesNBD', 'تذكير: الحد الأدنى المستحق 1,007.89 د.إ من إجمالي 20,157.80 د.إ قبل 21/10/2026.\nXXXX6477'],
  ['AE', 'EmiratesNBD', 'Your available balnace on your Visa Debit ••1674 is 13,711.12 AED.'],
  ['SA', 'AlRajhiBank', 'شراء إلكتروني بقيمة ٨١٣٫١٨ ريال من SAMPLE SHOP بالبطاقة رقم ****1696.\nهل قمت بهذه العملية؟ أرسل نعم\nرقم المرجع 757865'],
];
for (const [country, sender, body] of r5DriftNever) test(`neg drift never books: ${body.slice(0, 60).replace(/\s+/g, ' ')}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed || parsed.kind === 'cardPayment' || parsed.transferHint === true, `${body}: booked ${parsed?.type} ${parsed?.amountFils}`);
  }
});
test('a reading that is only the balance figure is never booked', () => {
  const body = 'You made a 155.57 EUR online transaction with SAMPLE SHOP on 24/09/2026 17:42. الرصيد الائتماني المتاح SAR 610.92\nتم خصم 155.57 EUR+ من بطاقتك المنتهية بـ 4539';
  for (const parsed of [android({ country: 'SA', sender: 'alinma', body }), ...history({ country: 'SA', sender: 'alinma', body })]) {
    assert.ok(!parsed || parsed.amountFils !== 61092, `booked the balance ${parsed?.amountFils}`);
  }
});
const r5DriftKeep = [
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Purchase Of Aed 50.00 At Sample Mart With Card 1234.'],
  ['AE', 'EmiratesNBD', 'expense', 1323, 'Your Account Ending In 4085 Has Been Used For Aed 13.23 At Sample Mart.'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'Purchase of AED 50.00 at SAMPLE MART with card 1234 - Emirates NBD'],
  ['AE', 'EmiratesNBD', 'income', 47976, 'SAMPLE MART returned AED479.76 to your Mastercard ...8717 on 2026-09-22 16:29.'],
  ['AE', 'EmiratesNBD', 'expense', 50000, 'AED 500.00 withdrawn from ATM with card 1234. Avl bal AED 500.00'],
  ['SA', 'AlRajhiBank', 'expense', 5000, 'شراء بمبلغ 50.00 ر.س لدى SAMPLE STORE\nرقم المرجع 757865'],
];
for (const [country, sender, type, minor, body] of r5DriftKeep) test(`neg drift keeps: ${body.slice(0, 60)}`, () => {
  const parsed = android({ country, sender, body });
  assert.equal(parsed?.type, type, body);
  assert.equal(parsed?.amountFils, minor, body);
});

// ── Round 5 review: readings to keep, shapes that must not book ─────────────
const r5bKeep = [
  ['AE', 'EmiratesNBD', 'income', 7500, 'AED 75.00 received from SAMPLE TAXI on your card XX1234 as a reversal.'],
  ['AE', 'EmiratesNBD', 'income', 7500, 'Reversal: AED 75.00 received from SAMPLE SHOP on your card XX1234.'],
  ['SA', 'AlRajhiBank', 'income', 1500000, 'تم ايداع راتب 15,000 ريال في حساب 1234'],
  ['AE', 'EmiratesNBD', 'income', 1500000, 'Transfer received from SAMPLE LLC AED 15,000.00 into your account XXX1234. Need a personal loan? Apply on Emirates NBD App.'],
  ['AE', 'EmiratesNBD', 'income', 12000, 'Refund of AED 120.00 from SAMPLE SHOP credited to your card XX1234. Order Cancelled on 10/10/2026.'],
  ['SA', 'AlRajhiBank', 'income', 82066, 'Credit from BALANCE STUDIO: SAR 820.66 refunded'],
  ['SA', 'AlRajhiBank', 'expense', 575, 'رسوم الخدمة 5.75 ر.س\nتم خصمها من حسابك 1234'],
];
for (const [country, sender, type, minor, body] of r5bKeep) test(`round 5 review keeps: ${body.slice(0, 60).replace(/\n/g, ' / ')}`, () => {
  const parsed = android({ country, sender, body });
  assert.equal(parsed?.type, type, body);
  assert.equal(parsed?.amountFils, minor, body);
});
test('an own transfer keeps its flag under a capitalised app footer', () => {
  const body = 'You have transferred AED 500.00 from your account XXX1234 to your savings account XXX5678. To Check Balance Visit Emirates NBD App';
  assert.equal(android({ country: 'AE', sender: 'EmiratesNBD', body })?.transferHint, true);
});
const r5bNever = [
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card XX1234 - PENDING'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card XX1234 (Pending)'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card XX1234. Status: Pending. Avl bal AED 100.00'],
  ['AE', 'EmiratesNBD', 'Pending: AED 50.00 at SAMPLE MART with card XX1234'],
  ['SA', 'AlRajhiBank', 'شراء بمبلغ 50.00 ر.س لدى SAMPLE STORE\nما تمت العملية'],
  ['SA', 'AlRajhiBank', 'شراء بمبلغ 50.00 ر.س لدى SAMPLE STORE\nالحالة: غير ناجحة'],
  ['SA', 'AlRajhiBank', 'شراء انترنت بمبلغ 50 ريال لدى SAMPLE STORE - لم تكتمل العملية'],
  ['AE', 'EmiratesNBD', 'It looks like AED 50.00 was debited from your card XX1234 at SAMPLE MART.'],
  ['AE', 'EmiratesNBD', 'Possibly charged AED 50.00 at SAMPLE MART on card XX1234.'],
  ['AE', 'EmiratesNBD', 'For instance, AED 50.00 debited from your card XX1234 at SAMPLE MART.'],
  ['AE', 'EmiratesNBD', 'eg: AED 50.00 debited from your card XX1234 at SAMPLE MART.'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card XX1234. Did you make this purchase? Reply YES or NO'],
  ['SA', 'AlRajhiBank', 'شراء بمبلغ 50.00 ر.س لدى SAMPLE STORE\nتعذر إتمام العملية'],
  ['SA', 'AlRajhiBank', 'شراء بمبلغ 50.00 ر.س لدى SAMPLE STORE\nقد يتم خصم المبلغ'],
  ['SA', 'AlRajhiBank', 'شراء بمبلغ 50.00 ر.س لدى SAMPLE STORE\nهل تؤكد هذه العملية؟'],
  ['SA', 'urpay', 'SR 625.00 paid online at SAMPLE SHOP PRE-AUTH Available credit: SR 52,863.06.'],
  ['SA', 'STCPay', 'Online payment of SAR662.58 to SAMPLE SHOP REVERSED Available balance: SAR28,951.58.'],
  ['SA', 'STCPay', 'فاتورة جديدة: SAMPLE BAR، 225.74 ريال.'],
];
for (const [country, sender, body] of r5bNever) test(`round 5 review never books: ${body.slice(0, 60).replace(/\n/g, ' / ')}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed, `${body}: booked ${parsed?.type} ${parsed?.amountFils}`);
  }
});
const r5bNoIncome = [
  ['SA', 'AlRajhiBank', 'حوالة واردة\nمبلغ: 500 ريال\nمن: SAMPLE PERSON\nتم عكسها'],
  ['AE', 'EmiratesNBD', 'SAMPLE PERSON has received AED 500.00 from your account XXX1234.'],
  ['AE', 'EmiratesNBD', 'AED 500.00 credited to account of SAMPLE PERSON from your account XXX1234.'],
];
for (const [country, sender, body] of r5bNoIncome) test(`round 5 review never income: ${body.slice(0, 60).replace(/\n/g, ' / ')}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed || parsed.type !== 'income', `${body}: booked income`);
  }
});
const r5bCardOrOwn = [
  ['AE', 'EmiratesNBD', 'Fund transfer to Credit Card XX1234 for AED 1,500.00 from account XXX5678 successful.'],
  ['AE', 'ADCB', 'ADCB: Payment sent Dhs 2,969.71 - VISA CARD PAYMENT - 20-Sep-2026 11:13\nAvl bal Dhs 24,230.73\nManage alerts at adcb.example/alerts'],
  ['AE', 'EmiratesNBD', 'Emirates NBD: Direct debit, Transaction amount: AED 769.02, Date: 2026-10-05 14:13, Card: ·8634, Payee: ENBD CREDIT CARD'],
  ['AE', 'Liv', 'تم سداد د.إ 338.92 لـ BARCLAYCARD رصيدك الحالي د.إ 1,408.70.'],
  ['SA', 'urpay', 'You sent SAR3,160.51 to ADVANZIA BANK\nBal: SAR52,494.58'],
  ['SA', 'RiyadBank', 'Riyad Bank\nBARCLAYCARD collected a direct debit of SAR 1,665.30 on 2026-09-23 11:13.'],
  ['AE', 'EmiratesNBD', 'سداد فاتورة\nالمبلغ: د.إ 1,222.81\nإلى: حساب التوفير'],
  ['SA', 'urpay', 'You received SAR 14,939.61 from MY SAVINGS'],
];
for (const [country, sender, body] of r5bCardOrOwn) test(`round 5 card or own move only: ${body.slice(0, 60).replace(/\n/g, ' / ')}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body })]) {
    assert.ok(isCardSide(parsed), `${body}: booked ${parsed?.type} ${parsed?.merchant}`);
  }
});
test('a transfer to the account of another person is not an own transfer', () => {
  const body = 'You have transferred AED 500.00 from your savings account to the account of Sample Person.';
  for (const parsed of [legacy('AE', body, 'EmiratesNBD'), android({ country: 'AE', sender: 'EmiratesNBD', body })]) {
    assert.ok(!parsed || !parsed.transferHint, `${body}: own transfer`);
  }
});

// ── Round 5 lab follow-ups ───────────────────────────────────────────────────
test('a Mashreq money-received credit from a person is still income', () => {
  const parsed = android({ country: 'AE', sender: 'Mashreq', body: 'Money received: AED 1,500.00 from SAMPLE PERSON' });
  assert.equal(parsed?.type, 'income');
  assert.equal(parsed?.amountFils, 150000);
});
test('a beneficiary receiving from your account is money out on both paths', () => {
  const row = { country: 'AE', sender: 'EmiratesNBD', body: 'Beneficiary SAMPLE PERSON received AED 700.00 from your account 002 via instant transfer.' };
  for (const parsed of [android(row), ...history(row, '')]) {
    assert.ok(!parsed || parsed.type === 'expense', `booked ${parsed?.type}`);
  }
  assert.equal(android(row)?.amountFils, 70000);
});
const r5cNever = [
  ['AE', 'EmiratesNBD', 'Emirates NBD: Payment sent AED 6,343.00 - YOUR ISA Avl bal AED 15,632.46'],
  ['SA', 'urpay', 'SR 4,365.01 sent to SAVINGS POT'],
  ['SA', 'AlRajhiBank', 'Internet transaction\nAmount: SR 391.87\nWhere: MASTERCARD ABRECHNUNG\nAvailable credit: SR 15,575.98.'],
  ['SA', 'SNB-AlAhli', 'SNB: Your debit card ***1002 was used for a 504.50 SAR purchase at ALRAJHI CREDIT CARD on 2026-10-06 07:38.'],
  ['SA', 'urpay', 'Online payment of 634.22 SR to SAMPLE HOTEL\nAvailable balance: 19,011.41 SR.\ncouldn\'t be completed'],
  ['AE', 'EmiratesNBD', 'You Sent Aed3,018.31 To Sample Person Reversed On 2026-10-08 18:17.'],
];
for (const [country, sender, body] of r5cNever) test(`round 5 lab follow-up: ${body.slice(0, 60).replace(/\n/g, ' / ')}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body })]) {
    assert.ok(isCardSide(parsed), `${body}: booked ${parsed?.type} ${parsed?.merchant}`);
  }
});

// ── Round 5 second review ────────────────────────────────────────────────────
const r5dKeep = [
  ['AE', 'EmiratesNBD', 'income', 7500, 'You have received AED 75.00 from SAMPLE SHOP as reversal in your account XXX1234'],
  ['AE', 'EmiratesNBD', 'income', 7500, 'ENBD: Transaction REVERSED. AED 75.00 has been credited to your card XX1234 from SAMPLE SHOP'],
  ['AE', 'EmiratesNBD', 'income', 5000, 'Your purchase at SAMPLE SHOP was Reversed. AED 50.00 credited to your account XXX1234'],
  ['AE', 'EmiratesNBD', 'income', 7500, 'AED 75.00 at SAMPLE SHOP reversed and credited to your salary account XXX1234'],
  ['SA', 'AlRajhiBank', 'income', 1500000, 'تم ايداع راتب بمبلغ 15,000 ريال لحساب التوفير 1234'],
  ['SA', 'AlRajhiBank', 'income', 1500000, 'تم ايداع راتب بمبلغ 15,000 ريال في حساب الراتب 1234'],
  ['AE', 'EmiratesNBD', 'expense', 35000, 'Your payment of AED 350.00 for payment of card annual fee was debited from your account XXX1234'],
  ['AE', 'EmiratesNBD', 'income', 50000, 'Money received from SAMPLE PERSON AED 500.00 to your account XXX1234. Card No: XX5678'],
  ['SA', 'AlRajhiBank', 'expense', 5000, 'شراء بمبلغ 50 ريال من بطاقتك 1234 لدى SAMPLE STORE، قد يتم تطبيق رسوم تحويل العملة'],
  ['SA', 'AlRajhiBank', 'expense', 50000, 'تم تحويل 500 ريال الى SAMPLE PERSON من حسابك 1234 ولن يتم خصم اي رسوم'],
  ['AE', 'EmiratesNBD', 'expense', 50000, 'You have transferred AED 500.00 from your savings account to the account of Sample Person.'],
];
for (const [country, sender, type, minor, body] of r5dKeep) test(`round 5 second review keeps: ${body.slice(0, 60)}`, () => {
  const parsed = android({ country, sender, body });
  assert.equal(parsed?.type, type, body);
  assert.equal(parsed?.amountFils, minor, body);
  assert.ok(!parsed.transferHint, `${body}: transfer-flagged`);
});
test('a credit to your savings account from your current account is never spending', () => {
  const parsed = android({ country: 'AE', sender: 'EmiratesNBD', body: 'AED 500.00 credited to Savings Account XXX5678 from your Current Account XXX1234.' });
  assert.ok(!parsed || parsed.type !== 'expense' || parsed.transferHint === true, `booked ${parsed?.type}`);
});
const r5dNever = [
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card XX1234 -- PENDING'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card XX1234 [Pending]'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card XX1234 -PENDING'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at SAMPLE MART with card XX1234 (pending approval)'],
  ['AE', 'EmiratesNBD', 'Pending purchase of AED 50.00 at SAMPLE MART with card XX1234'],
  ['AE', 'EmiratesNBD', 'Seems like AED 50.00 was debited at SAMPLE MART with card XX1234'],
];
for (const [country, sender, body] of r5dNever) test(`round 5 second review never books: ${body.slice(0, 60)}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed, `${body}: booked ${parsed?.type}`);
  }
});

// ── Round 5 third review ─────────────────────────────────────────────────────
const r5eIncome = [
  ['AE', 'EmiratesNBD', 500000, 'You have received AED 5,000.00 from SAMPLE PERSON in account XXX1234. For reversal requests call 600 54 0000'],
  ['AE', 'EmiratesNBD', 7500, 'Purchase reversal: AED 75.00 received from SAMPLE SHOP on card XX1234'],
  ['AE', 'EmiratesNBD', 7500, 'AED 75.00 received from SAMPLE SHOP for purchase reversal. Card XX1234'],
  ['AE', 'EmiratesNBD', 7500, 'Transaction reversal - AED 75.00 received from SAMPLE SHOP. Card XX1234'],
  ['SA', 'SNB-AlAhli', 50000, 'حوالة واردة بمبلغ 500 ريال من SAMPLE PERSON. في حال الخطأ يمكن طلب عكس الحوالة'],
  ['AE', 'EmiratesNBD', 50000, 'Dear Customer you have received AED 500.00 from your employer account. Avl Bal AED 9,000.00'],
];
for (const [country, sender, minor, body] of r5eIncome) test(`round 5 third review keeps income: ${body.slice(0, 60)}`, () => {
  const parsed = android({ country, sender, body });
  assert.equal(parsed?.type, 'income', body);
  assert.equal(parsed?.amountFils, minor, body);
});
test('a salary into a savings account is income, never an own transfer', () => {
  for (const body of ['ايداع راتب\nمبلغ: 15,000 ريال\nالى: حساب التوفير\nفي: 12/10/26',
    'حوالة واردة\nمبلغ: 500 ريال\nمن: SAMPLE PERSON\nالى: حساب التوفير']) {
    for (const parsed of [legacy('SA', body, 'SNB-AlAhli'), android({ country: 'SA', sender: 'SNB-AlAhli', body })]) {
      assert.ok(!parsed || !parsed.transferHint, `${body}: transfer-flagged`);
    }
  }
});

// ── Round 5 fourth review ────────────────────────────────────────────────────
const r5fKeep = [
  ['AE', 'ADCB', 'income', 7500, 'You received AED 75.00 reversal from SAMPLE SHOP on card XX1234'],
  ['AE', 'ADCB', 'income', 7500, 'Payment reversal AED 75.00 received from SAMPLE TAXI to card XX1234'],
  ['AE', 'EmiratesNBD', 'income', 7500, 'AED 75.00 received from SAMPLE SHOP (reversal) on card XX1234'],
  ['AE', 'ADCB', 'expense', 5000, 'AED 50.00 paid to SAMPLE SHOP thru Credit Card XX1234 on 12/10/2026'],
  ['AE', 'EmiratesNBD', 'expense', 5000, 'AED 50.00 spent at SAMPLE SHOP from your Amex. Avl limit AED 5,000.00'],
  ['SA', 'AlRajhiBank', 'expense', 5000, 'تم خصم مبلغ 50 ريال من ALRAJHI CREDIT CARD لدى SAMPLE STORE'],
  ['SA', 'SNB-AlAhli', 'income', 50000, 'تم ايداع 500 ريال في حساب SA0380000000608010167519'],
];
// "استلمت مبلغ … عكس عملية شراء" says money came back, but the free-text
// reversal is no launch-tested shape: Review, or the refund — never spending.
test('a received purchase reversal in Arabic is never spending', () => {
  const row = { country: 'SA', sender: 'AlRajhiBank', body: 'استلمت مبلغ 100 ريال عكس عملية شراء لدى SAMPLE STORE بطاقة 1234' };
  for (const parsed of [android(row), ...history(row)]) {
    assert.ok(!parsed || (parsed.type === 'income' && parsed.amountFils === 10000), `booked ${parsed?.type}`);
  }
});
for (const [country, sender, type, minor, body] of r5fKeep) test(`round 5 fourth review keeps: ${body.slice(0, 60)}`, () => {
  const parsed = android({ country, sender, body });
  assert.equal(parsed?.type, type, body);
  assert.equal(parsed?.amountFils, minor, body);
});
test('an account of yours receiving from your other account is never spending', () => {
  for (const body of ['Savings Account has received AED 500.00 from your Current Account XXX1234',
    'ENBD: Current Account has received AED 500.00 from your Savings Account XXX5678']) {
    for (const parsed of [android({ country: 'AE', sender: 'EmiratesNBD', body }), ...history({ country: 'AE', sender: 'EmiratesNBD', body }, '')]) {
      assert.ok(!parsed || parsed.type !== 'expense' || parsed.transferHint === true, `${body}: booked ${parsed?.type}`);
    }
  }
});
test('a reversal-requests footer never turns a transfer into a refund', () => {
  const parsed = android({ country: 'AE', sender: 'EmiratesNBD', body: 'Transfer of AED 1,000.00 to SAMPLE PERSON completed from your account XXX1234. Reversal requests: 600540000' });
  assert.ok(!parsed || parsed.type !== 'income', `booked ${parsed?.type}`);
});

// ── Round 5 fifth review ─────────────────────────────────────────────────────
const r5gIncome = [
  ['AE', 'DIB', 320, 'Interest received AED 3.20 from your deposit account'],
  ['AE', 'EmiratesNBD', 5000, 'Dividend received AED 50.00 from your investment account'],
  ['SA', 'SNB-AlAhli', 100000, 'Transfer received SAR 1,000.00 from your Savings account 9876'],
  ['AE', 'ADCB', 4000, 'You have received AED 40.00 from YOU GROCERY LLC'],
  ['AE', 'ADCB', 250000, 'Transfer received: AED 2,500.00 from SAMPLE PERSON into account XXX1234. Get your loan approved in minutes via the app.'],
  ['AE', 'FAB', 30000, 'Money received from SAMPLE PERSON AED 300.00 via Aani. Total due on your next statement is shown in app.'],
  ['AE', 'Mashreq', 7500, 'Transaction Reversed. AED 75.00 at SAMPLE SHOP has been credited to card XX1234'],
  ['AE', 'EmiratesNBD', 7500, 'TXN REVERSED ON CARD XX1234 AED 75.00 AT SAMPLE SHOP. AVL BAL AED 1,000.00'],
  ['AE', 'EmiratesNBD', 4210, 'Trx. of AED 42.10 on your card ending **1234 at SAMPLE AUTHORITY, UAE is Reversed. Trx Date: 11/09/26 17:10'],
];
for (const [country, sender, minor, body] of r5gIncome) test(`round 5 fifth review keeps income: ${body.slice(0, 60)}`, () => {
  const parsed = android({ country, sender, body });
  assert.ok(parsed && parsed.type === 'income' && parsed.amountFils === minor, `${body}: ${parsed?.type} ${parsed?.amountFils}`);
});
for (const body of ['AED 85.00 spent at SAMPLE MART on card 1234\nIsn\'t this you? Call 600540000',
  'AED 85.00 spent at SAMPLE MART on card 1234\nCan\'t remember this? Freeze your card in the app']) {
  test(`a completed spend keeps its row under a question footer: ${body.slice(-30)}`, () => {
    const parsed = android({ country: 'AE', sender: 'EmiratesNBD', body });
    assert.equal(parsed?.type, 'expense');
    assert.equal(parsed?.amountFils, 8500);
  });
}
for (const [country, sender, body] of [
  ['SA', 'AlRajhiBank', 'عكس حوالة واردة\nمبلغ: 500 SAR\nمن: SAMPLE PERSON\nالى: 1234'],
  ['SA', 'SNB-AlAhli', 'عكس قيد إيداع راتب\nمبلغ: 9,500.00 SAR\nحساب: **1234'],
]) test(`a reversed incoming field list is never income: ${body.slice(0, 30)}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed || parsed.type !== 'income', `${body}: booked income`);
  }
});
test('a debit the bank was unable to make is never booked', () => {
  const body = 'Sorry, we were unable to debit AED 85.00 for your SAMPLE bill from account 1234';
  for (const parsed of [android({ country: 'AE', sender: 'FAB', body }), ...history({ country: 'AE', sender: 'FAB', body })]) assert.ok(!parsed, `booked ${parsed?.type}`);
});

// ── Round 5 sixth review ─────────────────────────────────────────────────────
for (const [sender, body] of [
  ['FAB', 'Payment received AED 1,500.00 from SAMPLE PERSON to your Card Account 5678. Thank you for your payment.'],
  ['FAB', 'Payment received AED 1,500.00 from SAMPLE PERSON via Aani to your Credit Card 5678. Available credit AED 9,000'],
]) test(`a payment received on a card is the card side only: ${body.slice(0, 50)}`, () => {
  for (const parsed of [legacy('AE', body, sender), android({ country: 'AE', sender, body })]) assert.ok(isCardSide(parsed), `${body}: ${parsed?.type}`);
});
const r5hKeep = [
  ['AE', 'EmiratesNBD', 'income', 50000, 'Transfer reversed: You have received AED 500.00 back in your account XXX1234.'],
  ['AE', 'FAB', 'income', 50000, 'Your transfer to SAMPLE PERSON was reversed. You have received AED 500.00 in your account XXX1234.'],
  ['AE', 'EmiratesNBD', 'income', 50000, 'ATM withdrawal of AED 500.00 reversed. Amount added to your salary account XXX1234.'],
  ['AE', 'ADCB', 'income', 2625, 'Fee reversal AED 26.25 credited to salary A/C XXX1234'],
  ['AE', 'EmiratesNBD', 'income', 7500, 'AED 75.00 (Reversed) credited to your card XX1234 from SAMPLE SHOP'],
  ['AE', 'EmiratesNBD', 'expense', 8500, 'Purchase of AED 85.00 at SAMPLE MART with card 1234. To block your card SMS BLOCK and last 4 digits, example: BLOCK 1234'],
  ['SA', 'AlRajhiBank', 'income', 950000, 'تم إيداع راتب 9,500 ر.س في حساب سعادتكم رقم 1234'],
];
for (const [country, sender, type, minor, body] of r5hKeep) test(`round 5 sixth review keeps: ${body.slice(0, 60)}`, () => {
  const parsed = android({ country, sender, body });
  assert.ok(parsed && parsed.type === type && parsed.amountFils === minor, `${body}: ${parsed?.type} ${parsed?.amountFils}`);
});
test('"ما تمت عملية الشراء" is never booked', () => {
  const body = 'ما تمت عملية الشراء بمبلغ 85 ريال لدى SAMPLE STORE';
  for (const parsed of [legacy('SA', body, 'AlRajhiBank'), android({ country: 'SA', sender: 'AlRajhiBank', body })]) assert.ok(!parsed, `booked ${parsed?.type}`);
});
test('a CRLF blank tail stays linear', () => {
  const body = 'AED 5.00 paid\n' + '\r\n'.repeat(4000) + 'x';
  const started = process.hrtime.bigint();
  android({ country: 'AE', sender: 'EmiratesNBD', body });
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 2500);
});

// ── Round 5 seventh review ───────────────────────────────────────────────────
for (const [sender, body] of [
  ['EmiratesNBD', 'Payment received AED 2,000.00 from SAMPLE PERSON for your card account 5678 via Aani. Available credit AED 9,000.00'],
  ['EmiratesNBD', 'Payment received AED 2,000.00 from SAMPLE PERSON against your Credit Card 5678 via Aani. Thank you'],
  ['ADCB', 'Payment received AED 2,000.00 from SAMPLE PERSON to account 5678.\nCard: Visa Signature\nOutstanding balance AED 1,000.00'],
]) test(`a card payment receipt stays card-side: ${body.slice(0, 50)}`, () => {
  for (const parsed of [legacy('AE', body, sender), android({ country: 'AE', sender, body })]) assert.ok(isCardSide(parsed), `${body}: ${parsed?.type}`);
});
for (const [country, sender, body] of [
  ['AE', 'EmiratesNBD', 'Transfer received from SAMPLE PERSON AED 500.00 into your account XXX1234 has been reversed.'],
  ['AE', 'ADCB', 'AED 500.00 received from SAMPLE PERSON into your account XXX1234 has been reversed.'],
  ['SA', 'SNB-AlAhli', 'Transfer received SAR 1,500.00 from SAMPLE PERSON into your account 1234 has been reversed'],
]) test(`an incoming credit that was reversed is never income: ${body.slice(0, 50)}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed || parsed.type !== 'income', `${body}: booked income`);
  }
});
test('a reversed purchase credited to a salary account is income', () => {
  const parsed = android({ country: 'AE', sender: 'EmiratesNBD', body: 'Your purchase at SAMPLE MART was reversed. AED 75.00 added to your salary account XXX1234.' });
  assert.ok(!parsed || parsed.type === 'income', `booked ${parsed?.type}`);
});

// ── Round 5 eighth review ────────────────────────────────────────────────────
for (const [sender, body] of [
  ['EmiratesNBD', 'Salary of AED 12,000.00 credited to your account XXX1234 | REVERSED | Ref 55123'],
  ['EmiratesNBD', 'Transfer received: AED 500.00 from SAMPLE PERSON credited to your account XXX1234 (Reversed)'],
]) test(`a reversed incoming credit with its own status is never income: ${body.slice(0, 50)}`, () => {
  for (const parsed of [legacy('AE', body, sender), android({ country: 'AE', sender, body }), ...history({ country: 'AE', sender, body })]) {
    assert.ok(!parsed || parsed.type !== 'income', `${body}: booked income`);
  }
});
test('a purchase reversal into a salary account is a refund, not salary', () => {
  const parsed = android({ country: 'AE', sender: 'ADCB', body: 'POS purchase reversed - AED 75.00 credited to Salary A/C XXX1234' });
  assert.ok(!parsed || (parsed.type === 'income' && !/salary/i.test(`${parsed.merchant} ${parsed.categoryGuess}`)), `${parsed?.merchant} ${parsed?.categoryGuess}`);
});
for (const [country, sender, body] of [
  ['AE', 'EmiratesNBD', 'Cash not received: your ATM withdrawal of AED 500.00 has been reversed. Available balance AED 4,500.00'],
  ['AE', 'ADCB', 'Payment to SAMPLE UTILITY not received by biller; AED 300.00 has been reversed. Available balance AED 2,700.00'],
]) test(`a reversed debit is never booked as spending: ${body.slice(0, 50)}`, () => {
  const parsed = android({ country, sender, body });
  assert.ok(!parsed || parsed.type !== 'expense', `${body}: booked expense`);
});
for (const [sender, body] of [
  ['EmiratesNBD', 'Payment received AED 1,000.00 from SAMPLE PERSON into your account 5678 (Credit Card). Available credit AED 9,000.00'],
  ['FAB', 'Payment received AED 2,000.00 from SAMPLE PERSON into your loan account 1234. Thank you for your payment.'],
]) test(`a card or loan payment receipt is never spending or income: ${body.slice(0, 50)}`, () => {
  for (const parsed of [legacy('AE', body, sender), android({ country: 'AE', sender, body })]) assert.ok(isCardSide(parsed), `${body}: ${parsed?.type}`);
});
test('card and due wording followed by long blank runs stays linear', () => {
  for (const body of ['Payment received AED 500.00 from SAMPLE PERSON. Total due' + ' '.repeat(8000) + 'x',
    'Payment received AED 500.00 from SAMPLE PERSON into your account 1234 card' + ' '.repeat(8000) + 'x']) {
    const started = process.hrtime.bigint();
    android({ country: 'AE', sender: 'EmiratesNBD', body });
    assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 2500);
  }
});

// ── Round 5 ninth review ─────────────────────────────────────────────────────
for (const [country, sender, body] of [
  ['AE', 'EmiratesNBD', 'AED 500.00 credited to your account XXX1234 has been reversed'],
  ['SA', 'SNB-AlAhli', 'SAR 500.00 credited to your account 1234 on 12/10 was reversed'],
  ['AE', 'ADCB', 'Cash deposit of AED 2,000.00 credited to your account XXX1234 was reversed'],
  ['AE', 'FAB', 'AED 500.00 credited to your account XXX1234\nStatus: REVERSED'],
  ['AE', 'ADCB', 'AED 500.00 from SAMPLE PERSON credited to your account XXX1234\nREVERSED\nRef: 7781'],
  ['AE', 'EmiratesNBD', 'Reversal of salary credit of AED 12,000.00 debited from your account XXX1234'],
  ['AE', 'EmiratesNBD', 'AED 75.00 refunded to SAMPLE.COM has been debited from your account XXX1234'],
]) test(`a reversed credit or money out is never income: ${body.slice(0, 50).replace(/\n/g, ' / ')}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed || parsed.type !== 'income', `${body}: booked income`);
  }
});
const r5iKeep = [
  ['AE', 'RAKBANK', 'expense', 8500, 'AED 85.00 SPENT AT SAMPLE FUEL ON CREDIT CARD. AVL LIMIT AED 9,915.00'],
  ['SA', 'SNB-AlAhli', 'expense', 8500, 'PURCHASE SAR 85.00 AT SAMPLE BOOKS USING CREDIT CARD. AVAILABLE LIMIT SAR 9,915.00'],
  ['AE', 'ADCB', 'expense', 8500, 'Merchant: SAMPLE MART\nCREDIT CARD PURCHASE\nAmount: AED 85.00'],
  ['SA', 'AlRajhiBank', 'expense', 50000, 'رسوم التحويل 5.75 ر.س. تم تحويل 500.00 ر.س إلى SAMPLE PERSON من حسابك 1234'],
];
for (const [country, sender, type, minor, body] of r5iKeep) test(`round 5 ninth review keeps: ${body.slice(0, 60).replace(/\n/g, ' / ')}`, () => {
  const parsed = android({ country, sender, body });
  assert.ok(parsed && parsed.type === type && parsed.amountFils === minor, `${body}: ${parsed?.type} ${parsed?.amountFils}`);
});

// ── Round 5 tenth review, and the standalone-status policy ───────────────────
const r5jIncome = [
  ['AE', 'ADCB', 7500, 'POS purchase of AED 75.00 at SAMPLE SHOP has been reversed and credited to your account XXX1234'],
  ['AE', 'EmiratesNBD', 50000, 'ATM withdrawal of AED 500.00 has been reversed and credited to your account XXX1234'],
  ['AE', 'FAB', 30000, 'Your SAMPLE UTILITY payment of AED 300.00 has been reversed and added to your account 1234'],
];
for (const [country, sender, minor, body] of r5jIncome) test(`a reversed debit credited back is income: ${body.slice(0, 50)}`, () => {
  const parsed = android({ country, sender, body });
  assert.ok(parsed && parsed.type === 'income' && parsed.amountFils === minor, `${body}: ${parsed?.type} ${parsed?.amountFils}`);
});
test('an Arabic fee price ahead of a withdrawal never labels it a bank fee', () => {
  const parsed = android({ country: 'SA', sender: 'SNB-AlAhli', body: 'رسوم السحب 5.00 ر.س. تم سحب 500.00 ر.س من الصراف 1234' });
  assert.equal(parsed?.amountFils, 50000);
  assert.notEqual(parsed?.merchant, 'Bank fee');
});
test('a reversal request acknowledgement is never booked', () => {
  const body = 'Your reversal request for AED 75.00 at SAMPLE SHOP has been received';
  for (const parsed of [legacy('AE', body, 'EmiratesNBD'), android({ country: 'AE', sender: 'EmiratesNBD', body })]) assert.ok(!parsed, `booked ${parsed?.type}`);
});
// Policy: a status standing alone AFTER a movement ("…\nREVERSED", ". REVERSED",
// "…\nDECLINED") goes to Review; the inline compact reversal posting keeps its
// launch-tested refund reading.
for (const body of ['Purchase of AED 50.00 at SAMPLE MART with card 1234.\nREVERSED',
  'Purchase of AED 50.00 at SAMPLE MART with card 1234. REVERSED',
  'Purchase of AED 50.00 at SAMPLE MART with card 1234\nDECLINED']) {
  test(`a standalone trailing status goes to Review: ${JSON.stringify(body.slice(-12))}`, () => {
    assert.equal(android({ country: 'AE', sender: 'EmiratesNBD', body }), null);
  });
}
test('the inline compact reversal keeps its refund reading', () => {
  const parsed = android({ country: 'AE', sender: 'EmiratesNBD', body: 'ATM WDL AED 600.00 DR A/C 1234 REVERSED' });
  assert.equal(parsed?.type, 'income');
  assert.equal(parsed?.amountFils, 60000);
});

// ── Round 5 eleventh review: word order decides a reversal ───────────────────
for (const [country, sender, body] of [
  ['AE', 'EmiratesNBD', 'Cashback of AED 10.00 credited to your card XX1234 is reversed as the purchase was returned'],
  ['AE', 'EmiratesNBD', 'Transfer of AED 500.00 credited to your account XXX1234 was reversed as the transaction was recalled by the sender'],
  ['AE', 'EmiratesNBD', 'Cash deposit of AED 1,000.00 at ATM credited to your account XXX1234 has been reversed'],
  ['AE', 'FAB', 'Payment of AED 1,500.00 from SAMPLE TRADING LLC credited to your account 1234 has been reversed'],
  ['AE', 'EmiratesNBD', 'The refund of AED 75.00 on your card XX1234 has been reversed'],
]) test(`a credit followed by its reversal is never income: ${body.slice(0, 50)}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed || parsed.type !== 'income', `${body}: booked income`);
  }
});
test('a pure Arabic fee keeps its Bank fee label', () => {
  const parsed = android({ country: 'SA', sender: 'SNB-AlAhli', body: 'رسوم الخدمة 5.00 ر.س. تم خصم 5.00 ر.س من حسابك 1234' });
  assert.equal(parsed?.amountFils, 500);
  assert.equal(parsed?.merchant, 'Bank fee');
});
test('a refund request notice that reports the credit still books the refund', () => {
  const parsed = android({ country: 'AE', sender: 'EmiratesNBD', body: 'Your refund request has been received. AED 75.00 has been credited to your card XX1234' });
  assert.equal(parsed?.type, 'income');
  assert.equal(parsed?.amountFils, 7500);
});

// ── Round 5 twelfth review: the reversed clause is the debit's, not the credit's ──
// Free-text reversal sentences ("… credited to your card as your purchase at X
// was reversed") are not a launch-tested reversal shape: telling the debit's
// reversal from the credit's ("… as payment from X has been reversed") took a
// noun list that every review round bypassed. They may wait in Review; they
// must never book money out, nor income of another amount.
for (const [country, sender, minor, body] of [
  ['AE', 'EmiratesNBD', 50000, 'AED 500.00 added to your account XXX1234 as ATM withdrawal of AED 500.00 was reversed'],
  ['SA', 'SNB-AlAhli', 8500, 'SAR 85.00 added to your account 1234 as the transaction at SAMPLE BOOKS was reversed'],
  ['AE', 'EmiratesNBD', 7500, 'AED 75.00 credited to your card XX1234 as your purchase at SAMPLE SHOP was reversed'],
]) test(`money returned because a debit was reversed is never money out: ${body.slice(0, 50)}`, () => {
  for (const parsed of [android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed || (parsed.type === 'income' && parsed.amountFils === minor), `${body}: ${parsed?.type}`);
  }
});
test('a chargeback request that credits only once approved is never booked', () => {
  const body = 'Your chargeback request for AED 75.00 has been logged. Once approved the amount is credited to your card XX1234';
  for (const parsed of [legacy('AE', body, 'EmiratesNBD'), android({ country: 'AE', sender: 'EmiratesNBD', body })]) assert.ok(!parsed, `booked ${parsed?.type}`);
});

// ── Round 5 thirteenth review ────────────────────────────────────────────────
for (const [country, sender, body] of [
  ['AE', 'EmiratesNBD', 'AED 500.00 credited to your account that ends with 1234 has been reversed'],
  ['AE', 'EmiratesNBD', 'You received AED 500.00 from SAMPLE PERSON. The transfer has been reversed'],
]) test(`a reversed credit is never income: ${body.slice(0, 50)}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed || parsed.type !== 'income', `${body}: booked income`);
  }
});
for (const [country, sender, minor, body] of [
  ['SA', 'SNB-AlAhli', 8500, 'You received SAR 85.00 in your account 1234 since the SAMPLE BOOKS purchase was reversed'],
  ['SA', 'AlRajhiBank', 50000, 'You have received SAR 500.00 in your account 1234 as the ATM withdrawal was reversed'],
  ['AE', 'EmiratesNBD', 7500, 'You have received AED 75.00 as your purchase at SAMPLE SHOP was reversed'],
]) test(`money received because a debit was reversed is never money out: ${body.slice(0, 50)}`, () => {
  for (const parsed of [android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed || (parsed.type === 'income' && parsed.amountFils === minor), `${body}: ${parsed?.type}`);
  }
});

// ── Round 5 fourteenth review: only a debit clause ends the credit's sentence ──
for (const [country, sender, body] of [
  ['SA', 'AlRajhiBank', 'SAR 500.00 credited to your account 1234 due to a technical error has been reversed'],
  ['AE', 'EmiratesNBD', 'AED 500.00 credited to your account XXX1234 after verification has been reversed'],
  ['AE', 'EmiratesNBD', 'Interest of AED 12.00 credited to your account XXX1234 since last month has been reversed'],
  ['AE', 'FAB', 'Refund of AED 75.00 credited to your card XX1234 after your return at SAMPLE SHOP has been reversed'],
]) test(`a credit reversed after a prepositional phrase is never income: ${body.slice(0, 50)}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed || parsed.type !== 'income', `${body}: booked income`);
  }
});
for (const [country, sender, body] of [
  ['AE', 'ADCB', 'AED 85.00 spent at SAMPLE MART on card 1234. Avl bal AED 1,000.00. For example: enable Apple Pay in the app'],
  ['SA', 'SNB-AlAhli', 'Purchase SAR 120.00 at SAMPLE BOOKS with Mada card 1234. Example: Pay with Apple Pay for a faster checkout'],
]) test(`a promo "example" after the movement keeps the purchase: ${body.slice(0, 40)}`, () => {
  assert.equal(android({ country, sender, body })?.type, 'expense');
});

// ── Round 5 fifteenth review: the debit clause is structural, not a noun list ──
for (const [country, sender, minor, body] of [
  ['AE', 'EmiratesNBD', 30000, 'AED 300.00 added to your account XXX1234 as your DEWA bill was reversed'],
  ['AE', 'EmiratesNBD', 90000, 'AED 900.00 credited to your card XX1234 as the hotel booking at SAMPLE HOTEL was reversed'],
  ['SA', 'SNB-AlAhli', 5000, 'SAR 50.00 added to your account 1234 as the STC recharge was reversed'],
  ['AE', 'EmiratesNBD', 4500, 'AED 45.00 credited to your card XX1234 since your subscription at SAMPLE STREAM was reversed'],
  ['AE', 'EmiratesNBD', 10000, 'AED 100.00 added to your account XXX1234 as the top-up was reversed'],
  ['AE', 'EmiratesNBD', 7500, 'AED 75.00 credited to your card XX1234 because the amount at SAMPLE SHOP was reversed'],
  ['AE', 'EmiratesNBD', 3200, 'AED 32.00 credited to your card XX1234 as your Careem ride was reversed'],
  ['AE', 'EmiratesNBD', 50000, 'AED 500.00 added to your account XXX1234 as ATM withdrawal of AED 500.00 was reversed'],
]) test(`money returned for a reversed debit is never money out: ${body.slice(0, 50)}`, () => {
  for (const parsed of [android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed || (parsed.type === 'income' && parsed.amountFils === minor), `${body}: ${parsed?.type}`);
  }
});
for (const [country, sender, body] of [
  ['AE', 'EmiratesNBD', 'AED 500.00 credited to your account XXX1234 as payment from SAMPLE PERSON has been reversed'],
  ['AE', 'EmiratesNBD', 'AED 500.00 credited to your account XXX1234 as a transfer from SAMPLE PERSON has been reversed'],
  ['AE', 'EmiratesNBD', 'The amount of AED 500.00 credited to your account XXX1234 as an Aani payment has been reversed'],
  ['AE', 'EmiratesNBD', 'AED 500.00 deposited into your account XXX1234 when the cheque transfer cleared has been reversed'],
  ['AE', 'EmiratesNBD', 'Refund of AED 75.00 credited to your card XX1234 after the SAMPLE SHOP order return has been reversed'],
  ['AE', 'EmiratesNBD', 'Salary of AED 9,000.00 credited to your account XXX1234 as per employer transfer has been reversed'],
  ['AE', 'EmiratesNBD', 'Salary of AED 9,000.00 credited to your account XXX1234 as payroll transfer from SAMPLE CO has been reversed'],
  ['AE', 'EmiratesNBD', 'Interest of AED 12.00 credited to your account XXX1234 as a monthly payment has been reversed'],
]) test(`a reversed credit with an "as/when" phrase is never income: ${body.slice(0, 50)}`, () => {
  for (const parsed of [legacy(country, body, sender), android({ country, sender, body }), ...history({ country, sender, body })]) {
    assert.ok(!parsed || parsed.type !== 'income', `${body}: booked income`);
  }
});

// ── Reversal gate: the launch-tested credit-reversal shapes still book money out ──
// Any other reversal wording waits in Review (reversalLeftUnproven); these
// whole-alert shapes say which credit was taken back and keep their row.
for (const [country, sender, minor, body] of [
  ['AE', 'EmiratesNBD', 640000, 'Salary credit AED 6,400.00 to your account has been reversed.'],
  ['AE', 'EmiratesNBD', 625000, 'Payroll credit of AED 6,250.00 was reversed from your account 1234'],
  ['AE', 'FAB', 750000, 'Salary credit AED 7,500.00 to your account has been reversed. Available balance AED 99,999.00.'],
  ['AE', 'FAB', 4799, 'Refund AED 47.99 to card 1234 was reversed and debited from your account.'],
  ['SA', 'AlRajhiBank', 750000, 'تم عكس راتب SAR 7500.00 المودع في حسابك'],
  ['AE', 'FAB', 750000, 'SAL PAY AED 7,500.00 CR A/C 1234 REVERSED Available balance AED 99,999.00.'],
]) test(`a proven credit reversal books money out: ${body.slice(0, 50)}`, () => {
  // The senderless iPhone record too: no institution, so only parseSms's own reading can carry it.
  const row = { country, sender, body };
  for (const parsed of [android(row), legacy(country, body, sender), ...history(row), ...history(row, '')]) {
    assert.ok(parsed && parsed.type === 'expense' && parsed.amountFils === minor, `${body}: ${parsed?.type}`);
  }
});
// The same wording asked, scheduled, negated, conditional or challenged: no row.
for (const [country, sender, body] of [
  ['AE', 'FAB', 'Refund AED 47.99 to card 1234 was reversed and debited from your account?'],
  ['AE', 'FAB', 'Refund AED 47.99 to card 1234 will be reversed and debited from your account.'],
  ['AE', 'FAB', 'Refund AED 47.99 to card 1234 was not reversed and debited from your account.'],
  ['AE', 'FAB', 'If the refund AED 47.99 to card 1234 was reversed and debited from your account, call us.'],
  ['AE', 'FAB', 'Refund AED 47.99 to card 1234 was reversed and debited from your account. Did you request this? Reply Y'],
  ['AE', 'EmiratesNBD', 'Salary credit of AED 10,000.00 will be reversed from your account ending 0099'],
  ['AE', 'EmiratesNBD', 'Salary credit of AED 10,000.00 was not reversed from your account ending 0099'],
  ['AE', 'EmiratesNBD', 'Salary credit AED 6,400.00 to your account has been reversed? Reply YES to confirm'],
  ['SA', 'AlRajhiBank', 'هل تم عكس راتب SAR 7500.00 المودع في حسابك؟'],
  ['SA', 'AlRajhiBank', 'لم يتم عكس راتب SAR 7500.00 المودع في حسابك'],
  ['SA', 'AlRajhiBank', 'سيتم عكس راتب SAR 7500.00 المودع في حسابك'],
]) test(`a credit reversal that did not happen is never booked: ${body.slice(0, 50)}`, () => {
  const row = { country, sender, body };
  for (const parsed of [android(row), ...history(row), ...history(row, '')]) {
    assert.ok(!parsed, `${body}: booked ${parsed?.type}`);
  }
});
