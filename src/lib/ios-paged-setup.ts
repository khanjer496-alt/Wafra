/** Source-free closed-beta setup contracts. Never enable from a route parameter. */
export const PAGED_HISTORY_SHORTCUT_NAME = 'Wafra History Import';
export const PAGED_HISTORY_INSTALL_KEY = 'wafra/ios-paged-shortcut-confirmed/v1';
const HOSTED_HISTORY_SHORTCUT_URL = 'https://wafra-app-azg.pages.dev/wafra-history-import.shortcut';
export const PAGED_HISTORY_INSTALL_URL: string | null =
  process.env.EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA === '1' &&
  process.env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL === HOSTED_HISTORY_SHORTCUT_URL
    ? HOSTED_HISTORY_SHORTCUT_URL
    : null;
export const pagedHistoryEnabled = (): boolean => process.env.EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA === '1';
export const pagedHistoryRunUrl = (): string =>
  `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(PAGED_HISTORY_SHORTCUT_NAME)}&x-cancel=${encodeURIComponent('wafra://ios-paging-beta')}&x-error=${encodeURIComponent('wafra://ios-paging-beta')}`;

export interface PagedHistoryProgress {
  sessionId: string;
  status: 'continue' | 'complete';
  checked: number;
  accepted: number;
  skipped: number;
  createdAtMs: number;
  expiresAtMs: number;
}
export function parsePagedHistoryProgress(raw: string | null, now = Date.now()): PagedHistoryProgress | null {
  if (raw === null) return null;
  if (typeof raw !== 'string' || raw.length > 8192) throw new Error('invalid_paged_status');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_paged_status');
  const row = value as Record<string, unknown>;
  if (typeof row.sessionId !== 'string' || !/^PAGED-[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/.test(row.sessionId) ||
    (row.status !== 'continue' && row.status !== 'complete') ||
    !['checked', 'accepted', 'skipped'].every(key => Number.isSafeInteger(row[key]) && Number(row[key]) >= 0 && Number(row[key]) <= 1_000_000) ||
    Number(row.accepted) + Number(row.skipped) !== row.checked ||
    typeof row.createdAtMs !== 'number' || !Number.isFinite(row.createdAtMs) || row.createdAtMs <= 0 || row.createdAtMs > now + 60_000 ||
    typeof row.expiresAtMs !== 'number' || !Number.isFinite(row.expiresAtMs) ||
    Math.abs(row.expiresAtMs - row.createdAtMs - 86_400_000) > 1 || row.expiresAtMs <= now) throw new Error('invalid_paged_status');
  return { sessionId: row.sessionId, status: row.status, checked: Number(row.checked), accepted: Number(row.accepted),
    skipped: Number(row.skipped), createdAtMs: row.createdAtMs, expiresAtMs: row.expiresAtMs };
}

export const pagedHistoryCopy = {
  en: {
    title: 'Import past messages', intro: 'One setup. Available history, read in small pages.',
    install: 'Add the history Shortcut', installed: 'I added it — start import', start: 'Start history import', resume: 'Resume saved import', review: 'Review transactions',
    installHelp: 'Download the signed Shortcut, open it from Safari Downloads, then tap Add Shortcut. Return here to start. This is a separate Shortcut from future-alert capture.',
    privacy: 'Apple asks before reading Messages. Bank alerts are checked locally; nothing is uploaded. Only transactions you approve enter your ledger.',
    runningHelp: 'Keep Shortcuts open and the iPhone unlocked. If it stops, return here and resume; confirmed pages are retained for up to 24 hours.',
    counts: 'Messages checked', accepted: 'Readable', skipped: 'Unreadable or skipped',
    pending: 'History remains. Continue from the saved position.', completed: 'Extraction finished. Review before saving.',
    refresh: 'Refresh progress', remove: 'Discard temporary import', confirm: 'Discard', keep: 'Keep saved progress',
    discardTitle: 'Discard this temporary import?', discardBody: 'This removes only this staged message history and saved position. Your existing transactions are unchanged.',
    error: 'Progress is unavailable or has expired. No transactions were added by this check. Retry without deleting your app data.',
    missing: 'Shortcuts is not available. Install Apple Shortcuts, then return here.', failed: 'The action could not finish. Your saved ledger is unchanged.',
    beta: 'Closed beta: this version checks available Messages on iOS 26 or later. If a boundary cannot be verified, it stops without claiming complete history. Large-inbox device testing is still in progress.',
    back: 'Back to setup', again: 'Add Shortcut again', unavailable: 'Update Wafra to the matching beta before importing. No diagnostic developer settings are needed.',
  },
  ar: {
    title: 'استيراد الرسائل السابقة', intro: 'إعداد واحد. قراءة السجل المتاح على دفعات صغيرة.',
    install: 'إضافة اختصار السجل', installed: 'أضفته — بدء الاستيراد', start: 'بدء استيراد السجل', resume: 'متابعة الاستيراد المحفوظ', review: 'مراجعة العمليات',
    installHelp: 'نزّل الاختصار الموقّع وافتحه من تنزيلات سفاري، ثم اضغط إضافة الاختصار. عد إلى هنا للبدء. هذا اختصار منفصل عن التقاط الرسائل الجديدة.',
    privacy: 'تطلب آبل إذنك قبل قراءة الرسائل. تُفحص التنبيهات المصرفية محلياً دون رفعها. تُحفظ في سجلك فقط العمليات التي توافق عليها.',
    runningHelp: 'اترك تطبيق الاختصارات مفتوحاً والآيفون غير مقفل. إذا توقف، عد إلى هنا للمتابعة. تُحفظ الدفعات المؤكدة لمدة تصل إلى 24 ساعة.',
    counts: 'الرسائل المفحوصة', accepted: 'قابلة للقراءة', skipped: 'غير مقروءة أو متجاوزة',
    pending: 'ما زالت هناك رسائل. تابع من الموضع المحفوظ.', completed: 'انتهت القراءة. راجع العمليات قبل الحفظ.',
    refresh: 'تحديث التقدّم', remove: 'حذف الاستيراد المؤقت', confirm: 'حذف', keep: 'الاحتفاظ بالتقدّم',
    discardTitle: 'حذف هذا الاستيراد المؤقت؟', discardBody: 'يحذف هذا السجل المؤقت وموضع المتابعة فقط. لا تتغير عملياتك المسجلة.',
    error: 'التقدّم غير متاح أو انتهت صلاحيته. لم تُضف عمليات بهذا الفحص. أعد المحاولة دون حذف بيانات التطبيق.',
    missing: 'تطبيق الاختصارات غير متاح. ثبّت اختصارات آبل ثم عد إلى هنا.', failed: 'لم تكتمل الخطوة. لم يتغير سجلك المحفوظ.',
    beta: 'نسخة تجريبية محدودة: تفحص الرسائل المتاحة على iOS 26 أو أحدث. إذا تعذر التحقق من حدود دفعة تتوقف دون الادعاء باكتمال السجل. اختبار السجلات الكبيرة على الأجهزة ما زال جارياً.',
    back: 'العودة للإعداد', again: 'إضافة الاختصار مجدداً', unavailable: 'حدّث وفرة إلى النسخة التجريبية المتوافقة قبل الاستيراد. لا تحتاج إلى إعدادات المطوّر.',
  },
};
