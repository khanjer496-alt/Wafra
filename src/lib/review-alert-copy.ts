/** Review presentation only; these labels never decide whether money can be filed. */
export const reviewAlertCopy = {
  en: {
    informationHint: 'For reference. This is not a transaction to add.',
    dismissAlert: 'Dismiss alert',
    dismissing: 'Dismissing alert…',
    retryDismiss: 'Retry dismissal',
    localAi: {
      pending: 'Checking the alert type on your device…',
      unavailable: 'No confident AI suggestion. You can review this alert manually.',
      suggestion: 'On-device AI suggestion',
      confirm: 'Check the transaction type, amount and direction in Review before adding.',
    },
  },
  ar: {
    informationHint: 'للاطلاع فقط. هذه ليست عملية لإضافتها.',
    dismissAlert: 'تجاهل التنبيه',
    dismissing: 'جارٍ تجاهل التنبيه…',
    retryDismiss: 'إعادة محاولة التجاهل',
    localAi: {
      pending: 'جارٍ تحليل نوع التنبيه على جهازك…',
      unavailable: 'لا يوجد اقتراح موثوق من الذكاء الاصطناعي. يمكنك مراجعة التنبيه يدوياً.',
      suggestion: 'اقتراح الذكاء الاصطناعي على الجهاز',
      confirm: 'تحقق من نوع العملية والمبلغ والاتجاه في المراجعة قبل الإضافة.',
    },
  },
} as const;
