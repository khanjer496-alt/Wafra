'use strict';
// Refund matrix ORACLE (CEO 58078e1d item 2), v2 as accepted by the CEO (711485d5) and Change Reviewer (810c20ec, 583dcfd7).
// DATA ONLY: synthetic bodies and their expected outcome; it never calls the parser. refund-matrix.test.cjs feeds every row
// to parseSms, the launch session and the native bundle. The same generator lives in
// Shared/wafra-refund-matrix-oracle-20261112/generator.cjs for review.
const DEBIT_EN = 'AED 250.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026.';
const DEBIT_AR = 'تم خصم مبلغ 250.00 درهم من بطاقتك المنتهية بـ 1234 لدى NOON.COM.';

// Subjects that need an antecedent (the debit) exist only with a preceding debit sentence; without one, a refund
// sentence names its own figure first.
const SUBJECTS = { plain: ['amount-first', 'the refund', 'a refund', 'merchant'], debit: ['it', 'this amount', 'the refund', 'a refund of the same', 'merchant'] };
const VERBS = ['refunded', 'reversed', 'returned', 'credited', 'processed', 'processed and credited'];
const FORMS = { refunded: ['refunded', 'refund', 'refunding'], reversed: ['reversed', 'reverse', 'reversing'],
  returned: ['returned', 'return', 'returning'], credited: ['credited', 'credit', 'crediting'],
  processed: ['processed', 'process', 'processing'], 'processed and credited': ['processed and credited', 'process and credit', 'processing and crediting'] };
const ASPECTS = ['has been', 'was', 'is being', 'will be', 'will', 'not', 'has not'];
const LEADERS = ['none', 'if', 'once', 'when', 'after'];
const DESTS = ['your card', 'your account', 'merchant', 'beneficiary'];
const AMOUNTS = ['before', 'after', 'none'];
const TRAILS = ['none', 'reversed', 'in error', 'pending approval'];
const REFUND_NOUN = new Set(['the refund', 'a refund', 'a refund of the same']);

// A case is generated only when its words make sense together.
function natural(c) {
  if (REFUND_NOUN.has(c.subject) && ['refunded', 'reversed'].includes(c.verb)) return false; // "the refund has been refunded/reversed"
  if (c.subject !== 'merchant' && c.aspect === 'will') return false;                          // passive "will" = "will be"
  if (c.subject === 'merchant' && (c.dest === 'merchant' || c.dest === 'beneficiary')) return false;
  if (!c.debit && c.amount === 'none' && c.subject !== 'merchant') return false;              // no figure, no antecedent
  return true;
}

const amountText = (pos, debit) => {
  const n = debit ? '100.00' : '250.00'; // beside a debit a refund's own figure differs, so a second movement is explicit
  return pos === 'before' ? `AED ${n}` : pos === 'after' ? `${n} AED` : '';
};
const destEn = (d) => (d === 'merchant' ? 'the merchant' : d === 'beneficiary' ? 'the beneficiary' : d);

function sentenceEn(c) {
  const [pp, base, ing] = FORMS[c.verb];
  const amt = amountText(c.amount, c.debit);
  let clause;
  if (c.subject === 'merchant') {
    const object = c.verb.startsWith('processed') ? (amt ? `a refund of ${amt}` : 'your refund') : (amt || 'the purchase');
    const vp = { 'has been': `has ${pp}`, was: pp, 'is being': `is ${ing}`, 'will be': `will be ${ing}`,
      will: `will ${base}`, not: `did not ${base}`, 'has not': `has not ${pp}` }[c.aspect];
    clause = `NOON.COM ${vp} ${object} to ${destEn(c.dest)}`;
  } else {
    const head = {
      'amount-first': amt,
      'the refund': amt ? `the refund of ${amt}` : 'the refund',
      'a refund': amt ? `a refund of ${amt}` : 'a refund',
      it: amt ? `it, ${amt},` : 'it',
      'this amount': amt ? `this amount (${amt})` : 'this amount',
      'a refund of the same': amt ? `a refund of the same, ${amt},` : 'a refund of the same',
    }[c.subject];
    const vp = { 'has been': `has been ${pp}`, was: `was ${pp}`, 'is being': `is being ${pp}`, 'will be': `will be ${pp}`,
      not: `is not ${pp}`, 'has not': `has not been ${pp}` }[c.aspect];
    clause = `${head} ${vp} to ${destEn(c.dest)}`;
  }
  const tail = { none: '', reversed: ' and was later reversed', 'in error': ' in error', 'pending approval': ' pending approval' }[c.trail];
  const body = `${clause}${tail}`;
  const text = c.leader === 'none' ? `${body[0].toUpperCase()}${body.slice(1)}.`
    : `${c.leader[0].toUpperCase()}${c.leader.slice(1)} ${body}, you will receive an SMS.`;
  return c.debit ? `${DEBIT_EN} ${text}` : text;
}

