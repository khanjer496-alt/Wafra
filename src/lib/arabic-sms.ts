/**
 * Arabic bank SMS, rewritten into the wording the parser already reads.
 *
 * UAE and Saudi banks send Arabic to any customer whose profile language is
 * Arabic — it is not a fringe format, it is half the customers. Every Arabic
 * message was refused outright, including ones whose amount was already in
 * Latin script ("عملية شراء بمبلغ AED 250.00"), because the parser gates on an
 * English verb before it looks at anything else.
 *
 * The alternative to this file was a second parser for Arabic. That is the
 * exact shape this codebase keeps getting hurt by — two things that must agree
 * with nothing checking that they do — and it would have meant every category
 * rule, every merchant fix and every card-due change landing twice or drifting
 * apart. Rewriting the vocabulary instead means there is still only ONE
 * parser, and Arabic inherits every rule written since, for free.
 *
 * The cost is worth naming: a rewrite is only ever as good as its word list.
 * What is here is (a) the field labels of real messages on file and (b)
 * closed-class banking vocabulary — the words for "purchase", "card",
 * "balance". It is not, and cannot be, translation.
 */

/** Arabic-Indic ٠١٢٣٤٥٦٧٨٩ and the Persian variant ۰۱۲۳۴۵۶۷۸۹. */
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
/** Harakat (fatha, damma, sukun …) and tatweel — decoration, never meaning. */
const DIACRITICS = /[ً-ْـٰ]/g;
/** The Arabic block, digits and punctuation included. */
const ARABIC_ANY = /[؀-ۿ]/;
/** Arabic letters only — what counts as "still inside a word". */
const LETTER = 'ء-ي';

export function hasArabic(text: string): boolean {
  return ARABIC_ANY.test(text);
}

/**
 * A whole-word Arabic pattern.
 *
 * `\b` cannot be used here at all: JavaScript defines it over [A-Za-z0-9_],
 * so between a space and an Arabic letter there is no boundary and the
 * pattern never fires. Every rule in the first draft of this file was dead
 * for that reason and the tests below are what caught it.
 *
 * The trailing guard is a lookahead, which is universally supported. The
 * LEADING guard is a captured character rather than a lookbehind, because
 * Hermes — the engine this actually ships on — is not somewhere to bet on
 * lookbehind. `$1` puts that character back.
 */
function word(body: string): RegExp {
  return new RegExp(`(^|[^${LETTER}])(?:${body})(?![${LETTER}])`, 'g');
}

/**
 * Word rewrites, applied in order — longest phrase first, always.
 *
 * "تم خصم" has to win before the bare "خصم" inside it does. The same trap is
 * why "الرصيد المتاح" precedes "رصيد", and why the point-of-sale headlines
 * precede "شراء".
 *
 * Provenance is marked per block. `corpus` means the label appears in a real
 * bank message on file; `vocabulary` means it is the ordinary Arabic word for
 * the thing, the way "debited" is the ordinary English one. Nothing here is a
 * guessed message FORMAT — the rewrites are word-for-word and never assume
 * field order.
 *
 * Arabic fuses its prepositions and its article onto the following noun, so
 * "بمبلغ" (bi- + mablagh) and "المبلغ" (al- + mablagh) are the same noun and
 * both have to be listed. That is spelling, not format invention.
 */
