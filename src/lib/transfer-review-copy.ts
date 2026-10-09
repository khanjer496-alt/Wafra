import { getLanguage } from '@/lib/i18n';

/**
 * Transfer words still used outside the Transfers page: Home's notice, the
 * entry sheet's explainer and the transaction row's tag. The retired review
 * screen's sheet ("Check a transfer", "Save classification", "Leave as
 * recorded", ...) is gone; the Transfers page speaks transfer-activity-copy.ts.
 */
const en = {
  noticeBody: 'Wafra can’t tell whether these moved between your own accounts or to and from someone else. Until you answer, they are not counted as spending, income or Net.',
  /** The one term for an unanswered transfer ("Needs an answer"), with what it means for the totals. */
  ownershipUnknown: 'Needs an answer · not counted yet',
  confirmedOwn: 'Between your accounts · not spending',
  ownBody: 'Not spending or income. Wafra excludes these amounts from Spending, Income and Net; they stay recorded as movements between your accounts.',
  // The lead of a waiting transfer's question, after its status ("Needs an answer · not counted yet."): kept to two lines.
  pendingBody: 'Wafra keeps it out of Spending, Income and Net until you answer.',
  knownAccountEvidence: 'Recognised automatically: other bank SMS identify this account as yours. No matching receipt is required for ownership.',
  knownCardEvidence: 'Recognised automatically: other bank SMS identify the receiving credit card as yours. The bank payment is recorded; a card receipt has not been linked.',
};

const ar: typeof en = {
  noticeBody: 'لا تستطيع وفرة أن تعرف هل انتقلت هذه بين حساباتك أم مع شخص آخر. حتى تجيب، لا تُحتسب ضمن المصروفات أو الدخل أو الصافي.',
  ownershipUnknown: 'بانتظار إجابتك · غير محتسب حالياً',
  confirmedOwn: 'بين حساباتك · ليس مصروفاً',
  ownBody: 'ليست مصروفاً ولا دخلاً. تستبعد وفرة هذه المبالغ من المصروفات والدخل والصافي، مع إبقائها مسجلة كحركة بين حساباتك.',
  pendingBody: 'تستبعده وفرة من المصروفات والدخل والصافي حتى تجيب.',
  knownAccountEvidence: 'تم التعرّف عليه تلقائياً: رسائل بنكية أخرى تثبت أن هذا الحساب لك. لا يلزم إشعار استلام مطابق لإثبات الملكية.',
  knownCardEvidence: 'تم التعرّف عليه تلقائياً: رسائل بنكية أخرى تثبت أن بطاقة الائتمان المستلمة لك. الدفعة البنكية مسجلة، ولم يُربط بها إشعار استلام من البطاقة.',
};

export const transferReviewCopy = (language: string = getLanguage()): typeof en =>
  language === 'ar' ? ar : en;
