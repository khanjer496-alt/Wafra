// Arabic bank SMS.
//
// Banks in both Gulf markets send Arabic to any customer whose profile
// language is Arabic. Every one of these messages was refused outright before
// the rewrite layer — including ones whose amount was already in Latin script.
//
// Two of the messages below are VERBATIM bank text, from the published corpus
// of obahareth/bank-al-bilad-sms-parser. They are the reference formats: the
// labelled, one-field-per-line shape used across the Gulf. The rest exercise
// one vocabulary rule each and are marked as such.

const { parseSms } = require('./build/sms-parser.js');
const { arabicToEnglish, hasArabic } = require('./build/arabic-sms.js');

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

// ── the two verbatim corpus formats ──────────────────────────────────────

const CORPUS_CREDIT = `شراء عبر نقاط البيع
بطاقة: **1234;الإئتمانية
لدى: Some merchant
دولة: السعودية
مبلغ: 12.00 SAR
رصيد: 1234.56 SAR
في: 2019-05-07 23:44`;

const CORPUS_DEBIT = `مشتريات نقاط البيع
بطاقة: **4567;مدى
من: xx005
مبلغ: 34.00 SAR
لدى: Some restaurant
دولة: السعودية
في: 2019/05/07 01:29`;

{
  const r = parseSms(CORPUS_CREDIT);
  check('corpus: a labelled Arabic purchase parses at all', !!r);
  check('corpus: direction is expense', r && r.type === 'expense', r && r.type);
  check('corpus: the shop on its own line is the merchant', r && r.merchant === 'Some Merchant', r && r.merchant);
  check('corpus: the card number is read', r && r.card && r.card.last4 === '1234', r && r.card);
  // "**1234;الإئتمانية" states the kind AFTER the number. Getting this wrong
  // files the charge against a debit card and breaks the card-due chain.
  check('corpus: الإئتمانية makes it a CREDIT card', r && r.card && r.card.kind === 'credit', r && r.card);
  check('corpus: رصيد is read as a figure', r && r.snapshotFils === 123456, r && r.snapshotFils);
  // The stored text must be what the bank sent, not the rewrite: it is what
  // the accuracy export shows and what a later version re-parses.
  check('corpus: raw keeps the original Arabic', r && r.raw === CORPUS_CREDIT);
}

{
  const r = parseSms(CORPUS_DEBIT);
  check('corpus: the debit-card format parses', !!r);
  check('corpus: merchant found below the amount line', r && r.merchant === 'Some Restaurant', r && r.merchant);
  check('corpus: مدى makes it a DEBIT card', r && r.card && r.card.kind === 'debit', r && r.card);
  check('corpus: card number read', r && r.card && r.card.last4 === '4567', r && r.card);
}

// ── one rule each ────────────────────────────────────────────────────────

const CASES = [
  {
    name: 'amount in Latin script inside an Arabic sentence',
    body: 'عملية شراء بمبلغ AED 250.00 لدى نون من بطاقتك المنتهية 8575',
    want: { type: 'expense', amountFils: 25000, merchant: 'نون', card: '8575' },
  },
  {
    name: 'تم خصم is a debit',
    body: 'تم خصم مبلغ 150.00 درهم من حسابك رقم 1234 لدى بيسان الطبي',
    want: { type: 'expense', amountFils: 15000, merchant: 'بيسان الطبي' },
  },
  {
    name: 'Arabic-Indic numerals ١٢٣ are read as digits',
    body: 'تم خصم مبلغ ١٥٠٫٥٠ درهم من حسابك رقم ١٢٣٤ لدى كارفور',
    want: { type: 'expense', amountFils: 15050, merchant: 'كارفور', category: 'groceries' },
  },
  {
    name: 'درهم spelled out is the local currency',
    body: 'تم خصم مبلغ 89.00 درهم من بطاقتك المنتهية 1234 لدى صيدلية العين',
    want: { type: 'expense', amountFils: 8900, category: 'health' },
  },
  {
    name: 'إيداع الراتب is income',
    body: 'تم إيداع الراتب بمبلغ 12,000.00 درهم في حسابك',
    want: { type: 'income', amountFils: 1200000, category: 'salary' },
  },
  {
    name: 'استرداد is money coming back',
    body: 'تم استرداد مبلغ 75.00 درهم إلى بطاقتك المنتهية 8575',
    want: { type: 'income', amountFils: 7500 },
  },
  {
    name: 'سحب نقدي is an ATM withdrawal',
    body: 'سحب نقدي بمبلغ 500.00 درهم من بطاقتك المنتهية 1234',
    want: { type: 'expense', amountFils: 50000, merchant: 'ATM withdrawal' },
  },
  {
    name: 'مطعم names a restaurant',
    body: 'عملية شراء بمبلغ 210.00 درهم لدى مطعم الحلبي من بطاقتك المنتهية 4321',
    want: { type: 'expense', amountFils: 21000, category: 'dining' },
  },
  {
    name: 'أدنوك is fuel',
    body: 'عملية شراء بمبلغ 120.00 درهم لدى أدنوك من بطاقتك المنتهية 4321',
    want: { type: 'expense', amountFils: 12000, category: 'transport' },
  },
  {
    name: 'د.إ as a symbol still works with no merchant',
    body: 'تم خصم د.إ 150.00 من حسابك',
    want: { type: 'expense', amountFils: 15000 },
  },
];

