/** Presentation only. Import counters come from the durable history coordinator. */
export const ledgerLightCopy = {
  en: {
    reading: 'Reading SMS history', paused: 'History import paused', failed: 'Import interrupted', complete: 'History imported',
    checked: 'Messages checked', found: 'Alerts found',
    readingNote: 'You can use Wafra while messages are checked. Keep the app open to continue importing.',
    pausedNote: 'Your progress is saved. Resume to continue from the last saved page.',
    resume: 'Resume',
  },
  ar: {
    reading: 'قراءة سجل الرسائل', paused: 'استيراد السجل متوقف مؤقتاً', failed: 'تعذّر إكمال الاستيراد', complete: 'تم استيراد السجل',
    checked: 'رسائل تم فحصها', found: 'تنبيهات تم العثور عليها',
    readingNote: 'يمكنك استخدام وفرة أثناء فحص الرسائل. أبقِ التطبيق مفتوحاً لمتابعة الاستيراد.',
    pausedNote: 'تم حفظ تقدّمك. تابع الاستيراد من آخر صفحة محفوظة.',
    resume: 'متابعة',
  },
} as const;
