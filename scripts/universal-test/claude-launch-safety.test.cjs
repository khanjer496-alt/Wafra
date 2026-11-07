'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-ts.cjs').createLoader();
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseSms, nonPostingReason } = load('@/lib/sms-parser');
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
const { interpretBankAlert } = load('@/lib/bank-alert-interpreter');
const { buildImportPlan } = load('@/lib/import-plan');
const { materializeImportBatch, applyMaterializedImportBatch } = load('@/lib/ledger-import');
const { isIncome, isSpending } = load('@/lib/ledger');
const { setActiveCountry } = load('@/lib/country');
const { setActiveMarket, setLedgerCurrency } = load('@/lib/markets');
const observedAt = Date.parse('2026-10-12T12:00:00Z');

function readerWithBroadMoneyCount() {
  const fs = require('node:fs');
  const path = require('node:path');
  const ts = require('typescript');
  const dependency = require('./load-ts.cjs').createLoader();
  const money = dependency('@/lib/universal-money');
  let broadReads = 0;
  const file = path.resolve(__dirname, '../../src/lib/sms-parser.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(request => {
    if (request === '@/lib/universal-money') {
      return { ...money, extractUniversalMoney(...args) { broadReads++; return money.extractUniversalMoney(...args); } };
    }
    return dependency(request);
  }, module, module.exports);
  return { parseSms: module.exports.parseSms, dependency, broadReads: () => broadReads };
}

// Synthetic regressions recovered from Claude's unmerged launch-safety work.
// Exercise both the mature grammar and the actual Android launch seam.
function readers(body, country = 'AE') {
  const currency = country === 'SA' ? 'SAR' : 'AED';
  const sender = country === 'SA' ? 'AlRajhiBank' : 'EmiratesNBD';
  setActiveCountry(country); setActiveMarket(country); setLedgerCurrency(currency, 2);
  const reader = createLaunchAlertSession({ overrides: {}, pinnedCurrency: currency,
    regionHint: country, fxLookup: () => null, bestEffort: { enabled: true, country } });
  const interpretation = interpretBankAlert({ source: body, sender, market: country, observedAt });
  return [parseSms(body, {}, { sender, observedAt }),
    interpretation.outcome === 'parsed' ? interpretation.parsed : null,
    reader.parse(body, sender, reader.inspect(body, sender), country, observedAt)];
}

for (const body of [
  'حد ائتماني 20,000 ر.س. شراء 50 ر.س لدى نون بطاقة 1234',
  'الحد الائتماني 20,000 ر.س. شراء 50 ر.س لدى نون بطاقة 1234',
  'حد ائتماني 20,000 ر.س.\nشراء 50 ر.س\nلدى نون\nبطاقة 1234',
  'رصيد 2,000 ر.س. خصم 50 ر.س لدى نون',
]) test(`a labelled limit/balance cannot become principal: ${body.slice(0, 35)}`, () => {
  for (const parsed of readers(body, 'SA')) assert.equal(parsed?.amountFils, 5000);
});

for (const body of [
  'You have transferred AED 500.00 to your own account 5678.',
  'Transfer of AED 500.00 to own account 5678 successful.',
  'Card 1234 payment of AED 3,500.00 has been received.',
]) test(`an unproved transfer/settlement cannot become fresh spending: ${body.slice(0, 45)}`, () => {
  for (const parsed of readers(body)) assert.ok(!parsed || parsed.transferHint || parsed.kind === 'cardPayment');
});

