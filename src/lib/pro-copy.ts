/**
 * Copy for the Pro screen's benefit list and free-forever note.
 *
 * The list may only name what Pro actually gates (`requiresPro` in
 * purchases.ts and the gated rows in Settings): automatic capture on both
 * platforms, and on Android the bank-app notification reader and the past-SMS
 * inbox import, which are the same "Wafra collects messages without being
 * asked" feature. Insights, subscriptions, statement imports, Apple Pay rows,
 * backup and exports are free, so they are never sold here, and no saving
 * percentage is shown: the store returns display strings, not numeric prices.
 */
type Lang = 'en' | 'ar';

const en = {
  notificationsTitle: 'Bank-app notifications',
  notificationsText: 'Alerts some banks only send inside their app are added too.',
  historyTitle: 'Past SMS on this phone',
  historyText: 'Bank texts already in your inbox fill in earlier months.',
  freeTitle: 'Always free',
  freeText: 'Your ledger, manual entries, pasted bank messages and statement imports never need Pro.',
  selected: 'Selected',
};

type ProCopy = typeof en;

const ar: ProCopy = {
  notificationsTitle: 'إشعارات تطبيقات البنوك',
  notificationsText: 'تُضاف أيضًا التنبيهات التي ترسلها بعض البنوك داخل تطبيقها فقط.',
  historyTitle: 'الرسائل السابقة على هذا الهاتف',
  historyText: 'رسائل البنك الموجودة في صندوق الوارد تملأ الأشهر السابقة.',
  freeTitle: 'مجاني دائمًا',
  freeText: 'سجلك والإدخال اليدوي ولصق رسائل البنك واستيراد الكشوف لا تحتاج برو أبدًا.',
  selected: 'محدد',
};

export const PRO_COPY: Record<Lang, ProCopy> = { en, ar };

export function proCopy(language: string | null | undefined): ProCopy {
  return language === 'ar' ? ar : en;
}
