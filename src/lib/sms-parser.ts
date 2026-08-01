import { bankFromSender, getActiveMarket } from '@/lib/markets';
import type { CategoryId, TransactionType } from '@/lib/types';

/* ────────────────────────── Arabic normalisation ──────────────────────────
 *
 * UAE banks send the SAME alert in Arabic, in English, or with both halves in
 * one body — and the Arabic side arrives spelled a dozen equivalent ways.
 * Rather than a second parser, the message is normalised into ONE spelling so
 * the existing grammar can carry an Arabic vocabulary alongside its English
 * one.
 *
 * Two strings come out of it, deliberately:
 *
 *   source  the bank's own text, returned as `raw` and shown back to the user
 *   clean   source minus invisible marks — DELETIONS, so it is shorter
 *   folded  clean with orthography folded 1:1 — SAME LENGTH as clean
 *
 * All matching runs on `folded`; every substring shown to the user (a merchant
 * or biller name) is sliced out of `clean` at the folded match's offsets. That
 * only works because folding is strictly one code point to one code point: cut
 * the name out of `folded` instead and the user sees "هييه كهرباء" where the
 * bank wrote "هيئة كهرباء" — a corrupted merchant name that also splits the
 * merchant-override key in two.
 *
 * THE TRAP: every Arabic literal in this file is written POST-FOLD. No ة, no
 * ى, no أ إ آ, no ؤ, no ئ, no tatweel, no Arabic-Indic digits — a rule written
 * with them can never fire, because the input no longer contains them.
 */

/** Bidi controls, joiners, tatweel and harakat: decoration, never meaning. */
const INVISIBLE_RE =
  /[\u200B-\u200F\u061C\u202A-\u202E\u2066-\u2069\uFEFF\u0640\u064B-\u0655\u0670]/g;
const NBSP_RE = /[\u00A0\u2007\u202F]/g;

/**
 * Deletes what carries no meaning. A single RLM between "AED" and the digits
 * nulled an entire message, and banks inject them around every number in an
 * Arabic or bilingual body. Tatweel is elective letter-stretching used for RTL
 * justification ("درهــم" is "درهم"); harakat are vowel marks ("مطعمٌ" is
 * "مطعم"). Both appear inside templated bank alerts.
 */
export function stripInvisible(s: string): string {
  return s.replace(INVISIBLE_RE, '').replace(NBSP_RE, ' ');
}

/**
 * Strictly 1:1 orthography folding — the length of the string never changes,
 * which is what lets merchant names be sliced back out of the un-folded text.
 *
 * The digits are not cosmetic: JS `\d`, `\w` and `\b` are ASCII-only, so
 * NOTHING numeric matches until "١٢٣" becomes "123" (and `normalize('NFKC')`
 * will not do it — the mapping has to be explicit). The two separators are
 * money bugs in their own right: U+066C is a thousands separator, so
 * "AED 12٬345.67" was recorded as AED 12.00, a 1000x under-record with no
 * error and no null; U+066B is a decimal point, so "AED 150٫75" silently lost
 * its 75 fils.
 */
const FOLD_MAP: Record<string, string> = (() => {
  const m: Record<string, string> = {
    'آ': 'ا', 'أ': 'ا', 'إ': 'ا', 'ٱ': 'ا', // آ أ إ ٱ → ا
    'ى': 'ي', // ى → ي
    'ة': 'ه', // ة → ه
    'ؤ': 'و', // ؤ → و
    'ئ': 'ي', // ئ → ي
    '٫': '.', // ٫ arabic decimal separator
    '٬': ',', // ٬ arabic thousands separator
    '،': ',', // ، arabic comma
    '؛': ';', // ؛ arabic semicolon
  };
  for (let i = 0; i < 10; i++) {
    m[String.fromCharCode(0x0660 + i)] = String(i); // ٠-٩
    m[String.fromCharCode(0x06f0 + i)] = String(i); // ۰-۹ (extended)
  }
  return m;
})();
const FOLD_RE = /[\u0622\u0623\u0625\u0671\u0649\u0629\u0624\u0626\u066B\u066C\u060C\u061B\u0660-\u0669\u06F0-\u06F9]/g;

export function foldOrthography(s: string): string {
  return s.replace(FOLD_RE, (ch) => FOLD_MAP[ch] ?? ch);
}

/** Both stages, for callers that only need something matchable. */
export function normalizeArabic(s: string): string {
  return foldOrthography(stripInvisible(s));
}

/** Does this text contain Arabic script at all? Guards every Arabic-only rule. */
const ARABIC_RE = /[\u0600-\u06FF]/;
/** Arabic letters, post-fold. `\b` and `\w` are useless here — they are ASCII. */
const AR_LETTER = '\\u0621-\\u064A';

export interface ParsedCard {
  last4: string;
  kind: 'credit' | 'debit' | 'account';
}

export type SnapshotKind = 'balance' | 'limit' | 'outstanding';

export interface ParsedSms {
  /**
   * transaction — money moved; billDue — a payment reminder;
   * cardStatement — credit card statement with a due date;
   * cardPayment — payment received toward a credit card (a transfer, not spending).
   */
  kind: 'transaction' | 'billDue' | 'cardStatement' | 'cardPayment';
  type: TransactionType;
  amountFils: number;
  merchant: string;
  /** ISO date if the message contained one, otherwise null (caller defaults to today). */
  date: string | null;
  /** For billDue/cardStatement: the day of month it's due, when present. */
  dueDay: number | null;
  /** For cardStatement: minimum amount due, when present. */
  minDueFils: number | null;
  /** Card/account the message refers to, when identifiable. */
  card: ParsedCard | null;
  /** Bank-side leg of a card payment / own-account transfer: money moved, not spent. */
  transferHint: boolean;
  /** Balance / available-limit / outstanding figure the bank quoted, if any. */
  snapshotFils: number | null;
  snapshotKind: SnapshotKind | null;
  categoryGuess: CategoryId;
  raw: string;
}

/* ───────────────────────── Sender awareness ─────────────────────────
 *
 * NOT ONE real UAE bank SMS names its own bank in the body, except HSBC.
 * Checked against every message in scripts/test/fixtures/uae-accuracy-report.txt:
 * "From HSBC:" is the only in-body bank marker in the whole corpus. Every
 * other bank identifies itself through the SMS SENDER ID alone — "ADIB",
 * "RAKBANK", "Mashreq", or a notification package name like "ae.wio.personal".
 *
 * So a fixture that carries a bank name inside the body is LESS realistic, not
 * more, and per-bank grammar was impossible while `parseSms` could only see
 * the text. The sender arrives here as an OPTIONAL field on a third argument:
 * every existing caller, and every message whose sender is unknown, takes
 * exactly the path it took before.
 *
 * A profile is deliberately thin. Sender-gated rules earn their place only
 * when the BODY genuinely cannot settle the question — three do:
 *
 *   islamic  a Sharia-compliant issuer's credit card is a "Covered Card" and
 *            the word "credit" never appears anywhere in its alerts, so a
 *            kindless "Card" quoting an available LIMIT is a credit card. On
 *            a conventional bank the same sentence is a debit card.
 *   ownPot   the bank's own savings product. "GOAL", "SPACE" and "POT" are
 *            far too generic to match on their own — GOAL SPORTS and SPACE
 *            CAFE are real shops — and knowing which bank sent the message is
 *            the only thing that makes those nouns readable.
 *   brand    money moving TO the bank's own name ("...TO LIV FROM EMERGENCY
 *            FUNDS", real corpus #21) is moving inside your own bank. Without
 *            the sender, "LIV" is just a word that might be a payee.
 */
export interface BankProfile {
  /** Bank name exactly as the active market pack knows it. */
  name: string;
  /** How the bank writes its OWN name inside a body, where it writes it at all. */
  brand: RegExp;
  /** Sharia-compliant issuer: "Covered Card", profit rather than interest, Murabaha rather than loan. */
  islamic?: boolean;
  /** In-house savings pot: a Liv Goal, a Wio Saving Space, an ENBD savings pot. */
  ownPot?: RegExp;
}

const BANK_PROFILES: Record<string, Omit<BankProfile, 'name'>> = {
  // Emirates NBD and Liv run on one core, so they share a grammar (real corpus
  // families A and E) and both offer the same savings pots under two names.
  'Emirates NBD': { brand: /\benbd\b|emirates\s*nbd|\bliv\b/i, ownPot: /\b(?:liv\s+)?goals?\b|\bsavings?\s+pot\b/i },
  Liv: { brand: /\bliv\b/i, ownPot: /\b(?:liv\s+)?goals?\b|\bsavings?\s+pot\b/i },
  // Wio is app-push-first and sends comparatively little SMS; "Saving Spaces"
  // is its savings-pot product and the one Wio noun worth trusting.
  Wio: { brand: /\bwio\b/i, ownPot: /\b(?:saving\s+)?spaces?\b/i },
  ADIB: { brand: /\badib\b/i, islamic: true },
  DIB: { brand: /\bdib\b|dubai\s*islamic/i, islamic: true },
  'Emirates Islamic': { brand: /emirates\s*islamic\b/i, islamic: true },
  'Sharjah Islamic': { brand: /\bsib\b|sharjah\s*islamic/i, islamic: true },
  'Ajman Bank': { brand: /ajman\s*bank/i, islamic: true },
  // The brand is the bank's NAME, never one of its products: "RAKMoneyTransfer
  // to AHMED KHALID" names a rail and a real payee, not a move inside the bank.
  RAKBANK: { brand: /\brak\s*bank\b|\brakbank\b/i },
  Mashreq: { brand: /\bmashreq\b|\bneo\b/i },
  ADCB: { brand: /\badcb\b/i },
  FAB: { brand: /\bfab\b|first\s*abu\s*dhabi/i },
  HSBC: { brand: /\bhsbc\b/i },
  CBD: { brand: /\bcbd\b/i },
  NBF: { brand: /\bnbf\b/i },
  CBI: { brand: /\bcbi\b/i },
};

/**
 * The bank an SMS sender ID / notification package belongs to, with whatever
 * per-bank grammar the parser knows about it. Returns null for an unknown or
 * absent sender, which is the same as not passing one at all.
 */
export function bankProfileForSender(sender?: string): BankProfile | null {
  const bank = bankFromSender(sender);
  if (!bank) return null;
  return { name: bank.name, ...(BANK_PROFILES[bank.name] ?? { brand: /x^/ }) };
}

/** Optional, per-call context. Everything here is additive: omit it and nothing changes. */
export interface ParseOptions {
  /**
   * SMS sender ID ("ADIB", "RAKBANK", "Mashreq") or the notification package
   * name a bank app posted under ("ae.wio.personal"). Used only to
   * disambiguate — never to decide that a message is or is not a transaction.
   */
  sender?: string;
}

/**
 * "Credit Card" is a NOUN PHRASE, not the verb "credited" — and neither is
 * "credit limit", "credit line" or "credit score". Reading them as direction
 * made `hasCredit` permanently true on every credit card, so an AED 89.50
 * grocery run arrived as AED 89.50 of Business REVENUE: the ledger moved twice
 * the amount, in the wrong direction, on the commonest message a UAE bank
 * sends.
 */
/**
 * The Arabic half of each list is the SAME vocabulary, written the way an
 * Arabic-locale handset receives it — one grammar, two scripts, never two
 * parsers. Every literal is post-fold (see the normalisation block above).
 *
 * Bare "دائن"/"وارد" are deliberately absent: they are substrings of ordinary
 * words. Only the anchored forms are safe.
 */
const AR_CREDIT_WORDS =
  'ايداع|اودع|قيد داين|راتب|مرتب|رواتب|استرداد|استرجاع|مسترد|اضيف|اضافه مبلغ|حواله وارده|تحويل وارد';
const CREDIT_WORDS = new RegExp(
  `credit(?:ed)?(?!\\s*(?:card|limit|line|score|facility))|received|salary|refund(?:ed)?|deposit(?:ed)?|transferred to your|${AR_CREDIT_WORDS}`,
  'i',
);
/**
 * Direction settled by the CLAUSE that says WHERE the money went. These beat
 * the word lists outright: "Your salary of AED 10,000 has been paid into your
 * account" carries both "salary" and "paid", and letting the two lists race
 * booked it as a AED 10,000 EXPENSE carrying the income-only salary category —
 * one message, a AED 20,000 swing in the month.
 */
const CREDIT_CLAUSE_RE =
  /(?:credited|deposited|paid|transferred|remitted|added)\s+(?:back\s+)?(?:in)?to\s+(?:your|the|a\/?c)|credited\s+(?:with|back)\b|received\s+(?:from|(?:a\s+)?(?:payment|transfer|amount))|\bcash\s+deposit(?:ed)?\b|refunded\s+to\s+your|reversed\s+to\s+your|\binward\s+remittance\b|(?:الي|في)\s+حسابك|لحسابك/i;
const DEBIT_CLAUSE_RE =
  /(?:debited|deducted|withdrawn|charged|paid|spent|transferred)\s+from\s+your|charged\s+to\s+your\s+(?:card|account)|من\s+حسابك|من\s+بطاقتك|من\s+رصيدك/i;
/**
 * The credit clause read backwards: when the account CREDITED belongs to a
 * BILLER, the money left the user.
 *
 * "Your payment of AED 200.00 has been credited to your du account 1234567"
 * is a phone bill being settled, and "credited to your" booked it as AED 200
 * of income — a 2x swing on one message, since the spend vanishes and revenue
 * appears in its place. Every UAE biller (du, Etisalat, DEWA, Salik) confirms
 * a settlement in this shape, and says it four ways: credited TO, received
 * TOWARDS, received FOR, posted TO. Covering only "credited" left the other
 * three booking bill payments as revenue.
 *
 * THE PAYEE HAS TO BE NAMED, and this is the whole safety of the rule. An
 * earlier version required nothing after "to your", so the bare noun in
 * "credited to your ACCOUNT" read as a biller — and money paid INTO the user's
 * own account, with a RISING balance quoted in the same sentence, was booked
 * as an EXPENSE. That is the identical 2x swing pointed the other way.
 *
 * The name also gives the row a title: it sits before the noun with none of
 * the prepositions MERCHANT_RE looks for, so these rows used to arrive titled
 * "Account debit" and could never group or carry an override.
 */
const BILLER_SETTLED_RE =
  /\b(?:credited|received|posted|applied)(?:\s+[^\n]{0,24}?)?\s+(?:to|towards?|for|against)\s+(?:your|the)\s+([A-Za-z][A-Za-z0-9 &.'\-]{0,24}?)\s+(?:bill\s+|postpaid\s+|prepaid\s+)?(?:account|wallet|a\/c)\b/i;
/** The user's OWN payment as the subject: "your payment ... has been credited". */
const PAYMENT_SUBJECT_RE = /\b(?:your|the|a)\s+payment\b/i;
/** Words that describe the account itself, never the biller that owns it. */
const NOT_A_BILLER_RE =
  /^(?:credit|debit|covered|charge|prepaid|postpaid|bank|savings?|current|salary|joint|linked|registered|new|old|other|same|main|primary|personal|business)$/i;
/**
 * A bank's OWN name is never the biller. "Profit of AED 34.22 has been
 * credited to your ADIB Savings Account" and "Your salary payment has been
 * credited to your RAKBANK Account" are money ARRIVING, and naming the bank as
 * the payee of the user's salary is worse than naming nobody.
 */
const BANK_NAME_RE =
  /\bbanks?\b|\badib\b|\badcb\b|\benbd\b|emirates\s*nbd|emirates\s*islamic|\bliv\b|\bwio\b|\bmashreq\b|\bneo\b|rak\s*bank|\brakbank\b|\bfab\b|first\s*abu\s*dhabi|\bhsbc\b|\bcbd\b|\bnbf\b|\bcbi\b|\bdib\b|dubai\s*islamic|\bsib\b|sharjah\s*islamic|ajman\s*bank|\bciti\b|standard\s*chartered/i;
/**
 * What a UAE biller IS, categorically. This is the discriminator that tells a
 * bare "credited to your du account" (a phone bill) apart from "credited to
 * your ADIB Savings Account" (money arriving): a biller is a named service
 * provider the category vocabulary recognises, and a bank or an account type
 * is not. When the user's own PAYMENT is the subject the sentence has already
 * said the money left, so any named payee will do.
 */
const BILLER_CATEGORIES: CategoryId[] = ['telecom', 'utilities', 'transport', 'government'];
/**
 * The biller a settlement message names, or null when the message is about
 * money arriving in the user's own account.
 */
function billerSettlement(prose: string): string | null {
  const m = prose.match(BILLER_SETTLED_RE);
  const name = m?.[1].trim();
  if (!name || NOT_A_BILLER_RE.test(name) || BANK_NAME_RE.test(name)) return null;
  if (PAYMENT_SUBJECT_RE.test(prose)) return name;
  return BILLER_CATEGORIES.includes(guessCategory(name, 'expense')) ? name : null;
}
// DEBIT_WORDS is market-compiled below (its payment guard embeds the currency).
// "صرف" is deliberately absent — it is the stem of "مصرف" (BANK), which
// appears in almost every alert, and it would have made hasDebit permanently
// true on Arabic messages the way "credit" did on English credit cards.
const AR_DEBIT_WORDS =
  'شراء|مشتريات|خصم|خصمت|سحب|قيد مدين|تم دفع|تم الدفع|عمليه دفع|دفعه بمبلغ|تم سداد|سداد بمبلغ|تسديد|تحويل صادر|حواله صادره|تم تحويل|استخدمت|استخدام';
// Bare "دفع" is NOT a debit verb anywhere in this file, and this is why:
// "مستحقة الدفع" ("due for payment") contains it, and isBillDue requires
// !hasDebit — so a bare pay-verb turned every Arabic bill REMINDER into a real
// posted expense the user never made. Only anchored forms ("تم دفع", "سداد
// بمبلغ") are safe. This is the Arabic twin of the `payment(?!\s+due…)` guard
// on DEBIT_WORDS.
const BILL_DUE_WORDS = /\bdue\s+(?:on|by|date)\b|\bbill\b.*\b(?:due|generated|payable)\b|\bbill amount\b|\bpay\s+by\b|\bpayment\s+due\b|\bmin(?:imum)?\s+(?:amount\s+)?due\b|مستحقه الدفع|مستحق الدفع|تاريخ الاستحقاق|الحد الادني للدفع|يرجي السداد/i;
const BILL_MERCHANT_RE = /(?:your|the)\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,30}?)\s+bill\b/i;
/** "فاتورة هيئة كهرباء ومياه دبي بمبلغ ..." — the biller follows the noun. */
const AR_BILL_MERCHANT_RE = new RegExp(
  `فاتوره\\s+([${AR_LETTER}][${AR_LETTER}0-9 &.'\\-]{2,40}?)(?=\\s*(?:بمبلغ|بقيمه|مستحق|[,.;\\n]|$))`,
);

/** Credit-card statement: has "statement"/"total due" language plus a card reference. */
const STATEMENT_RE =
  /statement|total\s+(?:amount\s+)?due|total\s+billed\s+am(?:oun)?t|min(?:imum)?\s+payment\s+of|outstanding\s+(?:amount|balance)\s+of|كشف الحساب|كشف حساب|اجمالي المبلغ المستحق|المبلغ الاجمالي المستحق/i;
/** Purchase-style verbs that disqualify the statement branch (NOT "paid"). */
const STATEMENT_TXN_BLOCK_RE = /purchase|was used|charged|withdraw|debited|spent/i;
/** Payment INTO a card: settles dues rather than spending. */
// CARD_PAYMENT_RE is market-compiled below.

/**
 * OTP / verification messages describe an ATTEMPT, not a completed
 * transaction — and they quote the amount and the merchant, so every phrasing
 * this misses FABRICATES a purchase the user never made. The imperative form
 * ("Use 458213 to ...") is the commonest OTP shape of all and matched none of
 * the original six phrases.
 */