for (const [body, country] of [
  ['Your credit card 1234 has been credited with AED 1,000.00.', 'AE'],
  ['AED 1,000.00 credited to your credit card 1234.', 'AE'],
  ['تم إيداع 1,000 ر.س في بطاقتك الائتمانية 1234', 'SA'],
]) test(`a card-side credit stays outside confirmed income/spending totals: ${body.slice(0, 45)}`, () => {
  const currency = country === 'SA' ? 'SAR' : 'AED';
  const parsed = readers(body, country)[2];
  const state = { hydrated: true, privateMode: true, marketId: country,
    ledgerMoney: { schemaVersion: 2, currency, exponent: 2 }, accounts: [], transactions: [],
    cardDues: [], budgets: [], bills: [], goals: [], accountHints: {}, merchantOverrides: {},
    billAliases: {}, lastScanTs: 0, parserVersion: 0 };
  const plan = buildImportPlan(parsed ? [{ ...parsed, smsTs: observedAt, channel: 'inbox' }] : [],
    state, observedAt, new Date(observedAt));
  let id = 0;
  const next = applyMaterializedImportBatch(state,
    materializeImportBatch(plan.batch, state, prefix => `${prefix}-${id++}`));
  assert.equal(next.transactions.some(row => isIncome(row) || isSpending(row)), false);
});

for (const body of [
  'تم إلغاء عملية شراء بمبلغ 50 ر.س لدى نون',
  'تم إيقاف عملية شراء بمبلغ 50 ر.س لدى نون',
  'تم تعليق عملية شراء بمبلغ 50 ر.س لدى نون',
  'عملية غير ناجحة: شراء بمبلغ 50 ر.س لدى نون',
  'شراء\nمبلغ: 50 ر.س\nلدى: نون\nالعملية غير مكتملة',
  'عملية شراء بمبلغ 50 ر.س لدى نون تم إلغاؤها',
  'تم إلغاء العملية، يرجى التواصل معنا. شراء 50 ر.س لدى نون بطاقة 1234',
  'شراء بمبلغ 50 ر.س لدى نون لم تكتمل، يرجى المحاولة مرة أخرى',
  'تم إلغاء عملية شراء بمبلغ 50 ر.س لدى نون يرجى التواصل مع المتجر',
  'تم إلغاء عملية شراء بمبلغ 50 ر.س لدى نون\nاذا لم تطلب العملية اتصل بالبنك',
]) test(`cancelled or incomplete movement never posts: ${body.slice(0, 40)}`, () => {
  for (const parsed of readers(body, 'SA')) assert.equal(parsed, null);
});

for (const body of [
  'Purchase of AED 50.00 (approx.) at NOON with card 1234',
  'Your card 1234 was used FOR APPROX AED 50.00 at NOON',
  'Purchase of about AED 50.00 at NOON with card 1234',
  'Purchase of AED 50.00 (approx.) at NOON with card 1234. Available balance AED 50.00.',
  'Purchase of about USD 50.00 at NOON with card 1234',
  'Purchase of USD 50.00 (approx.) at NOON with card 1234',
  'Purchase of about USD .50 at NOON with card 1234',
  'Purchase of USD .50 (approx.) at NOON with card 1234',
]) test(`an estimated principal waits for Review: ${body.slice(0, 42)}`, () => {
  for (const parsed of readers(body)) assert.equal(parsed, null);
});

for (const body of [
  'Refund of AED 125.00 from NOON is under process.',
  'Refund of AED 125.00 approved. It will reflect in 5-7 days.',
  'Dear Customer, refund of AED 125.00 from NOON has been initiated to your card ending 1234',
  'Refund of AED 125.00 from NOON has been cancelled.',
  'Refund of AED 125.00 has not been credited to your card 1234.',
  'Refund of USD 125.00 from NOON is under process.',
  'Refund of USD 125.00 from NOON has been approved.',
  'Refund of USD .50 from NOON is under process.',
  'Refund of AED 125.00 from NOON. It has not been credited yet.',
  'Refund of AED 125.00 from NOON has been initiated, processing fee AED 5.00 has been charged to your card.',
  'Refund of AED 125.00 from NOON has been initiated and a processing fee of AED 5.00 was charged to your card.',
  'Refund of AED 125.00 from NOON has been cancelled and a fee of AED 5.00 was charged to your card.',
  'Refund of AED 125.00 from NOON has not been credited yet and a fee of AED 5.00 was deducted from your account.',
  'Refund of AED 125.00 from NOON has been requested and a processing fee of AED 5.00 was credited to your card.',
  'Refund of AED 125.00 from NOON has been initiated and a processing fee was charged to your card.',
  'Refund of AED 125.00 from NOON has been initiated and a levy was deducted from your account.',
]) test(`a refund that has not arrived never posts: ${body.slice(0, 45)}`, () => {
  for (const parsed of readers(body)) assert.equal(parsed, null);
});

