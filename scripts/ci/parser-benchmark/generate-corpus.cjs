#!/usr/bin/env node
'use strict';
/**
 * Deterministic generator for the FIXED parser-benchmark corpus.
 *
 * Output: parser-corpus-2026-11-11.jsonl, one object per line:
 *   {"id":1,"shape":"pos-purchase-debit-card","lang":"en","text":"..."}
 *
 * Every message is synthetic. Merchants are public brand names or invented
 * shops, names are invented, card/account tails and amounts are random. There
 * is no real customer message or personal data. The generator never calls the
 * parser: the shape label is the author's intent, and the benchmark reports how
 * many messages each parser actually recognises per shape.
 *
 * The corpus is committed. Regenerate only to change the corpus on purpose:
 *   node scripts/ci/parser-benchmark/generate-corpus.cjs > scripts/ci/parser-benchmark/parser-corpus-2026-11-11.jsonl
 */

const TOTAL = 5000;
const SEED = 20261111;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (list) => list[Math.floor(rnd() * list.length)];
const pad = (n, w = 2) => String(n).padStart(w, '0');

const MERCHANTS = ['CARREFOUR', 'SPINNEYS', 'NOON.COM', 'AMAZON.AE', 'TALABAT', 'DELIVEROO', 'UBER', 'CAREEM',
  'ADNOC', 'ENOC', 'EMARAT', 'LULU HYPERMARKET', 'STARBUCKS', 'TIM HORTONS', 'MCDONALDS', 'KFC', 'IKEA', 'H&M',
  'ZARA', 'SHARAF DG', 'JUMBO ELECTRONICS', 'PANORAMA SUPERMARKET', 'FISHBASKET', 'GREEN VALLEY MARKET',
  'SUNRISE PHARMACY', 'PALM CAFE', 'AL NOOR BAKERY', 'DESERT ROSE FLORIST', 'BLUE LAGOON SPORTS', 'CITY LIGHT OPTICS',
  'GOLDEN SANDS RESTAURANT', 'MARINA FRESH GROCERY', 'ORBIT BOOKSTORE', 'SALIK', 'DUBAI TAXI', 'APPLE.COM/BILL',
  'NETFLIX.COM', 'SPOTIFY', 'ETISALAT', 'DU TELECOM', 'AL FUTTAIM', 'MAJID AL FUTTAIM', 'SPORTS DIRECT', 'DECATHLON'];
const CITIES = ['DUBAI', 'ABU DHABI', 'SHARJAH', 'AJMAN', 'AL AIN', 'RAS AL KHAIMAH'];
const MERCHANTS_AR = ['كارفور', 'نون', 'أمازون', 'كريم', 'لولو هايبر ماركت', 'اينوك', 'سبينيس', 'ستاربكس',
  'مطعم الشام', 'صيدلية الشروق', 'مخبز النور', 'مركز الواحة التجاري', 'محطة الخليج للوقود', 'مقهى النخيل',
  'سوبرماركت الميناء', 'متجر الأفق للإلكترونيات'];
const NAMES = ['JOHN DOE', 'AHMED SALEM', 'KHALID RASHID', 'MARIA GARCIA', 'FATIMA HASSAN', 'LI WEI', 'PRIYA NAIR',
  'OMAR YOUSEF', 'SARA KHAN', 'DAVID BROWN'];
