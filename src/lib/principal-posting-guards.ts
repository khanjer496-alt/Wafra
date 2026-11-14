import { EN_CREDIT_PENDING_STATUS, AR_CREDIT_PENDING_STATUS, hasCreditCondition, hasPendingCreditStatus } from '@/lib/credit-settlement-guards';
/** Source-only qualifications of an already selected monetary value. */
export interface PrincipalSpan { start: number; end: number }

const CLICK_LINK_PROMPT = /(?:\b(?:click(?:ing)?|tap(?:ping)?|verify|confirm|update\s+(?:(?:your|the)\s+)?(?:details|information|credentials|account))\b[\s:：]+|(?<![ء-ي])(?:اضغط|إضغط|انقر)[\s:：]+)(?:[^.!?]|\.\d){0,120}?(?:(?:https?|hxxps?):\/\/|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[\/?#:]|\b)|www\.|\b(?:here|below|link|url)\b|الرابط|هنا)/giu;
const ISSUER_MERCHANT_DEBIT_CONFIRMATION = /^confirm\s+that\s+[A-Z]{3}\s+\d[\d,.]*\s+was\s+debited\s+from\s+your\s+account\s+ending\s+\d{4}\s+for\s+(?:a\s+)?purchase\s+at\s+(?:[a-z0-9-]+\.)+[a-z]{2,}$/iu;
/**
 * Only a closed sentence end may follow a declared merchant host; any other character may continue a URL.
 * Closed means: an optional card descriptor (`*2K1AB3CD0`), closing brackets/quotes, sentence punctuation
 * (ASCII, ideographic, Arabic or ellipsis), then visible white space or the end. U+FEFF counts as
 * white space in JavaScript but is invisible, so it cannot hide a path behind the host.
 */
const ISSUER_MERCHANT_HOST_END = /^(?:\*[A-Z0-9]{1,24})?["'”’»)\]]*[.!?;,。、،؛؟۔…]*(?:[^\S\uFEFF]|$)/iu;
/** One link-prompt match counts unless it is a warning, a merchant name or a closed issuer debit declaration. */
function countsAsLinkPrompt(source: string, match: RegExpMatchArray): boolean {
  const before = source.slice(Math.max(0, match.index! - 60), match.index);
  // A warning against clicking, or a merchant named CLICK HERE, is not a prompt.
  if (/(?:\b(?:do\s+not|don['’]t|never|avoid|refrain\s+from)\s+(?:ever\s+)?|\b(?:at|from|merchant\s*:?)\s+|(?:لا|عدم)\s+)$/iu.test(before)) return false;
  // A closed issuer debit declaration names a merchant, not a link to open.
  // Skip only this match, so a later user-directed instruction is still refused.
  // Use the complete prefix: a cropped suffix can manufacture a statement start.
  // Only a complete greeting may bridge comma/newline; not a wrapped "Can we".
  // Check what follows the host too: ASCII, fullwidth or %-encoded suffixes cannot be enumerated.
  return !(ISSUER_MERCHANT_DEBIT_CONFIRMATION.test(match[0]) &&
    ISSUER_MERCHANT_HOST_END.test(source.slice(match.index! + match[0].length)) &&
    /(?:^|[.!?])\s*(?:Dear\s+Customer[,\s]+)?we\s+$/iu.test(source.slice(0, match.index!)));
}
/** A link instruction is never settlement evidence, even with an issuer label. */
export function hasClickLinkPrompt(source: string): boolean {
  for (const match of source.matchAll(CLICK_LINK_PROMPT)) if (countsAsLinkPrompt(source, match)) return true;
  return false;
}
const WORD_ONLY_LINK_TARGET = /(?:\b(?:here|below|link|url)|الرابط|هنا)$/iu;
// An address anywhere in the message ("click the link http://bit.ly/x", "tap here: www.x.co") makes it a phishing
// shape even when the instruction itself ends on a bare word. A merchant domain without a path (AMAZON.COM) is not one.
const MESSAGE_NAMES_AN_ADDRESS = /(?:https?|hxxps?):\/\/|\bwww\.|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S/iu;
/** Every link instruction is a bare word ("tap here", "click the link") and the message names no address to open. */
export function hasOnlyWordLinkPrompts(source: string): boolean {
  if (MESSAGE_NAMES_AN_ADDRESS.test(source)) return false;
  const counted = [...source.matchAll(CLICK_LINK_PROMPT)].filter((match) => countsAsLinkPrompt(source, match));
  return counted.length > 0 && counted.every((match) => WORD_ONLY_LINK_TARGET.test(match[0]));
}
/**
 * A genuine debit may carry a footer such as "If not you, tap here to block your card". With no address in it,
 * it cannot be a phishing link, so the debit above it must reach Review instead of being dropped. The footer is
 * blanked for that Review inspection only; posting still refuses it.
 */
export function blankWordLinkPrompts(source: string): string {
  if (!hasOnlyWordLinkPrompts(source)) return source;
  let out = source;
  for (const match of source.matchAll(CLICK_LINK_PROMPT)) {
    if (!countsAsLinkPrompt(source, match)) continue;
    out = out.slice(0, match.index!) + ' '.repeat(match[0].length) + out.slice(match.index! + match[0].length);
  }
  return out;
}

const FIRST_PERSON_MONEY = /^\s*(?:(?:hi|hey|hello)\b(?:[^\r\n.!?]{0,40}[,!:]|\s+)\s*)?(?:I(?:\s+(?:(?:have|just|already)\s+){0,2}|['’]ve\s+(?:(?:just|already)\s+)?)(?:spent|paid|bought|sent|deposited|transferred|refunded)\b|[اأ]نا\s+(?:(?:قد|لقد)\s+)?(?:صرفت|دفعت|اشتريت|حولت|حوّلت|أرسلت|ارسلت)(?=\s))/iu;
/** Explicit personal money wording cannot become a bank event at either entry point. */
export function hasExplicitPersonalMoneyClaim(source: string): boolean {
  const text = source.replace(/^\s*Dear\s+Customer[,!:]\s*/iu, '');
  if (FIRST_PERSON_MONEY.test(text) || /^\s*they\s+charged\s+me\b/iu.test(text)) return true;
  if (!/^\s*(?:(?:hi|hey|hello|lol|ok|just|so)\b[\s,!:]*)*(?:paid|spent|received)\b/iu.test(text)) return false;
  // A bank receipt may name lunch or a shop; an instrument, reference or
  // balance keeps it eligible for the normal evidence-based parser.
  if (/\b(?:card|account|acct?|a\/c|balance|bal|avl|reference|ref|transaction|txn)\b/iu.test(text)) return false;
  return /^\s*lol\b/iu.test(text) ||
    /\b(?:for\s+(?:lunch|dinner|breakfast|the\s+taxi)|on\s+groceries\s+today)\b/iu.test(text);
}

/** A leading coupon invitation is an offer; the same wording may be a receipt footer. */
export function isLeadingNumericDiscountOffer(source: string): boolean {
  return /^\s*(?:[A-Z][A-Z0-9 .&-]{1,32}:\s*)?(?:Dear\s+Customer[,!:]\s*)?(?:use|enter)\s+(?:code\s+)?\d{4,8}\s+to\s+get\s+\d{1,3}\s?%\s+off\b/iu.test(source) ||
    (source.includes('خصم') && /^\s*(?:Dear\s+Customer[,!:]\s*)?(?:[^\n.!?\p{N}]{0,40}?[،,!:\s]\s*)?(?:استمتع\s+ب)?خصم\s*\p{Nd}{1,3}\s*[%٪]/iu.test(source));
}

/** A peer says they sent money TO the reader; this cannot prove an outgoing debit. */
export const isUnqualifiedPeerTransferClaim = (source: string): boolean =>
  /^\s*(?:[A-Z][A-Z0-9 .&-]{1,32}:\s*)?(?:Dear\s+Customer[,!:]\s*)?transferred\b(?:[^.\n]|\.\d){0,96}?\bto\s+(?:you|u)\b/iu.test(source);

const MOBILE_MONEY_CALLBACK = /\b(?:call|phone|ring|contact)\s+(?:(?:us|me|support|on|at)\s+){0,3}(?:\+|00)(?:971|966)[\s().-]*5(?:[\s().-]*\d){8}(?![\s().-]*\d)/giu;
/** A private mobile callback needs Review; it does not prove a stored debit imaginary. */
export function hasMobileMoneyCallback(source: string): boolean {
  if (!/(?:\+|00)(?:971|966)/u.test(source)) return false;
  for (const match of source.matchAll(MOBILE_MONEY_CALLBACK)) {
    const before = source.slice(Math.max(0, match.index! - 60), match.index);
    if (/\b(?:do\s+not|don['’]t|never|avoid)\s*$/iu.test(before)) continue;
    const after = source.slice(match.index! + match[0].length, match.index! + match[0].length + 60);
    if (/^\s*(?:to|for)\s+(?:cancel|verify|confirm|approve|authori[sz]e|secure|unblock|release)\b/iu.test(after) ||
      /\bto\s+(?:cancel|verify|confirm|approve|authori[sz]e|secure|unblock|release)[^.!?\n]{0,30}$/iu.test(before)) return true;
  }
  return false;
}

const MOVEMENT_STATUS = /\bincomplete\s+(?:transaction|txn|purchase|payment|transfer|withdrawal)\b|\b(?:transaction|txn|purchase|payment|transfer|withdrawal)(?:\s+(?:of|for|at|to|from|with|on)\b(?:[^.\n]|\.\d){0,80}?)?\s+(?:was|is|remains?|has\s+been)\s+incomplete\b|\b(?:transaction|txn|purchase|payment|authori[sz]ation)\b(?:[^.\n]|\.\d){0,100}?\s(?:cancell?ed|voided)\s+by\s+(?:the\s+)?(?:merchant|bank|issuer|acquirer)\b|\b(?:transaction|txn|purchase|payment|authori[sz]ation)\b(?:[^.\n]|\.\d){0,100}?\s(?:will\s+be|is\s+being)\s+(?:cancell?ed|voided)\b|[ \t][-–—:|][ \t]*(?:void|voided|cancell?ed)[ \t]*(?=\n|$)|[ \t]*[,:(][ \t]*(?:cancell?ed|voided|void)[ \t]*\)?[ \t]*(?=[.\n]|$)|(?<![ء-ي])(?:تم\s+)?(?:الغاء|ايقاف|تعليق)\s+(?:ال)?(?:عمليه|شراء|دفع|تحويل|حواله|سحب|معامله|حركه)(?![ء-ي])|(?<![ء-ي])(?:الغيت|اوقفت|علقت)\s+(?:ال)?(?:عمليه|شراء|دفع|تحويل|حواله|سحب|معامله|حركه)(?![ء-ي])|(?<![ء-ي])(?:ال)?(?:عمليه|معامله|شراء|دفع|تحويل|حواله|سحب|حركه)\s+(?:غير\s+(?:ناجح|مكتمل)ه?|لم\s+(?:تكتمل|يكتمل|تنجح)|(?:ال)?(?:ملغي|ملغا|ملغاه|موقوف[هة]?))(?![ء-ي])|(?<![ء-ي])(?:و?تم|قد\s+تم)\s+(?:الغاو|الغاي|ايقاف|تعليق)(?:ها|ه)(?![ء-ي])|(?<![ء-ي])تم\s+(?:ال)?الغاء(?![ء-ي])|(?<![ء-ي])لم\s+(?:تكتمل|يكتمل|تنجح)(?![ء-ي])/gi;
const CONDITIONAL_STATUS = /(?:\b(?:if|unless|please|pls|to|can|may|should)\b|(?<![ء-ي])(?:يرجي|الرجاء|رجاء|يمكنك|يمكنكم|يمكن|بامكانك|بامكانكم|اتصل|ارسل|للابلاغ|لطلب|طلب|خدمه|اذا|حال|تود|ترغب|عليك)(?![ء-ي]))(?:\s+(?:او|و|ب|في|علي|عن|من|كانت|كان|or|and))?(?:\s+\d{1,4})?\s*$/i;

/** Scope indicative status to the selected movement, excluding conditional/previous-event footers. */
export function isIncompletePrincipal(source: string, span: PrincipalSpan | undefined): boolean {
  if (!span) return false;
  const boundary = (at: number) => /[;!?]/u.test(source[at]) ||
    (source[at] === '.' && /^(?:\s|$)/u.test(source[at + 1] ?? ''));
  let start = span.start, end = span.end;
  while (start > 0 && !boundary(start - 1)) start--;
  while (end < source.length && !boundary(end)) end++;
  const blocks = [source.slice(start, end)];
  const header = source.slice(0, start);
  // A leading verdict still owns the field-list amount that follows it:
  // "Transaction cancelled. Purchase / Amount ...". An unrelated earlier
  // sentence or a conditional instruction does not acquire that authority.
  if (header && [...header.matchAll(MOVEMENT_STATUS)].some(match => match.index === header.length - header.trimStart().length)) {
    blocks.unshift(header);
  }
  for (const block of blocks) for (const match of block.matchAll(MOVEMENT_STATUS)) {
    const before = block.slice(Math.max(0, match.index! - 60), match.index);
    const after = block.slice(match.index! + match[0].length, match.index! + match[0].length + 45);
    if (CONDITIONAL_STATUS.test(before)) continue;
    if (/^(?:\s+(?:ال)?(?:سابق[هة]?|قديم[هة]?))|\b(?:previous|earlier|prior)\b/i.test(after)) continue;
    if (/(?:ها|ه)$/.test(match[0]) && /(?:ال)?بطاق(?:ه|تك|تكم)/.test(before.slice(-30))) continue;
    if (/incomplete/i.test(match[0]) && /\b(?:profile|registration|application|address)\b/i.test(match[0])) continue;
    return true;
  }
  return false;
}

const HEDGE_BEFORE = /(?:(?<![\p{L}\p{N}.*\/-])(?:about|approx(?:imately|\.)?|around|roughly|nearly|almost|up\s+to|estimated|est\.|circa|ca\.)|[~≈]|(?<![ء-ي])(?:حوالي|حوالى|تقريبا|تقريباً|ما\s+يقارب|نحو)(?![ء-ي]))[ \t]*$/iu;
const HEDGE_AFTER = /^[ \t]*(?:\([ \t]*(?:approx(?:imately|imate|\.)?|est(?:imated|imate|\.)?|about|roughly|circa|ca\.|~|تقريبا|تقريباً)[ \t]*\)|[~≈]|(?:approximately|approx\.?|roughly|or[ \t]+so|estimated|est\.)(?![\p{L}])|(?<![ء-ي])(?:تقريبا|تقريباً)(?![ء-ي]))/iu;

/** An exact repetition of the principal still proves its value. A hedged balance does not qualify another amount. */
export function isHedgedPrincipal(source: string, spans: readonly PrincipalSpan[]): boolean {
  return spans.length > 0 && spans.every(({ start, end }) =>
    HEDGE_BEFORE.test(source.slice(Math.max(0, start - 40), start)) ||
    HEDGE_AFTER.test(source.slice(end, end + 28)));
}

const REFUND_LEAD = /(?:\brefund(?:ed)?\s+(?:of|amount(?:\s+of)?|for)?|(?<![ء-ي])(?:(?:ال)?مبلغ\s+)?(?:ال)?استرداد(?:\s+(?:ال)?مبلغ)?(?:\s+بقيم[هة]|\s+بمبلغ)?)\s*[:\-]?\s*$/iu;
const NOT_CURRENT_REFUND = /\b(?:if|when|unless|earlier|previous|prior|another|other|last)\b|(?<![ء-ي])(?:اذا|حال|سابق[هة]?|اخري)(?![ء-ي])/iu;
const REFUND_PENDING = new RegExp("\\b(?:initiated|under\\s+process(?:ing)?|in\\s+process|in\\s+progress|being\\s+(?:processed|reversed)|will\\s+(?:be|reflect|appear|show)|requested|pending|awaiting|awaited|submitted|approved|raised)\\b|(?<![ء-ي])(?:قيد\\s+(?:ال)?(?:معالج[هة]|تنفيذ|مراجع[هة]|انتظار)|سيتم|سوف|طلب|تمت\\s+الموافق[هة])(?![ء-ي])" + `|${EN_CREDIT_PENDING_STATUS}|${AR_CREDIT_PENDING_STATUS}`, 'iu');
const REFUND_CANCELLED = /\b(?:has\s+been|was|is|got)\s+(?:cancell?ed|declined|rejected|unsuccessful|voided|reversed)\b|\brefund\s+(?:has\s+)?failed\b|(?<![ء-ي])(?:تم\s+)?(?:الغاء|إلغاء|رفض)\s+(?:طلب\s+)?(?:ال)?استرداد|(?:ال)?استرداد\s+(?:ال)?(?:ملغي|ملغى|ملغا|ملغاه|مرفوض)(?![ء-ي])/iu;
const REFUND_COMPLETED = /\b(?:credited|issued|processed\s+(?:to|into|on)|posted\s+(?:to|into|on)|received\s+(?:on|in|into)|deposited|returned\s+to|added\s+to)\b|(?<![ء-ي])(?:تم\s+(?:[إا]يداع|[إا]ضاف[هة]|استرداد|[إا]رجاع|[إا]عاد[هة])|اضيف|أضيف|اعيد|أعيد|اودع|أودع)(?![ء-ي])/giu;
const UNSETTLED_PREDICATE = /\b(?:will|would|shall|not|never|hasn['’]t|wasn['’]t|isn['’]t)\b/iu;
const REFUND_PAID_OUT = /\b(?:debited|deducted|charged|withdrawn|sent|paid\s+to)\b|(?<![ء-ي])(?:تم\s+خصم|خصمت|خصم\s+من)(?![ء-ي])/iu;

function sentenceAround(source: string, span: PrincipalSpan, continueAcrossLines = false): { start: number; end: number; text: string } {
  let start = span.start, end = span.end;
  const commaAt = (at: number) => source[at] === ',' && !(/\d/u.test(source[at - 1] ?? '') && /\d/u.test(source[at + 1] ?? ''));
  while (start > 0 && !commaAt(start - 1) && !/[\n;!?]/u.test(source[start - 1]) &&
    !(source[start - 1] === '.' && /\s/u.test(source[start] ?? ''))) start--;
  while (end < source.length && !commaAt(end) && !/[;!?]/u.test(source[end]) &&
    (continueAcrossLines || source[end] !== '\n') &&
    !(source[end] === '.' && /^(?:\s|$)/u.test(source[end + 1] ?? ''))) end++;
  return { start, end, text: source.slice(start, end) };
}

const INDEPENDENT_MONEY_SUBJECT = /\b(?:and|but|while|whereas)\s+(?!(?:the|your|this)\s+refund\b)(?:a|an|the|your|another|separate|additional)\s+|\b(?:and|but|while|whereas)\s+(?:(?:processing|service|bank|administrative|new|separate|additional|related|applicable)\s+){0,3}(?:fees?|tax|charge|payment|transfer|withdrawal|deposit|purchase|refund|transaction|balance)\b(?=\s+(?:of|was|were|has|have|had|is|will|charged|debited|deducted|credited)\b)|(?<![ء-ي])(?:و|[\r\n][ \t]*)(?:تم\s+)?(?:خصم\s+)?(?:ال)?(?:رسوم|رسم|ضريب[هة]|عمول[هة])(?=\s)/giu;
// Recognize a new grammatical subject, rather than a growing fee-name list.
// An auxiliary, a movement verb, or an explicit reference to this refund is
// continuation grammar; an unrelated noun before its own predicate is not.
const SUBJECT_BOUNDARY = /[\r\n]+[ \t]*(?:(?:and|but|while|whereas)\s+)?|\b(?:and|but|while|whereas)\s+/giu;
const FOLLOWING_SUBJECT = /^((?:[\p{L}][\p{L}'’\-]*\s+){0,5}[\p{L}][\p{L}'’\-]*)\s*(?:[:=–—-]\s*)?(?=\b(?:was|were|has|have|had|is|are|will|would|shall|credited|issued|debited|deducted|charged|withdrawn|sent|paid)\b)/iu;
const CONTINUATION_HEAD = /^(?:and|but|while|whereas|to|from|at|with|on|in|into|for|of|by|as|was|were|has|have|had|is|are|will|would|shall|be|been|being|not|never|it|reversed|refunded)\b|^(?:(?:this|the|your)\s+)?refund\b/iu;
const OPEN_ARGUMENT = /\b(?:to|from|at|with|on|in|into|for|of|by|as|the|your|this|a|an|ending|number|was|were|has|have|had|is|are|will|would|shall|be|been|being|not)\s*$/iu;

function continuesRefund(text: string): boolean {
  const head = text.trimStart();
  const firstWord = head.split(/\s/u)[0];
  return CONTINUATION_HEAD.test(head) || REFUND_PENDING.test(firstWord) ||
    REFUND_PAID_OUT.test(firstWord) || [...firstWord.matchAll(REFUND_COMPLETED)].length > 0;
}
const SAME_MONEY_REFERENCE = /^\s*(?:[(\[/=≈~]|equivalent(?:\s+to)?|equiv\.?|approx\.?|i\.?e\.?|بما\s+يعادل|ما\s+يعادل|يعادل)\s*$/i;
const ORIGINAL_MOVEMENT_REFERENCE = /\b(?:for|against|on|of)\s+(?:your|the)\s+(?:original\s+|earlier\s+|previous\s+)?(?:purchase|transaction|payment|charge|order)\s+(?:of|for)?\s*$|(?:لعمليه|عن\s+عمليه|من\s+عمليه)\s+(?:ال)?شراء\s+(?:بمبلغ|بقيمه)?\s*$/i;
const ORIGINAL_MOVEMENT_CLAUSE = /\b(?:for|against|on|of)\s+(?:your|the)\s+(?:original\s+|earlier\s+|previous\s+)?(?:purchase|transaction|payment|charge|order)\b|(?:لعمليه|عن\s+عمليه|من\s+عمليه)\s+(?:ال)?شراء(?=\s)/iu;

// "and" between capitalised words inside the name a preposition introduces ("from MARKS AND SPENCER
// has been credited", "H AND M") belongs to that name, not to a second clause. Only a plain "and"
// counts; everything after the preposition must still be capitalised words (no verb or determiner yet);
// and the word after "and" must be capitalised and must not open a clause ("the", "your", "a" ...).
const NAME_BEFORE_AND = /^\s*(?:from|at|to|with|via|by)\s+(?:\p{Lu}[\p{L}\p{N}&.'’-]*\s+)+$/u;
const NAME_AFTER_AND = /^\p{Lu}[\p{L}\p{N}&.'’-]*(?=\s|$)/u;
const CLAUSE_OPENER = /^(?:a|an|the|your|this|that|our|my|his|her|its|their|another|separate|additional|new|it|we|you|they|i)(?=\s|$)/iu;
const isNameJoin = (coordinator: string, before: string, after: string): boolean =>
  /^and\s+$/iu.test(coordinator) && NAME_BEFORE_AND.test(before) && NAME_AFTER_AND.test(after) && !CLAUSE_OPENER.test(after);

/** Ownership ends when a new monetary subject begins, not merely at punctuation. */
function refundScope(source: string, own: PrincipalSpan, monetarySpans: readonly PrincipalSpan[]) {
  // Banks wrap a single movement across lines. Its predicate still belongs
  // to this amount until punctuation, another money field, or a new subject.
  const sentence = sentenceAround(source, own, true);
  let end = sentence.end;
  let independentSubject = false;
  const reference = source.slice(own.end, end).match(ORIGINAL_MOVEMENT_CLAUSE);
  if (reference) {
    end = own.end + reference.index!;
    independentSubject = true;
  }
  // Probe every boundary independently: skipping a wrapped merchant must not
  // consume the separate subject on the following line.
  for (const boundary of source.slice(own.end, end).matchAll(SUBJECT_BOUNDARY)) {
    const at = own.end + boundary.index!;
    const subject = source.slice(at + boundary[0].length, end).match(FOLLOWING_SUBJECT);
    if (!subject) continue;
    const head = subject[1];
    if (continuesRefund(head) || OPEN_ARGUMENT.test(source.slice(own.end, at))) continue;
    if (isNameJoin(boundary[0], source.slice(own.end, at), source.slice(at + boundary[0].length, end))) continue;
    end = at;
    independentSubject = true;
    break;
  }
  const tail = source.slice(own.end, end);
  const independent = [...tail.matchAll(INDEPENDENT_MONEY_SUBJECT)][0];
  if (independent) end = own.end + independent.index!;
  for (const other of monetarySpans) {
    if (other.start < own.end || other.start >= end) continue;
    const between = source.slice(own.end, other.start);
    if (SAME_MONEY_REFERENCE.test(between) || ORIGINAL_MOVEMENT_REFERENCE.test(between)) continue;
    // The spans come from the same actual money reader as the caller's value.
    // Neither a fee's predicate nor a second movement's predicate may be
    // borrowed by a preceding refund. A coordinator is the subject boundary.
    const coordinators = [...between.matchAll(/\b(?:and|but|while|whereas)\b/giu)];
    const coordinator = coordinators[coordinators.length - 1];
    end = Math.min(end, coordinator ? own.end + coordinator.index! : other.start);
  }
  return { start: sentence.start, end, text: source.slice(sentence.start, end), independentSubject };
}

type RefundStatus = 'completed' | 'pending' | 'cancelled' | 'paid-out';
const REFUND_VERDICTS: readonly (readonly [RefundStatus, RegExp])[] = [
  ['cancelled', new RegExp(REFUND_CANCELLED.source, 'giu')],
  ['pending', new RegExp(REFUND_PENDING.source, 'giu')],
  ['paid-out', new RegExp(REFUND_PAID_OUT.source, 'giu')],
  ['completed', REFUND_COMPLETED],
];
const SAME_REFUND_TRANSITION = /^\s*(?:(?:and|but|then)\s+)?(?:it|(?:this|the|your)\s+refund)\s+(?:(?:has|have|had|was|is|been|now|already|successfully|fully|then|also|reversed)\s+)*$/iu;
const SHARED_REFUND_TRANSITION = /^\s*(?:and|but|then)\s+(?:(?:has|have|had|was|is|been|now|already|successfully|fully|then|also|reversed)\s+)*$/iu;

/** Reduce only affirmative states owned by this refund. A later fee or
 * referenced transaction cannot replace a verdict the refund already owns.
 */
function ownedRefundVerdict(sentence: string, principalEnd: number): RefundStatus | null {
  const hits = REFUND_VERDICTS.flatMap(([status, pattern]) => [...sentence.matchAll(pattern)]
    .filter(match => status !== 'completed' || match.index! >= principalEnd)
    .filter(match => status !== 'pending' || hasPendingCreditStatus(sentence) || !hasPendingCreditStatus(match[0]))
    .map(match => ({ status, start: match.index!, end: match.index! + match[0].length })))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let owned: { status: RefundStatus; end: number; unsettled: boolean } | null = null;
  let previousPredicateEnd = 0;
  for (const hit of hits) {
    if (hit.start < previousPredicateEnd) continue;
    let prefix = sentence.slice(previousPredicateEnd, hit.start);
    const joins = [...prefix.matchAll(/\b(?:and|but|then)\b/giu)];
    const join = joins[joins.length - 1];
    if (join) {
      const joined = prefix.slice(join.index!);
      if (previousPredicateEnd > 0 || SAME_REFUND_TRANSITION.test(joined) ||
          (SHARED_REFUND_TRANSITION.test(joined) && /\b(?:has|have|had|was|is)\b/iu.test(joined))) prefix = joined;
    }
    const unsettled = hit.status !== 'pending' && (UNSETTLED_PREDICATE.test(prefix) ||
      /\b(?:is|was|are|were)\s+being\s*$/iu.test(prefix));
    previousPredicateEnd = hit.end;
    const between = owned ? sentence.slice(owned.end, hit.start) : '';
    if (owned && !SAME_REFUND_TRANSITION.test(between) && !SHARED_REFUND_TRANSITION.test(between)) continue;
    // "Not credited and debited" shares the first verb's negation. A new
    // finite clause or explicit refund subject is needed to assert otherwise.
    if (owned?.unsettled && !SAME_REFUND_TRANSITION.test(between) &&
        !/\b(?:has|have|had|was|is)\b/iu.test(between)) continue;
    if (unsettled) {
      // A negated debit is not evidence that an already credited refund left.
      if (!owned || hit.status === 'completed') owned = { status: 'pending', end: hit.end, unsettled: true };
    } else {
      owned = { status: hit.status, end: hit.end, unsettled: UNSETTLED_PREDICATE.test(prefix) ||
        UNSETTLED_PREDICATE.test(sentence.slice(hit.start, hit.end)) ||
        (hit.status === 'pending' && /^being\s/iu.test(sentence.slice(hit.start, hit.end))) };
    }
  }
  return owned?.status ?? null;
}

/** A refund noun must govern THIS figure. Another purchase's refund or a fee is not enough. */
export function refundPrincipalStatus(
  source: string, spans: readonly PrincipalSpan[], monetarySpans: readonly PrincipalSpan[] = spans,
): RefundStatus | null {
  const own = spans.find(({ start }) => REFUND_LEAD.test(source.slice(Math.max(0, start - 48), start)));
  if (!own) return null;
  const scope = refundScope(source, own, monetarySpans);
  const sentence = scope.text;
  if (NOT_CURRENT_REFUND.test(source.slice(scope.start, own.start))) return null;
  if (hasCreditCondition(sentence)) return 'pending';
  const verdict = ownedRefundVerdict(sentence, own.end - scope.start);
  if (verdict) return verdict;
  if (UNSETTLED_PREDICATE.test(sentence)) return 'pending';
  const after = source.slice(scope.end, scope.end + 120);
  if (/^[.!\s]*(?:it|(?:this|the|your)\s+refund)\s+(?:has\s+not|hasn['’]t|is\s+not|will\s+be|remains?\s+pending)/iu.test(after)) return 'pending';
  if (scope.independentSubject) return 'pending';
  return 'completed';
}

/** The selected purchase itself was refunded; a previous or hypothetical refund cannot qualify it. */
export function isCompletedPrincipalRefund(source: string, span: PrincipalSpan | undefined): boolean {
  if (!span) return false;
  const scope = sentenceAround(source, span);
  if (NOT_CURRENT_REFUND.test(scope.text) || REFUND_PENDING.test(scope.text) || hasCreditCondition(scope.text)) return false;
  return /\b(?:purchase|transaction|payment|charge)\b(?:[^.\n]|\.\d){0,120}?\b(?:has\s+been|was|is|have\s+been)\s+(?:fully\s+)?refunded\b|(?<![ء-ي])(?:عمليه\s+)?(?:ال)?شراء(?:[^.\n]|\.(?=\S)){0,120}?\s+(?:و?تم\s+)(?:استرداد|استرجاع|ارجاع)(?:ها|ه)(?![ء-ي])/i.test(scope.text);
}

const CARD_CREDIT_TARGET = /\bcredit\s+card\b|بطاق(?:تك|ه|ة)\s+(?:ال)?ا[يئ]تماني[هة]/iu;
const CARD_CREDIT_MOVEMENT = /\bcredited(?:\s+with|\s+to)?\b|(?<![ء-ي])(?:تم\s+)?(?:إيداع|ايداع|إضافة|اضافه|اضافة)(?![ء-ي])/iu;

const REPAYMENT_MONEY = String.raw`(?:[A-Z]{3}|Dhs?\.?|SR|[$€£])\s*\p{Nd}+(?:[.,٫٬]\p{Nd}+)*`;
// A card is the destination, never an instrument used to pay a merchant/bill.
const REPAYMENT_CARD = String.raw`(?:(?!(?:bill|invoice|loan|finance|mortgage|account|utility|electricity|water|using|via|with|through|from|to|for|by|on|at|and|of)\b)[\p{L}\p{N}.'’-]+\s+){0,3}?card\b`;
const REPAYMENT_DESTINATION_CARD = String.raw`(?:(?!(?:bill|invoice|loan|finance|mortgage|account|utility|electricity|water|using|via|with|through|from|to|for|by|on|at|and)\b)[\p{L}\p{N}.'’-]+\s+){0,6}?card\b`;
const REPAYMENT_NUMBER = String.raw`\p{Nd}+(?:[.,٫٬]\p{Nd}+)*`;
const REPAYMENT_UNIT = String.raw`(?:[A-Z]{3}|Dhs?\.?|SR|[$€£])`;
const REPAYMENT_ANY_MONEY = String.raw`(?:${REPAYMENT_UNIT}\s*${REPAYMENT_NUMBER}|${REPAYMENT_NUMBER}\s*${REPAYMENT_UNIT})`;
const REPAYMENT_DESTINATION = String.raw`(?:on|to|towards?)\s+(?:your\s+)?${REPAYMENT_DESTINATION_CARD}`;
const REPAYMENT_GREETING = String.raw`(?:(?:Dear\s+[^\n.!?\p{N},:!]{1,40}|Hi|Hello)[,!:]\s*)?`;
const AR_REPAYMENT_MONEY = String.raw`(?:${REPAYMENT_ANY_MONEY}|${REPAYMENT_NUMBER}\s*(?:درهم|دراهم|ريال)|(?:درهم|دراهم|ريال)\s*${REPAYMENT_NUMBER})`;
const COMPLETED_CARD_BALANCE_RECEIPT = new RegExp(
  String.raw`^تم\s+(?:(?:[إا]يداع|[إا]ضاف[هة])\s+(?:مبلغ\s+)?|استلام\s+سداد\s+(?:بمبلغ|مبلغ)\s+)${AR_REPAYMENT_MONEY}`, 'iu',
);
const UNQUALIFIED_REPAYMENT = new RegExp(
  // Android joins a short notification title and body with a space. This
  // prefix only holds a repayment; it never qualifies a title as an issuer.
  String.raw`(?:^|[\n.!?]\s*)\s*(?:[A-Z][A-Z0-9 .&-]{1,32}(?::\s*|\s+))?${REPAYMENT_GREETING}(?:` +
  String.raw`payment\s+(?:received|credited)\s+${REPAYMENT_ANY_MONEY}\s+${REPAYMENT_DESTINATION}` +
  String.raw`|we\s+(?:have\s+)?received\s+(?:your\s+)?payment\s+(?:of\s+)?${REPAYMENT_ANY_MONEY}\s+${REPAYMENT_DESTINATION}` +
  String.raw`|payment\s+(?:of\s+)?${REPAYMENT_ANY_MONEY}\s+(?:was\s+)?received\s+${REPAYMENT_DESTINATION}` +
  String.raw`|(?:thank\s+you|thanks)\s+for\s+(?:your\s+)?payment\s+of\s+${REPAYMENT_ANY_MONEY}\s+${REPAYMENT_DESTINATION}` +
  String.raw`|your\s+payment\s+of\s+${REPAYMENT_ANY_MONEY}\s+to\s+(?:your\s+)?${REPAYMENT_DESTINATION_CARD}(?:[^.\n]|\.\d){0,80}\bsuccessful\b` +
  String.raw`|your\s+(?:(?:[\p{L}.'’-]+)\s+){0,4}?(?:credit|charge|covered)\s+card\s+payment\s+of\s+${REPAYMENT_ANY_MONEY}(?:[^.\n]|\.\d){0,60}\bsuccessful\b` +
  String.raw`|تم\s+استلام\s+سداد\s+(?:بمبلغ|مبلغ)\s+${AR_REPAYMENT_MONEY}\s+(?:على|علي|إلى|الى|الي|في)\s+بطاق(?:تك|تكم|ه|ة)\s+(?:ال)?ا[يئ]تماني[هة])`,
  'giu',
);
const QUALIFIED_REPAYMENT_RECEIPT = new RegExp(
  String.raw`^\s*(?:[A-Z][A-Z0-9 .&-]{1,32}:\s*)?(?:Dear\s+Customer[,!:]\s*)?(?:` +
  String.raw`payment\s+received|thank\s+you\s+for\s+(?:your\s+)?payment\s+of` +
  String.raw`)\s+(${REPAYMENT_MONEY})\s+on\s+your\s+${REPAYMENT_CARD}\s+(?:ending(?:\s+(?:in|with))?|number|no\.?)\s*(?:[*xX•·-]\s*)*\p{Nd}{4}(?!\p{Nd})` +
  String.raw`(?=\s*(?:[.!?\n]|$|(?:thank|avl|available|balance|for\s+(?:queries|help|details|information))\b))`,
  'iu',
);
// Preserve the mature receipt grammar already used by settlement pairing.
const QUALIFIED_MATURE_REPAYMENT_RECEIPT = new RegExp(
  String.raw`^\s*(?:[A-Z][A-Z0-9 .&-]{1,32}:\s*)?(?:Dear\s+Customer[,!:]\s*)?payment\s+of\s+(${REPAYMENT_MONEY})\s+(?:has\s+been\s+)?received\s+(?:towards?|on)\s+your\s+${REPAYMENT_CARD}\s+(?:ending(?:\s+(?:in|with))?|number|no\.?)\s*(?:[*xX•·-]\s*)*\p{Nd}{4}(?!\p{Nd})` +
    String.raw`(?=\s*(?:[.!?\n]|$|(?:thank|avl|available|balance|for\s+(?:queries|help|details|information))\b))`,
  'iu',
);
/** A receipt names the person's destination card and tail, never a merchant instrument. */
export function isQualifiedCardRepaymentReceipt(source: string, expectedCurrency?: string): boolean {
  const match = QUALIFIED_REPAYMENT_RECEIPT.exec(source) ?? QUALIFIED_MATURE_REPAYMENT_RECEIPT.exec(source);
  if (!match || /\b(?:debit|prepaid)\b/iu.test(match[0])) return false;
  if (/\bthank\s+you\b/iu.test(match[0]) && !/\b(?:credit|charge|covered)\b/iu.test(match[0])) return false;
  if (expectedCurrency === undefined) return true;
  const token = match[1].match(/^[^\p{Nd}]+/u)?.[0].trim().replace(/\.$/u, '').toUpperCase();
  const code = token === 'DH' || token === 'DHS' ? 'AED' : token === 'SR' ? 'SAR' : token;
  // This newly admitted family needs source-local currency proof; never price
  // a foreign card settlement through the core parser's fallback FX table.
  return code === expectedCurrency;
}

/** Weaker receipt claims cannot prove new spending/income. Keep them in Review. */
export function isUnqualifiedCardRepayment(source: string): boolean {
  if (!/\bpayment\b|سداد|[\u0640\u064B-\u065F\u0670\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFB50-\uFEFF\uFF01-\uFFEF]/iu.test(source)) return false;
  const text = repaymentReadingText(source);
  if (!/\bpayment\b|سداد/iu.test(text) || isQualifiedCardRepaymentReceipt(text)) return false;
  for (const match of text.matchAll(UNQUALIFIED_REPAYMENT)) {
    const after = text.slice(match.index! + match[0].length).split(/[\n!?;]|\.(?=\s|$)/u)[0];
    const clause = match[0] + after;
    // A shop receipt names the merchant; a bank/ATM/branch is a payment rail.
    const merchantAt = /\bat\s+\p{L}/iu.test(clause) &&
      !/\bat\s+(?:the\s+)?(?:atm\b|[\p{L}]*bank\b|(?:[\p{L}]+\s+){0,3}branch\b)/iu.test(clause);
    if (merchantAt || /\b(?:from|using)\s+(?!your\b|the\s+(?:bank|account)\b)\p{L}/iu.test(clause)) continue;
    return true;
  }
  return false;
}

function repaymentReadingText(source: string): string {
  return (/[\uFB50-\uFEFF\uFF01-\uFFEF]/u.test(source) ? source.normalize('NFKC') : source)
    .replace(/[\u0640\u064B-\u065F\u0670\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu, '');
}

function cardBalanceReceiptText(source: string): string {
  return repaymentReadingText(source)
    .replace(/^\s*[A-Z][A-Z .&'-]{1,32}(?:alert|bank|sms)\s*\r?\n\s*/iu, '')
    .replace(/^\s*[A-Z][A-Z0-9 .&'-]{1,32}:\s*/iu, '')
    .replace(/^\s*(?:Dear\s+[^\n.!?\p{N},:!]{1,40}|Hi|Hello)[,!:]\s*/iu, '').trim();
}

/** Explicit absence/future credit is not an actionable card-balance event. */
export function isUnpostedCardBalanceClaim(source: string): boolean {
  if (!/[إا]يداع|[إا]ضاف|سداد|[\u0640\u064B-\u065F\u0670\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFB50-\uFEFF\uFF01-\uFFEF]/u.test(source)) return false;
  const text = cardBalanceReceiptText(source);
  return CARD_CREDIT_TARGET.test(text) && /^(?:(?:(?:لم|لن)\s+يتم|سيتم|سوف\s+يتم|(?:[إا]ذا|لو|في\s+حال[هة]?)\s+تم)\s+(?:[إا]يداع|[إا]ضاف[هة]|استلام\s+سداد)|تم\s+استلام\s+طلب\s+(?:[إا]يداع|[إا]ضاف[هة]|سداد)|تم\s+(?:[إا]يداع|[إا]ضاف[هة])\s+طلب)(?![ء-ي])/u.test(text);
}

/** Regional past-tense proof may qualify Review, never automatic settlement. */
export function isCompletedCardBalanceReceipt(source: string): boolean {
  const text = cardBalanceReceiptText(source);
  return CARD_CREDIT_TARGET.test(text) && COMPLETED_CARD_BALANCE_RECEIPT.test(text);
}

/** A balance in another clause cannot become the repayment principal. */
export function isCompletedCardRepaymentPrincipal(source: string, span: PrincipalSpan): boolean {
  const clause = sentenceAround(source, span).text;
  return isCompletedCardBalanceReceipt(clause) && isUnqualifiedCardRepayment(clause);
}

/** A credit to the credit-card balance may be a settlement, not new income.
 * Leave ambiguous credits in Review; explicit refunds retain their own rules.
 */
export function isUnqualifiedCardCredit(source: string, span: PrincipalSpan | undefined): boolean {
  // Most purchases have neither predicate. Avoid scanning sentence boundaries
  // and running refund checks unless both are present somewhere in the source.
  if (!span || !CARD_CREDIT_TARGET.test(source) || !CARD_CREDIT_MOVEMENT.test(source)) return false;
  const clause = sentenceAround(source, span).text;
  if (/\bcash\s*back\s+(?:amount\s+)?of\b/iu.test(clause)) return false;
  if (/\bbooking\b[^.\n]{0,80}\bwas\s+cancell?ed\s+and\b/iu.test(clause)) return false;
  if (isCompletedPrincipalRefund(source, span) || /\brefund(?:ed)?\b|استرداد/iu.test(clause)) return false;
  return CARD_CREDIT_TARGET.test(clause) && CARD_CREDIT_MOVEMENT.test(clause);
}