test('a chargeback debited from the account cannot be income', () => {
  for (const body of ['Chargeback of AED 300.00 has been debited from your account 1234.',
    'Chargeback of AED 300.00 to account 1234 has been debited from your account 1234.']) {
    for (const parsed of readers(body)) assert.ok(!parsed || parsed.type === 'expense');
  }
});

test('a refund debit keeps its direction when the bank wraps the sentence', () => {
  const body = 'Refund AED 47.99 to card 1234 was reversed and debited from your account.';
  for (const wordsPerLine of [1, 2, 3, 5]) {
    const wrapped = body.split(' ').map((word, index) =>
      `${index ? (index % wordsPerLine ? ' ' : '\n') : ''}${word}`).join('');
    for (const parsed of readers(wrapped)) {
      assert.equal(parsed?.type, 'expense', `${wordsPerLine} words per line`);
      assert.equal(parsed.amountFils, 4799);
    }
  }
});

test('a reversal notice never proves a new refund credit or an unfinished debit', () => {
  for (const ending of [
    'was reversed.', 'has been reversed.', 'is being reversed.',
    'has not been reversed and debited from your account.',
    'was not reversed and charged to your card.',
    'has never been reversed and credited to your card.',
    'is being reversed and credited to your card.',
    'is being credited to your card.', 'was being debited from your account.',
  ]) for (const parsed of readers(`Refund of AED 47.99 to card 1234 ${ending}`)) assert.equal(parsed, null, ending);
  for (const [ending, type] of [
    ['has not been reversed and was debited from your account.', 'expense'],
    ['is being reversed and was credited to your card.', 'income'],
  ]) for (const parsed of readers(`Refund of AED 47.99 to card 1234 ${ending}`)) {
    assert.equal(parsed?.type, type, ending); assert.equal(parsed.amountFils, 4799);
  }
  for (const parsed of readers('Refund of AED 47.99 from BEING has been credited to your card.')) {
    assert.equal(parsed?.type, 'income'); assert.equal(parsed.amountFils, 4799);
  }
});

for (const body of [
  'Refund of AED 125.00 from NOON has been initiated\nProcessing fee AED 5.00 was charged to your card.',
  'Refund of AED 125.00 from NOON has been initiated\nProcessing fee was charged to your card.',
  'Refund of AED 125.00 from NOON has been initiated\nProcessing fee: charged to your card.',
  'Refund of AED 125.00 from NOON has been initiated\nService fee - charged to your card.',
  'Refund of AED 125.00 from NOON has been initiated\nCommission was charged to your card.',
  'Refund of AED 125.00 from NOON has been initiated\nA levy was deducted from your account.',
  'Refund of AED 125.00 from NOON has not been credited yet\nCommission was charged to your card.',
  'Refund of AED 125.00 from NOON has not been credited yet\nA levy was deducted from your account.',
  'Refund of AED 125.00 from NOON has not been credited yet\nA processing fee was deducted from your account.',
]) test(`a new fee line cannot settle a pending refund: ${body.slice(-45)}`, () => {
  for (const parsed of readers(body)) assert.equal(parsed, null);
});

test('a new unquantified fee line cannot debit a completed refund', () => {
  const body = 'Refund of AED 125.00 from NOON has been credited to your card\nProcessing fee was charged to your card.';
  for (const parsed of readers(body)) assert.ok(!parsed || (parsed.type === 'income' && parsed.amountFils === 12500));
});

test('a repeated reference to the same refund can confirm its completion across wraps', () => {
  const body = 'Refund of AED 125.00 from NOON has been initiated and the refund has now been credited to your card.';
  for (const wordsPerLine of [1, 2, 3, 5]) {
    const wrapped = body.split(' ').map((word, index) =>
      `${index ? (index % wordsPerLine ? ' ' : '\n') : ''}${word}`).join('');
    for (const parsed of readers(wrapped)) {
      assert.equal(parsed?.type, 'income');
      assert.equal(parsed.amountFils, 12500);
    }
  }
});

