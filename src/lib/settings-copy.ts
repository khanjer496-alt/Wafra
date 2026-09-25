/**
 * Copy for Settings, its "Data and help" sub-screen, the erase dialog and the
 * App Lock screen. English and Arabic keep identical keys (a parity test pins
 * that); counts are functions so Arabic gets its singular, dual and plural.
 *
 * Truth rules this copy is held to:
 * - The backup is a plain JSON file. It is not encrypted, so it never says so.
 * - Trusted devices receive future relayed items only; nothing older is copied.
 * - The lock hides the ledger. The encryption key is not bound to the lock, so
 *   the lock screen never claims the ledger "stays encrypted until you unlock".
 */
import type { BiometricKind } from '@/lib/biometric-kind';

type Lang = 'en' | 'ar';

/**
 * Arabic count phrase, by the last two digits as the grammar counts them:
 * 1 and 2 alone take the singular and dual words; a last pair of 3–10 takes
 * the plural (5 أيام, 103 أيام); 11–99 the accusative singular (11 يومًا);
 * and a round hundred or 100+1/100+2 the genitive singular (100 يوم, 101 يوم).
 */
export function arabicCount(
  n: number,
  forms: { one: string; two: string; few: string; many: string; hundreds: string },
): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const mod100 = n % 100;
  if (mod100 >= 3 && mod100 <= 10) return `${n} ${forms.few}`;
  if (mod100 >= 11) return `${n} ${forms.many}`;
  return `${n} ${forms.hundreds}`;
}

const en = {
  // Settings
  capture: 'Capture',
  notifications: 'Notifications',
  appearance: 'Appearance',
  countryAndCurrency: 'Country and currency',
  privacyAndSecurity: 'Privacy and security',
  theme: 'Theme',
  proTitle: 'Wafra Pro',
  proTrialTitle: 'Wafra Pro · trial',
  proTrialBody: (days: number) =>
    `Automatic capture is included for ${days} more ${days === 1 ? 'day' : 'days'}.`,
  captureWorking: (time: string) => `Working · last message ${time}`,
  // "SMS entries", not "added by the reader": a bank message pasted into
  // Import is stored the same way and cannot be told apart.
  smsAllowed: (count: number) =>
    count === 0
      ? 'Allowed · no SMS entries this month yet'
      : `Allowed · ${count} SMS ${count === 1 ? 'entry' : 'entries'} this month`,
  optionalOff: 'Optional · catches alerts some banks only send in their app',
  trustedRow: 'Trusted devices & family',
  trustedDetail: 'Share new relayed items with phones you trust',
  dataAndHelp: 'Data and help',
  dataAndHelpDetail: 'Backup, exports, feedback and erase',
  // Data and help
  yourData: 'Your data',
  helpImprove: 'Help Wafra get better',
  about: 'About',
  advanced: 'Advanced',
  exportPdfDetail: 'Current month or everything',
  exportCsvDetail: 'Every transaction, for a spreadsheet',
  backupTitle: 'Back up to a file',
  backupDetail: 'A plain JSON file you keep. It is not encrypted.',
  restoreTitle: 'Restore from a backup',
  restoreDetail: 'Replaces what’s on this phone',
  improveCategories: 'Improve categories',
  merchantsToPlace: (count: number) =>
    count === 0
      ? 'Nothing waiting for a category'
      : `${count} ${count === 1 ? 'item' : 'items'} to place`,
  unreadAlerts: 'Unread alerts',
  unreadFormats: (count: number) =>
    count === 0
      ? 'No formats waiting'
      : `${count} ${count === 1 ? 'format' : 'formats'} Wafra couldn’t read`,
  versionFooter: (version: string) => `Wafra ${version} · No account · No ads`,
  // Erase dialog
  eraseTitle: 'Erase everything?',
  eraseKeep: 'Keep my data',
  eraseConfirm: 'Erase',
  // Lock
  lockTitle: {
    'face-id': 'Face ID lock',
    'touch-id': 'Touch ID lock',
    fingerprint: 'Fingerprint lock',
    face: 'Face unlock',
    iris: 'Iris lock',
    passcode: 'App lock',
  } satisfies Record<BiometricKind, string>,
  unlockWith: {
    'face-id': 'Unlock with Face ID',
    'touch-id': 'Unlock with Touch ID',
    fingerprint: 'Unlock with fingerprint',
    face: 'Unlock with your face',
    iris: 'Unlock with iris',
    passcode: 'Unlock',
  } satisfies Record<BiometricKind, string>,
  lockedTitle: 'Wafra is locked',
  lockedBody: 'Your balances stay hidden until you unlock.',
  lockedRetry: 'That didn’t work. Try again.',
  lockedFallback: 'Your phone passcode works too.',
};

type SettingsCopy = typeof en;