// Arabic: impersonal (تم/سيتم/جاري/لم يتم + verbal noun) and merchant (قام/سيقوم/يقوم/لم يقم). A conditional leader takes
// the present "يتم" ("بمجرد أن يتم …"); a leader with an in-progress or negated aspect is not natural and is not generated.
const AR = {
  subjects: ['impersonal', 'merchant'],
  verbs: { refunded: 'استرداد', reversed: 'عكس', returned: 'إرجاع', credited: 'إيداع', processed: 'معالجة', 'processed and credited': 'معالجة وإيداع' },
  aspects: { 'has been': 'تم', 'will be': 'سيتم', 'is being': 'جاري', 'has not': 'لم يتم' },
  leaders: { none: '', if: 'إذا ', once: 'بمجرد أن ', when: 'عندما ', after: 'بعد أن ' },
  dests: { 'your card': 'إلى بطاقتك', 'your account': 'إلى حسابك', merchant: 'إلى التاجر', beneficiary: 'إلى المستفيد' },
  amounts: { before: 'مبلغ 250.00 درهم', after: 'مبلغ درهم 250.00', none: 'المبلغ' },
  trails: { none: '', reversed: ' وتم عكسه لاحقاً', 'in error': ' عن طريق الخطأ', 'pending approval': ' بانتظار الموافقة' },
};
function naturalAr(c) {
  if (c.leader !== 'none' && c.aspect !== 'has been') return false;
  if (c.subject === 'merchant' && (c.dest === 'merchant' || c.dest === 'beneficiary')) return false;
  if (!c.debit && c.amount === 'none' && c.subject !== 'merchant') return false;
  return true;
}
function sentenceAr(c) {
  const amt = c.debit && c.amount !== 'none' ? AR.amounts[c.amount].replace('250.00', '100.00') : AR.amounts[c.amount];
  const conditional = c.leader !== 'none';
  const a = conditional ? (c.leader === 'if' ? 'تم' : 'يتم') : AR.aspects[c.aspect];
  const merchantVerb = { تم: 'قام', يتم: 'يقوم', سيتم: 'سيقوم', جاري: 'يقوم', 'لم يتم': 'لم يقم' }[a];
  const core = c.subject === 'merchant'
    ? `${merchantVerb} التاجر NOON.COM ب${AR.verbs[c.verb]} ${amt} ${AR.dests[c.dest]}`
    : `${a} ${AR.verbs[c.verb]} ${amt} ${AR.dests[c.dest]}`;
  const text = conditional ? `${AR.leaders[c.leader]}${core}${AR.trails[c.trail]}، ستصلك رسالة.` : `${core}${AR.trails[c.trail]}.`;
  return c.debit ? `${DEBIT_AR} ${text}` : text;
}

// ── The oracle (rules in oracle.md; every row names its rule) ────────────────────────────────────────────────────────
const COMPLETED = new Set(['has been', 'was']);
const PENDING = new Set(['is being', 'will be', 'will']);
const NEGATED = new Set(['not', 'has not']);
function oracle(c) {
  const processedOnly = c.verb === 'processed';
  if (!c.debit) {
    if (c.amount === 'none') return ['NO_POST', 'R1 no amount'];
    if (c.leader !== 'none') return ['NO_POST', 'R2 conditional leader'];
    if (c.dest === 'merchant' || c.dest === 'beneficiary') return ['NO_POST', 'R3 third-party destination'];
    if (PENDING.has(c.aspect)) return ['NO_POST', 'R4 pending or future'];
    if (NEGATED.has(c.aspect)) return ['NO_POST', 'R5 negated'];
    if (c.trail !== 'none') return ['NO_POST', 'R6 reversed / in error / pending approval'];
    if (processedOnly) return ['REVIEW', 'R7 processed without an explicit credit (Q1 decided)'];
    return ['INCOME_REFUND', 'R8 completed own refund with its amount'];
  }
  if (c.amount !== 'none') return ['REVIEW', 'D1 a second figure beside the debit'];
  if (c.leader !== 'none') return ['EXPENSE', 'D2 a conditional refund footer; the debit posts'];
  // D3 DECIDED (CEO 711485d5): a "not refunded" note about a completed debit posts the expense, like D4; never income.
  if (NEGATED.has(c.aspect)) return ['EXPENSE', 'D3 a "not refunded" note: the debit posts, never income (CEO decided)'];
  if (PENDING.has(c.aspect)) return ['EXPENSE', 'D4 a pending or future refund: the debit posts, the refund is ignored (Q2 decided)'];
  if (c.dest === 'merchant' || c.dest === 'beneficiary') return ['REVIEW', 'D5 a refund to a third party beside a debit'];
  if (c.trail !== 'none') return ['REVIEW', 'D6 a refund taken back, in error or pending approval'];
  if (processedOnly) return ['REVIEW', 'D7 processed without an explicit credit (Q1 decided)'];
  return ['INCOME_DEBIT', 'D8 the debited purchase itself was refunded, reversed, returned or credited back'];
}

