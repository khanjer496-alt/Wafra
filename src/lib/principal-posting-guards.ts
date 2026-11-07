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

const REFUND_LEAD = /(?:\brefund(?:ed)?\s+(?:of|amount(?:\s+of)?|for)?|(?<![ء-ي])(?:(?:ال)?مبلغ\s+)?(?:ال)?استرداد(?:\s+(?:ال)?مبلغ)?(?:\s+بقيم[هة]|\s+بمبلغ)?)[ \t]*[:\-]?[ \t]*$/iu;
const NOT_CURRENT_REFUND = /\b(?:if|when|unless|earlier|previous|prior|another|other|last)\b|(?<![ء-ي])(?:اذا|حال|سابق[هة]?|اخري)(?![ء-ي])/iu;
const REFUND_PENDING = /\b(?:initiated|under\s+process(?:ing)?|in\s+process|in\s+progress|being\s+processed|will\s+(?:be|reflect|appear|show)|requested|pending|awaiting|submitted|approved|raised)\b|(?<![ء-ي])(?:قيد\s+(?:ال)?(?:معالج[هة]|تنفيذ|مراجع[هة]|انتظار)|سيتم|سوف|طلب|تمت\s+الموافق[هة])(?![ء-ي])/iu;
const REFUND_CANCELLED = /\b(?:has\s+been|was|is|got)\s+(?:cancell?ed|declined|rejected|unsuccessful|voided)\b|\brefund\s+(?:has\s+)?failed\b|(?<![ء-ي])(?:تم\s+)?(?:الغاء|إلغاء|رفض)\s+(?:طلب\s+)?(?:ال)?استرداد|(?:ال)?استرداد\s+(?:ال)?(?:ملغي|ملغى|ملغا|ملغاه|مرفوض)(?![ء-ي])/iu;
const REFUND_COMPLETED = /\b(?:credited|issued|processed\s+(?:to|into|on)|posted\s+(?:to|into|on)|received\s+(?:on|in|into)|deposited|returned\s+to|added\s+to)\b|(?<![ء-ي])(?:تم\s+(?:[إا]يداع|[إا]ضاف[هة]|استرداد|[إا]رجاع|[إا]عاد[هة])|اضيف|أضيف|اعيد|أعيد|اودع|أودع)(?![ء-ي])/giu;
const UNSETTLED_PREDICATE = /\b(?:will|would|shall|not|never|hasn['’]t|wasn['’]t|isn['’]t)\b/iu;
const REFUND_PAID_OUT = /\b(?:debited|deducted|charged|withdrawn|sent|paid\s+to)\b|(?<![ء-ي])(?:تم\s+خصم|خصمت|خصم\s+من)(?![ء-ي])/iu;

function sentenceAround(source: string, span: PrincipalSpan): { start: number; end: number; text: string } {
  let start = span.start, end = span.end;
  const commaAt = (at: number) => source[at] === ',' && !(/\d/u.test(source[at - 1] ?? '') && /\d/u.test(source[at + 1] ?? ''));
  while (start > 0 && !commaAt(start - 1) && !/[\n;!?]/u.test(source[start - 1]) &&
    !(source[start - 1] === '.' && /\s/u.test(source[start] ?? ''))) start--;
  while (end < source.length && !commaAt(end) && !/[\n;!?]/u.test(source[end]) &&
    !(source[end] === '.' && /^(?:\s|$)/u.test(source[end + 1] ?? ''))) end++;
  return { start, end, text: source.slice(start, end) };
}

const INDEPENDENT_MONEY_SUBJECT = /\b(?:and|but|while|whereas)\s+(?!(?:the|your|this)\s+refund\b)(?:a|an|the|your|another|separate|additional)\s+|\b(?:and|but|while|whereas)\s+(?:(?:processing|service|bank|administrative|new|separate|additional|related|applicable)\s+){0,3}(?:fees?|tax|charge|payment|transfer|withdrawal|deposit|purchase|refund|transaction|balance)\b(?=\s+(?:of|was|were|has|have|had|is|will|charged|debited|deducted|credited)\b)|(?<![ء-ي])و(?:تم\s+)?(?:خصم\s+)?(?:ال)?(?:رسوم|رسم|ضريب[هة]|عمول[هة])(?=\s)/giu;
const SAME_MONEY_REFERENCE = /^\s*(?:[(\[/=≈~]|equivalent(?:\s+to)?|equiv\.?|approx\.?|i\.?e\.?|بما\s+يعادل|ما\s+يعادل|يعادل)\s*$/i;
const ORIGINAL_MOVEMENT_REFERENCE = /\b(?:for|against|on|of)\s+(?:your|the)\s+(?:original\s+|earlier\s+|previous\s+)?(?:purchase|transaction|payment|charge|order)\s+(?:of|for)?\s*$|(?:لعمليه|عن\s+عمليه|من\s+عمليه)\s+(?:ال)?شراء\s+(?:بمبلغ|بقيمه)?\s*$/i;

/** Ownership ends when a new monetary subject begins, not merely at punctuation. */
function refundScope(source: string, own: PrincipalSpan, monetarySpans: readonly PrincipalSpan[]) {
  const sentence = sentenceAround(source, own);
  let end = sentence.end;
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
  return { start: sentence.start, end, text: source.slice(sentence.start, end) };
}

/** A refund noun must govern THIS figure. Another purchase's refund or a fee is not enough. */
export function refundPrincipalStatus(
  source: string, spans: readonly PrincipalSpan[], monetarySpans: readonly PrincipalSpan[] = spans,
): 'completed' | 'pending' | 'cancelled' | 'paid-out' | null {
  const own = spans.find(({ start }) => REFUND_LEAD.test(source.slice(Math.max(0, start - 48), start)));
  if (!own) return null;
  const scope = refundScope(source, own, monetarySpans);
  const sentence = scope.text;
  if (NOT_CURRENT_REFUND.test(source.slice(scope.start, own.start))) return null;
  if (REFUND_CANCELLED.test(sentence)) return 'cancelled';
  if (REFUND_PAID_OUT.test(sentence)) return 'paid-out';
  for (const match of sentence.matchAll(REFUND_COMPLETED)) {
    if (!UNSETTLED_PREDICATE.test(sentence.slice(Math.max(0, match.index! - 40), match.index))) return 'completed';
  }
  if (REFUND_PENDING.test(sentence) || UNSETTLED_PREDICATE.test(sentence)) return 'pending';
  const after = source.slice(scope.end, scope.end + 120);
  if (/^[.!\s]*(?:it|(?:this|the|your)\s+refund)\s+(?:has\s+not|hasn['’]t|is\s+not|will\s+be|remains?\s+pending)/iu.test(after)) return 'pending';
  return 'completed';
}

/** The selected purchase itself was refunded; a previous or hypothetical refund cannot qualify it. */
export function isCompletedPrincipalRefund(source: string, span: PrincipalSpan | undefined): boolean {
  if (!span) return false;
  const scope = sentenceAround(source, span);
  if (NOT_CURRENT_REFUND.test(scope.text) || REFUND_PENDING.test(scope.text)) return false;
  return /\b(?:purchase|transaction|payment|charge)\b(?:[^.\n]|\.\d){0,120}?\b(?:has\s+been|was|is|have\s+been)\s+(?:fully\s+)?refunded\b|(?<![ء-ي])(?:عمليه\s+)?(?:ال)?شراء(?:[^.\n]|\.(?=\S)){0,120}?\s+(?:و?تم\s+)(?:استرداد|استرجاع|ارجاع)(?:ها|ه)(?![ء-ي])/i.test(scope.text);
}