test('a later prepositional phrase cannot change an owned refund verdict', () => {
  for (const verdict of ['has been initiated', 'has been credited to your card']) {
    for (const tail of ['On your card a levy was deducted from your account.',
      'For the transaction that was debited from your account.',
      'On the other hand a levy was charged to your card.']) {
      for (const parsed of readers(`Refund of AED 125.00 from NOON ${verdict}\n${tail}`)) {
        if (verdict === 'has been initiated') assert.equal(parsed, null);
        else assert.ok(!parsed || (parsed.type === 'income' && parsed.amountFils === 12500));
      }
    }
  }
});

test('a pending refund cannot post when any part of its sentence is line-wrapped', () => {
  const body = 'Refund of AED 125.00 from NOON has been initiated.';
  for (let wordsPerLine = 1; wordsPerLine <= 8; wordsPerLine++) {
    const wrapped = body.split(' ').map((word, index) =>
      `${index ? (index % wordsPerLine ? ' ' : '\n') : ''}${word}`).join('');
    for (const parsed of readers(wrapped)) assert.equal(parsed, null, `${wordsPerLine} words per line`);
  }
});

test('a wrapped merchant cannot hide the following unrelated subject', () => {
  for (const tail of ['Commission was charged to your card.', 'A levy was deducted from your account.']) {
    for (const parsed of readers(`Refund of AED 125.00 from\nNOON\n${tail}`)) {
      assert.ok(!parsed || (parsed.type === 'income' && parsed.amountFils === 12500));
    }
  }
});

test('an original transaction cannot donate its debit to a refund', () => {
  for (const body of [
    'Refund of AED 125.00 has been initiated for the transaction that was debited from your account.',
    'Refund of AED 125.00 for your original transaction of AED 125.00 was debited from your account.',
    'Refund of AED 125.00 for your original transaction of AED 250.00 was debited from your account.',
    'Refund of AED 125.00 for your original transaction that was debited from your account.',
  ]) for (const parsed of readers(body)) assert.equal(parsed, null);
});

test('negated or future debits cannot reverse a credited refund', () => {
  for (const tail of ['and has not been debited from your account.',
    'and will be debited from your account.', 'and the refund has not been debited from your account.']) {
    for (const parsed of readers(`Refund of AED 125.00 has been credited to your card ${tail}`)) {
      assert.ok(!parsed || (parsed.type === 'income' && parsed.amountFils === 12500));
    }
  }
  for (const tail of ['has not been debited from your account.', 'will be debited from your account.']) {
    for (const parsed of readers(`Refund of AED 125.00 ${tail}`)) assert.equal(parsed, null);
  }
});

test('negation applies to coordinated refund verbs until an explicit new clause', () => {
  for (const verb of ['debited from your account', 'charged to your card']) {
    for (const parsed of readers(`Refund of AED 125.00 has not been credited and ${verb}.`)) assert.equal(parsed, null);
  }
  for (const body of ['Refund of AED 125.00 has not been debited and credited to your card.',
    'Refund of AED 125.00 has never been credited and charged to your card.',
    'Refund of AED 125.00 will be debited and credited to your card.']) {
    for (const parsed of readers(body)) assert.equal(parsed, null);
  }
  for (const body of ['Refund of AED 125.00 has been initiated and credited to your card.',
    'Refund of AED 125.00 has not been credited and the refund has now been credited to your card.']) {
    for (const parsed of readers(body)) assert.equal(parsed?.type, 'income');
  }
  for (const auxiliary of ['was', 'has been']) {
    for (const parsed of readers(`Refund of AED 125.00 has not been credited and ${auxiliary} debited from your account.`)) {
      assert.equal(parsed?.type, 'expense');
      assert.equal(parsed.amountFils, 12500);
    }
  }
});

