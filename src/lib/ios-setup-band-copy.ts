/** Section headings for the notification setup sheet; proof wording stays in ios-notification-copy. */
const COPY = {
  en: { shortcut: 'Add and check the Shortcut', automation: 'Create the automation', delivery: 'Notification delivery' },
  ar: { shortcut: 'إضافة الاختصار وفحصه', automation: 'إنشاء الأتمتة', delivery: 'وصول الإشعارات' },
};
export const iosSetupBandCopy = (language: string) => COPY[language === 'ar' ? 'ar' : 'en'];