const NAMES_AR = ['أحمد سالم', 'خالد راشد', 'فاطمة حسن', 'عمر يوسف', 'سارة خان', 'محمد علي'];
const BILLERS = ['DEWA', 'SEWA', 'FEWA', 'ETISALAT', 'DU', 'SALIK', 'EMPOWER', 'TECOM'];
const BILLERS_AR = ['هيئة كهرباء ومياه دبي', 'اتصالات', 'دو', 'سالك', 'إمباور'];
const BANKS = ['Emirates NBD', 'ADCB', 'FAB', 'Mashreq', 'RAKBANK', 'CBD', 'Dubai Islamic Bank'];
const FOREIGN = [['USD', 1], ['EUR', 1], ['GBP', 1], ['SAR', 1], ['INR', 0], ['KWD', 3]];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function amount(max = 5000) {
  // Log-uniform between 5 and max: most purchases are small, a few are large.
  const v = Math.exp(Math.log(5) + rnd() * (Math.log(max) - Math.log(5)));
  const fixed = v.toFixed(2);
  const [whole, frac] = fixed.split('.');
  const style = int(0, 2);
  if (style === 0 && whole.length > 3) return `${whole.slice(0, -3)},${whole.slice(-3)}.${frac}`;
  if (style === 1 && whole.length > 3) return `${whole.slice(0, -3)},${whole.slice(-3)}.${frac}`;
  return `${whole}.${frac}`;
}
function date(style) {
  const d = int(1, 28);
  const m = int(9, 10);
  const yyyy = 2026;
  if (style === 'dmy') return `${pad(d)}/${pad(m)}/${yyyy}`;
  if (style === 'mon') return `${pad(d)}-${MON[m - 1]}-${pad(yyyy % 100)}`;
  if (style === 'monlong') return `${pad(d)}-${MON[m - 1]}-${yyyy}`;
  return `${pad(d)}/${pad(m)}/${yyyy}`;
}
const time = () => `${pad(int(0, 23))}:${pad(int(0, 59))}`;
const last4 = () => String(int(1000, 9999));
const otp = () => String(int(100000, 999999));
const ref = () => String(int(100000, 99999999));

function toArabicIndic(text) {
  return text.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

function ctx(lang) {
  const f = pick(FOREIGN);
  const famt = (rnd() * 800 + 5).toFixed(f[1]);
  return {
    amt: amount(), amtBig: amount(40000), bal: amount(60000), limit: amount(60000), last4: last4(), last4b: last4(),
    merchant: pick(MERCHANTS), city: pick(CITIES), merchantAr: pick(MERCHANTS_AR), name: pick(NAMES), nameAr: pick(NAMES_AR),
    biller: pick(BILLERS), billerAr: pick(BILLERS_AR), bank: pick(BANKS), otp: otp(), ref: ref(), pct: pick([10, 15, 20, 25, 30, 50]),
    fcur: f[0], famt, dmy: date('dmy'), mon: date('mon'), monlong: date('monlong'), time: time(), lang,
  };
}
function fill(template, c) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (!(key in c)) throw new Error(`Unknown placeholder {${key}} in: ${template}`);
    return c[key];
  });
}

