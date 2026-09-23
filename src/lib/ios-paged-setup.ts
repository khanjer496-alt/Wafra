/** Source-free closed-beta setup contracts. Never enable from a route parameter. */
// This must match the name Apple actually installs from the canonical public
// iCloud record. Do not use a prettier alias here: Shortcuts' run URL resolves
// by installed name, which is how an older duplicate was executed on-device.
// The same record/name pair lives in IOS_HISTORY_SHORTCUT_INSTALLED_RECORDS
// (ios-history-setup.ts); this module stays dependency-free for its tests.
// Two verified paged records exist: the v2 iCloud record and the typed-date v4
// release asset. The run name follows whichever record the build installs.
const VERIFIED_PAGED_RECORDS: Readonly<Record<string, string>> = {
  'https://www.icloud.com/shortcuts/bc30c7ae89d6494c9ef0aea1a666d72d': 'Wafra-History-v2-typed-date.signed',
  'https://github.com/khanjer496-alt/Wafra/releases/download/ios-history-v4-20260919/Wafra-History-v4.signed.shortcut': 'Wafra-History-v4.signed',
  'https://github.com/khanjer496-alt/Wafra/releases/download/ios-history-v6-20260919/Wafra-History-v6.signed.shortcut': 'Wafra-History-v6.signed',
};
const configuredHistoryUrl = (): string | undefined => process.env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL;
export const PAGED_HISTORY_SHORTCUT_NAME: string =
  VERIFIED_PAGED_RECORDS[configuredHistoryUrl() ?? ''] ?? 'Wafra-History-v2-typed-date.signed';
export const PAGED_HISTORY_INSTALL_KEY = 'wafra/ios-paged-shortcut-confirmed/v4';
const VERIFIED_HISTORY_SHORTCUT_URL: string = configuredHistoryUrl() && VERIFIED_PAGED_RECORDS[configuredHistoryUrl()!]
  ? configuredHistoryUrl()!
  : 'https://www.icloud.com/shortcuts/bc30c7ae89d6494c9ef0aea1a666d72d';
// A build that installs the paged record runs the paged graph whether or not
// the beta flag is set: production shipped `5a0da9b5…` without the flag, so its
// users ran a paged Shortcut while the app still showed the legacy history UI
// (no saved-page progress, no resume, import review gated off). The paged
// surfaces therefore follow the configured record; the flag only widens them
// to builds testing an unverified URL.
const installsVerifiedPagedRecord = (): boolean =>
  process.env.EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL === VERIFIED_HISTORY_SHORTCUT_URL;
export const PAGED_HISTORY_INSTALL_URL: string | null =
  installsVerifiedPagedRecord() ? VERIFIED_HISTORY_SHORTCUT_URL : null;
export const pagedHistoryEnabled = (): boolean =>
  process.env.EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA === '1' || installsVerifiedPagedRecord();
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
    title: 'Import past messages', intro: 'Bring your past bank messages into Wafra. Review the results before saving.',
    install: 'Add the history Shortcut', installed: 'I added it — start import', start: 'Start history import', resume: 'Resume saved import', review: 'Review transactions',
    installHelp: 'Safari downloads the signed shortcut file. Open it from Downloads (the share icon, then Shortcuts) and tap Add Shortcut, then return here to start.',
    privacy: 'Apple asks before reading Messages. Bank alerts are checked locally; nothing is uploaded. Only transactions you approve enter your ledger.',
    runningHelp: 'Keep Shortcuts open and the iPhone unlocked. If it stops, return here and resume; your progress is saved for up to 24 hours.',
    counts: 'Messages checked', accepted: 'Readable', skipped: 'Unreadable or skipped',
    pending: 'History remains. Continue from the saved position.', completed: 'Your messages are ready. Review before saving.',
    refresh: 'Refresh progress', remove: 'Discard temporary import', confirm: 'Discard', keep: 'Keep saved progress',
    discardTitle: 'Discard this temporary import?', discardBody: 'This removes only this staged message history and saved position. Your existing transactions are unchanged.',
    error: 'Progress is unavailable or has expired. No transactions were added by this check. Retry without deleting your app data.',
    paused: 'History import paused before the next page could be saved. Your completed pages are still here. Try again, skip it for now, or continue using Wafra.',
    missing: 'Shortcuts is not available. Install Apple Shortcuts, then return here.', failed: 'The action could not finish. Your saved ledger is unchanged.',
    beta: 'Requires iOS 26 or later. Large message histories can take a while. If the import stops, return here to check your progress and continue.',
    back: 'Back to setup', again: 'Add Shortcut again', unavailable: 'Update Wafra to import past messages.',
  },
  ar: {
    title: 'استيراد الرسائل السابقة', intro: 'أضف رسائلك المصرفية السابقة إلى وفرة، وراجع النتائج قبل حفظها.',
    install: 'إضافة اختصار السجل', installed: 'أضفته — بدء الاستيراد', start: 'بدء استيراد السجل', resume: 'متابعة الاستيراد المحفوظ', review: 'مراجعة العمليات',
    installHelp: 'سيحمّل Safari ملف الاختصار الموقّع. افتحه من التنزيلات (أيقونة المشاركة ثم الاختصارات) واضغط إضافة الاختصار، ثم عد إلى هنا للبدء.',
    privacy: 'تطلب آبل إذنك قبل قراءة الرسائل. تُفحص التنبيهات المصرفية محلياً دون رفعها. تُحفظ في سجلك فقط العمليات التي توافق عليها.',
    runningHelp: 'اترك تطبيق الاختصارات مفتوحاً والآيفون غير مقفل. إذا توقف، عد إلى هنا للمتابعة. يُحفظ تقدمك لمدة تصل إلى 24 ساعة.',
    counts: 'الرسائل المفحوصة', accepted: 'قابلة للقراءة', skipped: 'غير مقروءة أو متجاوزة',
    pending: 'ما زالت هناك رسائل. تابع من الموضع المحفوظ.', completed: 'انتهت القراءة. راجع العمليات قبل الحفظ.',
    refresh: 'تحديث التقدّم', remove: 'حذف الاستيراد المؤقت', confirm: 'حذف', keep: 'الاحتفاظ بالتقدّم',
    discardTitle: 'حذف هذا الاستيراد المؤقت؟', discardBody: 'يحذف هذا السجل المؤقت وموضع المتابعة فقط. لا تتغير عملياتك المسجلة.',
    error: 'التقدّم غير متاح أو انتهت صلاحيته. لم تُضف عمليات بهذا الفحص. أعد المحاولة دون حذف بيانات التطبيق.',
    paused: 'توقف استيراد السجل قبل حفظ الدفعة التالية. ما زالت الدفعات المكتملة محفوظة. حاول مجدداً أو تخطَّها حالياً أو تابع استخدام وفرة.',
    missing: 'تطبيق الاختصارات غير متاح. ثبّت اختصارات آبل ثم عد إلى هنا.', failed: 'لم تكتمل الخطوة. لم يتغير سجلك المحفوظ.',
    beta: 'يتطلب iOS 26 أو أحدث. قد يستغرق سجل الرسائل الكبير بعض الوقت. إذا توقف الاستيراد، عد إلى هنا للتحقق من تقدمك والمتابعة.',
    back: 'العودة للإعداد', again: 'إضافة الاختصار مجدداً', unavailable: 'حدّث وفرة لاستيراد الرسائل السابقة.',
  },
};
