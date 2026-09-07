export const diagnosticCopy = {
  en: {
    title: 'Export data for diagnosis', intro: 'All recorded periods, including hidden accounts. Nothing is uploaded automatically.',
    warning: 'This file contains private merchant names, exact amounts, dates, notes, account details, bills, goals, category rules and diagnostic results. Share only with someone you trust. It is not a restore backup. Wafra does not read its signing keys, passwords or authentication-token stores for this export.',
    messages: 'Include readable bank messages',
    messageNote: 'Optional. Adds retained message text and, on Android, readable bank-money SMS with their current parser result. Personal messages, unknown senders and security codes are excluded. This can take time.',
    private: 'Message text is unavailable in Private Mode. Structured financial data can still be exported.',
    prepare: 'Prepare diagnostic file', share: 'Share diagnostic file', cancel: 'Cancel', ready: 'File ready. Wafra has not uploaded it.',
    busy: 'Preparing', failed: 'Export failed or was cancelled. No partial file was shared. Check available storage and message permission, then try again.',
    records: 'transactions', read: 'messages checked', noSource: 'Message text is off. The report still includes all stored transactions, categories, logo matches, rules and accounting checks.',
  },
  ar: {
    title: 'تصدير البيانات للتشخيص', intro: 'كل الفترات المسجلة بما فيها الحسابات المخفية. لا تُرفع البيانات تلقائياً.',
    warning: 'يتضمن الملف أسماء التجار والمبالغ الدقيقة والتواريخ والملاحظات وبيانات الحسابات والفواتير والأهداف وقواعد التصنيف ونتائج التشخيص. شاركه فقط مع شخص تثق به. ليس نسخة احتياطية للاستعادة. لا يشمل كلمات المرور أو مفاتيح التوقيع أو رموز المصادقة.',
    messages: 'تضمين الرسائل المصرفية المتاحة',
    messageNote: 'اختياري. يضيف نصوص الرسائل المحفوظة، وعلى أندرويد الرسائل المالية المصرفية المتاحة ونتيجة قراءتها الحالية. تُستبعد الرسائل الشخصية والمرسلون غير المعروفين ورموز الأمان. قد يستغرق ذلك وقتاً.',
    private: 'نصوص الرسائل غير متاحة في الوضع الخاص. يمكنك تصدير البيانات المالية المنظمة.',
    prepare: 'تحضير ملف التشخيص', share: 'مشاركة ملف التشخيص', cancel: 'إلغاء', ready: 'الملف جاهز. لم ترفع وفرة أي بيانات.',
    busy: 'جارٍ التحضير', failed: 'فشل التصدير أو تم إلغاؤه. لم تتم مشاركة ملف جزئي. تحقق من التخزين وإذن الرسائل ثم حاول مجدداً.',
    records: 'عملية', read: 'رسالة تم فحصها', noSource: 'نصوص الرسائل معطلة. يشمل التقرير جميع العمليات المسجلة والتصنيفات والشعارات والقواعد والفحوصات المحاسبية.',
  },
};
