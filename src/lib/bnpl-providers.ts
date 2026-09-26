/* ───────────────────── Buy-now-pay-later provider sources ─────────────────────
 *
 * A Tabby/Tamara instalment is ONE outflow with TWO messages: the bank's card
 * alert ("Purchase of AED 49.75 to TABBY with Credit Card ending 1234") and the
 * provider's own SMS or app notification restating it under the SHOP's name
 * ("... for your Noon order"). The bank alert is the real ledger event — it
 * names the card that paid and carries the bank's balance/limit. The
 * restatement can never be paired with it (dedupe compares merchants, and Noon
 * is not Tabby), so importing it counted every instalment twice, and an
 * "order split into 4 payments" notice booked the whole order on top of the
 * four card charges.
 *
 * So a BNPL provider is never a TRUSTED source: nothing it sends posts
 * automatically, and approving one of its messages in Review never teaches
 * Wafra to trust its app. That is decided by the provider's IDENTITY, never
 * its wording — provider copy changes and is not in the corpus; the sender is
 * what says who is talking. A bank alert that merely NAMES Tabby (the charge
 * above, an EPP offer, a refund) is untouched, as is any shop called "Tabby
 * Tailoring".
 *
 * The wording decides only what happens to a provider's message: ignore it,
 * or show it in Review. The same brands also move money no bank ever alerts
 * on. Tabby Cash (UAE, July 2026) is a stored-value account inside the
 * app.tabby.client app, with its own Cash Card and person-to-person
 * transfers; the Tamara Card pays cashback into a Tamara Wallet. Ignoring
 * everything a provider sends dropped those movements without trace. Only a
 * recognised RESTATEMENT of a bank card charge — an instalment or payment
 * charged, paid or received for an order; an order split into N payments; an
 * order refund to the card; a "will be charged tomorrow" preview; a plain
 * receipt for the shopper's payment that names no shop, person or other
 * payee ("Payment of AED 49.75 collected", "2 of 4 paid") — is ignored. Anything else a provider sends reaches Review like any other
 * unparsed financial alert, where the user decides.
 *
 * The restatement test is deliberately narrow, and anything that names the
 * provider's own account, card, wallet, balance, a transfer, a top-up or
 * cashback is never a restatement: a miss costs one Review card the user can
 * dismiss, while a false match would silently drop real money. It is
 * reachable only through the provider identity (isBnplProviderRestatement
 * takes the sender); the same words from any other source are never judged
 * by it. The bodies it was written against are illustrative, not verified
 * Tabby/Tamara templates.
 *
 * Android packages are exact ids verified on Google Play (developer "Tabby",
 * developer "TAMARA FZE"). The providers' merchant apps (app.tabby.cashier,
 * co.tamara.merchant) are deliberately absent. Postpay and Cashew publish no
 * consumer Android app under their own name that could be verified, so they
 * are gated by SMS sender only. SMS sender spellings are the brand itself with
 * the operator's promotional "AD" marker in either position; these have NOT
 * been checked against a real handset.
 *
 * A pure module with no imports on purpose: the parser, the launch session and
 * the Android capture scanner all consult it, and test harnesses that stub the
 * parser must still reach the real registry.
 */
const BNPL_PROVIDER_PACKAGES: ReadonlySet<string> = new Set(['app.tabby.client', 'co.tamara.user']);
const BNPL_PROVIDER_SENDER_RE = /^(?:ad)?(?:tabby(?:ai)?|tamara(?:co)?|postpay|cashew)(?:ad)?$/;

/**
 * Is this SMS sender ID / notification package a BNPL provider rather than a
 * bank? Accepts the `${package} ${title}` form a learned notification package
 * is parsed under. Exact identity only: a sender that merely CONTAINS a
 * provider name is not the provider.
 */
export function isBnplProviderSource(sender?: string | null): boolean {
  if (typeof sender !== 'string') return false;
  const value = sender.normalize('NFKC').trim().toLowerCase();
  if (!value || value.length > 200) return false;
  if (BNPL_PROVIDER_PACKAGES.has(value.split(/\s+/)[0])) return true;
  return BNPL_PROVIDER_SENDER_RE.test(value.replace(/[\s._-]/g, ''));
}

