'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const load = require('./load-ts.cjs').createLoader();
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { setActiveCountry } = load('@/lib/country');
const { setActiveMarket, setLedgerCurrency, detectLaunchMarketFromSender } = load('@/lib/markets');
const { currencyMinorUnits } = load('@/lib/currency-metadata');

// Wrong-post round 6. Each refusal below was BOOKED by the shipping capture
// paths: a credit limit or balance as the purchase amount, a cancelled /
// stopped / incomplete purchase as spending, an own-account move as spending,
// a credit-card settlement as income or a purchase, and a bare "دينار" as the
// ledger's dinar when the sender is another country's bank. Every body is
// synthetic text with fictional names, numbers and amounts. Each refusal is
// paired with the completed wording it must not disturb.
const observedAt = Date.parse('2026-10-12T12:00:00Z');

function session(country, ledger) {
  const exponent = currencyMinorUnits(ledger);
  setActiveCountry(country);
  setLedgerCurrency(ledger, exponent === 0 || exponent === 3 ? exponent : 2);
  setActiveMarket(country === 'AE' || country === 'SA' ? country : 'ZZ');
  return createLaunchAlertSession({ overrides: {}, pinnedCurrency: ledger, fxLookup: () => null,
    bestEffort: { enabled: true, country }, regionHint: country });
}
const ledgerOf = (row) => row.ledger ?? (row.country === 'AE' ? 'AED' : 'SAR');
// The Android SMS seam exactly as the launch evaluator drives it.
function android(row) {
  const reader = session(row.country, ledgerOf(row));
  const inspection = reader.inspect(row.body, row.sender);
  const launch = detectLaunchMarketFromSender(row.sender);
  return launch
    ? reader.parse(row.body, row.sender, inspection, launch, observedAt)
    : reader.parseUnproven(row.body, row.sender, inspection, observedAt);
}
// The iOS History path: the real senderless iPhone record.
function history(row) {
  const reader = session(row.country, ledgerOf(row));
  const record = { v: 1, id: createHash('sha256').update(`s6:${row.body}`).digest('hex'), text: row.body,
    receivedAt: new Date(observedAt).toISOString() };
  return parseHistoricalMessageRecords([JSON.stringify(record)], {}, new Date(observedAt), new Set(), reader).parsed;
}
const brief = (p) => p && { kind: p.kind, type: p.type, amount: p.amountFils, currency: p.currency, merchant: p.merchant,
  transfer: !!p.transferHint, side: p.cardPaymentSide };

// ── 1. A credit limit or balance is never the purchase amount ───────────────
const limitRows = [
  { id: 'a credit limit stated before the purchase', country: 'SA', sender: 'AlRajhiBank',
    body: 'حد ائتماني 20,000 ر.س. شراء 50 ر.س لدى نون بطاقة 1234' },
  { id: 'the definite credit limit before the purchase', country: 'SA', sender: 'AlRajhiBank',
    body: 'الحد الائتماني 20,000 ر.س. شراء 50 ر.س لدى نون بطاقة 1234' },
  { id: 'a credit limit on its own line before the purchase', country: 'SA', sender: 'AlRajhiBank',
    body: 'حد ائتماني 20,000 ر.س.\nشراء 50 ر.س\nلدى نون\nبطاقة 1234' },
  { id: 'the Al Rajhi field list with a limit field before the amount', country: 'SA', sender: 'AlRajhiBank',
    body: 'شراء\nالحد الائتماني: 20,000 ر.س\nمبلغ: 50 ر.س\nلدى: جرير' },
  { id: 'a bare balance opening the message', country: 'SA', sender: 'AlRajhiBank',
    body: 'رصيد 2,000 ر.س. خصم 50 ر.س لدى نون' },
];
for (const row of limitRows) {
  test(`limit/balance: ${row.id} books the 50, never the limit`, () => {
    for (const [path, parsed] of [['android', android(row)], ['history', history(row)[0]]]) {
      if (!parsed) continue;
      assert.equal(parsed.amountFils, 5000, `${path}: ${JSON.stringify(brief(parsed))}`);
      assert.equal(parsed.type, 'expense', path);
    }
    assert.equal(android(row)?.amountFils, 5000, 'the Android path keeps the purchase');
  });
}
test('limit/balance: an English balance sentence that LEADS with its figure is never the amount', () => {
  const row = { country: 'AE', sender: 'EmiratesNBD',
    body: 'AED 2,000.00 is your available balance. AED 50.00 was spent at NOON on your card 1234.' };
  for (const parsed of [android(row), ...history(row)]) {
    assert.ok(!parsed || parsed.amountFils === 5000, JSON.stringify(brief(parsed)));
  }
});
const limitControls = [
  { id: 'a purchase followed by its available limit', country: 'SA', sender: 'AlRajhiBank', minor: 5000,
    body: 'شراء 50 ر.س لدى نون بطاقة 1234. الحد الائتماني المتاح 20,000 ر.س' },
  { id: 'a field list with a balance field after the amount', country: 'SA', sender: 'AlRajhiBank', minor: 5000,
    body: 'شراء\nبطاقة: 1234\nمبلغ: 50 ر.س\nلدى: جرير\nالرصيد: 2,000 ر.س' },
  { id: 'an English purchase followed by its available balance', country: 'AE', sender: 'EmiratesNBD', minor: 5000,
    body: 'AED 50.00 was spent at NOON on your card 1234. Available balance is AED 2,000.00.' },
  { id: 'an English purchase whose figure is followed by "Avl Bal"', country: 'AE', sender: 'EmiratesNBD', minor: 5000,
    body: 'Purchase of AED 50.00 at NOON with card 1234. Avl Bal AED 2,000.00' },
];
for (const row of limitControls) {
  test(`limit/balance control: ${row.id} keeps its purchase`, () => {
    for (const parsed of [android(row), history(row)[0]]) {
      assert.equal(parsed?.amountFils, row.minor, JSON.stringify(brief(parsed)));
      assert.equal(parsed.type, 'expense');
    }
  });
}

