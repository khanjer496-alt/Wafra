import { getLanguage } from '@/lib/i18n';

/**
 * Transfer words still used outside the Transfers page: Home's notice, the
 * entry sheet's explainer and the transaction row's tag. The retired review
 * screen's sheet ("Check a transfer", "Save classification", "Leave as
 * recorded", ...) is gone; the Transfers page speaks transfer-activity-copy.ts.
 */
const en = {
  noticeBody: 'Only transfers with evidence of a possible own-account match appear here. While ownership is unresolved, Wafra does not count them as spending, income or Net.',
  ownershipUnknown: 'Transfer needs review · not counted yet',
  confirmedOwn: 'Between your accounts · not spending',
  ownBody: 'Not spending or income. Wafra excludes these amounts from Spending, Income and Net; they stay recorded as movements between your accounts.',
  pendingBody: 'Wafra keeps this out of Spending, Income and Net until you confirm whether the other account is yours.',
  knownAccountEvidence: 'Recognised automatically: other bank SMS identify this account as yours. No matching receipt is required for ownership.',
  knownCardEvidence: 'Recognised automatically: other bank SMS identify the receiving credit card as yours. The bank payment is recorded; a card receipt has not been linked.',
};

const ar: typeof en = {
  noticeBody: 'تظهر هنا فقط التحويلات التي توجد أدلة على احتمال أنها بين حساباتك. ما دامت الملكية غير مؤكدة فلن تحتسبها وفرة ضمن المصروفات أو الدخل أو الصافي.',
  ownershipUnknown: 'تحويل يحتاج مراجعة · غير محتسب حالياً',
  confirmedOwn: 'بين حساباتك · ليس مصروفاً',
  ownBody: 'ليست مصروفاً ولا دخلاً. تستبعد وفرة هذه المبالغ من المصروفات والدخل والصافي، مع إبقائها مسجلة كحركة بين حساباتك.',
  pendingBody: 'تستبعد وفرة هذا المبلغ من المصروفات والدخل والصافي حتى تؤكد ما إذا كان الحساب الآخر لك.',
  knownAccountEvidence: 'تم التعرّف عليه تلقائياً: رسائل بنكية أخرى تثبت أن هذا الحساب لك. لا يلزم إشعار استلام مطابق لإثبات الملكية.',
  knownCardEvidence: 'تم التعرّف عليه تلقائياً: رسائل بنكية أخرى تثبت أن بطاقة الائتمان المستلمة لك. الدفعة البنكية مسجلة، ولم يُربط بها إشعار استلام من البطاقة.',
};

export const transferReviewCopy = (language: string = getLanguage()): typeof en =>
  language === 'ar' ? ar : en;
