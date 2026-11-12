'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const load = require('./load-ts.cjs').createLoader();
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
// Ported from #190 (f14a20c1, 410442d4, 45306388) as BEHAVIOUR only (CEO 56bc3c4e): every Android, History and Review
// assertion is kept; the assertions on #190's moneyNoticeKind API are not, because no kept caller needs that API.
const { parseSms, nonPostingReason } = load('@/lib/sms-parser');
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
// The whole History outcome: rows booked, items waiting in Review, declines.
function historyOutcome(row, sender = row.sender) {
  const reader = session(row.country);
  const record = { v: 1, id: createHash('sha256').update(row.body + sender).digest('hex'), text: row.body,
    receivedAt: new Date(observedAt).toISOString(), ...(sender ? { sender } : {}) };
  return parseHistoricalMessageRecords([JSON.stringify(record)], {}, new Date(observedAt), new Set(), reader);
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

];

// Only completed-spend controls belong to this refusal-guard port; income/refund reconstruction is not ported.
for (const row of posts) test(`posts: ${row.id}`, () => {
  for (const [path, parsed] of [['android', android(row)], ['history', history(row)[0]]]) {
    assert.ok(parsed, `${path}: the completed alert is booked`);
    assert.equal(parsed.kind, 'transaction', path);
    assert.equal(parsed.type, row.type, path);
    assert.equal(parsed.amountFils, row.minor, path);
  }
});

// ── Wave 3: wordings the first guard dropped although money moved ───────────
// The wave 2 review (finding 1) found completed spends the guard refused: a
// fraud question with no full stop before it, a closing "Was this you?", a
// transfer request that "is processed", and a spend "within your daily limit".
// All bodies are synthetic. Each shape is a must-post control on Android and
// both iPhone History paths, on one line and on two. `senderless: false` marks
// a body the senderless History path never posts for a reason that is not a
// guard (no bank context without a sender); it must then wait in Review.
const guardShapes = [
  { id: 'Didn\'t make this transaction? footer, no full stop', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 5000,
    one: 'AED 50.00 spent on your card ending 1234 at TEST MART on 01/11/2026 Didn\'t make this transaction? Call 600540000',
    two: 'AED 50.00 spent on your card ending 1234 at TEST MART on 01/11/2026\nDidn\'t make this transaction? Call 600540000' },
  { id: 'Didn\'t make this purchase? footer, no full stop', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 5000,
    one: 'AED 50.00 spent on your card ending 1234 at TEST MART on 01/11/2026 Didn\'t make this purchase? Call 600540000',
    two: 'AED 50.00 spent on your card ending 1234 at TEST MART on 01/11/2026\nDidn\'t make this purchase? Call 600540000' },
  { id: 'Didn\'t do this? footer, no full stop', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 5000,
    one: 'AED 50.00 spent on your card ending 1234 at TEST MART on 01/11/2026 Didn\'t do this? Call 600540000',
    two: 'AED 50.00 spent on your card ending 1234 at TEST MART on 01/11/2026\nDidn\'t do this? Call 600540000' },
  { id: 'Unauthorised? footer, no full stop', country: 'AE', sender: 'Mashreq', type: 'expense', minor: 5000,
    one: 'AED 50.00 spent on Mashreq card ending 1234 at TEST MART on 01-NOV-2026 Unauthorised? Call 04 4244444',
    two: 'AED 50.00 spent on Mashreq card ending 1234 at TEST MART on 01-NOV-2026\nUnauthorised? Call 04 4244444' },
  { id: 'Unauthorized? footer (US spelling)', country: 'AE', sender: 'Mashreq', type: 'expense', minor: 5000,
    one: 'AED 50.00 spent on Mashreq card ending 1234 at TEST MART on 01-NOV-2026 Unauthorized? Call 04 4244444',
    two: 'AED 50.00 spent on Mashreq card ending 1234 at TEST MART on 01-NOV-2026\nUnauthorized? Call 04 4244444' },
  { id: 'a closing "Was this you?" line with no reply instruction', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 5000, senderless: false,
    one: 'Purchase of AED 50.00 with Debit Card ending 1234 at TEST MART on 01/11/2026. Was this you?',
    two: 'Purchase of AED 50.00 with Debit Card ending 1234 at TEST MART on 01/11/2026.\nWas this you?' },
  { id: 'a closing "Was this you?" line under an available balance', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 5000, senderless: false,
    one: 'Purchase of AED 50.00 with Debit Card ending 1234 at TEST MART on 01/11/2026. Avl Balance AED 1,000.00 Was this you?',
    two: 'Purchase of AED 50.00 with Debit Card ending 1234 at TEST MART on 01/11/2026. Avl Balance AED 1,000.00\nWas this you?' },
  // The two-line form of a prose transfer is not read by the amount grammar on
  // Android, with or without this guard (same at 429d32f0): see the known-gap
  // test below. The one-line form is the control.
  { id: 'a transfer request that "is processed"', country: 'AE', sender: 'ADCB', type: 'expense', minor: 50000,
    one: 'Your transfer request of AED 500.00 to TEST PERSON is processed.', two: null },
  { id: 'a spend "within your daily limit"', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 5000,
    one: 'Purchase of AED 50.00 at TEST MART on card ending 1234 within your daily limit',
    two: 'Purchase of AED 50.00 at TEST MART on card ending 1234\nwithin your daily limit' },
  { id: 'a spend "within your monthly spending limit"', country: 'AE', sender: 'EmiratesNBD', type: 'expense', minor: 5000,
    one: 'Purchase of AED 50.00 at TEST MART on card ending 1234 within your monthly spending limit',
    two: 'Purchase of AED 50.00 at TEST MART on card ending 1234\nwithin your monthly spending limit' },
];
for (const shape of guardShapes) for (const [lines, body] of [['1 line', shape.one], ['2 lines', shape.two]].filter(([, text]) => text)) {
  test(`wave 3 posts (${lines}): ${shape.id}`, () => {
    const row = { country: shape.country, sender: shape.sender, body };
    const paths = [['android', android(row)], ['history with sender', history(row)[0]]];
    if (shape.senderless !== false) paths.push(['history senderless', history(row, '')[0]]);
    for (const [path, parsed] of paths) {
      assert.ok(parsed, `${path}: the completed alert is booked`);
      assert.equal(parsed.kind, 'transaction', path);
      assert.equal(parsed.type, shape.type, path);
      assert.equal(parsed.amountFils, shape.minor, path);
    }
    assert.equal(nonPostingReason(body), null, 'no decline guard names it');
    if (shape.senderless === false) {
      // No sender, no bank context: not a guard refusal, and never lost.
      const out = historyOutcome(row, '');
      assert.equal(out.parsed.length, 0, 'senderless History does not auto-book without bank context');
      assert.equal(out.reviewCandidates.length, 1, 'it waits in Review instead');
    }
  });
}