const ar: SettingsCopy = {
  capture: 'الالتقاط',
  notifications: 'الإشعارات',
  appearance: 'المظهر',
  countryAndCurrency: 'الدولة والعملة',
  privacyAndSecurity: 'الخصوصية والأمان',
  theme: 'السمة',
  proTitle: 'وفرة برو',
  proTrialTitle: 'وفرة برو · فترة تجريبية',
  proTrialBody: (days: number) =>
    `الالتقاط التلقائي متاح ${arabicCount(days, {
      one: 'ليوم واحد إضافي',
      two: 'ليومين إضافيين',
      few: 'أيام إضافية',
      many: 'يومًا إضافيًا',
      hundreds: 'يوم إضافي',
    }).replace(/^(\d+)/, 'لمدة $1')}.`,
  captureWorking: (time: string) => `يعمل · آخر رسالة ${time}`,
  smsAllowed: (count: number) =>
    count === 0
      ? 'مسموح · لا عمليات من الرسائل هذا الشهر بعد'
      : `مسموح · ${arabicCount(count, {
        one: 'عملية واحدة من الرسائل',
        two: 'عمليتان من الرسائل',
        few: 'عمليات من الرسائل',
        many: 'عملية من الرسائل',
        hundreds: 'عملية من الرسائل',
      })} هذا الشهر`,
  optionalOff: 'اختياري · يلتقط تنبيهات ترسلها بعض البنوك داخل تطبيقها فقط',
  trustedRow: 'الأجهزة الموثوقة والعائلة',
  trustedDetail: 'شارك العناصر الجديدة المنقولة مع هواتف تثق بها',
  dataAndHelp: 'البيانات والمساعدة',
  dataAndHelpDetail: 'النسخ الاحتياطي والتصدير والملاحظات والحذف',
  yourData: 'بياناتك',
  helpImprove: 'ساعد وفرة على التحسن',
  about: 'حول التطبيق',
  advanced: 'متقدم',
  exportPdfDetail: 'الشهر الحالي أو كل شيء',
  exportCsvDetail: 'كل العمليات، لجدول بيانات',
  backupTitle: 'نسخ احتياطي إلى ملف',
  backupDetail: 'ملف JSON عادي تحتفظ به. الملف غير مشفّر.',
  restoreTitle: 'الاستعادة من نسخة احتياطية',
  restoreDetail: 'يستبدل ما على هذا الهاتف',
  improveCategories: 'تحسين التصنيفات',
  merchantsToPlace: (count: number) =>
    count === 0
      ? 'لا شيء بانتظار التصنيف'
      : arabicCount(count, {
        one: 'عنصر واحد بانتظار التصنيف',
        two: 'عنصران بانتظار التصنيف',
        few: 'عناصر بانتظار التصنيف',
        many: 'عنصرًا بانتظار التصنيف',
        hundreds: 'عنصر بانتظار التصنيف',
      }),
  unreadAlerts: 'تنبيهات غير مقروءة',
  unreadFormats: (count: number) =>
    count === 0
      ? 'لا توجد صيغ بانتظار المراجعة'
      : arabicCount(count, {
        one: 'صيغة واحدة تعذّرت قراءتها',
        two: 'صيغتان تعذّرت قراءتهما',
        few: 'صيغ تعذّرت قراءتها',
        many: 'صيغة تعذّرت قراءتها',
        hundreds: 'صيغة تعذّرت قراءتها',
      }),
  versionFooter: (version: string) => `وفرة ${version} · بلا حساب · بلا إعلانات`,
  eraseTitle: 'حذف كل شيء؟',
  eraseKeep: 'احتفظ ببياناتي',
  eraseConfirm: 'حذف',
  lockTitle: {
    'face-id': 'قفل Face ID',
    'touch-id': 'قفل Touch ID',
    fingerprint: 'قفل البصمة',
    face: 'فتح القفل بالوجه',
    iris: 'قفل القزحية',
    passcode: 'قفل التطبيق',
  },
  unlockWith: {
    'face-id': 'افتح باستخدام Face ID',
    'touch-id': 'افتح باستخدام Touch ID',
    fingerprint: 'افتح باستخدام البصمة',
    face: 'افتح باستخدام وجهك',
    iris: 'افتح باستخدام القزحية',
    passcode: 'فتح',
  },
  lockedTitle: 'وفرة مقفل',
  lockedBody: 'تبقى أرصدتك مخفية حتى تفتح القفل.',
  lockedRetry: 'لم ينجح ذلك. حاول مجددًا.',
  lockedFallback: 'يمكنك أيضًا استخدام رمز قفل هاتفك.',
};

export const SETTINGS_COPY: Record<Lang, SettingsCopy> = { en, ar };

export function settingsCopy(language: string | null | undefined): SettingsCopy {
  return language === 'ar' ? ar : en;
}