for (const [body, country, type, amount] of [
  ['Purchase of AED 50.00 at NOON with card 1234 was successful.', 'AE', 'expense', 5000],
  ['شراء بمبلغ 50 ر.س لدى نون. لإلغاء العملية اتصل 8001234567', 'SA', 'expense', 5000],
  ['شراء بمبلغ 50 ر.س لدى نون. يمكنك إلغاء العملية من التطبيق', 'SA', 'expense', 5000],
  ['شراء بمبلغ 50 ر.س لدى نون. يرجى إلغاء العملية إذا لم تقم بها', 'SA', 'expense', 5000],
  ['Purchase of AED 50.00 at CANCELLED CAFE with card 1234.', 'AE', 'expense', 5000],
  ['Purchase of AED 50.00 at NOON with card 1234. Your profile is incomplete, update it in the app.', 'AE', 'expense', 5000],
  ['Refund of AED 125.00 from NOON has been credited to your card 1234.', 'AE', 'income', 12500],
  ['Chargeback of AED 300.00 has been credited to your account 1234.', 'AE', 'income', 30000],
  ['Refund fee of AED 5.00 has been debited from your account 1234.', 'AE', 'expense', 500],
  ['Purchase of AED 50.00 at NOON with card 1234. Available balance AED 2,000.00 approx.', 'AE', 'expense', 5000],
  ['Refund of AED 125.00 from NOON. Your new card request has been approved.', 'AE', 'income', 12500],
  ['Refund of AED 125.00 from NOON was credited to your card. Another refund is under process.', 'AE', 'income', 12500],
  ['Purchase of AED 50.00 at NOON. Refund of AED 50.00 was initiated.', 'AE', 'expense', 5000],
  ['شراء بمبلغ 50 ر.س لدى نون. في حال تم إلغاء العملية يرجى التواصل مع المتجر.', 'SA', 'expense', 5000],
  ['شراء بمبلغ 50 ر.س لدى نون. تم إلغاء العملية السابقة من التطبيق.', 'SA', 'expense', 5000],
  ['تم دفع قيمة شحن رصيد 50 ر.س لدى STC', 'SA', 'expense', 5000],
  ['شراء رصيد 50 ر.س لدى نون بطاقة 1234', 'SA', 'expense', 5000],
]) test(`completed control remains exact: ${body.slice(0, 45)}`, () => {
  for (const parsed of readers(body, country)) {
    assert.equal(parsed?.type, type);
    assert.equal(parsed.amountFils, amount);
  }
});

test('a conditional cancellation footer is not deletion evidence for saved rows', () => {
  assert.equal(nonPostingReason('شراء بمبلغ 50 ر.س لدى نون. في حال تم إلغاء العملية يرجى التواصل مع المتجر.'), null);
});

test('two independently settled amounts stay reviewable rather than flipping one into the other direction', () => {
  for (const parsed of readers('Refund of AED 125.00 from NOON was credited to your account 1234; chargeback of AED 20.00 was debited from your account 1234.')) {
    assert.ok(!parsed || (parsed.type === 'income' && parsed.amountFils === 12500));
  }
});

for (const body of [
  'Refund of AED 125.00 from NOON has been credited to your card and a processing fee of AED 5.00 was charged to your card.',
  'Refund of AED 125.00 from NOON has been credited to your card and a fee of AED 5.00 was deducted from your account.',
  'Refund of AED 125.00 from NOON has been credited to your card and a processing fee was charged to your card.',
]) test(`a secondary debit cannot reverse a completed refund principal: ${body.slice(-55)}`, () => {
  for (const parsed of readers(body)) assert.ok(!parsed || (parsed.type === 'income' && parsed.amountFils === 12500));
});