// The Arabic gate has to be here, not bolted on later: an Arabic OTP carries a
// real debit verb (شراء) AND a real amount, so the moment the Arabic
// vocabulary lands, every one of them would post as a purchase that never
// happened.
/**
 * The NOUNS a one-time code is called, in both scripts. On their own these are
 * not evidence of anything: "Do not share your OTP with anyone" is the most
 * widely printed footer on UAE card alerts, and it names the OTP exactly as a
 * real OTP message does. Naming alone therefore cannot be the discriminator —
 * see OTP_RE and OTP_FOOTER_RE below for the two halves it splits into.
 */
const OTP_CODE_WORD =
  String.raw`(?:\botp\b|one[\s-]?time\s+(?:password|pin|code|passcode)|(?:verification|validation|authentication|security|secure|access|confirmation)\s+code|auth(?:oris|oriz)ation\s+code|3-?d\s*secure|\b3ds\b|رمز التحقق|رمز تحقق|كلمه المرور الموقته|كلمه السر لمره واحده)`;
/**
 * A 4-8 digit code, and not a figure. The trailing guard is what keeps a
 * balance out: "AED 5376.00" must never read as a one-time code.
 */
const OTP_CODE_DIGITS = String.raw`(?<![\d.,])\d{4,8}\b(?![.,]\d)`;
/**
 * A message whose SUBJECT is the code itself. The code is quoted, so the
 * message is the challenge and no money has moved — these suppress
 * unconditionally, because there is nothing else in them to protect.
 *
 * The discriminator is the DIGITS, not the noun. "A real OTP always names
 * itself" was the wrong test: a footer telling you never to share your OTP
 * names it too, and matching the bare noun deleted every purchase that carried
 * one — "AED 89.50 spent at CARREFOUR using Debit Card 1234. Avl Bal AED
 * 5,376.00. Do not share your OTP with anyone." vanished, while the identical
 * message ending "...your PIN" was imported. Five characters of footer decided
 * whether the user's money existed.
 */
const OTP_RE = new RegExp(
  // "Your OTP is 458213", "Security code 458213", "3D Secure: 458213",
  // "رمز التحقق ... هو 482910" — the noun and its digits in one clause.
  `${OTP_CODE_WORD}(?:\\s+(?:code|otp|password|pin|number))?\\s*(?:is|:|-|=|هو)?\\s*${OTP_CODE_DIGITS}` +
    `|${OTP_CODE_WORD}[^\\n]{0,48}?(?:\\bis\\b|[:=]|هو)\\s*${OTP_CODE_DIGITS}` +
    `|\\b\\d{4,8}\\s+is\\s+(?:your|the)\\s+(?:[a-z]+[\\s-]?){0,2}(?:code|otp|pin|password|passcode)\\b` +
    `|\\b(?:use|enter)\\s+\\d{4,8}\\s+to\\b` +
    `|(?:code|otp|password|pin)\\s+(?:for|to\\s+complete)\\s+(?:your\\s+)?3-?d\\s*secure`,
  'i',
);
/**
 * FOOTER BOILERPLATE, not evidence of anything.
 *
 * "Do not disclose your PIN", "Never share your OTP", "Bank will never ask for
 * your verification code" and "3D Secure" are stapled to the foot of real
 * POSTED-transaction alerts by issuers all over the UAE — "AED 89.50 spent at
 * CARREFOUR using Debit Card 1234. Balance AED 5,376.00. Do not disclose your
 * PIN." is a purchase that happened. Matched unconditionally and tested first,
 * these phrases DELETED every purchase that carried one.
 *
 * So the whole naming vocabulary lives HERE, behind hasPostedEvidence, and
 * only ever suppresses a message that shows no posted transaction at all. The
 * unconditional half above keeps the messages that quote a code.
 */
const OTP_FOOTER_RE = new RegExp(
  `do not (?:share|disclose|reveal|give)|never (?:share|disclose|reveal|ask)|will never ask|beware of fraud` +
    `|${OTP_CODE_WORD}` +
    `|رمز سري|الرمز السري|لا تشارك|لا تفصح|لا تشاركه|لن يطلب البنك`,
  'i',
);
/**
 * Pre-auth holds are not postings; the real charge arrives as its own SMS, so
 * a missed hold double-counts — and holds live at hotels, car rentals and fuel
 * pumps, which is exactly where the amounts are large.
 */
// "حجز" alone means "booking" — a hotel reservation is a real purchase — so
// only the anchored hold phrasings are listed.
// "pending SETTLEMENT" is deliberately NOT here, and never was safe to add: a
// card purchase sits in "pending settlement" for two or three days AFTER it is
// authorised, and the bank says so on the alert for the purchase itself —
// "AED 250.00 purchase at NOON with Credit Card 4110 is currently pending
// settlement." That is a posting the user must see, and this pattern deleted
// it. Only "pending authorisation" and "pending transaction" describe money
// that has not moved. Note that a genuine hold quoted with a settlement
// footer still dies on the hold phrasing ("debited provisionally ... Pending
// settlement"), which is where the suppression belongs.
const PREAUTH_RE =
  /pre[\s-]?auth|auth(?:oris|oriz)ation\s+hold|\bauth\s+hold\b|amount\s+(?:has been\s+)?blocked|blocked on your card|hold\s+(?:of|on|for|amount|placed)|\bon hold\b|temporary\s+(?:hold|charge|debit)|held on your (?:card|account)|earmark(?:ed)?|ring[\s-]?fenced|reserved on your card|has been (?:reserved|frozen)|provisional(?:ly)?\s+(?:debit|charge)|debited provisionally|pending\s+(?:transaction|authoris|authoriz)|not yet (?:posted|settled)|تم حجز|حجز مبلغ|مبلغ محجوز|تفويض مسبق/i;
/**
 * THE RELEASE OF A HOLD IS THE SETTLEMENT NOTICE, not the hold.
 *
 * The comment above says the real charge "arrives as its own SMS" — and this
 * IS that SMS. Hotels, car rentals and fuel pumps word it exactly this way:
 * "AED 1,500.00 charged at ROVE HOTEL with Credit Card 4110. The authorisation
 * hold has been released." PREAUTH_RE fired on the one sentence that PROVES
 * the money moved, and AED 1,500 disappeared with no row and no error.
 *
 * So the release clause is blanked out before the hold patterns are tested.
 * Anchoring rather than gating on evidence is deliberate: a genuine hold
 * quotes an available balance too ("AED 300.00 has been blocked on your Card
 * 4110. Avl Cr AED 5,000.00"), so an evidence gate would have let every hold
 * through.
 */
const HOLD_RELEASE_RE =
  /(?:(?:the|your|this|an?|earlier|previous|original)\s+)*(?:pre[\s-]?auth(?:oris|oriz)ation|auth(?:oris|oriz)ation|temporary|blocked)?\s*hold(?:[^.\n]|\.\d){0,60}?\b(?:released|reversed|removed|lifted|cleared|refunded)\b|\bpre[\s-]?auth(?:oris|oriz)ation\s+(?:(?:has\s+been|is|was)\s+)?(?:released|reversed|removed|lifted|cleared)\b|\bblocked\s+amount(?:[^.\n]|\.\d){0,40}?\b(?:released|reversed|removed)\b|تم الافراج عن المبلغ المحجوز/gi;
/**
 * A decline says money did NOT move, while the same sentence still carries the
 * purchase verb and the amount — so negative evidence has to beat positive
 * evidence, and the list has to be exhaustive: every refusal phrase missing
 * here becomes a phantom expense. Issuer reason codes ("DO NOT HONOUR", "card
 * expired") arrive with no refusal verb at all and are the signal themselves.
 *
 * "reversed" deliberately does NOT live here any more — see REVERSAL_RE.
 *
 * TIME OUT MARKET DUBAI is a real, high-traffic food hall, and a bare
 * "time-?out" read its name as a reason code: an AED 32 lunch vanished with no
 * row and no error. A refusal is something that happened to the TRANSACTION,
 * so the phrasing has to be the verbal one ("timed out", "transaction
 * timeout") which no descriptor can contain. The same class of collision —
 * a shop whose name contains denied, failed, void, cancelled, invalid or
 * expired — is handled structurally by maskMerchantNames: this whole pattern
 * is tested against a body whose merchant descriptors have been blanked out.
 */
/**
 * THE UAE'S STANDARD FRAUD-REPORTING FOOTER, which is not a decline.
 *
 * "If this was not authorised by you, please call 600 54 0000" is stapled to
 * POSTED card alerts by nearly every issuer in the country, and DECLINED_RE's
 * `not authoris\w*` and `unauthoris` deleted the posting it was attached to.
 * The blast radius was every issuer that uses it.
 *
 * The footer is CONDITIONAL ("if this was not you...") or IMPERATIVE ("report
 * unauthorised use to..."). A real decline states the refusal in the
 * indicative, about the transaction itself: "Your transaction was not
 * authorised." So the footer is blanked out before the decline patterns are
 * tested, and the indicative form still suppresses.
 */
