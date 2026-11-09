/** Source-only qualifications of an already selected monetary value. */
export interface PrincipalSpan { start: number; end: number }

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
const REFUND_PENDING = /\b(?:initiated|under\s+process(?:ing)?|in\s+process|in\s+progress|being\s+(?:processed|reversed)|will\s+(?:be|reflect|appear|show)|requested|pending|awaiting|submitted|approved|raised)\b|(?<![ء-ي])(?:قيد\s+(?:ال)?(?:معالج[هة]|تنفيذ|مراجع[هة]|انتظار)|سيتم|سوف|طلب|تمت\s+الموافق[هة])(?![ء-ي])/iu;
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
  if (NOT_CURRENT_REFUND.test(scope.text) || REFUND_PENDING.test(scope.text)) return false;
  return /\b(?:purchase|transaction|payment|charge)\b(?:[^.\n]|\.\d){0,120}?\b(?:has\s+been|was|is|have\s+been)\s+(?:fully\s+)?refunded\b|(?<![ء-ي])(?:عمليه\s+)?(?:ال)?شراء(?:[^.\n]|\.(?=\S)){0,120}?\s+(?:و?تم\s+)(?:استرداد|استرجاع|ارجاع)(?:ها|ه)(?![ء-ي])/i.test(scope.text);
}

const CARD_CREDIT_TARGET = /\bcredit\s+card\b|بطاق(?:تك|ه|ة)\s+(?:ال)?ا[يئ]تماني[هة]/iu;
const CARD_CREDIT_MOVEMENT = /\bcredited(?:\s+with|\s+to)?\b|(?<![ء-ي])(?:تم\s+)?(?:إيداع|ايداع|إضافة|اضافه|اضافة)(?![ء-ي])/iu;

const REPAYMENT_MONEY = String.raw`(?:[A-Z]{3}|Dhs?|SR|[$€£])\s*\p{Nd}+(?:[.,٫٬]\p{Nd}+)*`;
// A card is the destination, never an instrument used to pay a merchant/bill.
const REPAYMENT_CARD = String.raw`(?:(?!(?:bill|invoice|loan|finance|mortgage|account|utility|electricity|water|using|via|with|through|from|to|for|by|on|at|and|of)\b)[\p{L}\p{N}.'’-]+\s+){0,3}?card\b`;
const UNQUALIFIED_REPAYMENT = new RegExp(
  String.raw`^\s*(?:[A-Z][A-Z0-9 .&-]{1,32}:\s*)?(?:Dear\s+Customer[,!:]\s*)?(?:` +
  String.raw`payment\s+(?:received|credited)\s+${REPAYMENT_MONEY}\s+(?:on|to|towards?)\s+(?:your\s+)?${REPAYMENT_CARD}` +
  String.raw`|thank\s+you\s+for\s+(?:your\s+)?payment\s+of\s+${REPAYMENT_MONEY}\s+on\s+(?:your\s+)?${REPAYMENT_CARD}` +
  String.raw`|your\s+payment\s+of\s+${REPAYMENT_MONEY}\s+to\s+(?:your\s+)?(?:credit|charge|covered)\s+card\b(?:[^.\n]|\.\d){0,80}\bsuccessful\b)`,
  'iu',
);
/** These receipt claims cannot prove new spending/income. Keep them in Review. */
export function isUnqualifiedCardRepayment(source: string): boolean {
  const text = /[\uFF01-\uFFEF]/u.test(source) ? source.normalize('NFKC') : source;
  return UNQUALIFIED_REPAYMENT.test(text);
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