// ── Fixed regression controls (Change Reviewer 810c20ec edit 3): shapes the product never generates ────────────────────
const LONG = 'CARREFOUR HYPERMARKET MALL OF THE EMIRATES';
const CONTROLS = [
  ['After verification, the refund of AED 250.00 from IKEA has been credited to your card.', 'INCOME_REFUND', 'C1 comma ends the conditional leader'],
  ['Refund of AED 250.00 from IKEA has been credited to your card ending 1234. Disputed transactions may be reversed.', 'INCOME_REFUND', 'C2 hedged reversal footer'],
  ['Refund of AED 250.00 from IKEA has been credited to your card ending 1234. If credited in error, call 600 54 0000.', 'INCOME_REFUND', 'C2 hedged in-error footer'],
  [`Your refund request for AED250 has been received. Refund of AED 250.00 from ${LONG} has been credited to your card ending 1234.`, 'INCOME_REFUND', 'C3 glued currency, same amount'],
  [`Your refund request for AED100 has been received. A previous refund of AED 20.00 from ${LONG} has been credited to your card.`, 'NO_POST', 'C3 glued currency, a previous refund of another amount (341abedb High)'],
  [`Your refund request REF 556677 has been received. Refund of AED 250.00 from ${LONG} has been credited to your card ending 1234.`, 'INCOME_REFUND', 'C3 a reference is not an amount'],
  [`Your refund request for AED 100.00 has been received. A previous refund of AED 20.00 from ${LONG} has been credited to your card.`, 'NO_POST', 'C4 a previous refund of another amount'],
  [`Your refund request for 100.00 AED has been received. A previous refund of 20.00 AED from ${LONG} has been credited to your card.`, 'NO_POST', 'C4 the same, currency after'],
  ...['as a temporary credit pending investigation', 'and is on hold', 'and is under review', 'provisionally', 'subject to merchant approval']
    .map((t) => [`Refund of AED 250.00 from IKEA has been credited to your card ${t}.`, 'NO_POST', `C5 credit that can be taken back (${t})`]),
  ['Refund of AED 250.00 from IKEA has been credited to your card. The credit was cancelled by the merchant.', 'NO_POST', 'C5 credit cancelled in the next sentence'],
  [`A returned cheque fee of AED 50.00 was debited from your account ending 1234. Refund for your cancelled order has been credited to your card.`, 'REVIEW', 'C6 debit with a bare "returned" plus another refund'],
  [`${DEBIT_EN.replace('12/11/2026.', '12/11/2026 (reversed charges apply).')} Refund for your cancelled order has been credited to your card.`, 'REVIEW', 'C6 "(reversed charges apply)" plus another refund'],
  [`${DEBIT_EN} The annual fee is not refunded to your card.`, 'EXPENSE', 'C7 negated fee footer'],
  ['Purchase amount of AED 250.00 at NOON.COM on your Debit Card has been refunded.', 'INCOME_DEBIT', 'C8 Liv refund, no card digits'],
  ['Purchase amount of AED 250.00 at NOON.COM on your Debit Card ending 1234 has been refunded.', 'INCOME_DEBIT', 'C8 Liv refund, card digits'],
  ['Purchase amount of AED 250.00 at NOON.COM on your account ending 1234 has been refunded.', 'INCOME_DEBIT', 'C8 Liv refund to the own account (CEO 1014684b)'],
  ['Purchase of AED 250.00 with Debit Card ending 1234 at NOON.COM has been refunded. The refund was reversed by the merchant.', 'NO_POST', 'C9 a bare refund taken back later'],
  ...['MARKS AND SPENCER', 'H AND M', 'BARNES AND NOBLE']
    .map((m) => [`Refund of AED 250.00 from ${m} has been credited to your card ending 1234.`, 'INCOME_REFUND', `C10 merchant named with AND (${m})`]),
  // Oracle v2.1 (Change Reviewer 82667841): appended, so every earlier row keeps its id.
  ['AED 250.00 refunded to your card ending 1234.', 'INCOME_REFUND', 'C11 headline: a bare participle is completed'],
  ['Refund of AED 250.00 credited to your account.', 'INCOME_REFUND', 'C11 headline: refund of … credited'],
  ['250.00 AED reversed to your card.', 'INCOME_REFUND', 'C11 headline: currency after'],
  ['استرداد مبلغ 250.00 درهم إلى بطاقتك.', 'INCOME_REFUND', 'C11 Arabic headline: a bare verbal noun'],
  ['إيداع مبلغ 250.00 درهم في حسابك.', 'INCOME_REFUND', 'C11 Arabic headline: deposit to the own account'],
  ['Refund of AED 250.00 has been credited to your card and will appear on your next statement.', 'INCOME_REFUND', 'C12 a "will" not bound to the credit'],
  ['Refund for your pending order of AED 250.00 has been credited to your card.', 'INCOME_REFUND', 'C12 a "pending" not bound to the credit'],
  ['تم إيداع مبلغ 250.00 درهم في حسابك ولا يلزم أي إجراء.', 'INCOME_REFUND', 'C12 Arabic: a "لا" not bound to the credit'],
  [`${DEBIT_EN} If a refund of AED 100.00 has been credited to your card, you will receive an SMS.`, 'REVIEW', 'C13 first match: D1 (own figure) before D2 (conditional)'],
  // Oracle v2.2 (CEO 73c34ef8, Q1 narrowed): a processed refund to an instrument with digits, or with a balance line, is
  // settled; a bare one stays Review; a non-refund "processed" alert keeps its behaviour. Appended, so every id stays.
  ['Refund of AED 250.00 has been processed to your Debit Card ending 4502. Avl Balance is AED 400.00', 'INCOME_REFUND', 'C14 processed to a debit card with digits and a balance'],
  ['Refund of AED 250.00 has been processed to your Credit Card ending 4110. Avl Cr. Limit is AED 400.00', 'INCOME_REFUND', 'C14 processed to a credit card with digits and a limit'],
  ['Refund of AED 250.00 from NOON has been processed to your card ending 1234.', 'INCOME_REFUND', 'C14 processed to a card with digits'],
  ['Refund of AED 250.00 for your Noon order has been processed to your card ending 1234.', 'INCOME_REFUND', 'C14 processed refund for an order, card with digits'],
  ['The refund of AED 250.00 has been processed to your card. Your available balance is AED 900.00.', 'INCOME_REFUND', 'C14 processed with a balance line after it'],
  ['The refund of AED 250.00 has been processed to your card.', 'REVIEW', 'C15 a bare processed refund (Q1)'],
  ['NOON.COM has processed a refund of AED 250.00 to your account.', 'REVIEW', 'C15 a bare processed refund by the merchant (Q1)'],
  ['A credit transaction of AED 250.00 has been processed on your account XXXX1234 on 26/09/2026. Description: SALARY', 'INCOME_REFUND', 'C16 a processed salary credit keeps its income'],
  ['Dear Customer, Your payment to the account number 0501232543 has been processed. Amount Due: AED 250.00 Amount Paid: AED 250.00', 'EXPENSE', 'C16 a processed bill payment keeps its expense'],
  // Change Reviewer 4eee941b: a processed refund the bank says is not there yet stays Review (EXPENSE beside a debit, D4),
  // whatever balance line it carries; and a date is not an instrument number.
  ['Refund of AED 250.00 has been processed to your card ending 1234. It will reflect in your account within 5-7 working days.', 'REVIEW', 'C17 processed with digits, then "will reflect"'],
  ['Refund of AED 250.00 has been processed to your card ending 1234. Avl Balance is AED 400.00. It will reflect in your account within 5-7 working days.', 'REVIEW', 'C17 a balance line does not override "will reflect"'],
  ['Refund of AED 250.00 has been processed to your card ending 1234. It may take 5 working days to appear.', 'REVIEW', 'C17 processed with digits, then "may take 5 working days"'],
  ['تم معالجة استرداد مبلغ 250.00 درهم إلى بطاقتك المنتهية بـ 1234. سيظهر المبلغ في حسابك خلال 5-7 أيام عمل.', 'REVIEW', 'C17 Arabic: processed, then "سيظهر المبلغ"'],
  [`${DEBIT_EN} The refund has been processed to your card ending 1234. It will reflect in your account within 5-7 working days.`, 'EXPENSE', 'C17 beside a debit: not there yet, the debit posts (D4)'],
  ['The refund of AED 250.00 has been processed to your card on 12/11/2026.', 'REVIEW', 'C18 a date is not an instrument number'],
  // Change Reviewer 2aa1f668 (High): "processed to your account" with no refund wording and no debit is ordinary income.
  ['Your salary of AED 250.00 has been processed to your account.', 'INCOME_REFUND', 'C19 a processed salary keeps its income'],
  ['WPS salary of AED 250.00 has been processed to your account. Thank you for banking with us.', 'INCOME_REFUND', 'C19 a processed WPS salary keeps its income'],
  ['Your cash deposit of AED 250.00 has been processed to your account.', 'INCOME_REFUND', 'C19 a processed cash deposit keeps its income'],
  // Reviewer 956cb08a (Medium): a temporal lead with a completed credit and no clause after it is not a condition.
  ['After cancellation AED 250.00 has been refunded to your card ending 1234.', 'INCOME_REFUND', 'C20 "After <noun>" leads a completed refund'],
  ['Dear Customer, once again AED 250.00 has been refunded to your card ending 1234.', 'INCOME_REFUND', 'C20 "once again" is not a leader'],
  ['Once your order was cancelled AED 250.00 was refunded to your card ending 1234.', 'INCOME_REFUND', 'C20 a completed "once" clause, then the refund'],
  // Change Reviewer a41046bc (High), Reviewer 07a65c13 (Medium): a leader that directly governs the credit stays a condition,
  // whatever main clause follows. Reviewer 07a65c13 (Low): a telegraphic bare participle is completed.
  ...[
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
  ].map((body) => [body, 'NO_POST', 'C21 a leader directly governing the credit is a condition, whatever follows']),
  ['After cancellation AED 250.00 refunded to your card ending 1234.', 'INCOME_REFUND', 'C20 a telegraphic completed refund after "After <noun>"'],
  // Change Reviewer 742367fa (High), Reviewer c204ca32 (Medium/Low): an agent subject or any other verb after a temporal
  // leader governs the credit; "May" in a date or a name is not a modal.
  ...[
    'When the merchant has refunded AED 250.00 to your card please check your balance.',
    'Once we have refunded AED 250.00 to your account please check your balance.',
    'When they have refunded AED 250.00 to your card check your balance.',
    'When noon has refunded AED 250.00 to your card please check your balance.',
    'After the store refunded AED 250.00 to your card please verify the balance.',
    'Once the seller has refunded AED 250.00 to your card you receive an SMS.',
    'When the bank has credited AED 250.00 to your account kindly verify it in the app.',
    'When the merchant confirms AED 250.00 has been refunded to your card ending 1234.',
    'Once NOON confirms AED 250.00 has been refunded to your card ending 1234.',
  ].map((body) => [body, 'NO_POST', 'C21 an agent or another verb after the leader: the leader governs the credit']),
  ['After cancellation AED 250.00 has been refunded to your card ending 1234 on 12 May 2026.', 'INCOME_REFUND', 'C20 "May" in a date is not a modal'],
  ['After your return AED 250.00 has been credited to your card ending 1234 by MAY STORES.', 'INCOME_REFUND', 'C20 "MAY" in a name is not a modal'],
  // The same in Arabic (#231): a temporal leader directly governing the credit is a condition whatever follows; another phrase
  // between the leader and the credit makes it "when it happened".
  ...[
    'عندما تم استرداد مبلغ 250.00 درهم إلى بطاقتك تصلك رسالة.',
    'بمجرد أن تم إيداع مبلغ 250.00 درهم في حسابك يرجى مراجعة رصيدك.',
    'بعد أن تم استرداد مبلغ 250.00 درهم إلى بطاقتك يتم تحديث رصيدك.',
    'عندما تم إيداع مبلغ 250.00 درهم في حسابك. ستصلك رسالة.',
    'متى تم استرداد مبلغ 250.00 درهم إلى بطاقتك نرسل لك إشعاراً.',
    'عندما قام التاجر NOON.COM باسترداد مبلغ 250.00 درهم إلى بطاقتك تصلك رسالة.',
    'عند استرداد مبلغ 250.00 درهم إلى بطاقتك ستصلك رسالة.',
  ].map((body) => [body, 'NO_POST', 'C22 Arabic: a leader directly governing the credit is a condition, whatever follows']),
  ['عند إلغاء الطلب تم استرداد مبلغ 250.00 درهم إلى بطاقتك المنتهية بـ 1234.', 'INCOME_REFUND', 'C22 Arabic: "عند <noun>" leads a completed refund'],
  ...[
    'عندما يؤكد التاجر تم استرداد مبلغ 250.00 درهم إلى بطاقتك.',
    'متى استلمنا طلبك تم إيداع مبلغ 250.00 درهم في حسابك.',
    'عندما يوافق البنك تم إيداع مبلغ 250.00 درهم في حسابك.',
  ].map((body) => [body, 'NO_POST', 'C22 Arabic: another verb after the leader governs the credit']),
  ['عند إرجاع المنتج تم استرداد مبلغ 250.00 درهم إلى بطاقتك.', 'INCOME_REFUND', 'C22 Arabic: "إرجاع المنتج" is a product return, then a completed refund'],
  ['عند مراجعة طلبك تم إيداع مبلغ 250.00 درهم في حسابك المنتهي بـ 1234.', 'INCOME_REFUND', 'C22 Arabic: "عند مراجعة طلبك" leads a completed credit'],
];

