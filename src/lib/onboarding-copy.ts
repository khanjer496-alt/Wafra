/**
 * First-run copy added by the redesign: the Welcome language switch and
 * backup restore, the iPhone capture checklist, the Android SMS explainer and
 * the "ready" summary. English and Arabic keep identical keys; counts are
 * functions so Arabic gets singular, dual and plural forms.
 *
 * Truth rules:
 * - Android names READ_SMS "send and view"; Wafra never sends or replies, and
 *   one-time codes are skipped. SMS stay on the phone (they are not uploaded).
 * - The ready summary only reports what the ledger holds, and says so while
 *   imports are still being read.
 */
import { arabicCount } from '@/lib/settings-copy';

type Lang = 'en' | 'ar';

const en = {
  // Welcome
  switchLanguage: 'Switch the app to Arabic',
  restoreBackup: 'Restore from a backup',
  // iPhone capture checklist
  checklistFirstAlert: 'Wait for your next bank text',
  checklistFirstAlertDone: 'A bank text reached Wafra.',
  openShortcuts: 'Open Shortcuts',
  checklistDone: 'Done',
  checklistToDo: 'Not done yet',
  // Android SMS explainer, shown before the system prompt
  smsExplainerTitle: 'Read bank alerts',
  smsExplainerBody: 'Wafra reads bank SMS on this phone and ignores everything else.',
  smsExplainerSystemName: 'Android calls this permission “send and view SMS messages”.',
  smsExplainerNever: 'Wafra never sends or replies to messages, and it skips one-time codes. Your SMS are not uploaded.',
  smsExplainerContinue: 'Continue',
  smsExplainerNotNow: 'Not now',
  // Ready summary
  readyMonths: (months: number) => `${months} ${months === 1 ? 'month' : 'months'}`,
  readyTransactions: (count: number) => `${count} ${count === 1 ? 'transaction' : 'transactions'}`,
  readyMerchants: (count: number) => `${count} ${count === 1 ? 'merchant' : 'merchants'}`,
  whereItWent: 'Where it went',
  otherCategory: 'Everything else',
  foundRecurring: (subscriptions: number, bills: number) => {
    const parts: string[] = [];
    if (subscriptions > 0) parts.push(`${subscriptions} ${subscriptions === 1 ? 'subscription' : 'subscriptions'}`);
    if (bills > 0) parts.push(`${bills} ${bills === 1 ? 'bill' : 'bills'}`);
    return `Repeating payments found: ${parts.join(' and ')}. They are in Bills.`;
  },
  readyPending: 'Still reading your imports. These figures will grow as they finish.',
};

type OnboardingCopy = typeof en;

const ar: OnboardingCopy = {
  switchLanguage: 'تحويل التطبيق إلى الإنجليزية',
  restoreBackup: 'الاستعادة من نسخة احتياطية',
  checklistFirstAlert: 'انتظر رسالتك البنكية القادمة',
  checklistFirstAlertDone: 'وصلت رسالة بنكية إلى وفرة.',
  openShortcuts: 'افتح الاختصارات',
  checklistDone: 'تم',
  checklistToDo: 'لم يكتمل بعد',
  smsExplainerTitle: 'قراءة تنبيهات البنك',
  smsExplainerBody: 'يقرأ وفرة رسائل البنك على هذا الهاتف ويتجاهل كل ما عداها.',
  smsExplainerSystemName: 'يسمّي أندرويد هذا الإذن «إرسال رسائل SMS وعرضها».',
  smsExplainerNever: 'لا يرسل وفرة أي رسالة ولا يرد عليها، ويتجاوز رموز التحقق. لا تُرفع رسائلك.',
  smsExplainerContinue: 'متابعة',
  smsExplainerNotNow: 'ليس الآن',
  readyMonths: (months: number) => arabicCount(months, {
    one: 'شهر واحد', two: 'شهران', few: 'أشهر', many: 'شهرًا',
  }),
  readyTransactions: (count: number) => arabicCount(count, {
    one: 'عملية واحدة', two: 'عمليتان', few: 'عمليات', many: 'عملية',
  }),
  readyMerchants: (count: number) => arabicCount(count, {
    one: 'تاجر واحد', two: 'تاجران', few: 'تجار', many: 'تاجرًا',
  }),
  whereItWent: 'أين ذهب المال',
  otherCategory: 'كل ما عدا ذلك',
  foundRecurring: (subscriptions: number, bills: number) => {
    const parts: string[] = [];
    if (subscriptions > 0) {
      parts.push(arabicCount(subscriptions, { one: 'اشتراكًا واحدًا', two: 'اشتراكين', few: 'اشتراكات', many: 'اشتراكًا' }));
    }
    if (bills > 0) {
      parts.push(arabicCount(bills, { one: 'فاتورة واحدة', two: 'فاتورتين', few: 'فواتير', many: 'فاتورة' }));
    }
    return `دفعات متكررة وُجدت: ${parts.join(' و')}. ستجدها في الفواتير.`;
  },
  readyPending: 'لا يزال وفرة يقرأ ما استوردته. ستزيد هذه الأرقام عند اكتمال القراءة.',
};

export const ONBOARDING_COPY: Record<Lang, OnboardingCopy> = { en, ar };

export function onboardingCopy(language: string | null | undefined): OnboardingCopy {
  return language === 'ar' ? ar : en;
}