for (const body of [
  'Refund of USD 125.00 from NOON is under process.',
  'Refund of USD 125.00 from NOON has been cancelled.',
  'Purchase of USD 50.00 (approx.) at NOON with card 1234.',
]) test(`the worldwide fallback cannot restore an unproven principal: ${body.slice(0, 45)}`, () => {
  setActiveCountry('US'); setActiveMarket('ZZ'); setLedgerCurrency('USD', 2);
  const event = inspectUniversalBankEvent(body, { sender: 'Chase' });
  assert.notEqual(event.status, 'posted');
  const reader = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'USD', activeMarket: 'ZZ',
    bestEffort: { enabled: true, country: 'US' }, fxLookup: () => null });
  assert.equal(reader.parseUnproven(body, 'Chase', reader.inspect(body, 'Chase'), observedAt), null);
});

for (const [body, country, amount] of [
  ['AED 75.00 was debited at SAMPLE STORE using your FAB Credit Card. Apply now for 0% over 12 months on purchases of AED 1000.', 'AE', 7500],
  ['AED 50.00 has been debited from your account at SAMPLE CAFE. Enjoy 20% discount on your next purchase of AED 300 and above.', 'AE', 5000],
  ['Your Credit Card 4110 has been charged AED 24.90 for LIV PRIME. Earn 2 rewards for every AED 1 spent.', 'AE', 2490],
  ['تم خصم AED ٩٠ لعملية شراء لدى مكتبة الفنار، وسيتم تحويل صادر منفصل بمبلغ AED ٣٠٠.', 'AE', 9000],
  ['Fee charged\nFee: 2.30 SAR\nfor your transfer of SAR 10,000 to NAME', 'SA', 230],
]) test(`a qualified reference cannot erase or replace settled principal: ${body.slice(0, 55)}`, () => {
  const [legacy, ...capture] = readers(body, country);
  assert.equal(legacy?.amountFils, amount, 'mature positive contract is retained');
  assert.equal(legacy.type, 'expense');
  for (const parsed of capture) assert.ok(!parsed || (parsed.type === 'expense' && parsed.amountFils === amount));
});

for (const [body, currency, minor, exponent, charged] of [
  ['Purchase of KWD 12.345 (AED 148.20) at AVENUES MALL with your Credit Card ending 1234 on 05/09/2026.', 'KWD', 12345, 3, 14820],
  ['Purchase of AED 148.20 (KWD 12.345) at AVENUES MALL with your Credit Card ending 1234 on 05/09/2026.', 'KWD', 12345, 3, 14820],
  ['Purchase of JPY 1,500 (AED 36.73) at LAWSON TOKYO with your Credit Card ending 1234 on 05/09/2026.', 'JPY', 1500, 0, 3673],
  ['Purchase of USD 20.00 (AED 73.45) at OPENAI with your Credit Card ending 1234 on 05/09/2026.', 'USD', 2000, 2, 7345],
]) test(`the mature explicit bank FX pair retains exact ${currency} exponent ${exponent}`, () => {
  const [legacy, ...capture] = readers(body);
  assert.equal(legacy?.amountFils, charged);
  assert.equal(legacy.fxSource, 'bank');
  assert.equal(legacy.originalCurrency, currency);
  assert.equal(legacy.originalMinorUnits, minor);
  assert.equal(legacy.originalExponent, exponent);
  for (const parsed of capture) if (parsed) {
    assert.equal(parsed.amountFils, charged);
    assert.equal(parsed.originalMinorUnits, minor);
  }
});

test('a distant limit cannot qualify as the bank quote for a three-decimal foreign purchase', () => {
  for (const parsed of readers('Purchase of KWD 12.345 at AVENUES MALL with card 1234. AED 20,000.00 spending room left.')) {
    assert.ok(!parsed || parsed.amountFils !== 2000000);
  }
});

test('proved local balance footers retain the mature selected principal', () => {
  const reader = readerWithBroadMoneyCount();
  reader.dependency('@/lib/markets').setActiveMarket('AE');
  for (const body of [
    'Purchase of AED 50.00 at NOON with card 1234. Available balance AED 2,000.00.',
    'Available balance AED 2,000.00. Purchase of AED 50.00 at NOON with card 1234.',
    'Purchase of AED 50.00 at NOON with card 1234. Avl Cr. Limit AED 5,000.00.',
  ]) assert.equal(reader.parseSms(body)?.amountFils, 5000);
});