// ── Case selection ───────────────────────────────────────────────────────────────────────────────────────────────────
function* product(dims) {
  const keys = Object.keys(dims);
  const idx = keys.map(() => 0);
  while (true) {
    yield Object.fromEntries(keys.map((k, i) => [k, dims[k][idx[i]]]));
    let i = keys.length - 1;
    while (i >= 0 && ++idx[i] === dims[keys[i]].length) idx[i--] = 0;
    if (i < 0) return;
  }
}
const enAll = [];
for (const debit of [false, true]) {
  for (const c of product({ subject: debit ? SUBJECTS.debit : SUBJECTS.plain, verb: VERBS, aspect: ASPECTS, leader: LEADERS,
    dest: DESTS, amount: AMOUNTS, trail: TRAILS })) {
    const cc = { ...c, debit };
    if (natural(cc)) enAll.push(cc);
  }
}
const arAll = [];
for (const debit of [false, true]) {
  for (const c of product({ subject: AR.subjects, verb: VERBS, aspect: Object.keys(AR.aspects), leader: Object.keys(AR.leaders),
    dest: Object.keys(AR.dests), amount: Object.keys(AR.amounts), trail: Object.keys(AR.trails) })) {
    const cc = { ...c, debit };
    if (naturalAr(cc)) arAll.push(cc);
  }
}
function sample(all, full, rand) {
  if (full) return all;
  const out = new Map();
  const key = (c) => JSON.stringify(c);
  const base = (c) => ({ leader: 'none', dest: 'your card', amount: c.debit ? 'none' : 'before', trail: 'none' });
  // (a) every subject × verb × aspect × debit at baseline modifiers, (b) every single-modifier step, (c) a seeded draw.
  const byKey = new Map(all.map((c) => [key(c), c]));
  for (const c of all) {
    const b = { ...c, ...base(c) };
    if (byKey.has(key(b))) out.set(key(b), b);
    for (const k of ['leader', 'dest', 'amount', 'trail']) {
      const step = { ...b, [k]: c[k] };
      if (byKey.has(key(step))) out.set(key(step), step);
    }
  }
  for (let i = 0; i < 600; i++) { const c = all[Math.floor(rand() * all.length)]; out.set(key(c), c); }
  return [...out.values()];
}

/** Every oracle row: { id, lang, case, body, expected, rule }. `full` gives the whole natural product. */
function buildOracleRows({ full = false } = {}) {
  let seed = 0x5eed1234;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 0x100000000);
  const rows = [];
  for (const c of sample(enAll, full, rand)) rows.push(['EN', c, sentenceEn(c), ...oracle(c)]);
  for (const c of sample(arAll, full, rand)) rows.push(['AR', c, sentenceAr(c), ...oracle(c)]);
  for (const [body, expected, rule] of CONTROLS) rows.push(['CTL', {}, body, expected, rule]);
  return rows.map(([lang, c, body, expected, rule], i) => ({ id: `${lang}-${String(i + 1).padStart(5, '0')}`, lang, case: c, body, expected, rule }));
}
module.exports = { buildOracleRows };
