import { normalizeAlertText } from '@/lib/alert-draft';

/** Explicit owner/lifecycle labels never describe a transaction counterparty
 * or its date. Shared by model proposals and human-taught source layouts. */
const PROFILE = new RegExp(String.raw`^\s*(?:${[
  String.raw`(?:account\s+holder|card\s*holder|customer|owner|user|member)(?:\s+(?:full|legal|first|last))?\s+name|account\s+holder|card\s*holder`,
  String.raw`(?:account|card)\s+(?:opened|created|registered|issued|expires|opening\s+date|creation\s+date|registration\s+date|issuance\s+date|expiry(?:\s+date)?|expiration(?:\s+date)?)`,
  String.raw`(?:customer|member)\s+since|date\s+of\s+birth|birth\s+date|dear`,
  String.raw`اسم\s+(?:صاحب\s+الحساب|مالك\s+الحساب|حامل\s+البطاق[ةه]|العميل)|صاحب\s+الحساب|حامل\s+البطاق[ةه]`,
  String.raw`الاسم(?:\s+(?:الكامل|القانوني|الأول|الاول|الأخير|الاخير))?\s+(?:للعميل|لصاحب\s+الحساب|لحامل\s+البطاق[ةه])`,
  String.raw`تاريخ\s+(?:فتح\s+الحساب|إنشاء\s+الحساب|انشاء\s+الحساب|إصدار\s+البطاق[ةه]|اصدار\s+البطاق[ةه]|انتهاء\s+(?:البطاق[ةه]|الصلاحية)|الميلاد)`,
].join('|')})(?=$|[^\p{L}\p{M}\p{N}])`, 'iu');

export const isOwnerProfileClause = (clause: string): boolean => PROFILE.test(normalizeAlertText(clause));

/** Greeting identity ends at its comma; later purchase text keeps ownership. */
export function ownerProfilePrefixLength(clause: string): number {
  const greeting = normalizeAlertText(clause).match(/^\s*dear\b[^,，،]*[,，،]\s*/iu);
  return greeting ? greeting[0].length : clause.length;
}