// KNOWN GAP (visible, not silent): the 2-line prose form of the "is processed"
// transfer is read by no path, at rc1 and at 429d32f0 alike; the amount grammar
// wants one clause. It is a grammar limit, not a guard refusal. node:test
// reports it as a TODO until a parser change books it.
test('wave 3 known gap: a 2-line prose transfer request that "is processed" is not booked on Android', { todo: 'multi-line prose transfers are unread at 429d32f0 and rc1' }, () => {
  const row = { country: 'AE', sender: 'ADCB', body: 'Your transfer request of AED 500.00\nto TEST PERSON is processed.' };
  assert.ok(android(row), 'Android books the completed transfer');
});

// The same wordings with the refusal that IS right must still book nothing.
const guardSiblingsNever = [
  ['AE', 'EmiratesNBD', 'Your transfer request of AED 500.00 to TEST PERSON will be processed tomorrow.', 'request'],
  ['AE', 'EmiratesNBD', 'Your transfer request of AED 500.00 to TEST PERSON is being processed.', 'not-yet'],
  ['AE', 'EmiratesNBD', 'Your transfer request of AED 500.00 to TEST PERSON was not processed.', 'negated'],
  ['AE', 'EmiratesNBD', 'ATM withdrawal of AED 500.00 limit reached for today', 'limit'],
  ['AE', 'EmiratesNBD', 'Was this you? Purchase of AED 50.00 at TEST MART on card ending 1234', 'question'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at TEST MART on card ending 1234. Was this you? Reply YES or NO', 'question'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at TEST MART on card ending 1234\nWas this you? Reply Y', 'status'],
  ['AE', 'EmiratesNBD', 'Did you make a AED 50.00 purchase at TEST MART? Reply YES or NO', 'question'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at TEST MART on card ending 1234 - Declined', 'status'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at TEST MART on card ending 1234\nDid you make this transaction?', 'question'],
];
for (const [country, sender, body, kind] of guardSiblingsNever) test(`wave 3 still never posted: ${body.slice(0, 60).replace(/\n/g, ' / ')}`, () => {
  const row = { country, sender, body };
  assert.equal(android(row), null, 'Android seam books nothing');
  assert.equal(history(row).length, 0, 'History (with sender) books nothing');
  assert.equal(history(row, '').length, 0, 'senderless History books nothing');
});