// `\b` cannot see Arabic letters, so Arabic words are bounded explicitly. The
// optional leading letters are the attached conjunctions and prepositions
// (و ف ب ل) and the article.
const AR_LETTER = '\\u0621-\\u064A';
const arabicWord = (body: string): string => `(?<![${AR_LETTER}])${body}(?![${AR_LETTER}])`;

/**
 * The provider's own money, which has no bank alert behind it: Tabby Cash,
 * a provider card or wallet, a balance, a transfer between people, a top-up,
 * cashback. Any of these keeps a message on the Review path, even when it
 * also names an order ("paid for your Noon order from your Tabby Cash").
 */
const PROVIDER_OWN_MONEY_RE = new RegExp([
  '\\b(?:tabby|tamara)\\s*(?:cash|card|wallet|balance|account|credit)\\b',
  '\\bcash\\s*card\\b',
  '\\bwallet\\b',
  '\\b(?:your|new|available|current|wallet|account|cash)\\s+balance\\b',
  '\\btop(?:ped)?[\\s-]*up\\b',
  '\\bcash\\s*back\\b',
  '\\byou(?:\\s+have)?\\s+(?:sent|received)\\b',
  '\\bsent\\s+you\\b',
  '\\btransfer(?:red|s)?\\b',
  'تابي\\s*كاش',
  'بطاق[ةه]\\s+(?:تابي|تمارا)',
  'محفظ',
  'رصيد',
  'كاش\\s*باك',
  'استرداد\\s+نقدي',
  'تحويل',
  'حوال[ةه]',
  arabicWord('(?:استلمت|أرسلت|ارسلت)'),
  arabicWord('[وف]?(?:إيداع|ايداع)'),
].join('|'), 'iu');

/** A plan of instalments, or one instalment of it. */
const INSTALMENT_PLAN_RE = new RegExp([
  '\\bsplit\\s+(?:in(?:to)?\\s+)?(?:\\d+|two|three|four|six)\\b',
  '\\b(?:\\d+|two|three|four|five|six|eight|twelve)\\s+(?:(?:interest[\\s-]*free|equal|monthly)\\s+)*(?:payments|instal(?:l)?ments)\\b',
  '\\binstal(?:l)?ments?\\b',
  '\\bpayment\\s+\\d+\\s+of\\s+\\d+\\b',
  '\\b(?:first|second|third|fourth|last|final|next|upcoming|\\d+(?:st|nd|rd|th))\\s+(?:payment|instal(?:l)?ment)\\b',
  '\\bremaining\\s*:?\\s*\\d+\\s+payments?\\b',
  arabicWord('[وفبل]?(?:ال)?(?:قسط|[أا]قساط)(?:ك|كم|ين)?'),
  arabicWord('[وفبل]?(?:ال)?دفعات(?:ك|كم)?'),
  arabicWord('[وفبل]?(?:ال)?(?:تقسيم|مقسم)'),
  'الدفع[ةه]\\s+(?:الأولى|الاولى|الثانية|الثالثة|الرابعة|الأخيرة|الاخيرة|القادمة|التالية)',
].join('|'), 'iu');

/**
 * The shopper's own order: "your Noon order", "your order of/from/at …",
 * "order #…", and in Arabic "طلبك" (your order), "طلبية" or "طلب رقم". A
 * bare "طلب" is not enough — it also means a request, as in a request for
 * money between people.
 */
const ORDER_RE = new RegExp([
  "\\byour\\s+(?:[\\p{L}\\p{N}&'’.-]+\\s+){0,3}orders?\\b",
  '\\borders?\\s*(?:(?:of|from|at|with|no|number|id|ref)\\b|#)',
  arabicWord('[وفبل]{0,2}طلب(?:ك|كم|اتك|اتكم)'),
  arabicWord('[وفبل]{0,2}(?:ال)?طلبي(?:ة|ه|تك|تكم)'),
  arabicWord('(?:ال)?طلب') + '\\s+رقم',
].join('|'), 'iu');