const FRAUD_FOOTER_RE =
  /\bif\s+(?:this|that|it|the\s+(?:above\s+)?(?:transaction|purchase|payment))\b[^.\n]{0,90}|\bif\s+you\s+(?:have\s*n[o']t|did\s*n[o']t|do\s*n[o']t|didn'?t|haven'?t|don'?t)\b[^.\n]{0,90}|\b(?:to\s+report|report|reporting)\s+(?:an?\s+|any\s+)?unauthoris\w*[^.\n]{0,60}|\b(?:to\s+report|report|reporting)\s+(?:an?\s+|any\s+)?unauthoriz\w*[^.\n]{0,60}|\bunauthoris\w*\s+(?:use|transactions?|access|activity)\b[^.\n]{0,40}|\bunauthoriz\w*\s+(?:use|transactions?|access|activity)\b[^.\n]{0,40}|\bin\s+case\s+of\s+(?:any\s+)?unauthoris\w*[^.\n]{0,60}|\bnot\s+(?:done|made|initiated|authoris\w*|authoriz\w*)\s+by\s+you\b/gi;
/**
 * The refusal stated as something that happened TO the transaction.
 *
 * maskMerchantNames blanks the merchant DESCRIPTOR so a shop called TIMEOUT
 * MARKET cannot read as a reason code — but the descriptor swallows whatever
 * follows the shop's name, so masking could also HIDE the refusal: "Your
 * transaction of AED 250.00 at NOON declined due to insufficient funds" was
 * masked down to nothing and imported as a real AED 250 purchase titled "Noon
 * Declined Due To Insufficient Funds".
 *
 * This half is therefore tested against the UNMASKED body, and it can be:
 * every phrase here is verbal or clause-final, and no trade name contains
 * "declined due to", "was rejected" or "failed. Please retry". ACCESS DENIED
 * CAFE and TIME OUT MARKET stay safe because the bare nouns are not here.
 */
const DECLINED_VERB_RE =
  /\b(?:declined|rejected|refused|denied|failed|unsuccessful|timed\s+out)\s+(?:due\s+to|because|owing\s+to|for\s+(?:insufficient|want\s+of))\b|\b(?:was|is|were|are|has\s+been|have\s+been|been)\s+(?:declined|rejected|refused|denied|unsuccessful|dishonou?red)\b|\b(?:declined|rejected|failed|unsuccessful|timed\s+out)\s*[.!:;]|\btransaction\s+(?:has\s+)?(?:declined|failed|rejected)\b|\bplease\s+(?:retry|try\s+again)\b|\bcould\s+not\s+be\s+(?:processed|completed|authoris\w*|authoriz\w*|approved|honou?red)\b/i;
const DECLINED_RE =
  /declin|reject(?:ed|ion)|refused|\bdenied\b|not\s+(?:approved|successful|authoris\w*|authoriz\w*|completed|processed|honou?red)|unapproved|disapproved|unauthoris|unauthoriz|unsuccessful|insufficient|could not be (?:processed|completed|authoris\w*|authoriz\w*|approved|verified|honou?red)|unable to (?:process|complete|authoris\w*|authoriz\w*|approve)|has not been (?:processed|approved|completed)|did not (?:go through|succeed|complete)|\bfail(?:ed|ure|s)\b|was stopped|\baborted\b|\bterminated\b|\bvoided\b|(?:was|is|has been|been)\s+cancell?ed|exceeds\s+(?:your\s+)?(?:available\s+)?(?:limit|balance)|limit exceeded|do not honou?r|card\s+(?:has\s+)?expired|expired card|card is blocked|blocked for (?:online|international)|card restricted|invalid\s+(?:card|cvv|pin|otp|expiry|transaction)|\bis invalid\b|incorrect pin|wrong pin|pin tries exceeded|no response from (?:the\s+)?issuer|\btimed\s+out\b|\b(?:transaction|txn|request|session|connection|response|network|terminal)\s+time-?\s?outs?\b|مرفوض|تم رفض|لم تتم|لم يتم تنفيذ|فشلت|رصيد غير كاف|غير كافي|عدم كفايه|تم عكس|معكوسه/i;
/**
 * Money coming BACK. A reversal is a posting in the opposite direction, not a
 * refusal — but "reversed" sat in the decline list, so every reversal was
 * DISCARDED and the original expense stayed on the ledger with nothing to
 * offset it. Worse, the same event phrased with the noun ("a reversal of AED
 * 500 has been credited") parsed fine: two banks, one event, an AED 500
 * difference decided by grammar.
 *
 * A released pre-auth HOLD is not in here on purpose — the hold was never
 * posted, so crediting it would double-count against the settlement SMS.
 */
const REVERSAL_RE =
  /\brevers(?:ed|al)\b|charge-?\s?backs?\b|credited back|re-?credited|returned to your (?:card|account)/i;
const PROMO_RE =
  /cashback|voucher|promo|discount|t&cs?\b|terms apply|conditions apply|shop now|hurry|limited time|congratulations|you (?:could|can) win|opt-?out|\bdnd\d*\b|bit\.ly|wa\.me|tinyurl|payment plan|bonus|rewards? (?:on|program|draw)|earn \d+x|https?:\/\//i;
/**
 * Evidence that money ACTUALLY moved — banks append promo footers to real
 * alerts ("...Avl Bal AED 5,376. 0% instalments... bit.ly/..."), so promo
 * markers alone must not discard a message that shows a transaction.
 *
 * The bare verbs matter as much as the long forms: PROMO_RE matches
 * "cashback", which is the NAME of the user's own card product, and requiring
 * "purchase of" meant "Your Cashback Card 1234 purchase AED 89.50 at
 * CARREFOUR" was deleted outright. A loyalty footer must never be able to
 * erase a real purchase. "purchase" still needs a figure or a card beside it —
 * on its own it is just as likely to be the OFFER of one ("Complete your first
 * purchase using your e& money card and get AED 15 cashback").
 */
const TXN_EVIDENCE_RE =
  /purchase (?:of|amount)|purchase\s+(?:aed|dhs?|sar)\b|\d{4}\s+purchase\b|was used for|\bused (?:for|at|on)\b|\bspent\b|\bdebited\b|\bdeducted\b|has been (?:debited|deducted|credited|received)|debited from|deducted from|credited to|withdraw|avl\.?\s*(?:bal|cr|limit)|available (?:balance|credit)|bill amount|payment due|due (?:on|by|date)|pay by/i;

/**
 * The SHAPE of a posted transaction, as opposed to a word that happens to
 * appear in the body. TXN_EVIDENCE_RE above is deliberately loose — its job is
 * only to stop a PROMO footer deleting a real alert — and a bare "spent" or
 * "debited" is far too weak to overrule a suppression rule.
 *
 * This one names the CLAUSE: money that moved, in a sentence that says so.
 * "You spent AED 4,320.00 this month with your ADCB Credit Card" carries the
 * verb and a card and a figure, and is still a marketing summary, which is why
 * a summary is recognised by its own shape (SPEND_SUMMARY_RE) rather than by
 * failing this test.
 */
// The clauses on the second line are a FLOOR, not a whitelist of sentence
// shapes. Every one of them is a shape the rest of the parser already reads as
// a posting, and each was missing here — so a refund ("AED 350.00 refunded to
// your Credit Card 4110 by NOON"), an outgoing transfer, and a terse
// field-list alert ("Transaction alert: AED 89.50, CARREFOUR, Debit Card 1234,
// 31/07/2026") all scored as having NO evidence and were deleted by a security
// footer. A deleted refund is money the ledger keeps counting as spent.
const POSTED_CLAUSE_RE =
  /\b(?:purchase|transaction|payment|withdrawal|transfer|debit)\s+of\b|\b(?:has|have)\s+been\s+(?:successfully\s+)?(?:debited|deducted|credited|charged|paid|posted|processed|made|used|reversed|refunded)\b|\bwas\s+(?:successfully\s+)?(?:used|debited|deducted|charged|made|posted|processed|paid|spent)\b|\b(?:spent|debited|deducted|withdrawn|charged|paid|purchase)\s+(?:at|from|on|to|via|using|with)\b|\bavl\.?\s*(?:bal|balance|cr|limit)\b|\bavailable\s+(?:balance|limit|credit)\b|\b(?:refunded|reversed|credited|transferred|remitted|deposited)\s+(?:back\s+)?(?:to|from|into)\b|\b(?:transaction|txn|purchase|payment|card|debit|credit)\s+alerts?\b|\bnew\s+bal(?:ance)?\b|شراء بمبلغ|تم شراء|تم خصم|تم الخصم|تم سحب|تم دفع|تم الدفع|تم استرداد/i;

/**
 * SUPPRESSION MUST NEVER BEAT EVIDENCE.
 *
 * A body carrying an AMOUNT, a CARD or ACCOUNT, and a transaction clause is a
 * posting — whatever else it also contains. This is the gate every
 * boilerplate-shaped suppression rule has to pass before it is allowed to
 * delete a message, so that "do not disclose your PIN" and "3D Secure" go back
 * to being what they are: a footer on a real purchase.
 */
function hasPostedEvidence(raw: string, card: ParsedCard | null): boolean {
  if (!card) return false;
  if (extractAmountFils(raw) === null) return false;
  if (POSTED_CLAUSE_RE.test(raw)) return true;
  // A field-list alert carries an amount, a card, a merchant and a date, and
  // no verb at all — the parser reads it as a purchase everywhere else, so the
  // gate must not apply a stricter standard than the code path it guards.
  return !!extractMerchant(raw, MERCHANT_RE) || !!extractArabicMerchant(raw, raw);
}

/**
 * A monthly SPEND SUMMARY is marketing about the ledger, not an entry in it.
 * "You spent AED 4,320.00 this month with your ADCB Credit Card" fabricated a
 * AED 4,320 purchase that never happened — every dirham of it was already on
 * the ledger, one real transaction at a time.
 *
 * What makes it a summary is that the figure is qualified by a REPORTING
 * PERIOD: no posted-transaction alert has ever said "this month" about the
 * amount it is reporting. It is still gated on the message naming no merchant,
 * so a bank that appends a spend-to-date footer to a real purchase keeps the
 * purchase.
 */
// The gap tolerates a decimal point but not a sentence end: `[^.\n]` alone
// could not cross "AED 4,320.00", so the rule never fired on the one message
// it was written for.
//
// A REPORTING PERIOD is a reporting period whether it is spelled "this month",
// "in the last 30 days" or "year to date". Covering only the first spelling
// left the sibling shapes fabricating the same AED 4,320 purchase.
const REPORTING_PERIOD = String.raw`(?:(?:this|last|current|past)\s+(?:month|week|year|quarter|billing\s+(?:cycle|period))|(?:in|over|during|for)\s+the\s+(?:last|past)\s+\d{1,3}\s+(?:days?|weeks?|months?)|(?:year|month|week|quarter)[\s-]?to[\s-]?date|to\s+date\b|so\s+far\s+this\s+(?:month|week|year))`;
const SPEND_SUMMARY_RE = new RegExp(
  String.raw`\bspent\b(?:[^.\n]|\.\d){0,60}?\b${REPORTING_PERIOD}` +
    String.raw`|\bso\s+far\s+this\s+(?:month|week|year)\b|\b(?:total|monthly|weekly|yearly)\s+spend(?:ing|s)?\b|\bspend(?:ing)?\s+(?:summary|breakdown|report|insights?|analysis)\b|\byour\s+(?:month|week)\s+in\s+review\b|انفقت خلال هذا الشهر|ملخص الانفاق`,
  'i',
);

/**
 * AN OFFER QUOTES A HYPOTHETICAL FIGURE.
 *
 * "Enjoy 0% instalment plans on purchases above AED 1,000.00 with your Mashreq
 * card" fabricated a AED 1,000 purchase, and "Offer: Purchase of AED 250.00 at
 * any store earns you double points" fabricated a AED 250 one. A threshold to
 * qualify for and a price at NO PARTICULAR SHOP are not postings: there is no
 * card, no merchant and no posting verb behind them.
 *
 * Gated on hasPostedEvidence all the same, so a bank that staples an offer to
 * a real alert keeps the transaction.
 */
const OFFER_RE =
  /^\s*(?:offer|promo(?:tion)?|deal)\s*[:!-]|\bpurchases?\s+(?:above|over|worth|starting\s+(?:at|from))\s+(?:aed|dhs|sar)\b|\bat\s+any\s+(?:store|shop|merchant|outlet|retailer|branch)\b|\bon\s+purchases\s+(?:above|over)\b/i;

/**
 * A FUTURE OR SCHEDULED EVENT HAS NOT MOVED ANY MONEY — and the bank sends the
 * real alert when it does, so posting it now counts it twice.
 *
 * "Your salary of AED 15,000.00 will be credited on 25 Aug", "A payment of AED
 * 1,000.00 is scheduled from your account 1234 tomorrow" and "Loan instalment
 * of AED 2,500.00 will be deducted from account 1234 on 05 Aug" were all
 * booked today, and every one of them arrives again as a real debit or credit.
 *
 * Anchored, not blanket: the modal has to GOVERN the money verb, and a message
 * that also states the money already moved keeps its row (a real posting with
 * a "the next instalment will be deducted on 05 Sep" footer is common).
 */
/** A schedule states its own tense: nothing has been posted yet. */
const SCHEDULED_CLAUSE_RE =
  /\b(?:is|are|has\s+been|have\s+been|will\s+be)\s+scheduled\b(?:[^.\n]|\.\d)*|\bscheduled\s+(?:payment|transfer|debit|instruction)\b(?:[^.\n]|\.\d)*|\bstanding\s+instruction\s+(?:is|will)\b(?:[^.\n]|\.\d)*/gi;
const FUTURE_CLAUSE_RE =
  /\b(?:will|shall|would|going\s+to)\s+(?:not\s+)?(?:be\s+)?(?:auto[\s-]?)?(?:debited|deducted|credited|charged|applied|paid|posted|processed|collected|taken|transferred|withdrawn|deduct|debit|charge|credit)\b(?:[^.\n]|\.\d)*|\bscheduled\s+(?:for|on|to\s+be)\b(?:[^.\n]|\.\d)*|سيتم\s+(?:خصم|اضافه|تحويل)(?:[^.\n]|\.\d)*/gi;
/**
 * Tense evidence that the money ALREADY moved. A future or scheduled clause
 * sitting beside one of these is a footer on a real posting, not a forecast.
 */
const SETTLED_TENSE_RE =
  /\b(?:has|have|had)\s+been\s+(?:successfully\s+)?(?:debited|deducted|credited|charged|paid|posted|processed|made|used|reversed|refunded|received|withdrawn|transferred|spent|blocked)\b|\bwas\s+(?:successfully\s+)?(?:debited|deducted|credited|charged|paid|spent|used|made|posted|processed|withdrawn|transferred|reversed|refunded)\b|\bwere\s+(?:debited|credited|charged|deducted)\b|\b(?:spent|debited|deducted|withdrawn|charged|purchased)\s+(?:at|from|on|via|using|with)\b|\bavl\.?\s*(?:bal|balance|cr|limit)\b|\bavailable\s+(?:balance|limit|credit)\b|\bnew\s+bal(?:ance)?\b|تم خصم|تم الخصم|تم شراء|تم سحب/i;
/**
 * A returned, bounced or dishonoured cheque is money that did NOT leave the
 * account. It is stated in the perfect tense ("has been returned unpaid"), so
 * the future gate cannot see it and DECLINED_RE never carried the wording.
 */
const RETURNED_UNPAID_RE =
  /\b(?:cheque|check|chq)\b[^\n]{0,60}?\b(?:returned|bounced|dishonou?red|unpaid|not\s+honou?red)\b|\breturned\s+unpaid\b|\bcheque\s+return(?:ed)?\b|شيك مرتجع|شيك معاد/i;

/**
 * Currency-bound patterns compile from the ACTIVE MARKET's currency aliases
 * (AED/Dhs for the UAE, SAR/SR for Saudi...) and are lazily recompiled when
 * the market changes. Everything else in the grammar is market-agnostic.
 */
let AED_AMOUNT_RE = /x^/g;
let AED_SUFFIX_RE = /x^/g;
let MIN_DUE_RE = /x^/;
let TOTAL_DUE_RE = /x^/;
let AR_MIN_DUE_RE = /x^/;
let AR_TOTAL_DUE_RE = /x^/;
let OUTSTANDING_RE = /x^/;
let BARE_BALANCE_RE = /x^/;
let CARD_PAYMENT_RE = /x^/;
let DEBIT_WORDS = /x^/;
let PAYMENT_FOR_RE = /x^/;
let FX_PREFIX_RE = /x^/;
let FX_SUFFIX_RE = /x^/;
let compiledForMarket = '';

/**
 * The words that may sit between "your" and "card" in a card-settlement
 * clause. They are the PRODUCT NAME and nothing else — "your ADIB Covered
 * Card", "your RAKBANK Credit Card" — which is why the gap had to be widened
 * past one word in the first place.
 *
 * Tempering it is what stops the phrase crossing into the next clause. Each of
 * the listed words ENDS the noun phrase (a bill is not a card; "using" starts
 * a new prepositional phrase), so none of them can appear inside a card's own
 * name, and a card reached through one of them was never what the payment was
 * made towards.
 */
const CARD_GAP =
  String.raw`(?:(?!(?:bill|invoice|loan|finance|mortgage|account|utility|electricity|water|instal?ment|using|via|with|through|from|to|for|by|on|at|and|of)\b)\w+\s+){0,3}?card`;

/** Units of each currency per 1 USD — cross rates derive from this table. */
const UNITS_PER_USD: Record<string, number> = {
  USD: 1, AED: 3.6725, SAR: 3.75, EUR: 0.85, GBP: 0.74, QAR: 3.64,
  KWD: 0.307, BHD: 0.377, OMR: 0.385, INR: 83.5, PKR: 283, PHP: 56,
  EGP: 48, CAD: 1.37, AUD: 1.52, JPY: 150, CNY: 7.2, CHF: 0.8, TRY: 41,
};

function ensureCurrencyPatterns(): void {
  const m = getActiveMarket();
  if (compiledForMarket === m.id) return;
  compiledForMarket = m.id;
  // The aliases are folded with the same function the MESSAGE is folded with.
  // Without this the UAE symbol regresses to null the moment normalisation
  // lands: the pack writes "د\.إ", the input becomes "د.ا", and they stop
  // matching. Folding only touches Arabic letters, digits and separators —
  // never a backslash or a dot — so folding a regex SOURCE is safe.
  const CUR = m.currency.aliases.map(foldOrthography).join('|');
  AED_AMOUNT_RE = new RegExp(`(?:${CUR})\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'gi');
  // The trailing guard covers Arabic too: without it "50 دار" would read its
  // first two letters as the currency symbol and invent an amount.
  AED_SUFFIX_RE = new RegExp(
    `([\\d,]+(?:\\.\\d{1,2})?)\\s*(?:${CUR})(?![A-Za-z${AR_LETTER}])`, 'gi');
  MIN_DUE_RE = new RegExp(
    `min(?:imum)?\\s+(?:(?:amount\\s+)?due(?:\\s+amount)?|payment(?:\\s+of)?)\\s*(?:of|:|is)?\\s*(?:${CUR})\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
  TOTAL_DUE_RE = new RegExp(
    `total\\s+(?:amount\\s+due|due|billed\\s+am(?:oun)?t)\\s*(?:is|:)?\\s*(?:${CUR})\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
  // Arabic renders the currency AFTER the figure as often as before it
  // ("3,240.00 درهم"), so both due patterns make it optional on the left.
  // MIN_DUE_RE was English-only, which left every Arabic statement with a null
  // minimum — and a statement with no minimum produces no reminder.
  AR_MIN_DUE_RE = new RegExp(
    `(?:الحد الادني للدفع|الحد الادني المستحق|الحد الادني)\\s*(?:هو|:)?\\s*(?:${CUR})?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
  AR_TOTAL_DUE_RE = new RegExp(
    `(?:اجمالي المبلغ المستحق|المبلغ الاجمالي المستحق|اجمالي المستحق)\\s*(?:هو|:)?\\s*(?:${CUR})?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
  OUTSTANDING_RE = new RegExp(
    `\\boutstanding(?:\\s+(?:amount|balance))?\\s*(?:is|:|of)?\\s*(?:${CUR})?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
  // A bare "Balance AED 9774.87" line. This is the balance footer of the
  // BIGGEST family in the real corpus (the multi-line block, #6/#13/#42/#101…)
  // and of every Wio shape, and neither SNAPSHOT_RE (which wants an
  // avl/available/remaining/total prefix) nor PLAIN_BALANCE_RE (which wants
  // your/current/new/net/a-c) could see it — so the corpus split silently into
  // a balance-bearing half and a balance-less half depending on whether the
  // bank happened to write "Available".
  //
  // Tight on purpose: the word has to OPEN a line or a clause and the currency
  // has to follow it immediately, so a passing mention ("...and the balance
  // updated") quotes nothing. A masked figure ("Balance AED ····5193.16")
  // fails the digit class and stays unknown rather than being guessed at.
  BARE_BALANCE_RE = new RegExp(
    `(?:^|[\\n.;])\\s*bal(?:ance)?\\s*(?:is|:)?\\s*(?:${CUR})\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
  // The word gap between "your" and "card" was ONE word, and the product name
  // every Islamic and most conventional issuers use is two — "your ADIB
  // Covered Card", "your RAKBANK Credit Card". A card-BILL settlement was
  // therefore parsed as fresh spending titled "Card purchase" with no transfer
  // hint: the exact double-count this branch exists to prevent, since the
  // card's own statement is already on the ledger.
  //
  // The second alternative is a word-order variant, not a synonym: "We have
  // received your payment of AED X towards your ... Card" puts "your" before
  // "payment", which the received/credited/processed form cannot reach however
  // wide its word gap is.
  //
  // The gap is TEMPERED (see CARD_GAP): widening it to three bare words let
  // the phrase step out of its own clause and land on a card mentioned in the
  // next one — "payment of AED 200.00 has been received for your electricity
  // bill using card 1234" was booked as a card settlement, so a real AED 200
  // utility bill left the spending total (transferHint means "not spending")
  // and the debit card was re-typed as credit.
  CARD_PAYMENT_RE = new RegExp(
    `payment\\s+(?:of\\s+(?:${CUR})\\s*[\\d,.]+\\s+)?(?:is\\s+|was\\s+|has\\s+been\\s+)?(?:received|credited|processed)\\s+(?:towards?|to|on|for)\\s+(?:your\\s+)?${CARD_GAP}` +
      `|received\\s+your\\s+payment\\s+(?:of\\s+(?:${CUR})\\s*[\\d,.]+\\s+)?(?:towards?|to|for|against)\\s+(?:your\\s+)?${CARD_GAP}` +
      `|payment\\s+of\\s+(?:${CUR})\\s*[\\d,.]+\\s+against\\s+(?:your\\s+)?${CARD_GAP}` +
      `|received\\s+payment\\s+for\\s+your\\s+${CARD_GAP}` +
      `|thank\\s+you\\s+for\\s+(?:your\\s+)?payment[^\\n]{0,48}?(?:towards?|to|for|against)\\s+(?:your\\s+)?${CARD_GAP}` +
      `|card\\s+(?:no\\.?\\s*)?[\\dXx*•]*\\s*has\\s+been\\s+paid`, 'i');
  // "Payment for GINNYS PLUS TRADING of AED 2.25 has been made using Credit
  // Card ending with 4110." The payee sits BEFORE the amount with none of the
  // prepositions MERCHANT_RE looks for, so every message in this format
  // arrived titled "Card purchase" — a third of one user's unread report, and
  // rows that could never group into a merchant or a subscription.
  PAYMENT_FOR_RE = new RegExp(
    `payment\\s+for\\s+([A-Za-z0-9][^\\n]{1,48}?)\\s+of\\s+(?:${CUR})\\s*[\\d,]`, 'i');
  // "was used" but not "has been used" cost the whole perfect tense — the
  // commonest verb form in UAE card alerts. On a credit card the message then
  // flipped to income; on an Islamic "Covered Card", which names neither
  // credit nor debit, it matched nothing at all and the purchase VANISHED.
  // The trailing card clause covers alerts with no verb whatsoever
  // ("AED 250.00 to ETISALAT via Credit Card 1234").
  DEBIT_WORDS = new RegExp(
    `purchase|debit(?:ed)?|deducted|spent|paid|payment(?!\\s+(?:due|of\\s+(?:${CUR})[\\d,. ]+(?:is\\s+)?received))|withdraw(?:n|al)?|\\bused\\b|utilis(?:e|ed)|utiliz(?:e|ed)|swiped|tapped|transacted|transaction\\s+(?:of|amount)|cash\\s+advance|charged|(?:via|using|through)\\s+(?:your\\s+)?(?:credit|debit|covered|charge|prepaid)\\s+card` +
      // "AED 500 has been TRANSFERRED from your account to MOHAMMED ALI" named
      // no verb either list knew — only the opposite-direction phrase
      // "transferred to your" was listed — so an outgoing transfer returned
      // null and the money simply vanished from the ledger while the balance
      // the app showed drifted from the real one. Money only ever disappeared
      // OUTWARDS, which is what kept it invisible. Direction is still decided
      // by the clause (transferred FROM your / TO your), never by this word.
      `|transferr(?:ed|ing)` +
      `|${AR_DEBIT_WORDS}`, 'i');
  const codes = Object.keys(UNITS_PER_USD).filter((c) => c !== m.currency.code).join('|');
  FX_PREFIX_RE = new RegExp(`\\b(${codes})[^\\S\\r\\n]*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
  // Same line only. "Card No XXXX4777 \n USD .00" used to read the card's last
  // four digits as USD 8,722 and file a 32,031.55 purchase for a message whose
  // amount was masked out entirely.
  FX_SUFFIX_RE = new RegExp(`([\\d,]+(?:\\.\\d{1,2})?)[^\\S\\r\\n]*(${codes})\\b`, 'i');
}

/**
 * Banks redact the leading digits of a figure: "Avl Bal AED ····9235.93",
 * "AED ····0000.00", "Card No XXXX4777". What survives is a FRAGMENT, not the
 * number. Reading it recorded a 9,235.93 balance for an account that might
 * hold 129,235.93, so any figure whose digits are preceded by a mask run is
 * unknowable and gets dropped rather than guessed.
 */
const MASKED_PREFIX_RE = /(?:[·•*]|[Xx]{3,})[^\S\r\n]*$/;
function isMaskedFigure(raw: string, index: number): boolean {
  return MASKED_PREFIX_RE.test(raw.slice(Math.max(0, index - 12), index));
}

/** Minor units of the ACTIVE currency per 1 unit of `code`. */
function fxMinorPerUnit(code: string): number {
  const mine = UNITS_PER_USD[getActiveMarket().currency.code] ?? 1;
  const theirs = UNITS_PER_USD[code];
  return (mine / theirs) * 100;
}
/**
 * Foreign-currency fallback: online subscriptions (ChatGPT, Claude, PayPal
 * charges...) often arrive as "USD 20.00" with no local-currency figure at
 * all. Rather than dropping the transaction, convert with an approximate
 * cross rate into the active market's currency. A local amount anywhere in
 * the message always wins over conversion.
 */
function extractForeignAmountFils(raw: string): number | null {
  const pre = raw.match(FX_PREFIX_RE);
  const suf = pre ? null : raw.match(FX_SUFFIX_RE);
  const code = (pre?.[1] ?? suf?.[2])?.toUpperCase();
  const num = pre?.[2] ?? suf?.[1];
  if (!code || !num || !(code in UNITS_PER_USD)) return null;
  // Where the digits start: after the code for the prefix form, at the match
  // for the suffix form.
  const at = pre ? (pre.index ?? 0) + pre[0].length - num.length : (suf?.index ?? 0);
  if (isMaskedFigure(raw, at)) return null;
  const fils = Math.round(Number(num.replace(/,/g, '')) * fxMinorPerUnit(code));
  if (!Number.isFinite(fils) || fils <= 0 || fils > MAX_PLAUSIBLE_AMOUNT_FILS) return null;
  return fils;
}
/**
 * A single SMS transaction above AED 1,000,000 is almost certainly a misread
 * balance, loan figure, or reference number — never spending.
 */
const MAX_PLAUSIBLE_AMOUNT_FILS = 100_000_000;
// "is NOW AED 50,000.00" is the same balance sentence as "is AED 50,000.00",
// and without the adverb the figure read as a transaction amount: "Thank you
// for your payment towards your RAKBANK Credit Card ending 4711. Your
// available limit is now AED 50,000.00" was imported as a AED 50,000 card
// payment, and auto-import turned the same figure into a CardDue of AED 50,000
// with a AED 2,500 minimum — thousands of dirhams of debt that does not exist.
const BALANCE_PREFIX_RE =
  /(?:bal(?:ance)?|avl|avail(?:able)?|limit|outstanding|total|الرصيد المتاح|الرصيد الحالي|الحد المتاح|المتاح|الرصيد|رصيدك)\s*(?:is|:|\.|-|هو)?\s*(?:now|currently|الان)?\s*$/i;

/** Card identity: "Credit Card ending 1234", "Debit Card ..5678", "a/c XX9012", "card no. *1234". */
// "Covered Card" is what every Sharia-compliant issuer (DIB, ADIB, EIB, Ajman,
// SIB) calls its credit card — the words "credit card" never appear. Reading
// it as a debit card filed the card wrong AND stored its available HEADROOM as
// cash in an account, silently inflating net worth by a full credit limit.
const CARD_KIND_WORDS = /credit|covered|charge/i;
// The mask run is a SEPARATE optional piece from the word "ending", not one of
// a set of alternatives to it. ADCB really sends "Credit Card ending *** 6383"
// — the stars are the bank's own masking, not the accuracy report's — and an
// alternation could only ever match one of the two, so both real corpus
// messages in that format lost their card identity entirely and their rows
// could not be attached to any account.
const CARD_RE =
  /(credit|debit|covered|charge|prepaid)?\s*card(?:\s*(?:no\.?|number))?\s*(?:ending(?:\s+(?:in|with))?)?\s*(?:\.\.+|x+|\*+|[·•]+)?\s*(\d{4})\b/i;
const ACCOUNT_RE =
  /a\/?c(?:count)?\s*(?:no\.?|number)?\s*(?:ending(?:\s+in)?|\.\.+|x+|\*+|[·•]+)?\s*(\d{4})\b/i;
/** Fully masked PAN like "4782********4833" — the LAST four digits identify the card. */
const MASKED_PAN_RE = /\b\d{4,6}[Xx*•]{2,}(\d{4})\b/;
/**
 * Arabic attaches its possessives, so the card noun arrives as بطاقة /
 * البطاقة / بطاقتك / بالبطاقة — one STEM, five surface forms. Matching the
 * stem is what makes a single rule cover them all. "الائتمانية" (folded to
 * "الايتمانيه") is the Islamic-and-conventional word for credit; "الخصم" is
 * debit.
 */
const AR_CARD_KIND = 'الايتمان';
const AR_CARD_RE = new RegExp(
  `بطاق[${AR_LETTER}]{0,4}\\s*(${AR_CARD_KIND}[${AR_LETTER}]{0,3}|الخصم)?[^\\d\\n]{0,28}?(\\d{4})(?!\\d)`,
);
const AR_ACCOUNT_RE = new RegExp(
  `حساب[${AR_LETTER}]{0,3}\\s*(?:رقم)?[^\\d\\n]{0,20}?(\\d{4})(?!\\d)`,
);

// Auxiliaries and conjunctions end the descriptor and start a sentence about
// it. Without them the rest of the sentence became part of the name — "Acme
// Llc As Payment", "Zara And The" — and those rows can never group with the
// real merchant, so totals, subscriptions and category overrides all fragment.
// "and"/"but" are stopped only before "the": MARK AND SAVE is a shop.
const MERCHANT_STOP =
  // The Arabic block is a terminator too: "at CARREFOUR\nشراء بمبلغ..." is one
  // bilingual alert, and with no Arabic stop token the English merchant match
  // simply failed and the row arrived titled "Account debit".
  String.raw`(?=\s*(?:[\u0600-\u06FF]|,|\.|;|\bon\b|\bwith\b|\busing\b|\bvia\b|\bending\b|\bcard\b|\ba\/c\b|\bacc(?:ount)?\b|\bref\b|\btxn\b|\bdated\b|\bavl\b|\bavail(?:able)?\b|\bbal(?:ance)?\b|\botp\b|\bfor\b|\bis\b|\bhas\b|\bhave\b|\bwas\b|\bwere\b|\bare\b|\bbeen\b|\bwill\b|\bdid\b|\bdoes\b|\bcould\b|\bwould\b|\bshould\b|\bas\b|\band the\b|\bbut the\b|\baed\b|\bdhs\b|\bsar\b|\busd\b|\beur\b|\bgbp\b|$))`;
// "%" leads a real brand ("% ARABICA"); "·•" appear inside acquirer terminal
// IDs ("BLOOMFIELD TREAT-····5814"). Both used to break the match outright and
// cost the whole merchant name.
const MERCHANT_RE = new RegExp(
  // The optional domain tail keeps "CAPITAL.COM" and "Name.com, Inc" whole —
  // MERCHANT_STOP treats "." as a sentence end, so both used to arrive as
  // "Capital" and "Name".
  String.raw`(?:\bat|\bto|\bfrom|@)\s+([A-Za-z0-9%][A-Za-z0-9%·• &'\-*/()]{1,40}?(?:\.(?:com|ae|net|org|io|co)\b)?)` +
    MERCHANT_STOP,
  'gi',
);
/**
 * The Arabic merchant clause: "لدى كارفور", "في مطعم الطازج".
 *
 * Three things here are load-bearing.
 *
 * 1. The preposition needs a LEFT boundary, and `\b` cannot give one — Arabic
 *    letters are not `\w`. Without `(?:^|[^ء-ي])`, "الي" matches inside
 *    "الآلي" (as in "الصراف الآلي", the ATM) and the machine becomes the shop.
 * 2. The plumbing stop-list is a negative lookahead INSIDE the pattern, not a
 *    `continue` in the caller. As a `continue` the global exec had already
 *    consumed past the real payee, and "من بطاقتك المنتهية ب4833 لدى مطعم
 *    الطازج" came back whole as the merchant name.
 * 3. "من" (from) is the dangerous one: it introduces the payee AND the card or
 *    account the money left. The lookahead is what tells them apart.
 */
const AR_NOT_MERCHANT =
  'حساب|الحساب|بطاق|البطاق|رصيد|الرصيد|جهاز|مبلغ|المبلغ|تاريخ|خلال|صراف|الصراف|رقم|خلال';
// The stop list has to know the BARE CONNECTORS too. ADIB, DIB and Emirates
// NBD write the payee and the funding card in the order "لدى <merchant>
// <connector> بطاقتك", and with no stop for the connector the capture ran
// straight through it: "كارفور باستخدام" instead of "كارفور". The same shop
// then has one identity per word order — four of them were reachable — and
// every merchant override, subscription grouping and per-merchant total
// fragments between them.
//
// باستخدام ("using your card") is the commonest of the four, more common than
// the من case; بواسطة, على and عبر complete the set. Every one of them is
// stopped ONLY when the PLUMBING follows it (باستخدام بطاقتك، من حسابك), never
// on its own: Arabic trade names begin with these words ("منازل الشام", "علي
// بابا") and a bare stop would cut those in half — the same bug pointed the
// other way.
const AR_CONNECTOR = 'من|باستخدام|بواسطه|علي|عبر|عن طريق|بحسابك';
const AR_MERCHANT_RE = new RegExp(
  `(?:^|[^${AR_LETTER}])(?:لدي|في|الي|عند|من)\\s+(?!(?:${AR_NOT_MERCHANT}))` +
    `([${AR_LETTER}][${AR_LETTER}0-9 '\\-&.]{1,40}?)` +
    `(?=\\s*(?:[,.;:\\n]|بالبطاق|بطاقت|البطاق|بطاق|حساب|بتاريخ|بمبلغ|الرصيد|رصيد|المتاح|(?:${AR_CONNECTOR})\\s+(?:${AR_NOT_MERCHANT})|$))`,
  'g',
);

/**
 * Acquirer terminal ID glued to the descriptor: "GALADARI ICE CRE-151022".
 *
 * The version of this that only matched "····" was chasing a ghost: those dots
 * are the accuracy REPORT's own masking of digit runs, applied on export, not
 * something any bank sends. On the device the text is plain digits, so the
 * rule never fired where it mattered and "Bloomfield Treat-245814" stayed
 * split from "Bloomfield Treat".
 */
const TERMINAL_ID_RE = /[-\s]+(?:[·•X]{2,}\d*|\d{4,})$/i;

// The date needs a lead-in word, and a NOUN is as valid a lead-in as a
// preposition: RAKBANK writes "Due date 18/08/2026" and Mashreq "Payment due
// date 18/08/2026" where ENBD writes "due on". One missing word left both
// banks' statements with date null and therefore dueDay null — and a
// cardStatement with no due day raises no reminder at all, so the user simply
// misses the payment.
const DATE_RE =
  /(?:\b(?:on|by|before|is)\b|\bdue\s+date\b|\bvalue\s+date\b|بتاريخ|تاريخ الاستحقاق|حتي تاريخ|بحلول)\s*:?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i;
// "03/07/26 05:53" — a bare date WITH a time is the transaction timestamp and
// beats any "statement due on <date>" footer later in the message.
const DATETIME_RE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\s+\d{1,2}:\d{2}(?!\d)/;

// "الآلي" folds to "الالي" — a rule written with the madda can never fire.
const ATM_RE = /\batm\b|cash\s+withdrawal|\bwithdrawn\b|سحب نقدي|الصراف الالي|صراف الي|جهاز الصراف/i;
const FEE_RE =
  /\bfees?\b|\bcharges?\s+(?:of|:)|service charge|\bvat\b|annual membership|رسوم|رسم خدمه|ضريبه القيمه المضافه/i;
const DEPOSIT_RE = /cash\s+deposit|\bcdm\b|deposit(?:ed)?\s+(?:in|into|to)\b|ايداع نقدي|جهاز الايداع/i;

/**
 * Multi-line bank formats put the merchant on its own line with no
 * preposition at all:
 *   Credit Card Purchase / Card No XXXX4711 / EUR 2.99 /
 *   ALLDEBRID.COM MONTROUGE FRA / 03/07/26 05:53 / Avl Bal AED 13107.74
 * The first line after the amount line that isn't a date, card, or balance
 * line is the merchant descriptor.
 */
// "purchase" is deliberately NOT bare: real descriptors contain it
// ("WL *STEAM PURCHASE"), and dropping those lines cost the merchant. The
// plural form and the "card purchase" header are the noise.
const LINE_NOISE_RE =
  /\bcard\b|a\/?c\b|\baccount\s+(?:no|number|xx)|\bbal(?:ance)?\b|\blimit\b|statement|\bdue\b|payment\s+channel|\bpayment\b(?!\s*[A-Za-z])|purchases\b|purchase\s+of\b|debited|credited|\botp\b|\bref(?:erence)?\b|\btxn\b|\bavl\b|avail|value date|^date\b|paid upto|transaction\s+(?:date|time|id|ref)|mode\s+of\s+payment|amount\s+(?:due|paid)|^remaining\b/i;
const LINE_DATE_RE = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/;
const TRAILING_PLACE_RE =
  /\s+(?:DXB|DUBAI|ABU DHABI|SHARJAH|AJMAN|ARE|UAE|FRA|USA|GBR|DEU|NLD|ESP|ITA|IRL|SGP|HKG|IND|SAU|KSA|LUX|CAN|AUS|CHE|SWE|POL|JPN|RIYADH|JEDDAH|QAT|GHA|KWT|BHR|OMN|JOR|LBN|EGY|TUR|THA|MYS|KOR|CHN|PAK|LKA|PHL|BGD|ZAF|KEN|NGA|MAR|GRC|PRT|BEL|AUT|DNK|NOR|FIN|CZE|RUS|BRA|MEX|NZL|VNM|IDN|TWN|MCO|LIE)$/i;

/**
 * Emirates and cities acquirers append to the descriptor field.
 *
 * The stray-letter allowance only applies when the place is SEPARATED from
 * the name ("AL NIMAR AL ABYADHd SHARJAH" — acquirer corruption). Allowing it
 * on a glued place ate the real last character of every truncated name:
 * "FRIENDS AVENUE CATERINDUBAI" came back as "Friends Avenue Cateri".
 */
const PLACE_TAIL_RE =
  /(?:[-\s]+[A-Za-z]?)?(?:DXB|DUBAI|ABU ?DHABI|SHARJAH|AJMAN|FUJAIRAH|UMM AL QUWAIN|AL AIN|RAK)$/i;

/**
 * Strips the noise an acquirer wraps around a merchant name.
 *
 * The descriptor is a fixed-width field, so the city is regularly glued
 * straight onto a truncated name with no separator at all — "DUBAI INTEGRATED
 * ECONODUBAI", "FRIENDS AVENUE CATERINDUBAI", "Ziina  *CLEANTIZER SERDubai".
 * Splitting only on whitespace left the emirate inside the merchant, so the
 * same shop arrived under a different name from every bank that reported it
 * and no merchant override could ever cover them all.
 */
function cleanDescriptor(name: string): string {
  let out = name
    .replace(/\s*\([^)]*\)?\s*/g, ' ') // "noon Food(Noon ECommerce)" → "noon Food"
    // Leading acquirer terminal id, masked on export: "····8730 TGI FRIDAYS".
    .replace(/^[·•X]{2,}\d*\s+/i, '')
    .replace(/^(?:pos|tap|wl|sq|alp|eig|web|google|paypal|apl|amzn|mamo|ziina)\s*\*\s*/i, '')
    // Google bills through a help URL, not a location: "GOOGLE*FINART AI EXPE
    // G.CO/HELPPAY#CA US".
    .replace(/\s+G\.CO\/\S+(?:\s+[A-Za-z]{2,3})?$/i, '')
    .replace(TERMINAL_ID_RE, '') // "BLOOMFIELD TREAT-····5814"
    .replace(/[\s,]*\+[\d·•X\s-]{6,}$/i, '') // "MUZZ LTD +····1111"
    .replace(/[-\s]*\b(?:AE|ARE|UAE|BH|BHR|SA|KSA|US|USA|GB|IN)$/i, '')
    .trim();
  // Peel repeatedly: "TGI FRIDAYS DUBADUBAI" carries two. Never peel a name
  // down to nothing — a shop really can be called Dubai something.
  let prev = '';
  let peeledPlace = false;
  while (prev !== out) {
    prev = out;
    const peeled = out.replace(PLACE_TAIL_RE, '').trim();
    if (peeled !== out && (peeled.match(/[A-Za-z]/g) ?? []).length >= 3) {
      out = peeled;
      peeledPlace = true;
    }
  }
  // "AL NIMAR AL ABYADHdSHARJAH" → the lone lowercase letter left behind by
  // the peel is acquirer corruption, not the end of the name.
  if (peeledPlace && /[A-Z][a-z]$/.test(out)) out = out.slice(0, -1).trim();
  return out.replace(/(?:\s+COM|\.com)$/i, '').trim();
}

function merchantFromLines(raw: string): string {
  if (!raw.includes('\n')) return '';
  const codes = [
    ...Object.keys(UNITS_PER_USD),
    // Folded for the same reason ensureCurrencyPatterns folds them: the text
    // this runs against has already been normalised.
    ...getActiveMarket().currency.aliases.map(foldOrthography),
  ].join('|');
  const amountLineRe = new RegExp(`\\b(?:${codes})\\.?\\s*[\\d,]+(?:\\.\\d{1,2})?`, 'i');
  const lines = raw.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  const amountIdx = lines.findIndex((l) => amountLineRe.test(l));
  if (amountIdx < 0) return '';
  for (const line of lines.slice(amountIdx + 1)) {
    if (LINE_DATE_RE.test(line)) continue;
    if (LINE_NOISE_RE.test(line)) continue;
    if (amountLineRe.test(line)) continue;
    if ((line.match(/[A-Za-z]/g) ?? []).length < 3) continue;
    // Acquirer descriptors are fixed-width fields padded with spaces:
    // "EXINITY ME LTD        Dubai           AE" and
    // "WL *STEAM PURCHASE    425-889-9642 WA US". Only drop the tail when it
    // actually looks like the acquirer's location/phone block — "Ziina  *qasr
    // al zain m Sharjah ARE" pads inside the merchant name, and cutting there
    // left the payment gateway as the merchant.
    const pad = line.search(/\s{2,}/);
    const tail = pad < 0 ? '' : line.slice(pad).trim();
    let cleaned =
      tail && /^[\d\s+()-]{6,}|^[A-Za-z .]{1,30}\s+[A-Z]{2,3}$/.test(tail)
        ? line.slice(0, pad).trim()
        : line.replace(/\s{2,}/g, ' ');
    let prev = '';
    while (prev !== cleaned) {
      prev = cleaned;
      cleaned = cleaned.replace(TRAILING_PLACE_RE, '');
    }
    cleaned = cleanDescriptor(cleaned);
    if (cleaned.length >= 2 && cleaned.length <= 48) return cleaned;
  }
  return '';
}

/** Debit messages that are actually transfers: paying a card bill, moving between own accounts. */
// The Arabic side uses the card STEM ("سداد بطاقتك"), so a literal "بطاقه"
// would miss every possessive form.
const TRANSFER_HINT_RE =
  /(?:towards?|for)\s+(?:payment\s+of\s+)?(?:your\s+(?:credit\s+)?card|credit\s+card|card\s+(?:no\.?\s*)?[\dXx*•])|credit\s+card\s+(?:bill\s+)?payment|c\/?c\s+payment|cc\s*pymt|crd\s*pmt|card\s*e-?pay|card\s+settlement|own\s+account\s+transfer|transfer\s+to\s+(?:your\s+)?own\s+account|self\s+transfer|inward\s+remittance|سداد بطاق|سداد البطاق|تسديد بطاق|دفعه لبطاق|تحويل بين حساباتك|تحويل الي حسابك|حواله داخليه/i;

const CATEGORY_KEYWORDS: [RegExp, CategoryId][] = [
  // First, because a direct-debit instalment names a bank and would otherwise
  // fall through every other rule into "other". These three phrasings are
  // specific to standing debt instructions, not to utility direct debits.
  [/\bDD\s+instal?lments?\b|\bDDR\s+Reference\b|Direct\s+Debit\s+Service\s+Instructions?|\b(?:loan|finance|emi)\s+instal?lment\b|\b(?:car|auto|vehicle|home|personal|mortgage)\s+(?:loan|finance)\b|\bloan\s+(?:repayment|account|a\/c)\b|\binstal?lment\s+(?:due|paid|debited)\b/i, 'loan'],
  // Islamic finance, which is a third of UAE retail banking and had no entry
  // in this vocabulary at all. Murabaha (cost-plus sale) and Ijara (lease) are
  // what ADIB, DIB, Emirates Islamic, SIB and Ajman Bank call the product a
  // conventional bank calls a loan, and their instalments were landing in
  // Other — hiding the user's largest recurring outflow from the debt view.
  // Takaful is Islamic insurance, which the parser files under health.
  [/\bmurabaha?\b|\bijarah?\b|\bmusharaka?h?\b|\btawarruq\b|\bdiminishing\s+musharaka/i, 'loan'],
  [/\btakaful\b/i, 'health'],
  // UAE merchants read off a real 300-message accuracy report. Acquirers
  // truncate the descriptor to 20-22 characters, so several of these
  // deliberately match the stub the bank sends ("CATERIN", "GOVERNMEN",
  // "NATIONAL PAR") rather than the merchant's full legal name.
  [/caribou|caffe\s*nero|\bpeets?\b|tgi\s*fridays?|\btgif\b|cinnabon|cravia|bakemart|manazil al sham|al bait al shami|qalat trablus|alfatayir|aldumashqi|raydan|sultan saray|koshari|cookie dealer|malfoof|flurya|little neighborhood|friends\s?avenue|friendsavenue|caterin|chocolala|rabbash|arwa cake|cake n more|roti bhai|al tarbouch|buffalo\s+(?:jumeira|mirdif|wings)|cheese\s?cake|widerange fish|25 hours f and b/i, 'dining'],
  [/hyper\s?ramez|lavender al madina|mark and save|fresh good day|almed retail/i, 'groceries'],
  [/max fashion|\bmax\b(?!imum|\s*(?:limit|amount))|new yorker|lefties|la senza|victoria\s?s secret|\bkoton\b|ardene|lovisa|\blevis\b|\bcider\b|mumuso|whsmith|rivoli|malabar gold|l'?oreal|stradivarius|genzy trendz|nice style|honeylove|globale/i, 'shopping'],
  [/alphamed|wellfit|pilates|\bwatsons?\b|oriana/i, 'health'],
  [/\blime\s*\*|\blime\s*(?:ride|auth|temp)\b|valtrans|\bcar\s*par\b|golden bay car|yellow line car|smart green line car/i, 'transport'],
  [/meraas|al zajil fairs|tickets fy events|mushrif national|al safa park|global village|splitwise|camscanner|pixocial|pixelcut|\bfinart\b|scaleup|ar ruler|\bfresha\b|adobe|\bcanva\b|linkedin/i, 'entertainment'],
  [/\bunigaz\b/i, 'utilities'],
  [/carrefour|lulu|spinneys|union coop|choithram|grandiose|waitrose|nesto|al maya|west zone|viva supermarket|\bcoop\b|noon minutes|instashop|careem quik|talabat mart|hypermarket|supermarket|grocer|fresh market|baqala/i, 'groceries'],
  [/talabat|deliveroo|zomato|noon food|careem food|eateasy|restaurant|cafe|coffee|starbucks|costa|tim hortons|mcdonald|kfc|hardee|subway|shawarma|cafeteria|dining|bakery|pizza|burger|grill|chicken|broast|dunkin|krispy|baskin|papa john|pizza hut|domino|wingstop|five guys|shake shack|raising cane|jollibee|al ?baik|karak|chai|juice|catering|kitchen|bistro|donut|gelato|ice ?cream|sweets|pastr|foodcourt|food court|snack|falafel|biryani|mandi|machboos|kabab|kebab|hommus|manakish|allo beirut|wagamama|nando|chili|applebee|cheesecake|paul\b|shakespeare|arabian tea|barista|caribou|filli|karam|zaatar|maraheb|al safadi|automatic\b|\bkeeta\b|americana|kuwait food|restaur|\bsweets?\b|\bbake\b|bakeir|shawerm|noodle|sushi|ramen|bento|taco\b|wings\b|cookies|crumble|pinkberry|kcal\b|tortilla|arabica|hummus|\bfoods?\b|beverages/i, 'dining'],
  [/careem(?!\s*food)|uber|yango|bolt\b|udrive|ekar|taxi|\brta\b|road\s*(?:&|and)\s*transport|\bnol\b|salik|darb|mawaqif|mawgif|parkin\b|enoc|eppco|adnoc(?!\s*(?:oasis|coop))|emarat|petrol|fuel|tyre|tire|car wash|autopro|quicklube|oil change|metro|tram|parking|valet|careem bike|\bgrab\b|moi traffic|traffic fines|\brafid\b|cafu\b|cafuae|www cafu|refueled|car cent(?:er|re)|\bdott\b|garage|spare parts|\bcar\s+rentals?\b|\brent-?\s?a-?\s?car\b/i, 'transport'],
  [/dewa|sewa|fewa|addc|aadc|empower|lootah|tabreed|btu\b|chilled water|electricity|water|cooling|utility|sewerage|ajmansewerage|\blpg\b|gas cylinder/i, 'utilities'],
  [/etisalat|\be&(?![a-z])|eand\b|\bdu\b|virgin mobile|swyp|telecom|mobile recharge|internet|five telecom|wifi|\btelephone\b|\blandline\b/i, 'telecom'],
  // Word-bounded, for the same reason `\b7-?11\b` is: guessCategory reads the
  // WHOLE message, and a bare "rent" is a substring of current, currently,
  // different, parent and rental agency. "AED 250.00 purchase at NOON ... is
  // currently pending settlement" filed a Noon order under Rent.
  [/\brent(?:al|als|ed|ing)?\b|ejari|landlord/i, 'rent'],
  [/tabby|tamara|postpay|cashew|amazon|noon(?!\s*(?:food|minutes))|shein|temu|aliexpress|namshi|ounass|\bsivvi\b|ikea|home centre|homebox|home box|pan emirates|danube home|ace hardware|dragon ?mart|sharaf|jumbo|emax|virgin megastore|decathlon|sun ?& ?sand|nike|adidas|puma\b|\bh ?& ?m\b|zara\b|bershka|pull ?& ?bear|matalan|max fashion|centrepoint|splash\b|lifestyle|brands for less|daiso|miniso|mumzworld|firstcry|toys ?r ?us|dubizzle|mall\b|store|shop|boutique|tailor|tailo\b|salon|barber|spa\b|beauty|laundry|dry ?clean|perfume|jewel|gold ?souk|florist|flower|fashion|garment|abaya|red ?tag|landmark retail|citywalk|matajer|american eagle|hennes|uniqlo|sephora|skechers|lc waikiki|\basos\b|alibaba|duty ?free|dufry|\boutlet\b|jashanmal|washmen|hairdress|house ?hold|majid al futtaim|\bmaf\b|gmg consumer|al ?shaya/i, 'shopping'],
  [/pharmacy|phcy|life pharm|bin sina|boots\b|supercare|clinic|hospital|aster|medcare|\bnmc\b|mediclinic|saudi german|burjeel|zulekha|prime medical|dental|medical|medic\b|polyclinic|physio|optic|vision|lab\b|diagnostic|x-?ray|derma|vet\b|veterinar|sukoon|\bdaman\b|\baxa\b|insuran|\bins\b|wathba|gym\b|fitness|classpass|padel|phar\b|pharma|sports? club|fit body|be ?fit\b|bodybuilding|\bseha\b|patient portal|bioniq|supplement|dietary supp|nutrition|ole for sports|sports? ?(?:playgr|ground|centre|center|complex|academy|arena|hall)|football|futsal|tennis|basketball|swimming|athletic/i, 'health'],
  [/school|university|college|tuition|academy|nursery|kindergarten|\bgems\b|taaleem|kumon|udemy|coursera|coursra|skillshare|training (?:center|centre)|institute/i, 'education'],
  [/emirates(?!\s*(?:nbd|islamic|coop))|flydubai|etihad|air arabia|airline|airways|\bhotel\b|rotana|marriott|hilton|hyatt|radisson|movenpick|sheraton|ibis\b|novotel|booking|airbnb|agoda|expedia|almosafer|musafir|wego\b|cleartrip|wizz|visa fee|travel|resort|oberoi|chedi|meridien|fairmont|loungekey|dragonpass|airport companion|dayuse|trip\.?\s?(?:dot ?)?com|viator|makemytrip|airasia|hoteltonight/i, 'travel'],
  [/playstation|\bpsn\b|xbox|steam|nintendo|app store|google play|itunes|apple\.com|you\s*tube|national park|cinema|vox\b|reel\b|novo\b|roxy\b|imax|netflix|spotify|anghami|shahid|osn\b|starz|game\b|gaming|arcade|bowling|magic planet|kidzania|global village|ferrari world|yas island|img world|wild wadi|aquaventure|dubai parks|adventure|entertainment|theme park|water ?park|playground|palyground|ball talent|openai|chat\s*gpt|anthropic|\bclaude\b|alldebrid|real-?debrid|getresponse|domain\.com|godaddy|namecheap|hostinger|\bhosting\b|museum|prison island|x ?strike|billiard|\bgolf\b|shooting|leisure|theentertainer|little fox|g2a\b|cdkeys|oculus|stadia|al futtaim cin|\bcin\b|bounce\b/i, 'entertainment'],
  [/donat|charity|zakat|sadaqah|dubai cares|red crescent|beit al khair|dar al ber|gofundme/i, 'charity'],
  // Developer and AI tooling billed per seat — a whole spending family the
  // vocabulary had no entry for, so every one of them landed in "other".
  [/\bcursor\b|\blovable\b|\bcluely\b|\brork\b|\bloopcv\b|skywork|beautiful\.ai|resume-?now|\brezi\b|bettercv|kickresume|nanonoble|hostgator|namecheap|name\.com|hetzner|openrouter|presentations ?ai|mailsuite|vercel|netlify|supabase|railway\.app|replit|midjourney|perplexity|elevenlabs|runway\b|google ?one|fiverr/i, 'entertainment'],
  // Leisure venues and cinema distributors. Deliberately no district names
  // here — "City Walk" appears in the descriptor of every shop and cafe in
  // it, and matching it sent a coffee roastery to entertainment.
  [/gulf film|al mamzar|mamzar park|\bcinema\b/i, 'entertainment'],
  // Finance houses: an instalment to one of these is debt, like a bank DD.
  [/aafaq|amlak|tamweel|dunia finance|\bfinance house\b|reem finance|\bal hilal\b/i, 'loan'],
  // Food-delivery and restaurant-tech processors: these are meals, whatever
  // the descriptor says.
  //
  // "qlub" is the strongest of these and the reason it leads: it is the UAE
  // QR table-payment platform, and it appends itself to the venue's own name
  // in the card descriptor ("Kokoro qlub, sharjah", "LaBoheme-Muntazahqlub",
  // "BreakbyMara-AlJqlub"). Every descriptor carrying it is a restaurant bill,
  // whatever the venue is called — nine of them sat in Other.
  [/qlub|grubtech|\botter\b|carriage|deliveryhero|delivery hero|talabat|maxzigoodfood|alsafadi|wardt alsham|al tahadi|la barra|brass monkey|si italiano|tareeq al khalidiah|aseer time|nightjar|alpha flight|kitopi|new star families(?! sprm)/i, 'dining'],
  // Transliterated Arabic trade words. Half the descriptors on a UAE card
  // statement are Arabic shop names in Latin letters, and an English-only
  // vocabulary can never read them — which is why so much landed in Other.
  //
  // These are translations, not guesses about particular shops: aseer is
  // juice, mataam is restaurant, makhbaz is bakery. The English equivalents
  // (juice, restaurant, bakery) are already in the rules above; this is the
  // same vocabulary written the way the acquirer prints it.
  [/\baseer\b|\bmataam\b|\bmat3am\b|\bmakhbaz\b|\bmakhbz\b|\bfurn\b|hal[ae]w[iy]?[ay]{1,2}t|\bhalawa\b|\bqahwa\b|\bgahwa\b|\bmashawi\b|\bmeshwi\b|\bmashwi\b|\bfatayer\b|\bfattayer\b|\bsaj\b|\bmandi\b|\bmatbakh\b/i, 'dining'],
  [/\bthimar\b|\bthimaar\b|\bkhudar\b|\bkhodar\b|\bkhudra\b|\blahm\b|\blahom\b|\bleham\b|\blahham\b|\bsamak\b|\bdajaj\b|\bdajaaj\b|\bbaqal\w*|\bbakal[ae]\b|\btamoor\b/i, 'groceries'],
  [/\bsaydal\w*|\bsaidal\w*|\bsydal\w*/i, 'health'],
  // AliPay / WeChat descriptors are marketplace purchases.
  [/\balp\*|weixin\*|taobao|otherretail|guangdong|personalservices/i, 'shopping'],
  // Brokerages and crypto on-ramps are moving money, not spending it.
  [/etoro|capital\.com|bfinity|bitfi|binance|crypto\.com|interactive brokers|saxo|exinity/i, 'other'],
  // Government sits AFTER transport/utilities so traffic fines, RTA and SEWA
  // keep their more specific buckets.
  [/smart dubai|smartdxbgov|digital sharjah|sharjah finance|govt of|government|ministry|ministries|municipality|sharjah police|dubai police|abu dhabi police|noqodi|ica smart|vfs global|\bukvi\b|tasheel|amer cent|federal authority|immigration|dubai courts|al etihad credit|tahseel|dubai pay|\bmoi\b|\bmofa\b|emirates id|residency|prosecution|notary|\bgdrfa\b|economic depart|\bded\b|governmen|muncipal/i, 'government'],
  [/salary|payroll|wages/i, 'salary'],
  // ── The same vocabulary in Arabic script ──
  //
  // The twin of the transliteration block above: half of what a UAE handset
  // receives is written in Arabic, and an English-only vocabulary can never
  // read it, so all of it landed in Other.
  //
  // Placement is deliberate — AFTER the brand rules (so a bilingual alert
  // resolves to the Latin brand and one merchant override covers both
  // spellings) and BEFORE the structural fallbacks (so "مطعم الطازج" is dining
  // and not whatever the generic groceries rule happens to catch).
  //
  // Every literal is post-fold: مقهى is written مقهي, قهوة is قهوه, صيدلية is
  // صيدليه. A rule written the natural way can never fire.
  [/مطعم|مطاعم|مقهي|قهوه|كافيه|مخبز|مخابز|حلويات|شاورما|بيتزا|برجر|مشاوي|فطاير|عصير|عصاير|كافتيريا|ماكولات|وجبات|مطبخ|بوفيه|كنافه|فلافل|بروست|ايس كريم|ايسكريم|شوكولاته|طلبات|ديليفرو|ستاربكس|ماكدونالدز|كريم فود/i, 'dining'],
  [/بقاله|بقالات|سوبرماركت|هايبرماركت|هايبر|تموين|خضار|خضروات|فواكه|ثمار|لحوم|اسماك|دواجن|تمور|جمعيه تعاونيه|التعاونيه|كارفور|لولو|سبينيز/i, 'groceries'],
  [/صيدليه|صيدليات|مستشفي|مستوصف|عياده|عيادات|طبي|مختبر|تحاليل|اسنان|بصريات|نظارات|مركز صحي|نادي رياضي|لياقه/i, 'health'],
  // "كريم" is both Careem and the word for cream, exactly like the English
  // careem/ice-cream collision the rule above already guards — hence the
  // explicit letter boundaries, since \b is meaningless here.
  [/بنزين|وقود|محطه وقود|تاكسي|سياره اجره|مواصلات|مواقف|سالك|رسوم مرور|مغسله سيارات|كراج|قطع غيار|مترو|(?:^|[^ء-ي])كريم(?![ء-ي])|اوبر|ادنوك|اينوك/i, 'transport'],
  [/كهرباء|مياه|تبريد|تكييف مركزي|صرف صحي|اسطوانه غاز|ديوا/i, 'utilities'],
  [/اتصالات|انترنت|شريحه|رصيد الجوال|شحن الجوال|هاتف|خط ارضي/i, 'telecom'],
  [/ايجار|عقد ايجار|المالك/i, 'rent'],
  [/مدرسه|مدارس|جامعه|كليه|حضانه|روضه|معهد|رسوم دراسيه|دورات تدريبيه/i, 'education'],
  [/طيران|رحله|تذاكر|فندق|فنادق|منتجع|حجز فندقي|سفر|سياحه/i, 'travel'],
  [/سينما|ملاهي|العاب|ترفيه|حديقه|منتزه|بولينج|نتفليكس|انغامي/i, 'entertainment'],
  [/تبرع|تبرعات|صدقه|زكاه|جمعيه خيريه|خيريه|بيت الخير|الهلال الاحمر/i, 'charity'],
  [/قرض|تمويل|قسط|اقساط|مرابحه|اجاره|تمويل شخصي|تمويل عقاري/i, 'loan'],
  [/بلديه|شرطه|وزاره|حكومه|حكوميه|مخالفه|مخالفات|الهجره|الجوازات|تصريح|اقامه|هويه/i, 'government'],
  [/محل(?![ء-ي])|محلات|متجر|سوق|مركز تجاري|مول|ازياء|ملابس|احذيه|عطور|مجوهرات|اثاث|الكترونيات|مكتبه|هدايا|صالون|حلاق|خياط|تجاره|تجاريه|ايكيا|(?:^|[^ء-ي])نون(?![ء-ي])|امازون|شين|نامشي|سنتربوينت/i, 'shopping'],
  // Structural fallbacks — what the merchant IS, when no brand matched.
  // These sit last so brand rules always win.
  //
  // "7-11" is word-bounded because it was unanchored, and guessCategory is fed
  // the WHOLE message: any card, account or reference number containing 711
  // ("Debit Card ending 4711") filed the row as groceries. `\b7-?11\b` cannot
  // match inside 4711 — the 4|7 junction is not a word boundary.
  [/hypermarket|supermarket|superm\w*|hyperm\w*|mini ?mart?\b|\bmart\b|grocer|baqala|coop\b|co-?op|vegetables|\bfruits?\b|butcher|fish market|meat\b|roastery|adnoc oasis|zoom\b|\b7-?11\b|\b7-?eleven\b|circle k|last chance|day to day|gala\b|west zone|foodstuff|tawfeer|tawpeek|vending|\bmarket\b|\bsupe\w*\b|sprmkt|spmkt|\bsprm\b|\bsmkt\b|now ?now|\bviva\b|smart seven|mazraat|janata|aswaaq|plus point|\bspices?\b|\bdates? (?:llc|tr|trading)\b|\bgro\b|\bgroc\b|\bhymkt\b|hypermkt|\bfoodstuff|nuts? (?:tr|llc)\b|\bbakala|dairy|\bmeats?\b/i, 'groceries'],
  [/\brest\b|\bres\b|\bresto\b|restur|caf[et]{2}eria|cafteria|cafet|coffe|caffeine|tea ?house|eater|diner\b|canteen|barbecu|\bbbq\b|burgr|\bgrill|charcoal|tacos?\b|shawerma|ice ?cre|icecre|frozen|chocolat|\bcandy\b|sweet ?shop|donuts?\b|waffle|crepe|creperie|smoothie|fruitpunch|fruit ?punch|thai ?food|\bsushi|noodl|\bwok\b|\bcocina\b|trattoria|pizzeria|steak|seafood|fish ?house|fish ?market|chinese|iranian|lebanese|libnan|\bsoory\b|syrian|shamiah|lukmah|turkish|indian ?restaur|biriyani|kabsa|foodstuff ?tr\b|\bfoodco\b/i, 'dining'],
  // "Centre" sits here, in the structural fallbacks, rather than with the
  // brands: a medical centre is health and a car centre is transport, and both
  // of those rules run earlier. By the time anything reaches this line, the
  // only centres left are the retail kind.
  [/trading|general trading|electronics|mobile(?:s| shop)|computer|stationery|bookshop|book ?store|gifts|accessories|garments|textile|readymade|footwear|shoes|optical shop|\bcent(?:er|re)\b|\bcentr[ei]\b|\bplaza\b|\bsouq\b|\bbazaar\b/i, 'shopping'],
];

export function guessCategory(
  text: string,
  type: TransactionType,
  overrides?: Record<string, CategoryId>,
  merchant?: string,
): CategoryId {
  if (overrides && merchant) {
    const hit = overrides[merchant.trim().toLowerCase()];
    if (hit) return hit;
  }
  // This function is exported and called from the store with a transaction
  // TITLE that never went through parseSms, so it cannot assume anything has
  // been folded. Normalising here is what makes one Arabic rule cover every
  // spelling of the same word, whoever the caller is.
  text = normalizeArabic(text);
  // Money coming IN is never dining/groceries/etc — a Talabat payout is
  // business revenue, not food spending. Refunds, reversals, chargebacks,
  // cashback and bank interest/profit are OFFSETS against an earlier expense,
  // not revenue, so they stay out of Business: calling a chargeback "business
  // income" is a claim about the user's tax position that nothing in the
  // message supports.
  if (type === 'income') {
    if (/salary|payroll|wages|راتب|الراتب|مرتب|رواتب|اجر شهري/i.test(text)) return 'salary';
    if (/refund|revers(?:al|ed)|charge-?\s?back|credited back|re-?credited|adjustment|waive[rd]|cashback|\binterest\b|\bprofit\b/i.test(text)) return 'other';
    return 'business';
  }
  // Market-local vocabulary wins over the global baseline.
  for (const [re, cat] of [...getActiveMarket().keywords, ...CATEGORY_KEYWORDS]) {
    if (re.test(text)) return cat;
  }
  return 'other';
}

/**
 * Canonical names for online services whose card descriptors vary
 * ("OPENAI *CHATGPT", "PAYPAL *REALDEBRID", "APPLE.COM/BILL"...). One clean
 * name per service also makes subscription detection group them correctly.
 */
const SERVICE_NAMES: [RegExp, string][] = [
  [/openai|chat\s*gpt/i, 'ChatGPT'],
  [/anthropic|claude/i, 'Claude'],
  [/real-?debrid/i, 'Real-Debrid'],
  [/all-?debrid/i, 'AllDebrid'],
  [/netflix/i, 'Netflix'],
  [/spotify/i, 'Spotify'],
  [/you\s*tube|yt\s*premium/i, 'YouTube Premium'],
  [/google\s*one|google\s*storage/i, 'Google One'],
  [/apple\.com|apple\s*services|itunes/i, 'Apple'],
  [/icloud/i, 'iCloud'],
  [/amazon\s*prime|prime\s*video/i, 'Amazon Prime'],
  [/disney/i, 'Disney+'],
  [/anghami/i, 'Anghami'],
  [/shahid/i, 'Shahid'],
  [/\bosn\b/i, 'OSN+'],
  [/starz/i, 'StarzPlay'],
  [/deezer/i, 'Deezer'],
  [/audible/i, 'Audible'],
  [/dropbox/i, 'Dropbox'],
  [/linkedin/i, 'LinkedIn'],
  [/adobe/i, 'Adobe'],
  // Word-bounded: "CANVAS TRADING" or "CANVAS HOME" must not become Canva.
  [/\bcanva\b/i, 'Canva'],
  [/microsoft\s*365|office\s*365/i, 'Microsoft 365'],
  [/steam\s*(?:purchase|games)|steampowered/i, 'Steam'],
  [/capital\.com/i, 'Capital.com'],
  [/name\.com/i, 'Name.com'],
  [/coursra\*|coursera/i, 'Coursera'],
  [/\bkeeta\b/i, 'Keeta'],
  [/grubtech/i, 'Grubtech'],
  [/getresponse/i, 'GetResponse'],
  [/domain\.com/i, 'Domain.com'],
  [/www\.grab\b|grab\.com/i, 'Grab'],
  [/instashop/i, 'InstaShop'],
  [/ajmansewerage/i, 'Ajman Sewerage'],
  [/liv\.?\s*prime/i, 'Liv Prime'],
  [/\bcafu\b|cafuae|www cafu/i, 'CAFU'],
  [/crypto\.com/i, 'Crypto.com'],
  [/binance/i, 'Binance'],
  [/fiverr/i, 'Fiverr'],
  [/discord/i, 'Discord'],
  [/\bnotion\b/i, 'Notion'],
  [/github/i, 'GitHub'],
  [/telegram/i, 'Telegram Premium'],
  [/xbox\s*game\s*pass/i, 'Xbox Game Pass'],
  // UAE names seen under three spellings each across HSBC, Liv and ENBD
  // descriptors. Canonicalising them is what lets one merchant override — and
  // subscription detection — cover all of them at once.
  [/urban\s?clap|urban company/i, 'UrbanClap'],
  [/justlife/i, 'Justlife'],
  [/cleantizer|clentizer/i, 'Cleantizer'],
  [/hellochef/i, 'HelloChef'],
  [/dubai integrated eco/i, 'Dubai Integrated Economic Zones'],
  [/friends\s?avenue|friendsavenue/i, 'Friends Avenue'],
  [/manazil al sham/i, 'Manazil Al Sham'],
  [/valtrans/i, 'Valtrans'],
  [/mark and save/i, 'Mark & Save'],
  [/hyper\s?ramez/i, 'Hyper Ramez'],
  [/almed retail/i, 'Almed Retail'],
  [/arabian unigaz|\bunigaz\b/i, 'Arabian Unigaz'],
  [/little neighborhood/i, 'Little Neighborhood'],
  [/tgi\s*fridays?|\btgif\b/i, 'TGI Fridays'],
  [/caribou/i, 'Caribou Coffee'],
  [/caffe\s*nero/i, 'Caffe Nero'],
  [/new yorker/i, 'New Yorker'],
  [/lefties/i, 'Lefties'],
  [/mumuso/i, 'Mumuso'],
  [/laura beauty/i, 'Laura Beauty Salon'],
  [/ginnys plus/i, 'Ginnys Plus Trading'],
  [/al faan al raqi/i, 'Al Faan Al Raqi'],
  [/global village/i, 'Global Village'],
  [/\blime\s*\*|\blime\s*(?:ride|auth|temp)\b/i, 'Lime'],
  [/splitwise/i, 'Splitwise'],
  [/camscanner/i, 'CamScanner'],
  [/pixocial/i, 'Pixocial'],
  [/honeylove/i, 'HoneyLove'],
  [/playstation\s*plus|psn\s*plus/i, 'PlayStation Plus'],
];

/**
 * Structurally-recognized titles: the row IS understood even though its
 * category may be the neutral one — these never need format reporting.
 */
export const STRUCTURAL_TITLES = new Set([
  'ATM withdrawal',
  'Bank fee',
  'VAT fee',
  'Cash deposit',
  'Cheque',
  'Parking',
  'Outgoing transfer',
  'Incoming transfer',
  'Refund',
  'Inward remittance',
  'Bank transfer',
  'Card payment',
  'Account debit',
  'Telegraphic transfer',
  'Outward remittance',
]);

/** Clean descriptor noise and map to a canonical service name when known. */
export function normalizeServiceName(merchant: string): string | null {
  const stripped = merchant
    .replace(/^(?:tap|alp|web|eig|sq|wl)\s*\*\s*/i, '') // processor prefixes: "TAP*Keeta"
    .replace(/^(?:paypal|google|gpay|apl|amzn|pos|ziina|mamo)\s*\*?\s*/i, '');
  for (const [re, name] of SERVICE_NAMES) {
    if (re.test(stripped) || re.test(merchant)) return name;
  }
  return null;
}

const ACRONYMS = new Set([
  'RTA', 'KFC', 'FAB', 'DEWA', 'SEWA', 'FEWA', 'ADCB', 'ENBD', 'ENOC', 'ADNOC',
  'VOX', 'PSN', 'NMC', 'DXB', 'AUH', 'HSBC', 'CBD', 'RAK', 'DIB', 'ATM', 'NOL', 'OSN',
]);

function titleCase(s: string): string {
  // Arabic has no letter case, so the split/lowercase/re-capitalise round trip
  // is pure risk here: it would collapse whitespace inside a merchant name and
  // mangle a mixed-script one for no gain at all.
  if (ARABIC_RE.test(s)) return s.trim();
  return s
    .split(/\s+/)
    .map((w) => {
      if (ACRONYMS.has(w.toUpperCase())) return w.toUpperCase();
      const lower = w.toLowerCase();
      return lower ? lower[0].toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

/**
 * The transaction amount, or null.
 *
 * There is NO balance fallback, and there must never be one again. The
 * cardPayment, cardStatement and billDue branches used to ask for one, so when
 * a body stated no transaction amount at all the first figure was returned
 * even though BALANCE_PREFIX_RE had already identified it as a balance or an
 * available limit:
 *
 *   "Thank you for your payment towards your RAKBANK Credit Card ending 4711.
 *    Your available limit is now AED 50,000.00"
 *
 * came back as a AED 50,000 card payment whose snapshotFils was the SAME
 * number — the code asserting that one figure is both the balance and the
 * amount. Downstream, auto-import turns a statement into a CardDue with
 * totalDue = the limit and minDue = 5% of it: thousands of dirhams of debt
 * that does not exist. A message that does not state its amount is a message
 * we cannot import, and null says so.
 */
function extractAmountFils(raw: string): number | null {
  // Gather candidates from both currency positions, in message order.
  const candidates: { index: number; value: number }[] = [];
  AED_AMOUNT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = AED_AMOUNT_RE.exec(raw))) {
    const at = match.index + match[0].length - match[1].length;
    if (isMaskedFigure(raw, at)) continue;
    candidates.push({ index: match.index, value: Math.round(Number(match[1].replace(/,/g, '')) * 100) });
  }
  AED_SUFFIX_RE.lastIndex = 0;
  while ((match = AED_SUFFIX_RE.exec(raw))) {
    // Skip digits glued to identifiers ("a/c XX9012 AED...", "041-339***-001
    // AED..." must not read the account fragment as an amount).
    const before = match.index > 0 ? raw[match.index - 1] : ' ';
    if (/[A-Za-z0-9*•·.\-/]/.test(before)) continue;
    // Skip if this is the number part of a prefix match ("AED 100" also ends before "AED"? no —
    // but "AED 100.00 AED"-style doubles resolve identically, so duplicates are harmless).
    candidates.push({ index: match.index, value: Math.round(Number(match[1].replace(/,/g, '')) * 100) });
  }
  candidates.sort((a, b) => a.index - b.index);

  for (const c of candidates) {
    if (!Number.isFinite(c.value) || c.value <= 0 || c.value > MAX_PLAUSIBLE_AMOUNT_FILS) continue;
    const prefix = raw.slice(Math.max(0, c.index - 24), c.index);
    if (BALANCE_PREFIX_RE.test(prefix)) continue;
    return c.value;
  }
  return null;
}

function amountWithFx(raw: string): number | null {
  return extractAmountFils(raw) ?? extractForeignAmountFils(raw);
}

function extractMerchant(raw: string, re: RegExp): string {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const candidate = match[1].trim().replace(/\s{2,}/g, ' ');
    if (/^your\b/i.test(candidate) || /^(?:the |an? )?account\b/i.test(candidate)) continue;
    if (/^\d+$/.test(candidate)) continue; // bare digits are a card number, not a merchant
    if (/\d{4}[Xx*•]{2,}/.test(candidate) || /^\d{6,}/.test(candidate)) continue; // masked PANs
    if ((candidate.match(/[A-Za-z]/g) ?? []).length < 3) continue; // account numbers, "AED 1"
    // "your payment to the account number 4822" stops at "account", leaving a
    // bare article as the merchant. A row titled "The" helps nobody.
    // "date" is here for "spent AED 4,320.00 year TO DATE with your card": the
    // reporting-period phrase hides behind the same "to" a merchant uses, and
    // a row titled "Date" both invents a shop and defeats the spend-summary
    // gate, which only fires when the message names no merchant.
    if (/^(?:the|this|that|your|our|an?|and|for|to|date)$/i.test(candidate)) continue;
    if (/^\d+\s+(?:month|day|week|year|hr|hour|min)/i.test(candidate)) continue; // "up to 12 months"
    if (/^acc[\s/]|^a\/?c\b|^cr\.?\s*card/i.test(candidate)) continue; // "from Acc/Cr.Card ..."
    if (/^(?:aed|dhs|sar|usd|eur|gbp)\b/i.test(candidate)) continue;
    if (/^www\.?$/i.test(candidate)) continue; // "at WWW.GRAB.COM" stops at the dot
    // Marketing sentences hide behind the same "to"/"for" the merchant uses:
    // "log in to View Your Statement", "pay now to Avoid Charges". Rows
    // titled "View Your Statement" and "Avoid Charges" were the result.
    // A descriptor never opens with an imperative or names the reader.
    if (
      /^(?:avoid|view|check|see|click|visit|call|contact|update|verify|confirm|download|enjoy|get|earn|save|know|learn|read|use|pay|activate|renew|register|apply|explore|discover|manage|track|start|join|book|order|shop|win|claim|reply|dial|send|scan|switch|upgrade|unlock|redeem|collect|refer|share|follow|subscribe|opt)\b/i.test(
        candidate,
      )
    ) {
      continue;
    }
    // Deliberately no "us"/"we": HOMES R US is a shop, not a sentence about
    // the reader, and the guard deleted its name outright.
    if (/\b(?:you|your|yours|which|whom|their)\b/i.test(candidate)) continue;
    if (candidate) return candidate;
    if (re.lastIndex === match.index) re.lastIndex++;
  }
  return '';
}

/**
 * The body with its MERCHANT DESCRIPTORS blanked out, for suppression rules to
 * read.
 *
 * A shop's name is not a reason code. "AED 32.00 spent at TIMEOUT MARKET DUBAI
 * with Debit Card 1234" was deleted outright because Time Out Market — a real
 * food hall in Souk Al Bahar — read as a transaction timeout, and the decline
 * list is tested long before any merchant is extracted. The same collision is
 * waiting in every descriptor containing DENIED, FAILED, VOID, CANCELLED,
 * INVALID or EXPIRED, and listing shops that must not be suppressed is not a
 * strategy.
 *
 * So suppression is anchored instead: it reads the SENTENCE ABOUT the
 * transaction and never the name of the party to it. Blanking is done with
 * spaces so the string keeps its length and every other offset stays valid.
 */
/**
 * Blanks every match of `re` with spaces, keeping the string's LENGTH so every
 * other offset into it stays valid.
 *
 * This is how a footer is taken out of a suppression rule's way without taking
 * the transaction with it: the fraud-reporting footer, the hold-RELEASE
 * sentence and a future-tense clause are each removed from the text a
 * suppression pattern reads, so the pattern is left facing only the sentence
 * that is actually about this transaction.
 */
function blank(text: string, re: RegExp): string {
  return text.replace(re, (m) => ' '.repeat(m.length));
}

function maskMerchantNames(text: string): string {
  MERCHANT_RE.lastIndex = 0;
  let out = text;
  let m: RegExpExecArray | null;
  while ((m = MERCHANT_RE.exec(text))) {
    if (m.index === MERCHANT_RE.lastIndex) MERCHANT_RE.lastIndex++;
    // Every one of these patterns ends with its capture group; the trailing
    // context is a zero-width lookahead.
    const start = m.index + m[0].length - m[1].length;
    out = out.slice(0, start) + ' '.repeat(m[1].length) + out.slice(start + m[1].length);
  }
  return out;
}

// The gap before the figure excludes mask characters: "Avl Bal AED ····9235.93"
// must not report a 9,235.93 balance, because the real one has digits the bank
// redacted.
const SNAPSHOT_RE =
  /(?:avl|avail(?:able)?|remaining|total)\.?\s*(?:cr(?:edit)?\.?\s+)?(limit|bal(?:ance)?|outstanding)[^0-9·•*-]{0,12}([\d,]+(?:\.\d{1,2})?)/i;
// "Your balance is AED 401913.68" — balance quotes without an Avl/Total
// prefix. Kept separate so bare "limit" mentions (daily limits, offers)
// still need the availability prefix above.
const PLAIN_BALANCE_RE =
  /(?:your|current|new|updated|net|a\/?c(?:count)?)\s+bal(?:ance)?\s*(?:is|:|now)?[^0-9·•*-]{0,10}([\d,]+(?:\.\d{1,2})?)/i;
/**
 * The Arabic balance / limit footer. Kept separate rather than folded into
 * SNAPSHOT_RE because the two carry their kind differently: Arabic names the
 * kind in the phrase itself ("الحد المتاح" is headroom, "الرصيد المتاح" is
 * cash), where English splits it across an availability prefix and a noun.
 */
const AR_SNAPSHOT_RE =
  /(الحد المتاح|الرصيد المتاح|الرصيد الحالي|المبلغ المستحق|الرصيد|رصيدك)\s*(?:هو|:)?[^0-9·•*\-\n]{0,12}([\d,]+(?:\.\d{1,2})?)/;
const MAX_SNAPSHOT_FILS = 1_000_000_000; // 10M in the local currency

/** The balance / available-limit figure banks append to most alerts. */
function extractSnapshot(raw: string): { fils: number; kind: SnapshotKind } | null {
  const m = raw.match(SNAPSHOT_RE);
  if (m) {
    const fils = Math.round(Number(m[2].replace(/,/g, '')) * 100);
    if (Number.isFinite(fils) && fils >= 0 && fils <= MAX_SNAPSHOT_FILS) {
      const word = m[1].toLowerCase();
      return {
        fils,
        kind: word.startsWith('limit') ? 'limit' : word === 'outstanding' ? 'outstanding' : 'balance',
      };
    }
  }
  const plain = raw.match(PLAIN_BALANCE_RE);
  if (plain) {
    const fils = Math.round(Number(plain[1].replace(/,/g, '')) * 100);
    if (Number.isFinite(fils) && fils >= 0 && fils <= MAX_SNAPSHOT_FILS) {
      return { fils, kind: 'balance' };
    }
  }
  if (ARABIC_RE.test(raw)) {
    const ar = raw.match(AR_SNAPSHOT_RE);
    if (ar) {
      const fils = Math.round(Number(ar[2].replace(/,/g, '')) * 100);
      if (Number.isFinite(fils) && fils >= 0 && fils <= MAX_SNAPSHOT_FILS) {
        return {
          fils,
          kind: ar[1] === 'الحد المتاح' ? 'limit' : ar[1] === 'المبلغ المستحق' ? 'outstanding' : 'balance',
        };
      }
    }
  }
  const o = raw.match(OUTSTANDING_RE);
  if (o) {
    const fils = Math.round(Number(o[1].replace(/,/g, '')) * 100);
    if (Number.isFinite(fils) && fils >= 0 && fils <= MAX_SNAPSHOT_FILS) {
      return { fils, kind: 'outstanding' };
    }
  }
  // Last, because it is the loosest: an explicit "Avl"/"your"/"outstanding"
  // reading is always better evidence than a bare "Balance <currency> <n>".
  const bare = raw.match(BARE_BALANCE_RE);
  if (bare) {
    const fils = Math.round(Number(bare[1].replace(/,/g, '')) * 100);
    if (Number.isFinite(fils) && fils >= 0 && fils <= MAX_SNAPSHOT_FILS) {
      return { fils, kind: 'balance' };
    }
  }
  return null;
}

/**
 * A card with no kind word that quotes available HEADROOM rather than cash.
 * Only consulted for a Sharia-compliant issuer (see BankProfile.islamic): its
 * credit card is a "Covered Card" and the word "credit" appears nowhere in its
 * alerts, so on ADIB, DIB, Emirates Islamic, SIB or Ajman Bank a plain "your
 * ADIB Card ending 4417 ... your available limit is AED 8,240" is a CREDIT
 * card. The identical sentence from a conventional bank is a debit card, which
 * is why this needs the sender and cannot be read off the body.
 */
const LIMIT_EVIDENCE_RE = /available\s+(?:credit\s+)?limit|avl\.?\s*(?:cr\.?\s*)?limit|credit\s+limit|covered\s+card/i;

function extractCard(raw: string, bank?: BankProfile | null): ParsedCard | null {
  const islamicCredit = !!bank?.islamic && LIMIT_EVIDENCE_RE.test(raw);
  // Masked PANs first: CARD_RE would otherwise grab the FIRST four digits of
  // "Credit Card 4782********4833" as the identity.
  const masked = raw.match(MASKED_PAN_RE);
  if (masked) {
    return {
      last4: masked[1],
      kind: islamicCredit || /credit|covered\s+card|charge\s+card/i.test(raw) ? 'credit' : 'debit',
    };
  }
  const cardMatch = raw.match(CARD_RE);
  if (cardMatch) {
    const kindWord = cardMatch[1] ?? '';
    // Multi-line formats say "Credit Card Purchase" in the header and
    // "Card No XXXX4711" further down — when the number clause carries no
    // kind word, look at the whole message before assuming debit.
    const kind =
      CARD_KIND_WORDS.test(kindWord) ||
      (!kindWord && (islamicCredit || /(?:credit|covered|charge)\s+card/i.test(raw)))
        ? 'credit'
        : 'debit';
    return { last4: cardMatch[2], kind };
  }
  const accMatch = raw.match(ACCOUNT_RE);
  if (accMatch) return { last4: accMatch[1], kind: 'account' };
  // Arabic last, and only when there IS Arabic: on a bilingual body the
  // English clause is what the rest of the machinery is tuned for, so it has
  // to win. Card before account — "كشف حساب البطاقة المنتهية 4833" names both,
  // and it is the card that the statement is about.
  if (ARABIC_RE.test(raw)) {
    const arCard = raw.match(AR_CARD_RE);
    if (arCard) {
      const kindWord = arCard[1] ?? '';
      const kind =
        kindWord.startsWith(AR_CARD_KIND) || (!kindWord && raw.includes(AR_CARD_KIND))
          ? 'credit'
          : 'debit';
      return { last4: arCard[2], kind };
    }
    const arAcc = raw.match(AR_ACCOUNT_RE);
    if (arAcc) return { last4: arAcc[1], kind: 'account' };
  }
  return null;
}

/**
 * Cuts a matched name out of the UN-folded text, at the folded match's own
 * offsets. Sound only because folding is strictly 1:1 — slice the name out of
 * the folded string instead and the user is shown "هييه كهرباء" for a bank
 * that wrote "هيئة كهرباء". Every one of these patterns ends with its capture
 * group (the trailing context is a zero-width lookahead), so the group starts
 * exactly `m[1].length` before the end of the match.
 */
function sliceUnfolded(clean: string, m: RegExpExecArray | RegExpMatchArray): string {
  const start = (m.index ?? 0) + m[0].length - m[1].length;
  return clean.slice(start, start + m[1].length).trim();
}

/** The Arabic payee clause, read off `folded` and returned in `clean` spelling. */
function extractArabicMerchant(folded: string, clean: string): string {
  if (!ARABIC_RE.test(folded)) return '';
  AR_MERCHANT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AR_MERCHANT_RE.exec(folded))) {
    if (m.index === AR_MERCHANT_RE.lastIndex) AR_MERCHANT_RE.lastIndex++;
    const candidate = sliceUnfolded(clean, m);
    // Three letters is the same floor the Latin path uses: below it a
    // candidate is a fragment, not a name.
    if ((candidate.match(new RegExp(`[${AR_LETTER}]`, 'g')) ?? []).length < 3) continue;
    return candidate;
  }
  return '';
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
// ADCB style: "due by Jul 19 2026"
const MONTH_DATE_RE = /\b(?:on|by|before)\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i;

/**
 * ISO string for a date that actually exists. A day past the end of its month
 * ("30/02") is rejected rather than emitted: `new Date('2026-02-30')` rolls
 * forward to 2 March, which silently files the transaction in the wrong month
 * and skews every monthly figure derived from it.
 */
function isoDate(y: number, month: number, day: number): string | null {
  if (!(y >= 2000 && y <= 2100 && month >= 1 && month <= 12 && day >= 1)) return null;
  const daysInMonth = new Date(Date.UTC(y, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Day/month from a numeric date, tolerating the US order when it's unambiguous. */
function numericDate(d: string, m: string, yRaw: string): string | null {
  const y = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
  const first = Number(d);
  const second = Number(m);
  // The region writes DD/MM, so that reading is tried first. "12/25/2026" has
  // no valid DD/MM reading, and its MM/DD reading is unambiguous — before,
  // dates like this were dropped and the transaction silently took today.
  return isoDate(y, second, first) ?? isoDate(y, first, second);
}

function extractDate(raw: string): string | null {
  // Each format falls through to the next: a numeric date that matched but
  // could not be resolved must not stop the named-month form from being read.
  const withTime = raw.match(DATETIME_RE);
  if (withTime) {
    const iso = numericDate(withTime[1], withTime[2], withTime[3]);
    if (iso) return iso;
  }
  const numeric = raw.match(DATE_RE);
  if (numeric) {
    const iso = numericDate(numeric[1], numeric[2], numeric[3]);
    if (iso) return iso;
  }
  const named = raw.match(MONTH_DATE_RE);
  if (named) {
    const month = MONTH_NAMES[named[1].slice(0, 3).toLowerCase()];
    if (month) {
      const iso = isoDate(Number(named[3]), month, Number(named[2]));
      if (iso) return iso;
    }
  }
  return null;
}

/**
 * Parses a single bank-alert SMS. Returns null for non-transaction messages.
 *
 * `options.sender` is the SMS sender ID or notification package the message
 * arrived under. It is entirely optional and purely additive: with no sender,
 * or with one no market pack recognises, every message takes exactly the path
 * it took before senders existed. It is never allowed to decide WHETHER a
 * message is a transaction — only to disambiguate one that already is.
 */
export function parseSms(
  message: string,
  overrides?: Record<string, CategoryId>,
  options?: ParseOptions,
): ParsedSms | null {
  // `raw` stays the name the whole body matches against — it is now the
  // NORMALISED text. `source` is what the bank actually sent and is what every
  // return puts back in the `raw` FIELD: that string is shown to the user when
  // they report an unparsed format, so it has to be the bank's own words, not
  // ours. `clean` is the middle stage, and merchant names are sliced from it
  // so they keep the bank's spelling.
  const source = message.trim();
  if (!source) return null;
  const clean = stripInvisible(source);
  const raw = foldOrthography(clean);
  ensureCurrencyPatterns();
  const bank = bankProfileForSender(options?.sender);
  // Read once, up here, because the SUPPRESSION rules below need it: a card or
  // account number beside an amount and a transaction clause is the evidence
  // that has to beat a boilerplate footer. extractCard is pure.
  const card = extractCard(raw, bank);

  if (OTP_RE.test(raw)) return null;
  // Read once: this is what every boilerplate-shaped suppression rule below
  // has to beat before it may delete a message.
  const posted = hasPostedEvidence(raw, card);
  // Suppression reads the sentence ABOUT the transaction, never the name of
  // the shop it was made at (maskMerchantNames), and never the fraud-reporting
  // footer stapled underneath it (FRAUD_FOOTER_RE).
  const suppressible = blank(maskMerchantNames(raw), FRAUD_FOOTER_RE);
  // The masked pass catches a refusal stated about the transaction; the
  // unmasked pass catches one the merchant descriptor swallowed.
  if (DECLINED_RE.test(suppressible) || DECLINED_VERB_RE.test(raw)) return null;
  // ...but the RELEASE of a hold is the settlement notice, not the hold.
  if (PREAUTH_RE.test(blank(suppressible, HOLD_RELEASE_RE))) return null;
  // Footer boilerplate ("do not disclose your PIN", "never share your OTP",
  // "3D Secure") only gets to delete a message that shows no posted
  // transaction at all.
  if (OTP_FOOTER_RE.test(suppressible) && !posted) return null;
  // A monthly spend summary names no merchant. One that DOES name a merchant
  // is a real alert with a spend-to-date footer, and it keeps its transaction.
  if (SPEND_SUMMARY_RE.test(raw) && !extractMerchant(raw, MERCHANT_RE)) return null;
  // A threshold in an offer is a figure to qualify for, not one that moved.
  if (OFFER_RE.test(raw) && !posted) return null;
  // A returned cheque is money that stayed in the account.
  if (RETURNED_UNPAID_RE.test(raw)) return null;
  // A future or scheduled event arrives AGAIN as a real debit or credit, so
  // posting it now counts the same money twice. Suppressed only when the
  // modal governs the ONLY money clause in the body and nothing says the
  // money has already moved.
  //
  // Both tests run against the body with the future clause BLANKED OUT, never
  // the body itself: "Loan instalment of AED 2,500.00 will be deducted from
  // account 1234" carries "deducted from", so reading the raw body made the
  // forecast its own evidence of settlement and nothing was ever suppressed.
  {
    const settled = blank(blank(raw, FUTURE_CLAUSE_RE), SCHEDULED_CLAUSE_RE);
    if (settled !== raw && !SETTLED_TENSE_RE.test(settled)) return null;
  }
  // Telecom rate cards ("Make local calls for 5 AED/Minute") read like
  // purchases; a biller's own AutoPay receipt duplicates the bank-side SMS.
  if (/\d\s*(?:aed|dhs|sar)\s*\/\s*min(?:ute)?|roaming minutes/i.test(raw)) return null;
  // Fee schedules quote a price without charging it: "Branch Teller Services
  // are charged at AED 52.5 per transaction. Enjoy free banking at 430 ATMs".
  if (/\bare charged at\b|\bis charged at\b|\bper transaction\b/i.test(raw)) return null;
  if (/autopay service/i.test(raw)) return null;
  // "Amount will be deducted from next recharge" — nothing has moved yet.
  if (/deducted from (?:your )?next recharge|will be deducted from next/i.test(raw)) return null;
  // BNPL / tabby previews of TOMORROW's charge — the real charge arrives as
  // its own bank SMS, so importing these double-counts every instalment.
  if (
    /will be charged to your (?:default )?(?:card|payment method)|due tomorrow and will be charged|statement for (?:aed\s*)?[\d,.]+ is ready|charged to your (?:card|default payment method) (?:tomorrow|on \d)/i.test(
      raw,
    )
  ) {
    return null;
  }
  // Instalment-conversion offers quote an EXISTING purchase; payment
  // reminders and biller receipts duplicate messages already counted.
  //
  // Gated on evidence, exactly as PROMO_RE is three lines above. An EPP offer
  // is appended to the purchase alert BY DESIGN across ADCB, RAKBANK and
  // Emirates NBD — the offer only exists because a large purchase just posted
  // — so unconditionally this deleted the very purchases it advertised
  // against, and it hit large amounts specifically, since that is what banks
  // pitch EPP on.
  //
  // The evidence here has to be a SETTLED TENSE, not merely a posted clause: a
  // standalone conversion offer restates the purchase it is pitching against
  // in the present ("Pay as low as AED 226.8 per month for the purchase of AED
  // 7379.54 at ..."), and that purchase is already on the ledger from its own
  // alert. The alert itself says the money moved — "spent at", "was used",
  // "has been debited", or an available balance.
  if (
    /\*?convert now\*?|converted into instalments?|converted into installments?|interest payment plan|easy payment plan/i.test(raw) &&
    !(posted && SETTLED_TENSE_RE.test(raw))
  ) {
    return null;
  }
  if (/payment reminder|due date reminder|pay immediately to avoid|avoid blockage|is overdue\b/i.test(raw)) return null;
  if (/rate our service|thank you for using ajmanpay|successfully redeemed|delivery associate/i.test(raw)) return null;

  // RTA / municipal parking confirmations:
  //   Confirmation / PlateNo-XXX / TicketNo-XXX / Fee-AED2.38 / Paid upto ...
  if (
    /\bplate(?:no|source)?\s*[-:]/i.test(raw) &&
    /\b(?:fee|paid)\s*[-:]?\s*(?:aed|dhs|[\d,])/i.test(raw)
  ) {
    // Both spellings exist: "Fee-AED2.38" and "Paid: 2 AED".
    const feeMatch =
      raw.match(/\b(?:fee|paid)\s*[-:]?\s*(?:aed|dhs)\s*([\d,]+(?:\.\d{1,2})?)/i) ??
      raw.match(/\b(?:fee|paid)\s*[-:]?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:aed|dhs)/i);
    const fils = feeMatch ? Math.round(Number(feeMatch[1].replace(/,/g, '')) * 100) : null;
    if (!fils || fils <= 0) return null;
    return {
      kind: 'transaction',
      type: 'expense',
      amountFils: fils,
      merchant: 'Parking',
      date: extractDate(raw),
      dueDay: null,
      minDueFils: null,
      card: null,
      transferHint: false,
      snapshotFils: null,
      snapshotKind: null,
      categoryGuess: 'transport',
      raw: source,
    };
  }

  const date = extractDate(raw);
  const snapshot = extractSnapshot(raw);
  const snapshotFils = snapshot?.fils ?? null;
  let snapshotKind = snapshot?.kind ?? null;
  // On a credit card, "Avl Bal" is available CREDIT (limit headroom), not
  // money in an account — storing it as a balance made cards look rich.
  if (snapshotKind === 'balance' && card?.kind === 'credit') snapshotKind = 'limit';

  // Card payment received (transfer into the card) — before debit detection,
  // since these messages also contain the word "payment". Only credit cards
  // receive payments, whatever the message called the card.
  if (card?.kind !== 'account' && card && CARD_PAYMENT_RE.test(raw)) {
    const amountFils = amountWithFx(raw);
    if (!amountFils) return null;
    return {
      kind: 'cardPayment',
      type: 'expense',
      amountFils,
      merchant: `Card •${card.last4} payment`,
      date,
      dueDay: null,
      minDueFils: null,
      card: { ...card, kind: 'credit' },
      transferHint: true,
      snapshotFils,
      snapshotKind,
      categoryGuess: 'other',
      raw: source,
    };
  }

  // FAB-style card bill payment from the bank-account side:
  //   "Your payment instructions of AED 7,663.94 to 5492********4711 has
  //    been processed" — a transfer onto the card, never spending.
  if (/payment\s+instructions?\s+of/i.test(raw)) {
    const masked = raw.match(MASKED_PAN_RE);
    if (masked) {
      const amountFils = amountWithFx(raw);
      if (!amountFils) return null;
      return {
        kind: 'transaction',
        type: 'expense',
        amountFils,
        merchant: `Card •${masked[1]} payment`,
        date,
        dueDay: null,
        minDueFils: null,
        card: { last4: masked[1], kind: 'credit' },
        transferHint: true,
        snapshotFils,
        snapshotKind,
        categoryGuess: 'other',
        raw: source,
      };
    }
  }

  // Bill-pay through the bank: "Your payment instructions of AED 313.95 to
  // homeinet for consumer number 4026 has been processed".
  //
  // "for consumer number" is the tell, and it is decisive: this is a
  // registered biller, so the payment is a bill. The payee is a nickname the
  // user chose when they set the biller up (homeinet, apthome, Offhome,
  // Villabill), which means no vocabulary can ever classify it and adding
  // names to a list would be endless. The structure is what we recognise;
  // the name becomes the title, and one correction from the user pins the
  // category for that payee forever.
  const billerPay = raw.match(
    /payment\s+instructions?\s+of\s+(?:[A-Z]{3}|Dhs?)?\s*[\d,.]+\s+to\s+(.+?)\s+for\s+consumer\s+number/i,
  );
  if (billerPay) {
    const amountFils = amountWithFx(raw);
    if (!amountFils) return null;
    const payee = billerPay[1].trim().replace(/\s{2,}/g, ' ');
    const merchant = normalizeServiceName(payee) ?? titleCase(payee);
    return {
      kind: 'transaction',
      type: 'expense',
      amountFils,
      merchant,
      date,
      dueDay: null,
      minDueFils: null,
      card,
      transferHint: false,
      snapshotFils,
      snapshotKind,
      // A named biller beats the default; "Du" should still read as telecom.
      categoryGuess: guessCategory(payee, 'expense', overrides, merchant) === 'other'
        ? 'utilities'
        : guessCategory(payee, 'expense', overrides, merchant),
      raw: source,
    };
  }

  // Utility direct debits name the biller before the account: "AED 1,938.41
  // has been debited from your account no. 095-XXX11XXX-01 SEWA NO.-8765".
  // Without this the row title fell back to the generic "Card purchase".
  const billerRef = raw.match(/\b([A-Z][A-Z ]{2,20}?)\s+NO\.?\s*[-:]\s*[\dX·]/);
  if (billerRef) {
    const amountFils = amountWithFx(raw);
    if (amountFils) {
      const payee = billerRef[1].trim();
      const merchant = normalizeServiceName(payee) ?? titleCase(payee);
      return {
        kind: 'transaction',
        type: CREDIT_WORDS.test(raw) && !DEBIT_WORDS.test(raw) ? 'income' : 'expense',
        amountFils,
        merchant,
        date,
        dueDay: null,
        minDueFils: null,
        card,
        transferHint: false,
        snapshotFils,
        snapshotKind,
        categoryGuess: guessCategory(payee, 'expense', overrides, merchant) === 'other'
          ? 'utilities'
          : guessCategory(payee, 'expense', overrides, merchant),
        raw: source,
      };
    }
  }

  // Biller-portal receipt, sent as a labelled block:
  //   Your payment to the account number ····4822 has been processed.
  //   Amount Due: AED 408.45 / Amount Paid: AED 408.45 / Remaining Balance: 0
  // "Amount Paid" is the figure that moved; "Amount Due" only happens to equal
  // it when the bill was settled in full. Naming the account beats the generic
  // fallback, and the labelled lines are not a merchant descriptor.
  const portalPay = raw.match(
    /payment\s+to\s+(?:the\s+)?account\s+(?:number|no\.?)\s*[·•X*]*(\d{4,})[\s\S]*?amount\s+paid\s*:?\s*(?:[A-Z]{3}|Dhs?)?\s*([\d,]+(?:\.\d{1,2})?)/i,
  );
  if (portalPay) {
    // Last four, not first four: an unmasked account number would otherwise
    // label the row with its leading digits.
    const last4 = portalPay[1].slice(-4);
    const amountFils = Math.round(Number(portalPay[2].replace(/,/g, '')) * 100);
    if (amountFils > 0) {
      return {
        kind: 'transaction',
        type: 'expense',
        amountFils,
        merchant: `Payment to •${last4}`,
        date,
        dueDay: null,
        minDueFils: null,
        card,
        transferHint: false,
        snapshotFils,
        snapshotKind,
        categoryGuess: guessCategory(raw, 'expense', overrides, `Payment to \u2022${last4}`),
        raw: source,
      };
    }
  }

  // Telegraphic transfers / outward remittances — money moved between
  // accounts (usually abroad), not merchant spending.
  if (/issuance of telegraphic transfer|debit telegraphic transfer|^outward remittance/i.test(raw)) {
    const amountFils = amountWithFx(raw);
    if (!amountFils) return null;
    return {
      kind: 'transaction',
      type: 'expense',
      amountFils,
      merchant: /^outward remittance/i.test(raw) ? 'Outward remittance' : 'Telegraphic transfer',
      date,
      dueDay: null,
      minDueFils: null,
      card,
      transferHint: true,
      snapshotFils,
      snapshotKind,
      categoryGuess: 'other',
      raw: source,
    };
  }

  // HSBC-style "TT Payment to 041-339***-001 AED 1,108.00+" — an
  // inter-account transfer; "+" after the amount marks money arriving.
  if (/\btt\s+payment\b/i.test(raw)) {
    // Account fragments like "041-339***-001 AED" fake a suffix amount, so
    // read the prefix-form figure (optionally "+"-terminated) directly.
    const m = raw.match(/(?:aed|dhs|sar|usd|eur|gbp)\s*([\d,]+(?:\.\d{1,2})?)/i);
    const amountFils = m ? Math.round(Number(m[1].replace(/,/g, '')) * 100) : null;
    if (!amountFils) return null;
    return {
      kind: 'transaction',
      type: /[\d.,]\+/.test(raw) ? 'income' : 'expense',
      amountFils,
      merchant: 'Bank transfer',
      date,
      dueDay: null,
      minDueFils: null,
      card,
      transferHint: true,
      snapshotFils,
      snapshotKind,
      categoryGuess: 'other',
      raw: source,
    };
  }

  // Credit-card statement with dues. Statements only exist for credit cards.
  // Purchase-style verbs mean this is a transaction with a "statement due"
  // footer, not the statement itself ("if already paid" footers must NOT
  // disqualify a real due reminder, so this deliberately excludes "paid").
  if (card && STATEMENT_RE.test(raw) && BILL_DUE_WORDS.test(raw) && !STATEMENT_TXN_BLOCK_RE.test(raw)) {
    // "Min payment of AED100 ... Total billed amt is AED1174.49" — the
    // stated total beats first-amount extraction (which would grab the min).
    // Arabic states both figures the same way English does, and if the total
    // is not read the row records the MINIMUM instead — AED 162 for a AED
    // 3,240 statement.
    const totalMatch = raw.match(TOTAL_DUE_RE) ?? raw.match(AR_TOTAL_DUE_RE);
    const amountFils = totalMatch
      ? Math.round(Number(totalMatch[1].replace(/,/g, '')) * 100)
      : amountWithFx(raw);
    if (!amountFils) return null;
    const minMatch = raw.match(MIN_DUE_RE) ?? raw.match(AR_MIN_DUE_RE);
    return {
      kind: 'cardStatement',
      type: 'expense',
      amountFils,
      merchant: `Card •${card.last4}`,
      date,
      dueDay: date ? Number(date.slice(8)) : null,
      minDueFils: minMatch ? Math.round(Number(minMatch[1].replace(/,/g, '')) * 100) : null,
      card: { ...card, kind: 'credit' },
      transferHint: false,
      snapshotFils,
      snapshotKind,
      categoryGuess: 'other',
      raw: source,
    };
  }

  // URLs carry misleading words ("sewapayment.tiny.us" is not a payment).
  const prose = raw.replace(/https?:\/\/\S+/gi, ' ');
  const hasDebit = DEBIT_WORDS.test(prose);
  const hasCredit = CREDIT_WORDS.test(prose);
  // Carrier-billed store purchases ("App Store & Google Play bill") are
  // receipts, never utility bills — treating them as dues produced garbage
  // reminders with balance-sized amounts.
  const carrierBilling = /app\s*store|google play|play store|itunes/i.test(raw);
  const isBillDue = BILL_DUE_WORDS.test(raw) && !hasDebit && !hasCredit && !carrierBilling;

  // A refund or reversal reverses spending: money coming back IN, whatever
  // verbs the message uses ("Purchase amount of AED X ... has been refunded").
  const isRefund = /refunded to your (?:card|account)/i.test(prose) || REVERSAL_RE.test(prose);

  if (PROMO_RE.test(raw) && !TXN_EVIDENCE_RE.test(raw)) return null;
  // "AED 500.00 has been reversed to your Card ending 1234" names no verb from
  // either list and used to die right here — money returned, silently dropped.
  if (!hasDebit && !hasCredit && !isRefund && !isBillDue) return null;

  const amountFils = amountWithFx(raw);
  if (!amountFils) return null;

  // Direction is decided by the clause that says WHERE the money went, and
  // only falls back to the word lists when no clause said. An unordered race
  // between the two lists is what booked salaries as expenses and card
  // purchases as revenue: both lists match on the same sentence all the time.
  //
  // "credited to your account" settles it on its own. Those messages carry a
  // reference line naming the sender — "...B/O DELIVERY HERO TALABAT DB LLC
  // Talabat Biweekly Payment" — and the word Payment in it was enough to trip
  // the debit test, filing an incoming payout as spending.
  // ...and a credit clause whose credited ACCOUNT belongs to a biller is not a
  // credit at all: "Your payment of AED 200.00 has been credited to your du
  // account" is a phone bill being settled, and reading "credited to your" as
  // direction booked it as AED 200 of income. The payee has to be NAMED —
  // "credited to your account 1234" with a rising balance in the same sentence
  // is money arriving, and reading the bare noun as a biller turned it into an
  // expense: the same 2x swing pointed the other way.
  const billerPaid = billerSettlement(prose);
  const creditClause = CREDIT_CLAUSE_RE.test(prose) && !billerPaid;
  const debitClause = DEBIT_CLAUSE_RE.test(prose);
  const type: TransactionType = isBillDue || billerPaid
    ? 'expense'
    : isRefund || (creditClause && !debitClause)
      ? 'income'
      : debitClause || hasDebit || !hasCredit
        ? 'expense'
        : 'income';

  let merchant = '';
  /** The descriptor before cleanup — ".com" survives here, so Capital.com and
   *  Name.com can still be recognised as the services they are. */
  let descriptor = '';
  // English first in BOTH branches, always. On a bilingual body the two halves
  // name the same shop, and the Latin spelling is the one SERVICE_NAMES,
  // cleanDescriptor's acquirer heuristics, the merchant-override keys and
  // subscription grouping are all built around — resolving to "كارفور" when
  // "CARREFOUR" is right there would fragment every one of them.
  if (isBillDue) {
    const billMatch = raw.match(BILL_MERCHANT_RE);
    merchant = billMatch ? billMatch[1].trim() : extractMerchant(raw, MERCHANT_RE);
    if (!merchant) {
      const arBill = raw.match(AR_BILL_MERCHANT_RE);
      merchant = arBill ? sliceUnfolded(clean, arBill) : extractArabicMerchant(raw, clean);
    }
  } else {
    merchant = extractMerchant(raw, MERCHANT_RE);
    if (!merchant) merchant = extractArabicMerchant(raw, clean);
    if (!merchant) {
      const paymentFor = raw.match(PAYMENT_FOR_RE);
      if (paymentFor) merchant = paymentFor[1].trim();
    }
    // "...credited to your du account 1234567", "...received towards your DEWA
    // account" — the biller names itself before the noun, with none of the
    // prepositions MERCHANT_RE looks for.
    if (!merchant && billerPaid) merchant = billerPaid;
    // "...received for your electricity bill using card 1234" — the same
    // shape with the bill noun instead. BILL_MERCHANT_RE already reads it for
    // reminders; a POSTED bill payment deserves the same title rather than
    // the generic "Card purchase".
    if (!merchant && type === 'expense') {
      const billName = raw.match(BILL_MERCHANT_RE);
      if (billName) merchant = billName[1].trim();
    }
  }
  let transferHint = !isBillDue && TRANSFER_HINT_RE.test(raw);
  descriptor = merchant;
  merchant = cleanDescriptor(merchant);
  // HSBC embeds the merchant BEFORE the verb:
  //   "From HSBC: 30AUG23 MINISTRY OF HUMAN RE Purchase from 041-..."
  if (!merchant) {
    const hsbc = raw.match(/from hsbc:\s*\d{1,2}[a-z]{3}\d{2,4}\s+(.{3,40}?)\s+purchase from/i);
    if (hsbc) merchant = hsbc[1].trim();
  }
  // Multi-line formats: the merchant sits on its own line after the amount.
  if (!merchant && !isBillDue && type === 'expense' && !transferHint) {
    const lineMerchant = merchantFromLines(raw);
    if (lineMerchant) merchant = lineMerchant;
  }
  // A known service named anywhere beats the looser payee heuristics below
  // ("WWW.GRAB.COM, BANGKOK" must resolve to Grab, not "for exact amt").
  if (!merchant && !isBillDue && type === 'expense' && !transferHint) {
    const svc = normalizeServiceName(raw);
    if (svc) merchant = svc;
  }
  // Transfer rails name the rail, not a shop: "for a FastPay transfer to
  // Khalid Rashid", "MOBILE BANKING TRANSFER TO AE····0021...", "for Fund
  // Transfer through Liv app". The money did leave, so these stay expenses —
  // but calling them "Card purchase" was wrong twice over, and a row that
  // reads "Transfer to Khalid Rashid" needs no category at all.
  let structuralMerchant = false;
  // "RULE TRANSFER TO SAVINGS WITH ONE-SHOT SAVING" — an automated sweep into
  // the user's own savings pot. It is the clearest possible self-transfer, and
  // three of them were being counted as spending.
  if (
    !isBillDue &&
    // A savings pot has a NAME, and the name is rarely the word "savings":
    // Liv calls its default one "Emergency Funds" and sweeps into it with a
    // "RULE TRANSFER". Two of those, at AED 7,000 and AED 4,000, were being
    // counted as a month's spending.
    //
    // The two branded pot nouns are here because they are self-identifying:
    // Wio's product is a "Saving Space", and "LIV GOAL <name>" names the bank
    // before the noun, so neither can be mistaken for a shop. The bare nouns
    // (a "GOAL", a "SPACE", a "POT" with no brand in front) are NOT here —
    // they only become readable once the sender says which bank sent this,
    // which is what bank.ownPot below is for.
    (/transfer to savings|savings? (?:rule|goal|pot|plan)\b|round-?up saving|\brule\s+transfer\b|one-?shot\s+sav|\bemergency\s+funds?\b|\bsaving\s+spaces?\b|\bliv\s+goals?\b/i.test(
      raw,
    ) ||
      // Sender-gated: money moving to one of THIS bank's own products, or to
      // the bank's own name ("...TO LIV FROM EMERGENCY FUNDS", real corpus
      // #21). Both are the user shifting money inside their own bank, and
      // both read as an unknown payee without the sender.
      (!!bank &&
        new RegExp(
          `\\b(?:to|into)\\s+(?:your\\s+)?(?:${bank.ownPot?.source ?? 'x^'}|${bank.brand.source})`,
          'i',
        ).test(raw)))
  ) {
    merchant = 'Savings transfer';
    structuralMerchant = true;
    transferHint = true;
  }

  if (!isBillDue && type === 'expense') {
    const named = raw.match(
      /\b(?:fastpay|instant|local|domestic|international|fund|mobile\s+banking)\s+transfer\s+to\s+([A-Za-z][A-Za-z .'\-]{2,40}?)\s*(?:[.,;]|\bif\b|$)/i,
    );
    if (named) {
      merchant = `Transfer to ${named[1].trim().replace(/\s{2,}/g, ' ')}`;
      structuralMerchant = true;
    } else if (/\btransfer\s+to\s+[A-Z]{2}[\dX·•]/i.test(raw)) {
      merchant = 'Bank transfer';
      structuralMerchant = true;
    } else if (!merchant && /\bfund\s+transfer\b|\bfunds?\s+transferred\b/i.test(raw)) {
      merchant = 'Outgoing transfer';
      structuralMerchant = true;
    }
  }

  // "debited ... for SALIK on", "sent to Dubai Islamic Bank as per your
  // Direct Debit instructions" — payee named after "for" / "sent to".
  if (!merchant && !isBillDue && type === 'expense' && !transferHint) {
    const payeeRe =
      /\b(?:for|sent\s+to)\s+([A-Za-z][A-Za-z &.'\-]{2,40}?)\s*(?:[.,;]|\bon\b|\bas\s+per\b|\bthrough\b|$)/gi;
    for (const m of raw.matchAll(payeeRe)) {
      const candidate = m[1].trim();
      if (/^(?:aed|dhs|sar|usd|eur|gbp|your|the|payment|consumer|exact|pay\b|using|below)/i.test(candidate)) continue;
      if ((candidate.match(/[A-Za-z]/g) ?? []).length < 3) continue;
      merchant = candidate.replace(/\s+(?:PJSC|LLC|PSC|FZE)$/i, '').trim();
      break;
    }
  }
  if (!merchant) {
    // No "at/to/from" clause — but a known service named ANYWHERE in the
    // message still identifies the row (many card descriptors put the
    // merchant at the end with no preposition). Generic "Card purchase"
    // titles can never group into subscriptions, so this matters.
    const service =
      !isBillDue && type === 'expense' && !transferHint ? normalizeServiceName(raw) : null;
    merchant = service ?? (isBillDue
      ? 'Bill payment'
      : type === 'income'
        ? /\brefund(?:ed)?\b/i.test(raw) || REVERSAL_RE.test(raw)
          ? 'Refund'
          : DEPOSIT_RE.test(raw)
          ? 'Cash deposit'
          : /inward\s+remittance/i.test(raw)
            ? 'Inward remittance'
            : 'Incoming transfer'
        : transferHint
          ? 'Card payment'
          : ATM_RE.test(raw)
            ? 'ATM withdrawal'
            : /cheque|\bchq\b/i.test(raw)
              ? 'Cheque'
              : /value\s+added\s+tax|\bvat\b\s*(?:@|¡)?\s*\d/i.test(raw)
                ? 'VAT fee'
                : FEE_RE.test(raw)
                  ? 'Bank fee'
                  : /instant\s+transfer|local\s+transfer|social\s+transfer/i.test(raw)
                    ? 'Outgoing transfer'
                    // No card in the message means no card purchase: "An amount
                    // of AED 118.04 has been debited from your FAB account
                    // XXXX0002" names no payee at all, and saying "Card
                    // purchase" invented one.
                    : !card || card.kind === 'account'
                      ? 'Account debit'
                      : 'Card purchase');
  } else if (!structuralMerchant) {
    // Payment processors prefix their own descriptor: "ALP*Taobao",
    // "EIG*Hostgator.com", "V*bettercv.com", "GOOGLE*GOOGLE ONE". The prefix
    // is the acquirer, never the merchant, and it made identical shops read
    // as different ones.
    // Ziina and Mamo are UAE payment links: the shop's own name follows the
    // star, so "Ziina  *qasr al zain m" is Qasr Al Zain, not Ziina.
    // "HTTP WWW CARS24 COM" and "HTTP //WWW.BINANCE.COM" are URLs, not names.
    // When nothing survives the scheme and host prefix, a service named
    // anywhere in the message identifies the row better than "Www" does.
    const deUrled =
      merchant.replace(/^https?\s*[:/]*\s*(?:www[\s.]?)?/i, '').trim() ||
      normalizeServiceName(raw) ||
      merchant;
    const unprefixed = deUrled.replace(
      /^(?:alp|eig|sq|tap|web|v|paypal|google|gpay|apl|amzn|pos|ziina|mamo|wl)\s*\*\s*/i,
      '',
    );
    merchant =
      normalizeServiceName(descriptor || merchant) ??
      normalizeServiceName(merchant) ??
      titleCase((unprefixed || deUrled || merchant).replace(/[\s,;.*-]+$/, ''));
  }
  // ATM messages usually name a location; the row is still a cash withdrawal.
  //
  // The CATEGORY has to be pinned along with the title, because guessCategory
  // reads the whole message and an ATM's street address is a shopping mall as
  // often as not: "ADIB ATM AL WAHDA MALL" filed as shopping, "ENBD ATM DEIRA
  // CITY CENTRE" as shopping (via "centre"), "MASHREQ ATM BURJUMAN" as other.
  // One event, three categories, decided by which street the machine stands
  // on. A withdrawal is cash leaving the account; what it is later spent on is
  // not in this message.
  let titlePinned = false;
  if (!isBillDue && type === 'expense' && !transferHint && ATM_RE.test(raw)) {
    merchant = 'ATM withdrawal';
    titlePinned = true;
  }
  // A transfer the bank never gave a payee for is money moving between your
  // own places, not spending. The bank sends BOTH legs of a card settlement —
  // "instant transfer AED 10,089" and "payment instructions ... to
  // 5492****4833" — and with only the second leg flagged, the same 10,089 was
  // counted once as a transfer and once as spending, on the same day.
  //
  // A transfer that DOES name a person keeps its "Transfer to <name>" title
  // and stays an expense, because that money really did leave.
  //
  // Outgoing only. Including incoming here was a mistake that zeroed a user's
  // income: an unnamed transfer OUT is usually a self-move or a card
  // settlement, but an unnamed transfer IN is real money arriving — a salary,
  // someone paying you back — and excluding it is never right.
  if (type === 'expense' && (merchant === 'Outgoing transfer' || merchant === 'Bank transfer')) {
    transferHint = true;
  }

  return {
    kind: isBillDue ? 'billDue' : 'transaction',
    type,
    amountFils,
    merchant,
    date,
    dueDay: isBillDue && date ? Number(date.slice(8)) : null,
    minDueFils: null,
    card,
    transferHint,
    snapshotFils,
    snapshotKind,
    // When the title is pinned, the TITLE is all guessCategory gets to read —
    // not the message, whose ATM address would otherwise decide it. A user
    // override on that title still wins, which is the one thing that should
    // always beat a structural guess.
    categoryGuess: guessCategory(titlePinned ? merchant : raw, type, overrides, merchant),
    raw: source,
  };
}

/**
 * Parses pasted text that may contain several messages separated by blank
 * lines.
 *
 * The blank-line split is what makes a BILINGUAL alert dangerous here: banks
 * send the English and Arabic halves of ONE purchase in one body, often with a
 * blank line between them, and each half parses perfectly on its own — so a
 * single AED 50 purchase arrived as two AED 50 rows and doubled the user's
 * spending. `parseSms` on the same text gives the correct single row; only the
 * paste path and the Worker go through the split.
 *
 * The collapse is deliberately narrow. Two blocks are the same event only when
 * they agree on amount, card, date, kind and direction AND they are in
 * DIFFERENT SCRIPTS — that is a restatement, not a repeat. Two same-amount,
 * same-card, same-day charges in one script are perfectly real (two Salik
 * tolls, two coffees), and deleting one of those would be the same bug pointed
 * the other way.
 *
 * ...and it was, because none of that compared the MERCHANT. An AED 50 card
 * purchase at Carrefour and an AED 50 card purchase at Starbucks, on the same
 * card and the same day, one alert in each language, agreed on every field the
 * test looked at — so the second one was deleted and the user's coffee simply
 * never happened.
 *
 * Merchants cannot be compared across scripts by name (the whole point is that
 * "كارفور" and "Carrefour" are the same shop), so the two names are compared
 * by TRANSLITERATION — the Arabic is romanised and both sides are reduced to
 * the consonant skeleton Arabic script actually writes.
 *
 * categoryGuess was tried as a proxy for identity and is far too coarse in
 * BOTH directions. It merged distinct shops — Amazon and نون are both
 * shopping, Carrefour and لولو are both groceries, Talabat and ستاربكس are
 * both dining, and each of those pairs lost a real purchase. And it split
 * restatements — the Latin brand table knows SHARAF DG is shopping and has no
 * entry for شرف دي جي, which guesses "other", so one AED 200 purchase became
 * AED 400 of spending. A guess of "other" means "I do not know"; it is not a
 * claim that this is a different shop.
 *
 * Where they do collapse, the LATIN row is the one kept, for the same reason
 * English wins inside parseSms: it carries the names everything downstream
 * groups by.
 */
/** A title that names no shop, so it can never contradict one that does. */
function namesNoMerchant(row: ParsedSms): boolean {
  return (
    STRUCTURAL_TITLES.has(row.merchant) ||
    row.merchant === 'Card purchase' ||
    row.merchant === 'Bill payment' ||
    /^Card •/.test(row.merchant)
  );
}

/**
 * Arabic spellings of LATIN LETTER NAMES. UAE brands with an initialism in
 * them are transliterated letter by letter — "SHARAF DG" is "شرف دي جي", where
 * دي is the letter D and جي is the letter G — so a character-level
 * romanisation alone can never line the two spellings up.
 */
const AR_LETTER_WORDS: Record<string, string> = {
  'اي': 'a', 'ايه': 'a', 'بي': 'b', 'سي': 'c', 'دي': 'd', 'اف': 'f', 'جي': 'g',
  'اتش': 'h', 'جيه': 'j', 'كي': 'k', 'ال': 'l', 'ام': 'm', 'ان': 'n', 'او': 'o',
  'كيو': 'q', 'ار': 'r', 'اس': 's', 'تي': 't', 'يو': 'u', 'في': 'v',
  'دبليو': 'w', 'اكس': 'x', 'واي': 'y', 'زد': 'z',
};
/** Post-fold Arabic letters to their nearest Latin sound. */
const AR_TO_LATIN: Record<string, string> = {
  'ا': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': 'h', 'خ': 'kh',
  'د': 'd', 'ذ': 'd', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's',
  'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': '', 'غ': 'gh', 'ف': 'f', 'ق': 'q',
  'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'و': 'w', 'ي': 'y',
  'ء': '', 'پ': 'p', 'چ': 'ch', 'ژ': 'z', 'گ': 'g', 'ڤ': 'v',
};
function romanizeArabic(s: string): string {
  return s
    .split(/\s+/)
    .map(
      (w) =>
        AR_LETTER_WORDS[w] ??
        [...w].map((c) => AR_TO_LATIN[c] ?? (/[a-z0-9]/i.test(c) ? c : ' ')).join(''),
    )
    .join(' ');
}
/**
 * The CONSONANT SKELETON of a merchant name — what survives when the two
 * scripts are asked to agree.
 *
 * Arabic writes short vowels only as diacritics banks do not send, so the
 * vowels are dropped from both sides rather than guessed at. The letter
 * classes are the substitutions Arabic orthography is forced into: there is no
 * V (فيرجن is VIRGIN), no hard G (ميجاستور is MEGASTORE), and no P.
 */
function merchantKey(name: string): string {
  let s = normalizeArabic(name).toLowerCase();
  if (ARABIC_RE.test(s)) s = romanizeArabic(s);
  return s
    .replace(/[^a-z0-9]+/g, '')
    .replace(/c(?=[eiy])/g, 's') // CENTRE is سنتر, not كنتر
    .replace(/ph/g, 'f')
    .replace(/sh|ch/g, 's')
    .replace(/th/g, 't')
    .replace(/gh/g, 'g')
    .replace(/kh|ck|qu|q|c/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/v/g, 'f')
    .replace(/g/g, 'j')
    .replace(/p/g, 'b')
    .replace(/z/g, 's')
    // Doubling is a Latin spelling convention Arabic does not write, so it
    // goes BEFORE the vowels do. Collapsing afterwards instead reduced نون to
    // a single "n" and لولو to a single "l", and a one-letter skeleton is
    // treated as unknown — which silently merged Noon into Amazon and Lulu
    // into Carrefour, deleting a real purchase each time.
    .replace(/(.)\1+/g, '$1')
    .replace(/[aeiouwy]/g, '');
}

function merchantsAgree(a: ParsedSms, b: ParsedSms): boolean {
  if (a.merchant.trim().toLowerCase() === b.merchant.trim().toLowerCase()) return true;
  if (namesNoMerchant(a) || namesNoMerchant(b)) return true;
  const ka = merchantKey(a.merchant);
  const kb = merchantKey(b.merchant);
  // A one-consonant skeleton (IKEA, ايكيا) carries too little to tell the two
  // names apart, so it contradicts nothing and the rest of the evidence —
  // which already agreed on amount, card, day, kind and direction — decides.
  if (ka.length < 2 || kb.length < 2) return true;
  return ka === kb;
}
export function parseSmsBatch(
  text: string,
  overrides?: Record<string, CategoryId>,
): ParsedSms[] {
  const rows = text
    .split(/\n\s*\n/)
    .map((m) => parseSms(m, overrides))
    .filter((p): p is ParsedSms => p !== null);
  const out: ParsedSms[] = [];
  for (const row of rows) {
    const prev = out[out.length - 1];
    const restatement =
      prev &&
      prev.amountFils === row.amountFils &&
      (prev.card?.last4 ?? null) === (row.card?.last4 ?? null) &&
      prev.date === row.date &&
      prev.kind === row.kind &&
      prev.type === row.type &&
      merchantsAgree(prev, row) &&
      ARABIC_RE.test(prev.raw) !== ARABIC_RE.test(row.raw);
    if (!restatement) {
      out.push(row);
      continue;
    }
    if (ARABIC_RE.test(prev.raw) && !ARABIC_RE.test(row.raw)) out[out.length - 1] = row;
  }
  return out;
}
