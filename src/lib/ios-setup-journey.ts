import type { Account, Transaction } from './types';
import type { IosSetupReadiness } from './ios-capture-setup';

/** Self-confirmed automation plus a working native action, not delivery proof. */
export function futureSetupConfigured(readiness: IosSetupReadiness, confirmed: boolean): boolean {
  return confirmed && (readiness === 'shortcut-proven' || readiness === 'first-alert-captured');
}

/**
 * Guidance derived from the existing, saved ledger only. A bank name is NOT a
 * sender ID, an Apple picker value, a new bank connection or a coverage claim.
 * Never infer names from an account label or retain raw Message sender/body.
 */
export function detectedSetupBanks(
  accounts: readonly Account[], transactions: readonly Transaction[],
): string[] {
  const importedAccounts = new Set<string>();
  for (const row of transactions) {
    if (row.source === 'sms') importedAccounts.add(row.accountId);
  }
  const names = new Map<string, string>();
  for (const account of accounts) {
    if (account.archived || !importedAccounts.has(account.id)) continue;
    const raw = account.bankName;
    if (typeof raw !== 'string' || raw.length > 100 ||
      /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(raw)) continue;
    const name = raw.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (name) names.set(name.toLocaleLowerCase('en-US'), name);
  }
  return [...names.values()];
}

// Localized together so this trial cannot accidentally change shared onboarding
// contracts elsewhere. No fixed duration or recent-only default is promised.
const COPY = {
  en: {
    intro: 'Your past transactions first. New alerts next.',
    historyRequest: 'Checks all retained history within this Shortcut’s coverage—not a 30-day sample.',
    historyPending: 'History not imported yet.',
    historyRunning: 'History unfinished. New-alert setup is still available.',
    historyComplete: 'The completed history import was saved.',
    detected: 'Banks found in your saved transactions',
    detectedHelp: 'These bank names are a guide, not exact sender names. In Apple Shortcuts, choose the senders shown in your bank messages. Add every sender you use; Wafra cannot select them for you.',
    noBanks: 'No banks recognised from saved transactions yet. You can still set up future alerts using the senders shown in Messages.',
    senderHelp: 'Choose one or more senders in the same Message automation. With senders selected, leave Message Contains empty so other bank-alert wording is not excluded.',
    configureWhileImporting: 'Set up future alerts',
    checkTitle: 'Check your setup',
    needsSetup: 'New alerts not set up yet.',
    proofOnly: 'The local Shortcut check passed. The Message automation still needs your confirmation.',
    waiting: 'Setup checked — waiting for your first bank alert.',
    received: 'The first qualifying alert was processed. This does not prove every purchase will arrive.',
    proofHelp: 'A local check tests the action only. A real bank alert is separate evidence. You do not need to make a purchase to finish setup.',
  },
  ar: {
    intro: 'معاملاتك السابقة أولاً، ثم التنبيهات الجديدة.',
    historyRequest: 'يفحص السجل المحتفظ به ضمن نطاق تغطية الاختصار، وليس عيّنة من آخر ٣٠ يوماً.',
    historyPending: 'لم يُستورد السجل بعد.',
    historyRunning: 'السجل غير مكتمل. يمكنك إعداد التنبيهات الجديدة دون إعادة ضبط هذا الاستيراد.',
    historyComplete: 'حُفظ استيراد السجل المكتمل.',
    detected: 'البنوك الموجودة في معاملاتك المحفوظة',
    detectedHelp: 'أسماء البنوك هذه للإرشاد وليست أسماء المرسلين الدقيقة. في اختصارات Apple اختر المرسلين كما يظهرون في رسائل بنكك، وأضف كل مرسل تستخدمه. لا يستطيع وفرة اختيارهم نيابةً عنك.',
    noBanks: 'لم نتعرّف على بنوك من معاملات محفوظة بعد. ما زال بإمكانك إعداد التنبيهات الجديدة باستخدام المرسلين الظاهرين في الرسائل.',
    senderHelp: 'اختر مرسلاً أو أكثر في أتمتة رسالة واحدة. بعد اختيار المرسلين اترك «تحتوي الرسالة على» فارغاً حتى لا تُستبعد تنبيهات البنك ذات الصياغة المختلفة.',
    configureWhileImporting: 'إعداد التنبيهات الجديدة',
    checkTitle: 'التحقق من الإعداد',
    needsSetup: 'إعداد التنبيهات الجديدة غير مكتمل.',
    proofOnly: 'نجح فحص الاختصار محلياً. ما زالت أتمتة الرسائل تحتاج إلى تأكيدك.',
    waiting: 'فُحص الإعداد — بانتظار أول تنبيه بنكي.',
    received: 'عولج أول تنبيه مؤهّل. هذا لا يثبت وصول كل عملية شراء.',
    proofHelp: 'الفحص المحلي يختبر الإجراء فقط. التنبيه البنكي الحقيقي دليل منفصل. لا تحتاج إلى إجراء عملية شراء لإنهاء الإعداد.',
  },
} as const;

export function iosSetupJourneyCopy(language: string) {
  return language === 'ar' ? COPY.ar : COPY.en;
}