/** A payment moving for that order: charged, paid, received, refunded, due. */
const ORDER_PAYMENT_RE = new RegExp([
  '\\b(?:paid|pay|payments?|charged?|received|debited|deducted|collected|processed|refund(?:ed)?|due)\\b',
  'خصم', 'دفع', 'سداد', 'استلام', 'استلمنا', 'استرداد', 'استرجاع', 'تحصيل', 'مستحق',
].join('|'), 'iu');

/** The day-before notice of a charge the bank will alert on when it happens. */
const CHARGE_PREVIEW_RE = new RegExp([
  '\\bwill\\s+be\\s+(?:automatically\\s+|auto[\\s-]*)?(?:charged|debited|collected|deducted)\\b',
  '\\bdue\\s+(?:tomorrow|today|on)\\b',
  'سيتم\\s+(?:خصم|تحصيل|سحب)',
].join('|'), 'iu');

// Within one sentence: a decimal point ("49.75") does not end it.
const SAME_SENTENCE = '(?:[^.!?؟\\n]|\\.(?=\\d))';

/**
 * A plain receipt for the shopper's own payment to the provider, which the
 * paying bank alerts on as a charge to the provider: "Payment of AED 49.75
 * collected successfully", "We have received your payment of AED 49.75",
 * "AED 49.75 was charged to your card ending 1234", "2 of 4 paid". Used only
 * with PAYEE_RE below: a payment AT a shop, TO a person or FROM someone is
 * the provider's own money (a card purchase, a transfer), never a receipt.
 */
const PAYMENT_RECEIPT_RE = new RegExp([
  `\\bpayment\\b${SAME_SENTENCE}{0,60}?\\b(?:collected|received|successful(?:ly)?|processed|confirmed|completed)\\b`,
  '\\b(?:received|collected|processed)\\s+your\\s+payment\\b',
  '\\b(?:charged|debited|deducted|collected)\\s+(?:to|from|on)\\s+your\\s+(?:saved\\s+|default\\s+|debit\\s+|credit\\s+|bank\\s+)?card\\b',
  '\\b\\d{1,2}\\s+of\\s+\\d{1,2}\\s+(?:paid|payments?|instal(?:l)?ments?)\\b',
  `(?:خصم|تحصيل|سحب)${SAME_SENTENCE}{0,40}?من\\s+بطاقت(?:ك|كم)`,
  arabicWord('(?:استلام|استلمنا)') + '\\s+' + arabicWord('دفعت(?:ك|كم)'),
  arabicWord('دفعت(?:ك|كم)') + `${SAME_SENTENCE}{0,40}?(?:بنجاح|ناجح[ةه]?)`,
].join('|'), 'iu');

/** A counterparty other than the shopper: "at CARREFOUR", "to Sara", "from Ahmed". */
const PAYEE_RE = new RegExp([
  '\\b(?:at|to|from)\\s+(?!(?:your|you)\\b)[\\p{L}\\p{N}]',
  arabicWord('(?:في|إلى|الى)') + '\\s+(?!بطاقت)',
].join('|'), 'iu');

/**
 * Is this message a BNPL provider RESTATING a charge the paying bank already
 * alerted on (see the header)? Only then may it be ignored. False for every
 * non-provider sender, whatever the text says, and false for anything that
 * names the provider's own money — that goes to Review instead.
 */
export function isBnplProviderRestatement(sender: string | null | undefined, text: string): boolean {
  if (!isBnplProviderSource(sender) || typeof text !== 'string') return false;
  // Arabic tatweel and short vowels never change a word; drop them so the
  // word boundaries above see the letters.
  const value = text.normalize('NFKC').replace(/[ـً-ْ]/g, '');
  if (PROVIDER_OWN_MONEY_RE.test(value)) return false;
  return INSTALMENT_PLAN_RE.test(value) || CHARGE_PREVIEW_RE.test(value) ||
    (ORDER_RE.test(value) && ORDER_PAYMENT_RE.test(value)) ||
    (PAYMENT_RECEIPT_RE.test(value) && !PAYEE_RE.test(value));
}