const REWRITES: [RegExp, string][] = [
  // ── amount ─────────────────────────────────────────────── corpus + vocab
  // "مبلغ: 12.00 SAR" is a labelled field in the Al Bilad corpus; "بمبلغ" is
  // the same noun with the preposition fused on.
  [word('بمبلغ|المبلغ|مبلغ'), '$1 '],
  [word('وقدره|قدره'), '$1 '],

  // ── direction: money leaving ───────────────────────────── corpus + vocab
  // The two point-of-sale headlines are verbatim corpus lines.
  [word('شراء\\s+عبر\\s+نقاط\\s+البيع'), '$1 Card purchase '],
  [word('مشتريات\\s+نقاط\\s+البيع'), '$1 Card purchase '],
  [word('نقاط\\s+البيع'), '$1 POS '],
  [word('سحب\\s+نقدي'), '$1 ATM cash withdrawal '],
  [word('تم\\s+خصم'), '$1 debited '],
  [word('تم\\s+سحب'), '$1 withdrawn '],
  [word('تم\\s+الدفع'), '$1 paid '],
  [word('تم\\s+شراء|عملية\\s+شراء'), '$1 purchase '],
  [word('خصم|مخصوم'), '$1 debited '],
  // "تم" is the passive auxiliary — "تم استرداد" is "has been refunded". Every
  // pairing that changes meaning is handled above; what is left is the bare
  // auxiliary, and leaving it stranded put a word of Arabic in the middle of
  // the rewritten sentence where a merchant matcher could pick it up.
  [word('تم|تمت'), '$1 has been '],
  [word('مشتريات|شراء'), '$1 purchase '],
  [word('سحب'), '$1 withdrawn '],
  [word('دفع|مدفوع'), '$1 paid '],

  // ── direction: money arriving ──────────────────────────────────── vocab
  [word('تم\\s+إيداع|تم\\s+ايداع'), '$1 deposited '],
  [word('تم\\s+إضافة|تم\\s+اضافة'), '$1 credited '],
  [word('إيداع|ايداع'), '$1 deposited '],
  [word('استرداد|استرجاع|مسترد'), '$1 refunded '],
  [word('الراتب|راتب'), '$1 salary '],
  [word('إضافة|اضافة|أضيف|اضيف'), '$1 credited '],
  [word('حوالة|تحويل'), '$1 transfer '],

  // ── balance ───────────────────────────────────────────── corpus + vocab
  // "رصيد: 1234.56 SAR" is a corpus label. The parser reads "Avl Bal".
  [word('الرصيد\\s+المتاح|الرصيد\\s+المتوفر|الرصيد\\s+الحالي'), '$1 Avl Bal '],
  [word('الحد\\s+المتاح'), '$1 Available limit '],
  [word('المبلغ\\s+المستحق'), '$1 Total amount due '],
  [word('الرصيد|رصيد'), '$1 Avl Bal '],

  // ── card and account ──────────────────────────────────── corpus + vocab
  // "بطاقة: **1234" is the corpus label; "بطاقتك المنتهية 8575" is the same
  // thing said as a sentence, so "المنتهية" has to become "ending".
  [word('المنتهية|المنتهيه|تنتهي\\s+بـ|تنتهي\\s+ب'), '$1 ending '],
  [word('بطاقتك|البطاقة|بطاقة'), '$1 Card '],
  [word('حسابكم|حسابك|الحساب|حساب'), '$1 account '],
  [word('رقم'), '$1 no '],
  // Card kind, from the corpus: "**1234;الإئتمانية" is credit, "**4567;مدى"
  // is the Saudi debit network.
  [word('الإئتمانية|الائتمانية|الإئتمانيه|الائتمانيه'), '$1 credit '],
  [word('مدى'), '$1 debit '],

  // ── prepositions ─────────────────────────────────────────────── corpus
  // "لدى: <merchant>" is where the shop's name lives. It becomes "at", the
  // preposition MERCHANT_RE looks for.
  [word('لدى'), '$1 at '],
  [word('إلى|الى'), '$1 to '],
  [word('من'), '$1 from '],
  [word('في'), '$1 on '],
  [word('بواسطة'), '$1 via '],

  // ── fields that carry nothing ────────────────────────────────── corpus
  // "دولة: السعودية" is the acquirer country; the English path strips the
  // same field off the tail of a descriptor.
  [/دولة\s*:\s*\S+/g, ' '],
  [word('المملكة\\s+العربية\\s+السعودية|السعودية|الإمارات|الامارات'), '$1 '],
];

/** Currency words spelled out. The symbols د.إ and ر.س are market aliases already. */
const CURRENCY_WORDS: [RegExp, string][] = [
  [word('درهم\\s+إماراتي|دراهم|درهما|درهماً|درهم'), '$1 AED '],
  [word('ريال\\s+سعودي|ريالات|ريالا|ريالاً|ريال'), '$1 SAR '],
  [word('دولار|دولارا|دولاراً'), '$1 USD '],
  [word('يورو'), '$1 EUR '],
];

/**
 * Rewrite an Arabic bank SMS into the wording the parser reads.
 *
 * Returns the input untouched when it holds nothing Arabic, so the English
 * path does not merely stay unaffected — it never reaches this function's
 * logic at all, and cannot regress from anything in the tables above.
 */
export function arabicToEnglish(text: string): string {
  if (!hasArabic(text)) return text;

  let out = text
    .replace(DIACRITICS, '')
    // Arabic-Indic numerals, digit by digit. Without this every amount, card
    // number and date in a fully-Arabic message is invisible.
    .replace(ARABIC_DIGITS, (d) => {
      const c = d.charCodeAt(0);
      return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
    })
    // Arabic decimal and thousands separators.
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');

  for (const [re, to] of CURRENCY_WORDS) out = out.replace(re, to);
  for (const [re, to] of REWRITES) out = out.replace(re, to);

  // Arabic messages are written as labelled fields — "لدى: <shop>", "بطاقة:
  // **1234" — and the colon survives the rewrite sitting where the English
  // patterns expect a space. It cost the shop name and the card number on the
  // most common format there is: "at : Some merchant" matches no merchant
  // rule, and "Card : **1234" matches no card rule.
  //
  // Only a colon directly after a LATIN letter goes, which by this point means
  // a word this file put there. A time keeps its own ("in: 2019-05-07 23:44"),
  // because a digit precedes that one.
  out = out.replace(/([A-Za-z])[^\S\r\n]*:[^\S\r\n]*/g, '$1 ');
  // A label that rewrote to nothing at all leaves its colon leading the line:
  // "مبلغ: 12.00 SAR" becomes ": 12.00 SAR". Only ever at the start of a line,
  // so a time keeps its colon.
  out = out.replace(/^[^\S\r\n]*:[^\S\r\n]*/gm, '');

  // Horizontal whitespace only — the line breaks have to survive.
  //
  // The labelled Arabic format puts one field per line, and the parser's
  // whole multi-line descriptor reader is behind an `includes('\n')` check.
  // Collapsing newlines both locked Arabic out of that reader and ran the
  // fields together, which is how the shop's name came back as "Some Merchant
  // 12" with the first digits of the amount stuck to it.
  return out
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/[^\S\r\n]*\r?\n[^\S\r\n]*/g, '\n')
    .trim();
}
