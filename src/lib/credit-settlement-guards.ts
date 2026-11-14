import { CURRENCY_MINOR_UNITS } from '@/lib/currency-metadata';
import type { UniversalBankEvent } from '@/lib/universal-types';
/** Qualifications of a credit, shared by posting, principal selection and informational Review. */
const normalized = new Map<string, string>();
export function normalizeCreditText(source: string): string {
  const cached = normalized.get(source);
  if (cached !== undefined) return cached;
  const text = source.normalize('NFKC')
    .replace(/[\u0640\u064B-\u0655\u0670\u200B-\u200F\u061C\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    // Preserve grammatical information before folding the Arabic letters: إن is if, أن is that.
    .replace(/(?<![ء-ي])أن(?![ء-ي])/g, ' that_ar ').replace(/(?<![ء-ي])إن(?![ء-ي])/g, ' if_ar ')
    .replace(/[أإآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و').replace(/ة/g, 'ه')
    .replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) - (c >= '۰' ? 0x06f0 : 0x0660)))
    .replace(/\bcharge[\s\-–—]*backs?\b/gi, 'chargeback')
    .replace(/[,:;\-–—،؛\n]/g, (c, at, whole) => /\d/.test(whole[at - 1] ?? '') && /\d/.test(whole[at + 1] ?? '') ? c : ' | ')
    .replace(/[.!?؟](?=\s|$)/g, ' || ').replace(/\s+/g, ' ').trim();
  if (normalized.size >= 64) normalized.delete(normalized.keys().next().value!);
  normalized.set(source, text);
  return text;
}
export const EN_CREDIT_PENDING_STATUS = String.raw`(?:under[-\s]+(?:process(?:ing)?|review|investigation)|in[-\s]+(?:process|progress|queue)|being\s+(?:processed|reviewed|initiated)|pending|awaiting|awaited|on\s+hold|queued|queuing|queueing|scheduled|provisional(?:ly)?|temporar(?:y|ily)|not\s+yet\s+(?:final|complete))\b`;
export const AR_CREDIT_PENDING_STATUS = String.raw`(?<![ء-ي])(?:(?:في\s+[اإ]نتظار|ب[اإ]نتظار)(?![ء-ي])|(?:قيد|تحت)\s+(?:ال)?(?:انتظار|معالج[هة]|تنفيذ|اجراء|إجراء|مراجع[هة]|دراس[هة]|تحقيق|تدقيق|تسوي[هة])|جار[يى]?[\u064B-\u0652]*\s+(?:ال)?(?:معالج[هة]|تنفيذ|تحقق|تدقيق|تسوي[هة])|مجدول[هة]?|معلق[هة]?|موقت[هة]?|لم\s+تتم\s+تسويت[هها]+\s+بعد)(?![ء-ي])`;
const PENDING = new RegExp(`${EN_CREDIT_PENDING_STATUS}|${AR_CREDIT_PENDING_STATUS}`, 'iu');
export const REFUND_REQUEST_NOUN_RE = /\b(?:(?:refund|reversal|chargeback)\s+(?:requests?|claims?|applications?)|requests?\s+(?:for|to)\s+(?:(?:a|the|your)\s+)?(?:refund|reversal|reverse|chargeback))\b|(?<![ء-ي])(?:طلب(?:ك|كم)?\s+(?:ال)?(?:ل?استرداد|ل?استرجاع|ل?عكس|اعاده|اعتراض)|طلبك\s+لاسترداد)(?![ء-ي])/iu;
export const isRefundRequest = (source: string): boolean => REFUND_REQUEST_NOUN_RE.test(normalizeCreditText(source).replace(/\|/g, ' '));
const CREDIT_MENTION = /\b(?:refund(?:ed|ing)?|reversal|reversed|chargeback|credited|credit(?!\s+card))\b|(?<![ء-ي])(?:استرداد|استرجاع|ارجاع|اعاده|عكس|ايداع|اضافه)(?![ء-ي])/iu;
// This is deliberately conservative. Always inspect the normalized ORIGINAL,
// never a merchant-masked, clause-selected or request-note-stripped derivative.
const UNSETTLED_EN = /\b(?:if|unless|subject|upon|provided|once|when|after|until|pending|awaiting|queued|queuing|queueing|scheduled|process(?:ed|ing)?|progress|review(?:ed|ing)?|requests?|require[ds]?|approval|approv(?:e[ds]?|ing)|verification|verif(?:y|ied|ying)|clearance|eligible|may|can|will)\b/iu;
const UNSETTLED_AR = /(?<![ء-ي])(?:if_ar|و?(?:اذا|لو|عند|بعد|فور|حين|شرط|بشرط|شريطه|رهن|مرهون|(?:في\s+|ب)?انتظار|قيد|جار[ي]?|طلب(?:ك|كم)?|يتطلب|تتطلب|موافقه|تحقق|تسويه|سوف|يمكن)|(?:ال|بال|لل)(?:شرط|انتظار|طلب|موافقه|تحقق|تسويه))(?![ء-ي])/iu;
export const hasUnsettledCreditToken = (source: string): boolean => {
  const original = normalizeCreditText(source);
  return UNSETTLED_EN.test(original) || UNSETTLED_AR.test(original);
};
export const mentionsCredit = (source: string): boolean => CREDIT_MENTION.test(normalizeCreditText(source));

/** The source spans remain in the original spelling; normalization is detection only. */
export function completedDebitBesideCredit(source: string): { debit: string; credit: string } | null {
  if (!mentionsCredit(source)) return null;
  const parts = source.split(/(?<=[.!?؟])\s+|[;؛\n]+|\s+(?:but|while)\s+(?=(?:your|the)\s+(?:refund|reversal|charge[\s-]*back))|\s*[-–—]\s*(?=(?:refund|reversal|charge[\s-]*back)\b)/iu);
  const debit = parts.filter(part => {
    const text = normalizeCreditText(part);
    return !CREDIT_MENTION.test(text) && /\d/.test(text) &&
      /\b(?:was\s+debited|has\s+been\s+debited|debited\s+from|purchase(?:\s+of)?|purchased|spent|paid\s+(?:at|to)|used\s+(?:at|for)|withdrawn\s+from)\b|(?:تم|تمت)\s+(?:ال)?(?:خصم|شراء|دفع|سحب)/iu.test(text) &&
      !hasUnsettledCreditToken(part) && !/\b(?:not|failed|declined|unsuccessful|rejected|reversed)\b|(?:لم|لن|فشل|رفض)/iu.test(text);
  });
  const credit = parts.filter(part => mentionsCredit(part));
  return debit.length === 1 && credit.length > 0 ? { debit: debit[0], credit: credit.join(' ') } : null;
}
const OWN_REFERENCE = /^(?:(?:this|the|that|same|your)\s+(?:credit|refund|amount|money|funds|reversal|cheque|check|dispute|claim|hold|lien|bank|sum|transfer|transaction|payment|deposit|approval|verification|confirmation|clearance|permission|consent)|(?:it|its|them)\b|(?:the\s+)?same\b|(?:this|these|those|they)\s+(?=(?:is|are|was|were|will|shall|has|have|can|could|would|may)\b)|status\b|(?:هذا|نفس|ذلك)\s+(?:ال)?(?:مبلغ|استرداد|ايداع)|(?:ال)?(?:مبلغ|استرداد|حاله)(?![ء-ي]))/iu;
const CONDITION_HEAD = /^(?:only\s+)?(?:if\b|unless\b|until\b|whether\b|once\b|when\b|after\b|upon\b|on\b|subject\b|provided\b|providing\b|conditional\b|contingent\b|depending\b|in\s+case\b|should\b|assuming\b|as\s+long\s+as\b|so\s+long\s+as\b|pending\b|awaiting\b|under\b|in\s+(?:process|progress|queue)\b|if_ar\b|اذا(?![ء-ي])|ان(?![ء-ي])|لو(?![ء-ي])|في\s+حال|عند(?![ء-ي])|بمجرد(?![ء-ي])|بشرط(?![ء-ي])|شريطه(?![ء-ي])|رهن(?![ء-ي])|مرهون(?![ء-ي])|لحين(?![ء-ي])|حتي(?![ء-ي])|ريثما(?![ء-ي])|بانتظار(?![ء-ي])|في\s+انتظار(?![ء-ي])|قيد(?![ء-ي])|تحت(?![ء-ي]))/iu;
const COMPLEMENT_HEAD = /(?:\b(?:subject\s+to|conditional\s+(?:on|upon)|contingent\s+on|depending\s+on|on|upon|under|in|status)|(?:بشرط|شريطه|شرط|رهن|لحين|حتي|ريثما))\s*$/iu;
// Qualifiers always see the same normalized original, before any field masking.
export function creditQualificationScope(source: string): string {
  return normalizeCreditText(source);
}
const EN_PAST_EVENT = /\b(?:after|once|when|following)\s+(?![^|.]*\b(?:will|would|shall|may|might|if|unless)\b)([^|.]*?)\b(?:approved|verified|confirmed|cleared|accepted|completed|cancell?ed|signed\s+off)\b/giu;
const AR_PAST_EVENT = /(?:بعد(?:\s+(?:ان|that_ar))?|عندما|حين)\s+(?:ان\s+)?(?:(?:قد\s+)?(?:وافق|اكد|اعتمد|تحقق)|(?:تم|تمت)\s+(?:ال)?(?:تحقق|تاكيد|اعتماد|موافقه|الغاء|ارجاع|استرجاع|مراجعه))/gu;
function withoutPastEvents(text: string): string {
  return text.replace(EN_PAST_EVENT, (all, subject) => !subject.trim() || /^(?:(?:successfully|fully|finally|already|just|now)\s*)+$/iu.test(subject.trim()) || /\b(?:is|are|gets?)\b/iu.test(subject) ? all : ' ').replace(AR_PAST_EVENT, ' ')
    .replace(/\bonce\s+(?:again|more)\b/gi, ' ')
    .replace(/\bafter\s+(?:(?:your|the|this)\s+)?(?:cancell?ation|return|refund\s+request|verification|clearance|review|investigation|dispute(?:\s+resolution)?|chargeback|reversal)\b/gi, ' ')
    .replace(/(?:عند|عندما|بمجرد(?:\s+(?:ان|that_ar))?|بعد(?:\s+(?:ان|that_ar))?)\s+(?:ال)?(?:الغاء|ارجاع|استرجاع|مراجعه|تحقق|اعتراض|نزاع)(?:\s+(?:ال)?(?:طلب|طلبك|عمليه|معامله|شراء|منتج|سلعه|بضاعه|مشتريات)){0,3}(?=\s+و?(?:قد\s+)?(?:تم|تمت)(?![ء-ي]))/g, ' ')
    .replace(/بعد\s+(?:ال)?تحقق(?:\s+من\s+(?:ال)?طلب)?/g, ' ')
    .replace(/عند\s+(?:الساعه|الوقت)\s+\d[\d:]*|تم\s+(?:ال)?تحقق\s+من\s+(?:ال)?عمليه/g, ' ');
}
export const hasPastCreditEvent = (text: string): boolean => {
  const scope = creditQualificationScope(text);
  return withoutPastEvents(scope) !== scope;
};
export const CREDIT_CONDITION_SOURCE = String.raw`\b(?:subject\s+to|conditional\s+(?:on|upon)|contingent\s+(?:on|upon)|depending\s+on|assuming|(?:as|so)\s+long\s+as|on\s+condition(?:\s+that)?|in\s+(?:the\s+)?event(?:\s+of)?|in\s+case(?:\s+of)?|provided(?:\s+that)?|providing(?:\s+that)?|if|unless|until|whether|till|should)\b|\b(?:once|when|after|upon)\s+|\bon\s+(?:(?:successful|final|merchant|bank)\s+)*(?:approval|verification|clearance|confirmation|receipt)\b|(?<![ء-ي])(?:if_ar|اذا|لو|في\s+حال(?:ه)?|بشرط|شريطه|شرط|رهن|مرهون|لحين|حتي|ريثما|بمجرد|عند|عندما|متي|حينما|حين)(?![ء-ي])|(?<![ء-ي])بعد\s+(?:ال)?(?:موافقه|اعتماد)(?![ء-ي])`;
const CONDITION = new RegExp(CREDIT_CONDITION_SOURCE, 'iu');
export function hasCreditCondition(source: string): boolean {
  return CONDITION.test(normalizeCreditText(source));
}
export function hasPendingCreditStatus(source: string): boolean {
  const text = normalizeCreditText(source);
  const workflowText = text.replace(/\bas\s+requested\b/gi, ' ');
  const workflow = /\b(?:initiated|submitted|requested|raised|lodged|registered|logged)\b/iu.test(workflowText);
  const completedMoney = /\b(?:has|have|had)\s+(?:(?:now|already|just)\s+)?been\s+(?:(?:successfully|fully|now)\s+)?(?:credited|refunded|reversed|returned|deposited|posted)\b|\b(?:was|were)\s+(?:(?:successfully|fully|now)\s+)?(?:credited|refunded|reversed|returned|deposited|posted)\b|(?<!\b(?:be|being|if|once|when|until)\s+)\b(?:credited|refunded|reversed|returned|deposited|posted)\s+(?:back\s+)?(?:to|into|onto)\s+your\b/iu.test(text);
  const decisionState = text.replace(/\b(?:no|not)\s+(?:approval|verification|confirmation|clearance|permission|consent)\s+(?:is\s+)?(?:required|needed)\b/giu, ' ');
  const requiredDecision = /\b(?:approval|verification|confirmation|clearance|permission|consent)\s+(?:(?:is|remains?)\s+)?(?:required|needed|outstanding)\b/iu.test(decisionState);
  return PENDING.test(text) || requiredDecision || (workflow && !completedMoney) || /\b(?:will|would|shall|may|might|can|could)\s+(?:(?:not|soon|shortly|be|been)\s+)*(?:credit|refund|revers|return|deposit|receiv)\w*\b/iu.test(text);
}
export const hasLeadingCreditCondition = (source: string): boolean => hasCreditCondition(source);
export const isHistoricalCreditClaim = (source: string): boolean => /(?:^|\|)\s*(?:(?:a|the|your)\s+)?(?:previous|earlier|prior|old)\s+(?:refund|reversal|credit)\b/iu.test(normalizeCreditText(source));
export function hasSettledCreditReceipt(source: string): boolean {
  if (isHistoricalCreditClaim(source)) return false;
  const text = creditQualificationScope(source);
  if (hasCreditCondition(text) || hasPendingCreditStatus(text) || /\b(?:not|never)\s+(?:(?:yet|been|be|successfully)\s+)*(?:credited|refunded|reversed|returned|deposited|received|completed|settled)\b/iu.test(text)) return false;
  const head = /\b(?:credit(?!\s+card\b)(?:\s+(?:transaction|transfer|payment))?|refund|reversal|chargeback)\s+([\p{L}][\p{L}'’]*)\b/iu.exec(text);
  const monetaryHead = !head || /^(?:of|for|from|to|amount|has|have|had|was|were|is|are|received|arrived|credited|refunded|returned|reversed|deposited|posted|processed|successful|successfully|complete|completed|settled|done)$/iu.test(head[1]) || Object.hasOwn(CURRENCY_MINOR_UNITS, head[1].toUpperCase());
  // A completed process subject (an application, appeal, ticket...) is not the money subject.
  const actualMoneyVerb = /\b(?:credited|refunded|returned|reversed|deposited|posted)\s+(?:back\s+)?(?:to|into|onto|in|on)\s+(?:your|the\s+original)\b/iu.test(text);
  if (!monetaryHead && !actualMoneyVerb) return false;
  const receipt = /\b(?:credited|refunded|reversed|returned|deposited|posted|received|arrived|applied|processed|complete(?:d)?|successful|settled|done)\b|(?<![ء-ي])(?:تم|تمت)\s+(?:(?:تاكيد|تنفيذ)\s+)?(?:ال)?(?:استرداد|استرجاع|ارجاع|اعاده|عكس|ايداع|اضافه|معالجه)/iu.test(text);
  if (!receipt) return false;
  // Request receipt/completion is not money receipt; a separate money verb is necessary.
  return !isRefundRequest(text) || /\b(?:credited|refunded|reversed|returned|deposited)\b|(?:تم|تمت)\s+(?:استرداد|ايداع|عكس)/iu.test(text);
}
export type CreditSourceDisposition = 'post' | 'review' | 'not-credit';
export function creditSourceDisposition(source: string): CreditSourceDisposition {
  const text = normalizeCreditText(source);
  if (CREDIT_MENTION.test(text) && hasUnsettledCreditToken(source)) return 'review';
  if (/\b(?:cash\s*back|rewards?|points|miles|bonus)\b|(?:استرداد|استرجاع)\s+(?:ال)?نقدي/iu.test(text)) return 'not-credit';
  const sentences = text.split(/\s*\|\|\s*/);
  const index = sentences.findIndex(sentence => CREDIT_MENTION.test(sentence) && /(?:\b[A-Z]{3}\s*\d|\d[\d,.]*\s*(?:[A-Z]{3}\b|درهم|ريال))|(?:درهم|ريال)\s*\d/iu.test(sentence));
  if (index < 0) return 'not-credit';
  const owned = [sentences[index]];
  for (const later of sentences.slice(index + 1)) if (OWN_REFERENCE.test(later.trim())) owned.push(later);
  const scope = owned.join(' | ');
  const bareActiveCondition = /(?:^|\|)\s*و?ان\s+(?!(?:قد\s+)?(?:تم|يتم|كان)(?:\s|$))/u.test(scope);
  return bareActiveCondition || hasCreditCondition(scope) || hasPendingCreditStatus(scope) || !hasSettledCreditReceipt(scope) ? 'review' : 'post';
}

/** The existing Review contract: retain uncertain credit evidence, never confirmation authority. */
export function informationalCreditReview(source: string, event: UniversalBankEvent): UniversalBankEvent {
  if (event.amount.evidence === 'missing' || ['authentication', 'balance', 'statement', 'bill', 'card-payment'].includes(event.family) ||
    event.issues.some(issue => /^(?:authentication|promotion|failed)-not-posting$/.test(issue))) return event;
  return { ...event, decision: 'review', status: 'informational',
    family: event.family === 'unknown' ? (/refund|reversal|charge[ -]*back|استرداد|استرجاع|عكس/iu.test(source) ? 'refund' : 'transfer') : event.family,
    direction: event.direction === 'unknown' || event.direction === 'none' ? 'credit' : event.direction,
    observations: event.observations.map(observation => observation.field.spans.some(span =>
      event.amount.spans.some(primary => primary.start === span.start && primary.end === span.end))
        ? { ...observation, role: 'transaction' as const } : observation),
    issues: [...new Set([...event.issues, 'unsettled-credit-not-posting'])] };
}

/** Unsettled bank money can be retained, while authentication, links and actual failures keep their refusal. */
export function canReviewCreditRefusal(source: string, reason: string | null): boolean {
  if (reason === null || reason === 'pending-processing') return true;
  if (reason !== 'declined') return false;
  return (hasCreditCondition(source) && /\b(?:if|unless|whether)\b[^.!?]{0,80}\b(?:rejected|declined)\b/iu.test(source)) ||
    /لم\s+(?:يتم|تتم)\s+(?:تسويت|تسويه|معالجه|تنفيذ)[^|]{0,20}\s+بعد/u.test(normalizeCreditText(source));
}