for (const { name, body, want } of CASES) {
  const r = parseSms(body);
  if (!r) {
    check(name, false, 'REFUSED');
    continue;
  }
  const errs = [];
  if (want.type && r.type !== want.type) errs.push(`type ${r.type} != ${want.type}`);
  if (want.amountFils && r.amountFils !== want.amountFils) {
    errs.push(`amount ${r.amountFils} != ${want.amountFils}`);
  }
  if (want.merchant && r.merchant !== want.merchant) {
    errs.push(`merchant ${JSON.stringify(r.merchant)} != ${JSON.stringify(want.merchant)}`);
  }
  if (want.card && (!r.card || r.card.last4 !== want.card)) {
    errs.push(`card ${JSON.stringify(r.card)} != ${want.card}`);
  }
  if (want.category && r.categoryGuess !== want.category) {
    errs.push(`category ${r.categoryGuess} != ${want.category}`);
  }
  check(name, errs.length === 0, errs);
  check(`${name} — raw is untouched`, r.raw === body);
}

// ── the trap that nearly shipped ─────────────────────────────────────────
//
// The first draft of arabic-sms.ts anchored every rule with \b. JavaScript
// defines \b over [A-Za-z0-9_], so between a space and an Arabic letter there
// is no boundary at all and EVERY rule was dead. Nothing downstream would have
// noticed — the messages simply carried on being refused, which is exactly
// what they did before. So: assert the rewrite actually changes the text.

check('a \\b-style boundary does NOT work on Arabic (why word() exists)', !/\bخصم\b/.test('تم خصم مبلغ'));

for (const [label, arabic, expect] of [
  ['خصم', 'تم خصم 5.00 درهم', /debited/],
  ['شراء', 'عملية شراء 5.00 درهم', /purchase/],
  ['سحب', 'سحب نقدي 5.00 درهم', /withdrawal/],
  ['إيداع', 'تم إيداع 5.00 درهم', /deposited/],
  ['استرداد', 'تم استرداد 5.00 درهم', /refunded/],
  ['لدى', 'شراء لدى كارفور', /\bat\b/],
  ['بطاقة', 'بطاقة: **1234', /Card/],
  ['رصيد', 'رصيد: 100.00 درهم', /Avl Bal/],
  ['المنتهية', 'بطاقتك المنتهية 1234', /ending/],
  ['درهم', '5.00 درهم', /AED/],
  ['ريال', '5.00 ريال', /SAR/],
]) {
  check(`rewrite fires for ${label}`, expect.test(arabicToEnglish(arabic)), arabicToEnglish(arabic));
}

// Arabic-Indic and Persian digit forms both have to convert.
check('٠١٢٣٤٥٦٧٨٩ convert', arabicToEnglish('مبلغ ٠١٢٣٤٥٦٧٨٩ درهم').includes('0123456789'));
check('۰۱۲۳۴۵۶۷۸۹ convert', arabicToEnglish('مبلغ ۰۱۲۳۴۵۶۷۸۹ درهم').includes('0123456789'));
check('٫ is a decimal point', arabicToEnglish('١٥٠٫٥٠ درهم').includes('150.50'));

// The line structure has to survive: the parser's multi-line descriptor
// reader is behind an includes('\n') check, and the labelled format is one
// field per line.
check('line breaks survive the rewrite', arabicToEnglish(CORPUS_CREDIT).includes('\n'));

// ── the English path must not notice any of this ─────────────────────────

check('hasArabic is false for English', !hasArabic('Purchase of AED 120.00 at CARREFOUR'));
check(
  'an English message is returned byte-for-byte',
  arabicToEnglish('Purchase of AED 120.00 at CARREFOUR. Avl Bal AED 5,000.00') ===
    'Purchase of AED 120.00 at CARREFOUR. Avl Bal AED 5,000.00',
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
