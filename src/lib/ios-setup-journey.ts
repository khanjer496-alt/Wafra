import type { Account, Transaction } from './types';
import type { IosSetupReadiness } from './ios-capture-setup';
import type { IosMessageSetupProgress } from './ios-message-onboarding';

/** Self-confirmed automation plus a working native action, not delivery proof. */
export function futureSetupConfigured(readiness: IosSetupReadiness, confirmed: boolean): boolean {
  return confirmed && (readiness === 'shortcut-proven' || readiness === 'first-alert-captured');
}

/** A declined history review is different from choosing future-only setup. */
export function canFinishIosMessageSetup(
  progress: IosMessageSetupProgress,
  readiness: IosSetupReadiness,
): boolean {
  return futureSetupConfigured(readiness, progress.futureAutomationConfirmed) &&
    (progress.historyStatus === 'complete' ||
      (progress.historyStatus === 'skipped' && progress.historySkippedForNow === true));
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
    intro: 'New alerts first. Past messages when you’re ready.',
    historyRequest: 'Checks all retained history within this Shortcut’s coverage—not a 30-day sample.',
    historyPending: 'History not imported yet.',
    historyRunning: 'History unfinished. New-alert setup is still available.',
    historyComplete: 'The completed history import was saved.',
    detected: 'Banks found in your saved transactions',
    detectedHelp: 'These bank names are only a guide. Apple may not expose bank SMS IDs in its sender picker, so this step is optional and must never block setup.',
    noBanks: 'No banks recognised from saved transactions yet. You can continue using Wafra and revisit automatic capture later.',
    senderHelp: 'Apple may show only Contacts here. If your bank sender is not selectable, do not create a fake contact just to finish setup — continue without automatic capture.',
    configureWhileImporting: 'Set up future alerts',
    checkTitle: 'Check your setup',
    needsSetup: 'New alerts not set up yet.',
    proofOnly: 'The local Shortcut check passed. The Message automation still needs your confirmation.',
    waiting: 'Setup checked — waiting for your first bank alert.',
    received: 'The first qualifying alert was processed. This does not prove every purchase will arrive.',
    proofHelp: 'A local check tests the action only. A real bank alert is separate evidence. You do not need to make a purchase to finish setup.',
  },
  ar: {
    intro: 'التنبيهات الجديدة أولاً، والرسائل السابقة عندما تكون مستعداً.',
    historyRequest: 'يفحص السجل المحتفظ به ضمن نطاق تغطية الاختصار، وليس عيّنة من آخر ٣٠ يوماً.',
    historyPending: 'لم يُستورد السجل بعد.',
    historyRunning: 'السجل غير مكتمل. يمكنك إعداد التنبيهات الجديدة دون إعادة ضبط هذا الاستيراد.',
    historyComplete: 'حُفظ استيراد السجل المكتمل.',
    detected: 'البنوك الموجودة في معاملاتك المحفوظة',
    detectedHelp: 'أسماء البنوك للإرشاد فقط. قد لا تعرض Apple معرّفات رسائل البنوك في قائمة المرسلين، لذلك هذه الخطوة اختيارية ولا يجب أن تمنع إكمال الإعداد.',
    noBanks: 'لم نتعرّف على بنوك من معاملات محفوظة بعد. يمكنك متابعة استخدام وفرة والعودة إلى الالتقاط التلقائي لاحقاً.',
    senderHelp: 'قد تعرض Apple جهات الاتصال فقط هنا. إذا لم يظهر مرسل البنك فلا تنشئ جهة اتصال وهمية فقط لإكمال الإعداد — تابع دون الالتقاط التلقائي.',
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
