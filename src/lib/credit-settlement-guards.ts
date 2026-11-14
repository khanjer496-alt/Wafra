/** Shared qualifications of the selected credit clause, never a whole-message keyword blacklist. */
export const EN_CREDIT_PENDING_STATUS = String.raw`(?:under[-\s]+(?:process(?:ing)?|review)|in[-\s]+(?:process|progress|queue)|being\s+(?:processed|reviewed|initiated)|pending|awaiting|awaited|on\s+hold|queued|queuing|queueing|scheduled|provisional|not\s+yet\s+final)\b`;
export const AR_CREDIT_PENDING_STATUS = String.raw`(?<![ء-ي])(?:(?:في\s+انتظار|ب[اإا]نتظار)\s+(?:ال)?(?:موافق[هة]|اعتماد|تسوي[هة]|تحقق|تاكيد|تأكيد)|(?:قيد|تحت)\s+(?:ال)?(?:انتظار|معالج[هة]|تنفيذ|اجراء|إجراء|مراجع[هة]|دراس[هة]|تحقيق|تدقيق|تسوي[هة])|جار[يى]?[\u064B-\u0652]*\s+(?:ال)?(?:معالج[هة]|تنفيذ|تحقق|تدقيق|تسوي[هة])|مجدول[هة]?|لم\s+تتم\s+تسويت[هها]+\s+بعد)(?![ء-ي])`;
const DECISION = String.raw`(?:approv(?:e[sd]?|al)|authori[sz](?:e[sd]?|ation)|verif(?:y|ies|ied|ication)|confirm(?:s|ed|ation)?|clear(?:s|ed|ance)?|accept(?:s|ed|ance)?|validat(?:e[sd]?|ion)|settlement|upheld|receipt\s+of\s+(?:the\s+)?funds)\b`;
const WORDS = String.raw`(?:[\p{L}\p{N}'’\-]+\s+)*`;
const EN_CONDITION = String.raw`\b(?:if|unless|until|whether|once|when|after|pending|provided(?:\s+that)?|providing(?:\s+that)?|upon|subject\s+to|conditional\s+on|contingent\s+on)\s+${WORDS}${DECISION}`;
const AR_DECISION = String.raw`(?:ال)?(?:موافق[هة]|اعتماد|تحقق|تاكيد|تأكيد|قبول|تسوي[هة]|وافق|يوافق|توافق|اعتمد|يعتمد|تحقق|يتحقق|اكد|أكد|يوكد|يؤكد)(?![ء-ي])`;
export const CREDIT_CONDITION_SOURCE = String.raw`${EN_CONDITION}|(?<![ء-ي])(?:رهن|مرهون[هة]?\s+ب?|بشرط|شريط[هة]|شرط|عند|بمجرد|بعد|في\s+حال[هة]?|اذا|إذا|ان|إن)\s*${WORDS}${AR_DECISION}`;
const CONDITION = new RegExp(CREDIT_CONDITION_SOURCE, 'iu');
const PENDING = new RegExp(`${EN_CREDIT_PENDING_STATUS}|${AR_CREDIT_PENDING_STATUS}`, 'iu');
// The bank's security footer describes what the customer should do, not whether this credit has arrived.
const IGNORE_FOOTER = /\bif\s+(?:(?:it|this|they|the\s+\w+)\s+(?:is|are|has\s+been|gets?)\s+)?(?:approved|authori[sz]ed|verified|confirmed|cleared|accepted|validated)\s+by\s+you\b,?\s+(?:(?:please|kindly)\s+)?(?:ignore|disregard)\b[^.;\n]*/gi;
function qualificationScope(text: string): string {
  return text.split(/[,،;]\s*(?:(?:your|the)\s+other\s+(?:refund|reversal|request|order)|another\s+(?:refund|reversal|request|order)|و?(?:طلبك|طلبكم|الطلب|الاسترداد)\s+(?:الاخر|الآخر|الاخري|الأخرى))/iu)[0];
}
export function hasCreditCondition(text: string): boolean {
  return CONDITION.test(qualificationScope(text).replace(IGNORE_FOOTER, ' ').replace(/\bafter\s+(?:(?:your|the|this)\s+)?(?:request|claim|order|verification|review)\s+(?:was|has\s+been|had\s+been)\s+(?:approved|verified|completed|cleared)\b/gi, ' '));
}
export function hasPendingCreditStatus(text: string): boolean {
  return PENDING.test(qualificationScope(text).replace(/\b(?:pending|in[-\s]+progress|under[-\s]+review)\s+(?:orders?|purchases?|transactions?|applications?)\b/gi, ' '));
}
/** Leading explicit conditions do not become historical just because punctuation separates them from the credit. */
export function hasLeadingCreditCondition(text: string): boolean {
  // "After verification, ... has been credited" is an existing settled temporal control.
  return hasCreditCondition(text.replace(/\bafter\b[\s\S]*$/i, ' '));
}