// ── Notices that quote money but never moved it ──────────────────────────────
// [market, sender, body, the notice family #190 named (documentation only; null when another guard refuses it)]
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

for (const [country, sender, body, kind] of neverPosted.filter(row => row[3] !== null)) test(`never posted (${country}): ${body.slice(0, 60)}`, () => {
  const row = { country, sender, body };
  assert.equal(android(row), null, 'Android seam books nothing');
  assert.equal(history(row).length, 0, 'History (with sender) books nothing');
  assert.equal(history(row, '').length, 0, 'senderless History books nothing');
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
// KNOWN GAPS (visible, not silent): two compact "Refund |" bars that the #163
// port wanted refused are booked as an expense at rc1 AND at 429d32f0 (not a
// wave 2 regression). Until the parser reads them they are TODO tests, so each
// run still prints them.
const refundBarGaps = round4Never.filter(row => row[2].startsWith('Refund |'));
for (const [country, sender, body] of refundBarGaps) test(`round 4 known gap (booked today, should wait in Review): ${body.slice(0, 60)}`, { todo: 'unchanged from 429d32f0; #163 port did not cover refund bars' }, () => {
  const row = { country, sender, body };
  assert.equal(android(row), null, 'Android seam books nothing');
  assert.equal(history(row).length, 0, 'History (with sender) books nothing');
  assert.equal(history(row, '').length, 0, 'senderless History books nothing');
});
test('round 4 known gaps: the Refund | bars are still exactly the two listed', () => {
  assert.equal(refundBarGaps.length, 2);
});
for (const [country, sender, body] of round4Never.filter(row => !row[2].startsWith('Refund |'))) test(`round 4 never posted (${country}): ${body.slice(0, 60)}`, () => {
  const row = { country, sender, body };
  assert.equal(android(row), null, 'Android seam books nothing');
  assert.equal(history(row).length, 0, 'History (with sender) books nothing');
  assert.equal(history(row, '').length, 0, 'senderless History books nothing');
});

for (const body of [
  'Your payment of AED 12.00 to SAMPLE RIDES was not paid.',
  'Your payment of AED 12.00 to SAMPLE RIDES\nwas not paid.',
]) for (const sender of ['EmiratesNBD', '']) test(`negated payment matrix: ${JSON.stringify(body)} / ${sender || 'senderless'}`, () => {
  const row = { country: 'AE', sender, body };
  assert.equal(android(row), null);
  assert.equal(history(row).length, 0);
  assert.equal(history(row, '').length, 0);
});

// Option (b): a money-bearing alert the guards refuse is never posted and never
// silently lost. From a launch-bank sender it waits in Review (Android inbox
// capture and both iPhone paths share inspectSourceFreeRefusedAlert); a real
// decline is recorded as declined. Only wording that moved no money (negated,
// balance-only, chat, offers) is set aside.
const { inspectSourceFreeRefusedAlert } = load('@/lib/auto-import');
const reviewVisible = [
  ['AE', 'EmiratesNBD', 'Did you make a AED168.06 purchase at SAMPLE SHOP? Reply YES or NO.'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at TEST MART on card ending 1234 - was this you? Reply Y or N'],
  ['AE', 'EmiratesNBD', 'Was this you? AED 168.06 purchase at SAMPLE SHOP on card ending 1234'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at TEST MART on card ending 1234\nWas this you? Reply Y'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 with Debit Card ending 1234 at THE CANCELLED. Avl Balance AED 900.00'],
  ['AE', 'ADCB', 'Your transfer request of AED 500.00 to TEST PERSON will be processed tomorrow.'],
  ['AE', 'ADCB', 'Payment request: SAMPLE PERSON is asking you to pay 206.00 AED.'],
  ['AE', 'EmiratesNBD', 'Your Debit Card ending 1234 has been used for AED 245.50 at SAMPLE MART, will be approved shortly.'],
  ['SA', 'AlRajhiBank', 'شراء عبر نقاط البيع\nبطاقة: **1234\nلدى: SAMPLE SHOP\nمبلغ: 120.00 SAR\nهل قمت بهذه العملية؟'],
  ['SA', 'AlRajhiBank', 'هل قمت بتحويل 500.00 ر.س إلى SAMPLE PERSON؟ للتأكيد أرسل 1 وللإلغاء أرسل 2.'],
];
for (const [country, sender, body] of reviewVisible) test(`refused money waits in Review, not posted, not lost: ${body.slice(0, 55).replace(/\n/g, ' / ')}`, () => {
  const row = { country, sender, body };
  assert.equal(android(row), null, 'not posted on Android');
  assert.equal(history(row).length, 0, 'not posted from History');
  for (const channel of ['inbox', 'push']) {
    const decision = inspectSourceFreeRefusedAlert({ source: body, sender, observedAt, channel, session: session(country) });
    assert.equal(decision.kind, 'review', `${channel}: waits in Review`);
  }
  assert.equal(historyOutcome(row).reviewCandidates.length, 1, 'History queues it for Review');
});
test('a refused trailing decline is recorded as declined, not reviewed as spending', () => {
  const row = { country: 'AE', sender: 'EmiratesNBD', body: 'Purchase of AED 50.00 at TEST MART on card ending 1234 - Declined' };
  assert.equal(android(row), null);
  assert.equal(inspectSourceFreeRefusedAlert({ source: row.body, sender: row.sender, observedAt, channel: 'inbox', session: session('AE') }).kind, 'declined');
});

// "Not u?" (410442d4): an abbreviated fraud-report footer, not a question about the money. Decision: a completed debit
// that carries it is read exactly as the same debit without it, on every path. The UPI body is #190's original; on a Gulf
// ledger it takes the unproven-format path.
const outcome = (row) => {
  const parsed = android(row);
  return parsed && { kind: parsed.kind, type: parsed.type, amountFils: parsed.amountFils, currency: parsed.currency };
};
for (const [country, sender, withFooter, withoutFooter] of [
  ['AE', 'EmiratesNBD', 'AED 640.00 debited from your account ending 1234 at TEST MART on 01/11/2026. Not u? Call 600540000.',
    'AED 640.00 debited from your account ending 1234 at TEST MART on 01/11/2026.'],
  ['AE', 'EmiratesNBD', 'AED 640.00 debited from your account ending 1234 at TEST MART on 01/11/2026 Not u?Call 600540000',
    'AED 640.00 debited from your account ending 1234 at TEST MART on 01/11/2026'],
  ['AE', 'PNB', 'A/c XX1234 debited INR 640.00 Dt 24-09-26 10:05:12 thru UPI:626712345678.Bal INR 12,345.67 Not u?Fwd this SMS to 9264092640 to block UPI.Download PNB ONE-PNB',
    'A/c XX1234 debited INR 640.00 Dt 24-09-26 10:05:12 thru UPI:626712345678.Bal INR 12,345.67'],
]) test(`a completed debit keeps the abbreviated Not u fraud footer: ${withFooter.slice(0, 50)}`, () => {
  const footer = outcome({ country, sender, body: withFooter });
  assert.deepEqual(footer, outcome({ country, sender, body: withoutFooter }));
  assert.equal(history({ country, sender, body: withFooter }).length, history({ country, sender, body: withoutFooter }).length);
  if (country === 'AE' && sender === 'EmiratesNBD') {
    assert.equal(footer?.type, 'expense', 'the Gulf debit posts');
    assert.equal(footer.amountFils, 64000);
  }
});
