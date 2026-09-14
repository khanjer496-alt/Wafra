/**
 * Copy for the one-tap tester diagnostics control.
 *
 * It lives here rather than beside the component for the reason
 * scripts/test/contracts.test.js enforces: a screen that writes its own
 * English sentence is a screen that ships untranslated, which is how strings
 * with translations already sitting in i18n.ts went out in English anyway.
 * `src/lib/supplement-copy.ts` is the same arrangement for the import screen.
 */
export const TESTER_DIAGNOSTICS_COPY = {
  en: {
    button: 'Send test diagnostics',
    busy: 'Collecting diagnostics…',
    detail: 'Sends one privacy-safe report to Wafra Cloudflare with performance, parser/category, SMS import and bank-notification health. Raw SMS, names, card/account numbers and exact amounts are not uploaded.',
    sentTitle: 'Diagnostics sent',
    sentBody: (id: string) => `Report ID: ${id}\n\nKeep this ID so the report can be retrieved from Cloudflare.`,
    failedTitle: 'Could not send diagnostics',
    failedBody: 'The report stayed on this phone. Check your connection and try again.',
  },
  ar: {
    button: 'إرسال تشخيص الاختبار',
    busy: 'جارٍ جمع التشخيص…',
    detail: 'يرسل تقريراً واحداً آمناً للخصوصية إلى Cloudflare يتضمن الأداء والمحلل والتصنيفات واستيراد SMS وحالة إشعارات البنوك. لا يتم رفع نص الرسائل أو الأسماء أو أرقام البطاقات/الحسابات أو المبالغ الدقيقة.',
    sentTitle: 'تم إرسال التشخيص',
    sentBody: (id: string) => `معرّف التقرير: ${id}\n\nاحتفظ بهذا المعرّف لاسترجاع التقرير من Cloudflare.`,
    failedTitle: 'تعذر إرسال التشخيص',
    failedBody: 'بقي التقرير على هذا الهاتف. تحقق من الاتصال وحاول مرة أخرى.',
  },
} as const;