for (const body of [
  'Your total purchases this month AED 5000. Available balance AED 2000.',
  'AED 500.00 spent so far. Available balance AED 2,000.00.',
  'You have used your card for AED 500.00 this month. Available balance AED 2,000.00.',
]) test(`an ancillary balance never proves a selected aggregate as a transaction: ${body.slice(0, 50)}`, () => {
  for (const parsed of readers(body)) assert.equal(parsed, null);
});

test('unproved and foreign amounts still use fresh monetary proof on every invocation', () => {
  const reader = readerWithBroadMoneyCount();
  reader.dependency('@/lib/markets').setActiveMarket('AE');
  const body = 'AED 20,000.00 xyzzy plugh. AED 50.00 was spent at NOON on your card 1234.';
  assert.equal(reader.parseSms(body), null);
  const first = reader.broadReads();
  assert.ok(first > 0);
  assert.equal(reader.parseSms(body), null);
  assert.ok(reader.broadReads() > first, 'no raw-message memo or fixture cache');
  const beforeFx = reader.broadReads();
  assert.equal(reader.parseSms('Purchase of KWD 12.345 (AED 148.20) at AVENUES MALL with card 1234.')?.amountFils, 14820);
  assert.ok(reader.broadReads() > beforeFx);
  for (const currency of ['BAM', 'PEN', 'TOP']) {
    const before = reader.broadReads();
    assert.equal(reader.parseSms(`Purchase of AED 50.00 at NOON with card 1234. Available balance AED 2,000.00. Payment of ${currency} 100.00 at SAMPLE STORE was made.`), null);
    assert.ok(reader.broadReads() > before, `${currency} still requires broad monetary proof`);
  }
});

test('documented Omani decimal conventions preserve an exact bilingual principal', () => {
  const row = require('../universal-launch-eval/corpus/south-asia-mena.json').find(row => row.id === 'SAM-OM-BANKMUSCAT-1');
  load('@/lib/best-effort-autopost').setBestEffortAutoPostEnabled(true);
  setActiveCountry('OM'); setActiveMarket('ZZ'); setLedgerCurrency('OMR', 3);
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'OMR', regionHint: 'OM',
    fxLookup: () => null, bestEffort: { enabled: true, country: 'OM' } });
  // Worldwide alerts use this boundary; interpretBankAlert is AED/SAR-only.
  const parsed = session.parseUnproven(row.body, row.sender, session.inspect(row.body, row.sender), observedAt);
  assert.equal(parsed?.type, 'expense'); assert.equal(parsed.amountFils, 4200); assert.equal(parsed.currency, 'OMR');
  load('@/lib/best-effort-autopost').setBestEffortAutoPostEnabled(false);
});

test('a pinned three-decimal ledger never supplies missing source conventions or hides a competing amount', () => {
  const row = require('../universal-launch-eval/corpus/south-asia-mena.json').find(row => row.id === 'SAM-OM-BANKMUSCAT-1');
  load('@/lib/best-effort-autopost').setBestEffortAutoPostEnabled(true);
  for (const [country, body] of [
    ['US', row.body], [null, row.body],
    ['OM', row.body.replace('بمبلغ 4.200', 'بمبلغ 5.200')],
    ['OM', row.body.replace('بمبلغ 4.200', 'بمبلغ 4.201')],
    ['OM', row.body.replace('OMR 4.200', 'OMR 4,200')],
    ['OM', row.body.replaceAll('OMR', 'KWD').replaceAll('ر.ع', 'د.ك')],
  ]) {
    setActiveCountry(country); setActiveMarket('ZZ'); setLedgerCurrency('OMR', 3);
    const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'OMR', regionHint: country,
      fxLookup: () => null, bestEffort: { enabled: true, country } });
    assert.equal(session.parseUnproven(body, row.sender, session.inspect(body, row.sender), observedAt), null);
  }
  load('@/lib/best-effort-autopost').setBestEffortAutoPostEnabled(false);
  setActiveCountry('AE'); setActiveMarket('AE'); setLedgerCurrency('AED', 2);
});