// weight = share of the 5,000 messages (relative). Shapes mirror the families
// the product reads: card purchases dominate, with a long tail of everything else.
const SHAPES = [
  // ── English ────────────────────────────────────────────────────────────────
  { shape: 'pos-purchase-debit-card', lang: 'en', weight: 14, templates: [
    'Purchase of AED {amt} with Debit Card ending {last4} at {merchant}, {city}.',
    'Purchase of AED {amt} with Debit Card ending {last4} at {merchant} on {dmy}',
    'Dear Customer, Purchase of AED {amt} with Debit Card ending {last4} at {merchant}. Avl Bal is AED {bal}.',
  ] },
  { shape: 'pos-purchase-credit-card', lang: 'en', weight: 12, templates: [
    'Purchase of AED {amt} with Credit Card ending {last4} at {merchant}. Avl Cr. Limit AED {limit}.',
    'Purchase of AED {amt} with Credit Card ending {last4} at {merchant}, {city} on {mon} {time}',
    'AED {amt} was spent on your Credit Card ending {last4} at {merchant} on {dmy}. Available limit AED {limit}.',
  ] },
  { shape: 'card-used-for', lang: 'en', weight: 8, templates: [
    'Your Debit Card ending {last4} was used for AED {amt} at {merchant} on {mon}. Available balance is AED {bal}.',
    'Card ending {last4} was used for AED {amt} at {merchant} on {dmy} {time}.',
    'AED {amt} spent on Credit Card ending {last4} at {merchant} on {monlong}.',
  ] },
  { shape: 'online-purchase-with-warning', lang: 'en', weight: 4, templates: [
    'Purchase of AED {amt} with Credit Card ending {last4} at {merchant}. If not you, call the bank. Never share your OTP or PIN with anyone.',
    'AED {amt} was debited from your account ending {last4} for an online purchase at {merchant}.\nDo not share your OTP with anyone.',
  ] },
  { shape: 'atm-withdrawal', lang: 'en', weight: 4, templates: [
    'AED {amt} withdrawn from your account ending {last4} at ATM {city} on {mon}. Available balance AED {bal}.',
    'Cash withdrawal of AED {amt} with Debit Card ending {last4} at ATM {city}.',
  ] },
  { shape: 'salary-credit', lang: 'en', weight: 3, templates: [
    'Your account ending {last4} has been credited with AED {amtBig} on {dmy}. Salary. Available balance AED {bal}.',
    'Salary of AED {amtBig} was credited to your account {last4}.',
  ] },
  { shape: 'transfer-in', lang: 'en', weight: 3, templates: [
    'AED {amt} has been credited to your account ending {last4} from {name}.',
    'Inward remittance of {amt} AED has been credited to your account XX{last4}.',
  ] },
  { shape: 'transfer-out', lang: 'en', weight: 4, templates: [
    'AED {amt} has been transferred from your account ending {last4} to {name}. Ref {ref}.',
    'Dear {name}, AED {amt} has been debited from your Saving Bank Account ending with {last4} for a FastPay transfer to {name}.',
    'Outward Remittance Debit Account XXXX{last4} AED {amt} Value Date {dmy} Available Balance AED {bal}',
  ] },
  { shape: 'bill-payment', lang: 'en', weight: 3, templates: [
    'Your payment of AED {amt} to {biller} for consumer number {ref} has been processed on {dmy} {time}',
    'AED {amt} has been deducted from your account {last4} towards {biller} bill payment.',
  ] },
  { shape: 'card-repayment', lang: 'en', weight: 2, templates: [
    'Payment of AED {amtBig} has been received on your Credit Card {last4}********{last4b}.',
    'AED {amtBig} has been deducted from your account {last4} towards payment of your Credit Card ending {last4b}.',
  ] },
  { shape: 'refund', lang: 'en', weight: 2, templates: [
    'Refund of AED {amt} has been credited to your card ending {last4} from {merchant}.',
    'Your refund request has been received. Refund of AED {amt} from {merchant} has been credited to your card ending {last4}.',
  ] },
  { shape: 'balance-notice', lang: 'en', weight: 3, templates: [
    'Your available balance in account ending {last4} is AED {bal} as of {dmy}.',
    'Account ending {last4} balance: AED {bal}. Thank you for banking with {bank}.',
  ] },
  { shape: 'foreign-currency-purchase', lang: 'en', weight: 3, templates: [
    'Purchase of {fcur} {famt} with Credit Card ending {last4} at {merchant}.',
    'Card ending {last4} was used for {fcur} {famt} at {merchant} on {dmy}. Amount charged AED {amt}.',
  ] },
  { shape: 'otp', lang: 'en', weight: 6, templates: [
    'Your OTP for transaction of AED {amt} at {merchant} is {otp}. Do not share it with anyone.',
    '{otp} is your one time password for {bank}. Valid for 5 minutes. Never share it.',
    'Use code {otp} to verify your login. Do not disclose it to anyone including bank staff.',
  ] },
  { shape: 'promotion', lang: 'en', weight: 4, templates: [
    'Get {pct}% cashback on dining this weekend with your {bank} card. T&C apply.',
    'Dear Customer, enjoy {pct}% off at {merchant} with your {bank} Credit Card until {monlong}. Terms apply.',
    '{bank}: pre-approved personal loan up to AED {amtBig}. Reply YES to know more.',
  ] },
  { shape: 'declined', lang: 'en', weight: 2, templates: [
    'Transaction of AED {amt} at {merchant} was declined due to insufficient funds.',
    'Your card ending {last4} was declined for AED {amt} at {merchant}.',
  ] },
  { shape: 'phishing-link', lang: 'en', weight: 1, templates: [
    'Your {bank} card is blocked. Click http://short.example/{otp} to verify now.',
    'Urgent: AED {amt} debited from your account. If not you, tap https://secure-{bank}.example/login to cancel.',
  ] },
  { shape: 'personal-or-other', lang: 'en', weight: 1, templates: [
    'Hi, I paid AED {amt} for lunch today, will send you the rest on {dmy}.',
    'Reminder: your appointment at {merchant} is on {dmy} at {time}.',
  ] },
  // ── Arabic ─────────────────────────────────────────────────────────────────
  { shape: 'ar-pos-purchase', lang: 'ar', weight: 9, templates: [
    'عملية شراء بمبلغ {amt} درهم بالبطاقة المنتهية بـ {last4} لدى {merchantAr}',
    'تم خصم {amt} درهم من بطاقتك المنتهية بـ {last4} لدى {merchantAr} بتاريخ {dmy}',
    'شراء بقيمة {amt} AED عبر بطاقة الائتمان المنتهية بـ {last4} في {merchantAr}. الرصيد المتاح {bal} AED',
  ] },
  { shape: 'ar-debit', lang: 'ar', weight: 3, templates: [
    'تم خصم مبلغ {amt} درهم من حسابك المنتهي بـ {last4} بتاريخ {dmy}',
    'تم سحب مبلغ {amt} درهم من الصراف الآلي بالبطاقة المنتهية بـ {last4}',
  ] },
  { shape: 'ar-credit', lang: 'ar', weight: 3, templates: [
    'تم إيداع مبلغ {amt} درهم في حسابك المنتهي بـ {last4}. الرصيد الحالي {bal} درهم',
    'تم إيداع الراتب {amtBig} درهم في حسابك المنتهي بـ {last4}',
  ] },
  { shape: 'ar-transfer-out', lang: 'ar', weight: 3, templates: [
    'تم تحويل مبلغ {amt} درهم من حسابك المنتهي بـ {last4} إلى {nameAr}',
    'حوالة صادرة بمبلغ {amt} درهم إلى {nameAr}. الرصيد المتاح {bal} درهم',
  ] },
  { shape: 'ar-bill-payment', lang: 'ar', weight: 2, templates: [
    'تم سداد فاتورة {billerAr} بمبلغ {amt} درهم من حسابك المنتهي بـ {last4}',
    'فاتورة {billerAr} بمبلغ {amt} درهم مستحقة الدفع بتاريخ {dmy}',
  ] },
  { shape: 'ar-refund', lang: 'ar', weight: 1, templates: [
    'تم استرداد مبلغ {amt} درهم إلى بطاقتك المنتهية بـ {last4} من {merchantAr}',
  ] },
  { shape: 'ar-otp', lang: 'ar', weight: 3, templates: [
    'رمز التحقق الخاص بك هو {otp}. لا تشاركه مع أحد.',
    'رمز التحقق لعملية الشراء بمبلغ {amt} درهم لدى {merchantAr} هو {otp}',
  ] },
  { shape: 'ar-promotion', lang: 'ar', weight: 2, templates: [
    'احصل على خصم {pct}% عند الدفع ببطاقتك من {bank} في {merchantAr} هذا الأسبوع. تطبق الشروط والأحكام',
    'عرض خاص: خصم {pct}% على مشترياتك القادمة من {merchantAr}',
  ] },
  { shape: 'ar-declined', lang: 'ar', weight: 1, templates: [
    'تم رفض عملية بمبلغ {amt} درهم لدى {merchantAr} بسبب عدم كفاية الرصيد',
  ] },
  { shape: 'ar-balance', lang: 'ar', weight: 1, templates: [
    'رصيدك المتاح في الحساب المنتهي بـ {last4} هو {bal} درهم',
  ] },
  { shape: 'ar-foreign-purchase', lang: 'ar', weight: 1, templates: [
    'عملية شراء بمبلغ {famt} {fcur} بالبطاقة المنتهية بـ {last4} لدى {merchant}',
  ] },
  { shape: 'ar-card-repayment', lang: 'ar', weight: 1, templates: [
    'تم استلام دفعة بمبلغ {amtBig} درهم على بطاقتك الائتمانية المنتهية بـ {last4}. شكرا',
  ] },
];

function allocate() {
  const sum = SHAPES.reduce((s, x) => s + x.weight, 0);
  const counts = SHAPES.map((x) => Math.round((TOTAL * x.weight) / sum));
  let diff = TOTAL - counts.reduce((s, n) => s + n, 0);
  let biggest = counts.indexOf(Math.max(...counts));
  counts[biggest] += diff;
  return counts;
}

function main() {
  const counts = allocate();
  const rows = [];
  SHAPES.forEach((def, i) => {
    for (let n = 0; n < counts[i]; n++) {
      const c = ctx(def.lang);
      let text = fill(pick(def.templates), c);
      // About a sixth of the Arabic messages use Arabic-Indic digits, as some banks send them.
      if (def.lang === 'ar' && rnd() < 0.16) text = toArabicIndic(text);
      rows.push({ shape: def.shape, lang: def.lang, text });
    }
  });
  // Fisher-Yates with the seeded generator: stable order, mixed shapes.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  rows.forEach((row, index) => process.stdout.write(`${JSON.stringify({ id: index + 1, ...row })}\n`));
}

main();
