/** The statement-file promise is identical across import methods and platforms. */
export const STATEMENT_PROCESSING_DISCLOSURE = {
  en: 'Statements are sent to Wafra’s import service, read, then deleted.',
  ar: 'تُرسل كشوف الحساب إلى خدمة الاستيراد في وفرة، وتُقرأ ثم تُحذف.',
} as const;

export const IMPORT_PROCESSING_DISCLOSURE = {
  en: `Pasted messages and SMS are read on this device. ${STATEMENT_PROCESSING_DISCLOSURE.en}`,
  ar: `تُقرأ الرسائل الملصقة ورسائل SMS على هذا الجهاز. ${STATEMENT_PROCESSING_DISCLOSURE.ar}`,
} as const;

export function importProcessingDisclosure(language: 'en' | 'ar', platform: string): string {
  if (platform === 'android') return IMPORT_PROCESSING_DISCLOSURE[language];
  if (platform === 'ios') return language === 'ar'
    ? `تُقرأ الرسائل الملصقة على هذا الآيفون. إذا كنت تستخدم اختصاراً قديماً يعمل عبر الإنترنت، فإنه يرسل الرسائل الملتقطة إلى خادم وفرة لقراءتها. ${STATEMENT_PROCESSING_DISCLOSURE.ar}`
    : `Pasted messages are read on this iPhone. If you use an older online Shortcut, it sends captured messages to Wafra’s server for reading. ${STATEMENT_PROCESSING_DISCLOSURE.en}`;
  return language === 'ar'
    ? `تُقرأ الرسائل الملصقة على هذا الجهاز. ${STATEMENT_PROCESSING_DISCLOSURE.ar}`
    : `Pasted messages are read on this device. ${STATEMENT_PROCESSING_DISCLOSURE.en}`;
}