// ── 2. Cancelled, stopped, suspended or incomplete is not spending ──────────
const notCompleted = [
  ['SA', 'AlRajhiBank', 'تم إلغاء عملية شراء بمبلغ 50 ر.س لدى نون'],
  ['SA', 'AlRajhiBank', 'تم إلغاء عملية شراء بمبلغ 50 ر.س لدى نون وسيتم إعادة المبلغ'],
  ['AE', 'ADCB', 'تم إلغاء عملية الشراء بمبلغ 50 درهم لدى نون'],
  ['SA', 'AlRajhiBank', 'إلغاء عملية\nشراء\nمبلغ: 50 ر.س\nلدى: نون'],
  ['SA', 'AlRajhiBank', 'تم إيقاف عملية شراء بمبلغ 50 ر.س لدى نون'],
  ['SA', 'AlRajhiBank', 'تم تعليق عملية شراء بمبلغ 50 ر.س لدى نون'],
  ['SA', 'AlRajhiBank', 'عملية غير ناجحة: شراء بمبلغ 50 ر.س لدى نون'],
  ['SA', 'AlRajhiBank', 'شراء\nمبلغ: 50 ر.س\nلدى: نون\nالعملية غير مكتملة'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at NOON with card 1234 was incomplete.'],
];
for (const [country, sender, body] of notCompleted) {
  test(`not completed: "${body.replace(/\n/g, ' / ').slice(0, 60)}" never posts`, () => {
    const row = { country, sender, body };
    assert.equal(android(row), null);
    assert.deepEqual(history(row), []);
  });
}
const completedControls = [
  ['SA', 'AlRajhiBank', 'شراء بمبلغ 50 ر.س لدى نون', 5000],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at NOON with card 1234 was successful.', 5000],
  // An offer to cancel is no status of the purchase it follows.
  ['SA', 'AlRajhiBank', 'شراء بمبلغ 50 ر.س لدى نون. لإلغاء العملية اتصل 8001234567', 5000],
  ['SA', 'AlRajhiBank', 'شراء بمبلغ 50 ر.س لدى نون. يمكنك إلغاء العملية من التطبيق', 5000],
  // An incomplete PROFILE says nothing about the purchase.
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at NOON with card 1234. Your profile is incomplete, update it in the app.', 5000],
];
for (const [country, sender, body, minor] of completedControls) {
  test(`completed control: "${body.slice(0, 60)}" keeps its purchase`, () => {
    const parsed = android({ country, sender, body });
    assert.equal(parsed?.amountFils, minor, JSON.stringify(brief(parsed)));
    assert.equal(parsed.type, 'expense');
  });
}

// ── 3. An own-account transfer is transfer-flagged, never spending ─────────
for (const body of [
  'You have transferred AED 500.00 to your own account 5678.',
  'Transfer of AED 500.00 to own account 5678 successful.',
]) {
  test(`own account: "${body}" is an own-account transfer`, () => {
    for (const parsed of [android({ country: 'AE', sender: 'EmiratesNBD', body }), ...history({ country: 'AE', body })]) {
      if (!parsed) continue;
      assert.equal(parsed.transferHint, true, JSON.stringify(brief(parsed)));
      assert.notEqual(parsed.merchant, 'Own');
    }
  });
}
test('own account control: a transfer to someone else\'s account stays an outgoing transfer', () => {
  const parsed = android({ country: 'AE', sender: 'EmiratesNBD', body: 'You have transferred AED 500.00 to account 5678.' });
  assert.equal(parsed?.type, 'expense');
  assert.equal(parsed.amountFils, 50000);
  assert.ok(!parsed.transferHint);
});

// ── 4. Paying a credit card is never income or a purchase ──────────────────
for (const body of [
  'Your credit card 1234 has been credited with AED 1,000.00. Available limit is AED 9,000.00.',
  'AED 1,000.00 credited to your credit card 1234.',
]) {
  test(`card settlement: "${body.slice(0, 50)}" is never income`, () => {
    for (const parsed of [android({ country: 'AE', sender: 'EmiratesNBD', body }), ...history({ country: 'AE', body })]) {
      assert.ok(!parsed || parsed.kind === 'cardPayment', JSON.stringify(brief(parsed)));
    }
  });
}
test('card settlement: "Card 1234 payment of … has been received" is the card\'s payment receipt', () => {
  const body = 'Card 1234 payment of AED 3,500.00 has been received. Thank you.';
  for (const parsed of [android({ country: 'AE', sender: 'EmiratesNBD', body }), ...history({ country: 'AE', body })]) {
    assert.equal(parsed?.kind, 'cardPayment', JSON.stringify(brief(parsed)));
    assert.equal(parsed.amountFils, 350000);
    assert.equal(parsed.cardPaymentSide, 'receipt');
  }
});
test('card settlement control: a bill paid WITH the card stays the bill', () => {
  const parsed = android({ country: 'AE', sender: 'EmiratesNBD',
    body: 'Card 1234 payment of AED 50.00 to DEWA has been received.' });
  assert.ok(!parsed || parsed.kind !== 'cardPayment', JSON.stringify(brief(parsed)));
});
for (const [body, minor, type] of [
  ['Your salary of AED 10,000.00 has been credited to your account 1234.', 1000000, 'income'],
  ['AED 1,000.00 credited to your account 1234.', 100000, 'income'],
  ['Refund of AED 50.00 has been credited to your credit card 1234.', 5000, 'income'],
  ['Your booking at SAMPLE AIR was cancelled and AED 1,200.00 has been credited to your Credit Card 4110.', 120000, 'income'],
  ['Purchase of AED 50.00 at NOON with credit card 1234. Available limit AED 9,000.00.', 5000, 'expense'],
]) {
  test(`card settlement control: "${body.slice(0, 50)}" keeps its ${type}`, () => {
    const parsed = android({ country: 'AE', sender: 'EmiratesNBD', body });
    assert.equal(parsed?.type, type, JSON.stringify(brief(parsed)));
    assert.equal(parsed.amountFils, minor);
    assert.equal(parsed.kind, 'transaction');
  });
}

// ── 5. A bare "دينار" names whose dinar only through its own bank's sender ──
const dinar = 'تم خصم 5.250 دينار من حسابك رقم XXXX1234 لدى SAMPLE SHOP';
for (const [country, ledger, sender] of [
  ['KW', 'KWD', 'ArabBank'], // a Jordanian bank on a Kuwaiti ledger
  ['KW', 'KWD', ''],
  ['BH', 'BHD', ''],
  ['BH', 'BHD', 'BBK'], // BBK operates in Bahrain AND Kuwait: its dinar is unproven
  ['KW', 'KWD', 'BBK'],
]) {
  test(`bare dinar: ${sender || 'no sender'} on a ${ledger} ledger waits in Review`, () => {
    const row = { country, ledger, sender, body: dinar };
    assert.equal(android(row), null);
    assert.deepEqual(history(row), []);
  });
}
test('bare dinar control: a Jordanian bank\'s own sender on a JOD ledger still posts JOD', () => {
  const parsed = android({ country: 'JO', ledger: 'JOD', sender: 'HBTF',
    body: 'بنك الإسكان: تم إيداع حوالة CliQ بمبلغ 75.000 دينار من AHMAD KHALED في حسابكم رقم ****1234 بتاريخ 20/09/2026. الرصيد المتوفر 587.300 دينار' });
  assert.equal(parsed?.currency, 'JOD', JSON.stringify(brief(parsed)));
  assert.equal(parsed.amountFils, 75000);
  assert.equal(parsed.type, 'income');
});
test('bare dinar control: an explicit "د.ك" on a KWD ledger still posts', () => {
  const parsed = android({ country: 'KW', ledger: 'KWD', sender: 'NBK',
    body: 'تم خصم 5.250 د.ك من حسابك رقم XXXX1234 لدى SAMPLE SHOP' });
  assert.equal(parsed?.currency, 'KWD', JSON.stringify(brief(parsed)));
  assert.equal(parsed.amountFils, 5250);
});

// ── Round 7 ────────────────────────────────────────────────────────────────
// 1. Limit/balance synonyms, and the structural rule for unseen wordings: two
// distinct figures where the booked one is not proven by its own clause.
const r7Limits = ['سقف البطاقة', 'حد البطاقة', 'الحد الائتماني المتبقي', 'الحد المتبقي', 'رصيدكم', 'رصيد الحساب',
  'رصيد متاح', 'المبلغ المتوفر'];
for (const label of r7Limits) {
  test(`round 7 limit: "${label} 20,000 ر.س" before a purchase books the 50`, () => {
    const row = { country: 'SA', sender: 'AlRajhiBank', body: `${label} 20,000 ر.س. شراء 50 ر.س لدى نون بطاقة 1234` };
    for (const parsed of [android(row), ...history(row)]) {
      assert.ok(!parsed || parsed.amountFils === 5000, JSON.stringify(brief(parsed)));
    }
  });
}
for (const body of [
  'AED 2,000.00 available balance. AED 50.00 was spent at NOON on your card 1234.',
  'AED 2,000.00 remains your available balance. AED 50.00 was spent at NOON on your card 1234.',
  'AED 20,000.00 is your credit line. AED 50.00 was spent at NOON on your card 1234.',
  'AED 20,000.00 limit available. AED 50.00 was spent at NOON on your card 1234.',
  'Credit line AED 20,000.00. AED 50.00 was spent at NOON on your card 1234.',
  // An unseen label: the structural rule, not a synonym, refuses the 20,000.
  'AED 20,000.00 headroom remains. AED 50.00 was spent at NOON on your card 1234.',
  'سعة البطاقة 20,000 ر.س. شراء 50 ر.س لدى نون بطاقة 1234',
]) {
  test(`round 7 limit: "${body.slice(0, 48)}" never books the larger figure`, () => {
    const country = /AED/.test(body) ? 'AE' : 'SA';
    const row = { country, sender: country === 'AE' ? 'EmiratesNBD' : 'AlRajhiBank', body };
    for (const parsed of [android(row), ...history(row)]) {
      assert.ok(!parsed || parsed.amountFils === 5000, JSON.stringify(brief(parsed)));
    }
  });
}
for (const [country, sender, body, minor, type] of [
  ['SA', 'AlRajhiBank', 'شراء بمبلغ 50 ر.س لدى نون', 5000, 'expense'],
  ['SA', 'AlRajhiBank', 'شراء 50 ر.س لدى نون بطاقة 1234. الرصيد المتاح 2,000 ر.س', 5000, 'expense'],
  ['AE', 'EmiratesNBD', 'Purchase of AED 50.00 at NOON with card 1234. Available balance AED 2,000.00', 5000, 'expense'],
  ['AE', 'EmiratesNBD', 'Your Debit Card ending 4321 was used for AED 45.00 at SAMPLE CAFE on 05/10/2026. Avl bal AED 5,000.00.', 4500, 'expense'],
  ['AE', 'EmiratesNBD', 'Your salary of AED 10,000.00 has been credited to your account 1234. Available balance AED 12,000.00', 1000000, 'income'],
  ['SA', 'AlRajhiBank', 'Outward transfer (SARIE)\n1000.00 SAR\nTo SAMPLE NAME\nTo SAMPLE BANK\nAccount *666\nFees 1.15 SAR\n06/02/26 04:19\nRef. No. *0BBB', 100000, 'expense'],
  ['SA', 'AlRajhiBank', 'خصم رسوم\nرسوم: 0.58 ريال\nعلى حوالة بمبلغ 500 ريال', 58, 'expense'],
]) {
  test(`round 7 control: "${body.slice(0, 48).replace(/\n/g, ' / ')}" keeps its ${minor}`, () => {
    const parsed = android({ country, sender, body });
    assert.equal(parsed?.amountFils, minor, JSON.stringify(brief(parsed)));
    assert.equal(parsed.type, type);
  });
}
// 2. More cancelled / incomplete wordings.
for (const [country, sender, body] of [
  ['SA', 'AlRajhiBank', 'ألغيت عملية الشراء بمبلغ 50 ر.س لدى نون'],
  ['SA', 'AlRajhiBank', 'تم إلغاء الحركة: شراء بمبلغ 50 ر.س لدى نون'],
  ['SA', 'AlRajhiBank', 'عملية لم تكتمل: شراء بمبلغ 50 ر.س لدى نون'],
  ['AE', 'EmiratesNBD', 'Incomplete purchase of AED 50.00 at NOON with card 1234.'],
]) {
  test(`round 7 not completed: "${body.slice(0, 48)}" never posts`, () => {
    assert.equal(android({ country, sender, body }), null);
    assert.deepEqual(history({ country, body }), []);
  });
}
// 3. An Arabic credit into a credit card is never income.
test('round 7 card credit: "تم إيداع … في بطاقتك الائتمانية" is never income', () => {
  const body = 'تم إيداع 1,000 ر.س في بطاقتك الائتمانية 1234';
  for (const parsed of [android({ country: 'SA', sender: 'AlRajhiBank', body }), ...history({ country: 'SA', body })]) {
    assert.ok(!parsed || parsed.type !== 'income' || parsed.kind === 'cardPayment', JSON.stringify(brief(parsed)));
  }
});
test('round 7 card credit control: a deposit into the account stays income', () => {
  const parsed = android({ country: 'SA', sender: 'AlRajhiBank', body: 'تم إيداع 1,000 ر.س في حسابك 1234' });
  assert.equal(parsed?.type, 'income');
  assert.equal(parsed.amountFils, 100000);
});
// 4. Footer offers to cancel/stop/suspend never withdraw the purchase they follow.
for (const footer of ['يرجى إيقاف العملية', 'الرجاء إلغاء العملية', 'للإبلاغ أو إلغاء العملية اتصل 8001234567',
  'أرسل 1 إلغاء العملية', 'ايقاف الشراء عبر الانترنت متاح', 'خدمة تعليق الشراء الدولي',
  'سيتم إيقاف الشراء عبر الانترنت بعد 3 محاولات', 'إذا لم تقم بهذه العملية يرجى إيقاف العملية']) {
  test(`round 7 footer: "${footer}" keeps the purchase`, () => {
    const row = { country: 'SA', sender: 'AlRajhiBank', body: `شراء بمبلغ 50 ر.س لدى نون. ${footer}` };
    assert.equal(android(row)?.amountFils, 5000);
    assert.equal(history(row)[0]?.amountFils, 5000);
  });
}
// 5. "incomplete" must attach to the transaction, not a profile.
test('round 7: an incomplete payment PROFILE keeps the completed payment', () => {
  const parsed = android({ country: 'AE', sender: 'EmiratesNBD',
    body: 'Payment of AED 50.00 at NOON with card 1234 successful. Your payment profile is incomplete.' });
  assert.equal(parsed?.amountFils, 5000);
});
// 6. Kuwait's largest banks' own sender IDs prove a bare Arabic dinar.
// NBK is a shared brand (also the National Bank of Kenya), which is why the
// registry asks for KWD evidence; a Kenyan bank never writes "دينار", so the
// Arabic word from that exact sender ID is Kuwaiti.
for (const sender of ['KFH', 'NBK']) {
  test(`round 7 dinar: ${sender} on a KWD ledger posts 5.250 KWD`, () => {
    const parsed = android({ country: 'KW', ledger: 'KWD', sender, body: dinar });
    assert.equal(parsed?.currency, 'KWD', JSON.stringify(brief(parsed)));
    assert.equal(parsed.amountFils, 5250);
    assert.deepEqual(history({ country: 'KW', ledger: 'KWD', body: dinar }), [], 'senderless History still waits');
  });
}
test('round 7 dinar control: NBK on a JOD ledger is a Kuwaiti dinar, never booked as JOD', () => {
  assert.equal(android({ country: 'JO', ledger: 'JOD', sender: 'NBK', body: dinar }), null);
});
test('round 7 dinar control: NBK with an English Kenyan alert is not Kuwaiti money', () => {
  const parsed = android({ country: 'KW', ledger: 'KWD', sender: 'NBK', body: 'KES 5,250.00 debited from your account 1234 at SAMPLE SHOP' });
  assert.ok(!parsed || parsed.currency !== 'KWD' || parsed.originalCurrency === 'KES', JSON.stringify(brief(parsed)));
});

// ── Round 8 ────────────────────────────────────────────────────────────────
const sa = (body) => ({ country: 'SA', sender: 'AlRajhiBank', body });
const ae = (body) => ({ country: 'AE', sender: 'EmiratesNBD', body });
const neverPosts = (name, row) => test(`round 8 never posts: ${name}`, () => {
  const parsed = android(row);
  assert.equal(parsed, null, JSON.stringify(brief(parsed)));
  assert.deepEqual(history(row), []);
});
// H1. A status that is its clause's own verb still vetoes; a pending
// cancellation of this amount is no posting.
neverPosts('"تم إلغاء العملية، يرجى التواصل معنا" before the purchase', sa('تم إلغاء العملية، يرجى التواصل معنا. شراء 50 ر.س لدى نون بطاقة 1234'));
neverPosts('"سيتم إلغاء عملية الشراء بمبلغ …"', sa('سيتم إلغاء عملية الشراء بمبلغ 50 ر.س لدى نون وإعادة المبلغ'));
// W1. Aggregate, period and cumulative figures are never the movement.
for (const body of [
  'Total spent this month AED 2,000.00. Purchase of AED 50.00 at NOON with card 1234.',
  'This month you have spent AED 2,000.00. Purchase of AED 50.00 at NOON with card 1234.',
  'Purchases this cycle: AED 2,000.00; this purchase AED 50.00 at NOON with card 1234.',
  'Spent so far AED 2,000.00 of your AED 5,000.00 budget. Purchase of AED 50.00 at NOON with card 1234.',
  'Your balance was debited to AED 2,000.00 after a purchase of AED 50.00 at NOON with card 1234.',
]) {
  test(`round 8 aggregate: "${body.slice(0, 44)}" never books the larger figure`, () => {
    for (const parsed of [android(ae(body)), ...history(ae(body))]) assert.ok(!parsed || parsed.amountFils === 5000, JSON.stringify(brief(parsed)));
  });
}
test('round 8 aggregate: a daily withdrawal allowance is never the withdrawal', () => {
  const row = ae('Your daily withdrawal allowance is AED 5,000.00. Withdrawn AED 500.00 at ATM with card 1234.');
  for (const parsed of [android(row), ...history(row)]) assert.ok(!parsed || parsed.amountFils === 50000, JSON.stringify(brief(parsed)));
});
for (const [name, body, bad] of [
  ['the amount left of the limit', '5000 ر.س المتبقي من الحد 50 ر.س شراء لدى نون', 500000],
  ['a debit from the monthly purchase limit', 'تم خصم مبلغ 2000 ر.س من حد الشراء الشهري. شراء 50 ر.س لدى نون', 200000],
]) {
  test(`round 8 aggregate: ${name} is never booked`, () => {
    for (const parsed of [android(sa(body)), ...history(sa(body))]) assert.ok(!parsed || parsed.amountFils !== bad, JSON.stringify(brief(parsed)));
  });
}
test('round 8: an instalment conversion never books the converted total as fresh spending', () => {
  const row = ae('Your purchase of AED 3,000.00 at NOON has been split into 12 payments of AED 250.00. First instalment of AED 250.00 charged to card 1234.');
  for (const parsed of [android(row), ...history(row)]) assert.ok(!parsed || parsed.amountFils !== 300000, JSON.stringify(brief(parsed)));
});
// W2. A foreign principal never lets an unproven local figure be booked.
neverPosts('a USD purchase with "AED 20,000.00 spending room left"', ae('Purchase of USD 100.00 at AMAZON US on card 1234. AED 20,000.00 spending room left.'));
neverPosts('"الحد المسموح ٢٠٠٠٠ ر.س" before a USD purchase', sa('الحد المسموح ٢٠٠٠٠ ر.س. شراء دولي USD 20 لدى AMAZON بطاقة 1234'));
// W3. More cancelled / void / incomplete wordings.
neverPosts('"… لم تكتمل، يرجى المحاولة مرة أخرى"', sa('عملية شراء بمبلغ 50 ر.س لدى نون لم تكتمل، يرجى المحاولة مرة أخرى'));
neverPosts('a trailing "تم الإلغاء" line', sa('شراء بمبلغ 50 ر.س لدى نون\nتم الإلغاء'));
neverPosts('"cancelled by merchant"', ae('Purchase of AED 50.00 at NOON with card 1234 cancelled by merchant. Call 600 if you need help.'));
neverPosts('a trailing "- VOID"', ae('Purchase of AED 50.00 at NOON with card 1234 - VOID'));
neverPosts('an authorisation that "will be cancelled"', ae('Authorisation of AED 50.00 at NOON on card 1234 will be cancelled.'));
// W4. A credit INTO a credit card is never spending.
neverPosts('"تم إضافة 50 ر.س إلى بطاقتك الائتمانية 1234 من نون"', sa('تم إضافة 50 ر.س إلى بطاقتك الائتمانية 1234 من نون'));
// H2. Only a bare or Kuwaiti-qualified dinar resolves to KWD through NBK/KFH.
for (const adjective of ['ليبي', 'جزائري', 'تونسي', 'صربي']) {
  neverPosts(`NBK "دينار ${adjective}" on a KWD ledger`, { country: 'KW', ledger: 'KWD', sender: 'NBK',
    body: `عملية شراء بمبلغ 12.500 دينار ${adjective} لدى SAMPLE SHOP من حسابك رقم XXXX1234` });
}
test('round 8 dinar control: NBK "دينار كويتي" posts KWD', () => {
  const parsed = android({ country: 'KW', ledger: 'KWD', sender: 'NBK', body: 'تم خصم 5.250 دينار كويتي من حسابك رقم XXXX1234 لدى SAMPLE SHOP' });
  assert.equal(parsed?.currency, 'KWD');
  assert.equal(parsed.amountFils, 5250);
});
// Controls: what must keep posting exactly as before.
for (const [name, row, minor, type] of [
  ['a single-amount purchase', sa('شراء بمبلغ 50 ر.س لدى نون'), 5000, 'expense'],
  ['a purchase with a trailing available balance', ae('Purchase of AED 50.00 at NOON with card 1234. Available balance AED 2,000.00'), 5000, 'expense'],
  ['a purchase label then "Available balance AED …"', ae('Purchase AED 50.00 Available balance AED 2,000.00'), 5000, 'expense'],
  ['an FX purchase with its local equivalent', ae('Purchase of USD 100.00 (AED 367.30) at AMAZON US with card 1234. Available balance AED 2,000.00'), 36730, 'expense'],
  ['an ATM withdrawal with its balance', ae('Cash withdrawal of AED 500.00 at ATM with card 1234. Avl bal AED 4,500.00'), 50000, 'expense'],
  ['an SNB field list with "بـ:" and "القيمة المتاحة"', { country: 'SA', sender: 'SNB', body: 'شراء عبر نقاط البيع\nبطاقة: 1234\nبـ:88.40 SAR\nلدى: SAMPLE\nالقيمة المتاحة:1204.10 SAR' }, 8840, 'expense'],
  ['a purchase with a "to cancel … call" footer', ae('Purchase of AED 50.00 at NOON with card 1234. To cancel this transaction call 600 000000.'), 5000, 'expense'],
  ['a purchase with "يرجى إلغاء العملية إذا لم تقم بها"', sa('شراء بمبلغ 50 ر.س لدى نون. يرجى إلغاء العملية إذا لم تقم بها'), 5000, 'expense'],
  ['a merchant called VOID STUDIO', ae('Purchase of AED 50.00 at VOID STUDIO with card 1234.'), 5000, 'expense'],
  ['a refund credited to a credit card', ae('Refund of AED 50.00 from NOON has been credited to your credit card 1234.'), 5000, 'income'],
]) {
  test(`round 8 control: ${name} keeps ${minor}`, () => {
    const parsed = android(row);
    assert.equal(parsed?.amountFils, minor, JSON.stringify(brief(parsed)));
    assert.equal(parsed.type, type);
  });
}

// ── Round 9 ────────────────────────────────────────────────────────────────
const { inspectSourceFreeRefusedAlert } = load('@/lib/auto-import');
// The refusal path both platforms take after the parser declines to post.
function refusal(row, sender = row.sender ?? '') {
  const reader = session(row.country, ledgerOf(row));
  return inspectSourceFreeRefusedAlert({ source: row.body, sender, observedAt, channel: 'inbox', session: reader }).kind;
}
// L1. A "what is left" label on the NEXT line describes the next figure.
for (const [body, minor, sender] of [
  ['شراء\nمبلغ: 50 SAR\nالمتاح من الحد: 9950 SAR', 5000],
  ['شراء\nمبلغ: 50 SAR\nالمتبقي من الحد اليومي: 9950 SAR', 5000],
  ['شراء\nمبلغ: 50 SAR\nالمتاحة للشراء: 9950 SAR', 5000],
  ['سحب صراف\nمبلغ: 500 SAR\nالمتاح للسحب اليومي: 4500 SAR', 50000],
  ['شراء عبر نقاط البيع\nبطاقة: 1234\nبـ:88.40 SAR\nالمتاح للصرف:5000 SAR', 8840, 'SNB'],
  ['شراء\nمبلغ: 50 SAR المتاح: 1500 SAR', 5000],
]) {
  test(`round 9 next-line label: "${body.replace(/\n/g, ' / ').slice(0, 44)}" posts ${minor}`, () => {
    const row = { country: 'SA', sender: sender ?? 'AlRajhiBank', body };
    assert.equal(android(row)?.amountFils, minor, JSON.stringify(brief(android(row))));
    assert.equal(history(row)[0]?.amountFils, minor);
  });
}
for (const [body, minor] of [
  ['Withdrawal of AED 500.00\nAvailable to withdraw today AED 4,500.00', 50000],
  ['Purchase of AED 50.00\nLeft to spend AED 9,950.00', 5000],
]) {
  test(`round 9 next-line label: "${body.replace(/\n/g, ' / ').slice(0, 44)}" posts ${minor}`, () => {
    assert.equal(android(ae(body))?.amountFils, minor);
    assert.equal(history(ae(body))[0]?.amountFils, minor);
  });
}
// Policy: a structural refusal of a completed-looking movement reaches Review
// on both platforms (with the sender, and senderless as iPhone History).
for (const [name, row] of [
  ['a daily allowance beside a withdrawal', ae('Your daily withdrawal allowance is AED 5,000.00. Withdrawn AED 500.00 at ATM with card 1234.')],
  ['what is left of the limit', sa('5000 ر.س المتبقي من الحد 50 ر.س شراء لدى نون')],
  ['a debit from the monthly limit', sa('تم خصم مبلغ 2000 ر.س من حد الشراء الشهري. شراء 50 ر.س لدى نون')],
  ['an instalment conversion', ae('Your purchase of AED 3,000.00 at NOON has been split into 12 payments of AED 250.00. First instalment of AED 250.00 charged to card 1234.')],
  ['a credit into a credit card read as spending', sa('تم إضافة 50 ر.س إلى بطاقتك الائتمانية 1234 من نون')],
  ['a deposit into a credit card', sa('تم إيداع 1,000 ر.س في بطاقتك الائتمانية 1234')],
  ['an unseen balance label', ae('AED 20,000.00 xyzzy plugh. AED 50.00 was spent at NOON on your card 1234.')],
  ['a hedged figure', ae('Purchase of AED 50.00 (approx.) at NOON with card 1234')],
  ['an "APPROX" figure', ae('Your card 1234 was used FOR APPROX AED 50.00 at NOON')],
]) {
  test(`round 9 review: ${name} never posts and reaches Review on both paths`, () => {
    assert.equal(android(row), null);
    assert.deepEqual(history(row), []);
    assert.equal(refusal(row), 'review', 'with sender');
    assert.equal(refusal(row, ''), 'review', 'senderless');
  });
}
test('round 9 review control: a genuine cancel stays silent (declined, not Review)', () => {
  assert.equal(refusal(sa('تم إلغاء عملية شراء بمبلغ 50 ر.س لدى نون')), 'declined');
});
// L2. A reference amount and an aggregate never block the movement.
test('round 9: "Refund of AED 20.00 for your purchase of AED 50.00" posts the 20 refund', () => {
  const parsed = android(ae('Refund of AED 20.00 for your purchase of AED 50.00 at NOON has been credited to your card 1234.'));
  assert.equal(parsed?.amountFils, 2000);
  assert.equal(parsed.type, 'income');
});
test('round 9: "AED 3,000.00 can still be withdrawn today" never blocks the 2,000 withdrawal', () => {
  const parsed = android(ae('AED 2,000.00 withdrawn from your account 1234 at ATM. AED 3,000.00 can still be withdrawn today.'));
  assert.equal(parsed?.amountFils, 200000);
});
test('round 9: "spent AED 3,000.00 of your AED 5,000.00 limit" never blocks the 50 purchase', () => {
  const parsed = android(ae('Purchase of AED 50.00 at NOON with card 1234. You have spent AED 3,000.00 of your AED 5,000.00 limit.'));
  assert.equal(parsed?.amountFils, 5000);
});
// W1. A purchase that "has been refunded" is a refund, never spending.
for (const [name, row, merchant] of [
  ['English', ae('Your purchase of AED 50.00 at NOON has been refunded. Card 1234'), 'Noon'],
  ['Arabic', sa('عملية شراء بمبلغ 50 ر.س لدى نون تم استردادها'), 'نون'],
]) {
  test(`round 9 refund: the ${name} "has been refunded" purchase is income`, () => {
    const parsed = android(row);
    assert.equal(parsed?.type, 'income', JSON.stringify(brief(parsed)));
    assert.equal(parsed.amountFils, 5000);
    assert.equal(parsed.merchant, merchant);
    for (const p of history(row)) assert.notEqual(p.type, 'expense');
  });
}
test('round 9 refund control: "will be refunded" is no refund yet', () => {
  for (const parsed of [android(ae('Your purchase of AED 50.00 at NOON will be refunded within 5 days. Card 1234'))]) {
    assert.ok(!parsed || parsed.type !== 'expense', JSON.stringify(brief(parsed)));
  }
});
// W2. More cancelled forms.
for (const body of ['عملية شراء بمبلغ 50 ر.س لدى نون، تم إلغاؤها', 'عملية شراء بمبلغ 50 ر.س لدى نون تم إلغاؤها',
  'عملية شراء بمبلغ 50 ر.س لدى نون تم إلغاؤه', 'عملية شراء بمبلغ 50 ر.س لدى نون تم إلغائها',
  'شراء ملغي بمبلغ 50 ر.س لدى نون', 'شراء ملغى بمبلغ 50 ر.س لدى نون']) {
  neverPosts(`"${body}"`, sa(body));
}
for (const body of ['Purchase of AED 50.00 at NOON with card 1234, cancelled', 'Purchase of AED 50.00 at NOON with card 1234: cancelled',
  'Purchase of AED 50.00 at NOON with card 1234 (cancelled)', 'Purchase of AED 50.00 at NOON with card 1234 - cancelled']) {
  neverPosts(`"${body}"`, ae(body));
}
test('round 9 control: a merchant called CANCELLED CAFE keeps the purchase', () => {
  assert.equal(android(ae('Purchase of AED 50.00 at CANCELLED CAFE with card 1234'))?.amountFils, 5000);
});
test('round 9 control: an exact figure stated again with "approx." keeps the purchase', () => {
  const parsed = android(ae('Purchase of AED 100.00 at SAMPLE ELECTRONICS with Credit Card ending 4417. Amount: USD 27.23 or AED 100.00 approx.'));
  assert.equal(parsed?.amountFils, 10000);
});

// ── Round 10 ───────────────────────────────────────────────────────────────
// 1. A refund noun governing the booked figure is money IN; the purchase it
// names is a reference. Not-yet refunds post nothing.
for (const body of [
  'A refund of AED 20.00 for your purchase of AED 50.00 at NOON has been processed to your card ending 1234.',
  'A refund of AED 20.00 for your purchase of AED 50.00 at NOON has been posted to your card ending 1234.',
  'A refund of AED 20.00 for your purchase of AED 50.00 at NOON has been received on your card ending 1234.',
]) {
  test(`round 10 refund: "${body.slice(0, 50)}…" is income 20`, () => {
    for (const parsed of [android(ae(body)), ...history(ae(body))]) {
      assert.equal(parsed?.type, 'income', JSON.stringify(brief(parsed)));
      assert.equal(parsed.amountFils, 2000);
    }
  });
}
for (const [country, body] of [
  ['SA', 'تم إيداع مبلغ استرداد 20 ر.س لعملية الشراء بمبلغ 50 ر.س لدى نون'],
  ['SA', 'استرداد مبلغ 20 ر.س لعملية الشراء بمبلغ 50 ر.س لدى نون'],
]) {
  test(`round 10 refund: "${body}" is income 20`, () => {
    const row = { country, sender: 'AlRajhiBank', body };
    const parsed = android(row);
    assert.equal(parsed?.type, 'income', JSON.stringify(brief(parsed)));
    assert.equal(parsed.amountFils, 2000);
    for (const p of history(row)) assert.notEqual(p.type, 'expense');
  });
}
neverPosts('a refund that "has been initiated"', ae('A refund of AED 20.00 for your purchase of AED 50.00 at NOON has been initiated.'));
neverPosts('a refund that "is under process"', ae('A refund of AED 20.00 for your purchase of AED 50.00 at NOON is under process.'));
neverPosts('a refund "قيد المعالجة"', sa('استرداد مبلغ 20 ر.س لعملية الشراء بمبلغ 50 ر.س لدى نون قيد المعالجة'));
test('round 10 refund control: a refund PAID OUT keeps its debit', () => {
  const parsed = android(ae('Refund of AED 50.00 to NOON debited from your card 1234.'));
  assert.equal(parsed?.type, 'expense', JSON.stringify(brief(parsed)));
});
// 2. A conditional, future or other-transaction refund never flips this purchase.
for (const [row, name] of [
  [ae('Purchase of AED 50.00 with card 1234 at NOON. If your purchase is refunded, it will reflect in 5-7 days.'), 'a conditional refund footer'],
  [ae('Purchase of AED 50.00 with card 1234 at NOON, the earlier transaction was refunded'), 'an earlier transaction refunded'],
  [sa('شراء بمبلغ 50 ر.س لدى نون\nعملية شراء سابقة تم استردادها'), 'a previous purchase refunded'],
]) {
  test(`round 10: ${name} keeps the purchase as spending`, () => {
    const parsed = android(row);
    assert.equal(parsed?.type, 'expense', JSON.stringify(brief(parsed)));
    assert.equal(parsed.amountFils, 5000);
  });
}
// 3. A card security footer ("…بإيقاف بطاقتك او تعليقها") never cancels the purchase.
for (const footer of ['في حال عدم معرفتك بالعملية بادر بإيقاف بطاقتك او تعليقها',
  'في حال عدم معرفتك بالعملية بادر بإيقاف بطاقتك او ايقافها من التطبيق', 'لإيقاف البطاقة او تعليقه اتصل 8001234567']) {
  test(`round 10 footer: "${footer.slice(0, 40)}" keeps the purchase`, () => {
    const row = sa(`شراء\nمبلغ: 50 ر.س\nلدى: نون\n${footer}`);
    assert.equal(android(row)?.amountFils, 5000);
    assert.equal(history(row)[0]?.amountFils, 5000);
  });
}
// Controls: a genuine pronoun cancel still cancels; a single-amount refunded purchase is still income.
neverPosts('"… لدى نون تم إلغاؤها" (control)', sa('عملية شراء بمبلغ 50 ر.س لدى نون تم إلغاؤها'));
test('round 10 control: "has been refunded" with one figure stays income', () => {
  const parsed = android(ae('Your purchase of AED 50.00 at NOON has been refunded. Card 1234'));
  assert.equal(parsed?.type, 'income');
  assert.equal(parsed.amountFils, 5000);
});

// ── Round 11 ───────────────────────────────────────────────────────────────
// 1. A refund that has not arrived posts nothing, whichever direction the
// grammar first read; money that is expected waits in Review.
for (const [name, row, wantReview] of [
  ['"is under process"', ae('Refund of AED 125.00 from NOON is under process.'), true],
  ['"is pending"', ae('Refund of AED 125.00 from NOON is pending.'), true],
  ['"has been initiated"', ae('Refund of AED 125.00 from NOON has been initiated.'), true],
  ['"approved … will reflect"', ae('Refund of AED 125.00 approved. It will reflect in 5-7 days.'), true],
  ['"has been initiated to your card ending 1234"', ae('Dear Customer, refund of AED 125.00 from NOON has been initiated to your card ending 1234'), true],
  ['a cancelled refund', ae('Refund of AED 125.00 from NOON has been cancelled.'), false],
  ['"استرداد مبلغ … قيد المعالجة"', sa('استرداد مبلغ 150.00 ريال قيد المعالجة لدى نون'), false],
  ['"طلب استرداد … قيد المعالجة"', sa('طلب استرداد مبلغ 150.00 ريال لدى نون قيد المعالجة'), false],
]) {
  test(`round 11 refund not yet: ${name} never posts`, () => {
    assert.equal(android(row), null, JSON.stringify(brief(android(row))));
    assert.deepEqual(history(row), []);
    if (wantReview) assert.equal(refusal(row), 'review');
  });
}
test('round 11: Chase "Your refund … has been initiated" never posts', () => {
  const row = { country: 'US', ledger: 'USD', sender: 'Chase', body: 'Chase: Your refund of $45.99 from AMAZON has been initiated' };
  assert.equal(android(row), null);
  assert.deepEqual(history(row), []);
});
// 2. A chargeback DEBIT is never income.
for (const body of ['Chargeback of AED 300.00 has been debited from your account 1234.',
  'AED 300.00 debited from your account 1234 as chargeback reversal.']) {
  test(`round 11 chargeback debit: "${body.slice(0, 48)}" is never income`, () => {
    for (const parsed of [android(ae(body)), ...history(ae(body))]) {
      assert.ok(!parsed || parsed.type === 'expense', JSON.stringify(brief(parsed)));
    }
  });
}
// Controls.
for (const [name, row, minor, type] of [
  ['a credited refund', ae('Refund of AED 125.00 from NOON has been credited to your card 1234.'), 12500, 'income'],
  ['a processed refund', ae('Refund of AED 125.00 from NOON has been processed to your card ending 1234.'), 12500, 'income'],
  ['a chargeback credited', ae('Chargeback of AED 300.00 has been credited to your account 1234.'), 30000, 'income'],
  ['a refund fee debit', ae('Refund fee of AED 5.00 has been debited from your account 1234.'), 500, 'expense'],
  ['a refund paid out', ae('Refund of AED 50.00 to NOON debited from your card 1234.'), 5000, 'expense'],
  ['"تم إيداع مبلغ استرداد"', sa('تم إيداع مبلغ استرداد 150.00 ريال لدى نون'), 15000, 'income'],
  ['"has been refunded"', ae('Your purchase of AED 50.00 at NOON has been refunded. Card 1234'), 5000, 'income'],
  ['a refund for a cancelled order', ae("We've issued your refund of 58.89 AED for your cancelled order."), 5889, 'income'],
]) {
  test(`round 11 control: ${name} keeps ${type} ${minor}`, () => {
    const parsed = android(row);
    assert.equal(parsed?.type, type, JSON.stringify(brief(parsed)));
    assert.equal(parsed.amountFils, minor);
  });
}
test('round 11 control: Chase "refund … credited" still posts', () => {
  const parsed = android({ country: 'US', ledger: 'USD', sender: 'Chase', body: 'Chase: Your refund of $45.99 from AMAZON has been credited to your account ending 1234' });
  assert.ok(!parsed || parsed.type === 'income', JSON.stringify(brief(parsed)));
});
