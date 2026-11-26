/**
 * Copy for the Pro screen's benefit list and free-forever note.
 *
 * The list may only name what Pro actually gates (`requiresPro` in
 * purchases.ts and the gated rows in Settings): automatic capture on both
 * platforms, and on Android the bank-app notification reader and the past-SMS
 * inbox import, which are the same "Wafra collects messages without being
 * asked" feature. Insights, subscriptions, statement imports, Apple Pay rows,
 * backup and exports are free, so they are never sold here. The plan rows show
 * storefront-formatted billed prices and periods, without savings claims.
 */
type Lang = 'en' | 'ar';

const en = {
  notificationsTitle: 'Bank-app notifications',
  notificationsText: 'Alerts some banks only send inside their app are added too.',
  historyTitle: 'Past SMS on this phone',
  historyText: 'Bank texts already in your inbox fill in earlier months.',
  freeTitle: 'Always free',
  freeText: 'Your ledger, manual entries, pasted bank messages, statement imports and backup never need Pro. The first 3 days include free automatic capture, and billing never starts automatically.',
  selected: 'Selected',
  // After a retry the store still returned no plan (the panel's own text says why; this says the retry ran).
  pricesStillUnavailable: 'Still no prices from the store',
  pricesStillUnavailableBody: 'The store did not send Wafra’s plans, so nothing can be bought right now. Check your connection and that this phone is signed in to the store, then try again.',
};

type ProCopy = typeof en;

const ar: ProCopy = {
  notificationsTitle: 'إشعارات تطبيقات البنوك',
  notificationsText: 'تُضاف أيضًا التنبيهات التي ترسلها بعض البنوك داخل تطبيقها فقط.',
  historyTitle: 'الرسائل السابقة على هذا الهاتف',
  historyText: 'رسائل البنك الموجودة في صندوق الوارد تملأ الأشهر السابقة.',
  freeTitle: 'مجاني دائمًا',
  freeText: 'سجلك والإدخال اليدوي ولصق رسائل البنك واستيراد الكشوف والنسخ الاحتياطي لا تحتاج برو أبدًا. أول ٣ أيام تشمل الالتقاط التلقائي المجاني، ولا تبدأ الفوترة تلقائياً.',
  selected: 'محدد',
  pricesStillUnavailable: 'ما زالت الأسعار غير متاحة من المتجر',
  pricesStillUnavailableBody: 'لم يرسل المتجر خطط وفرة، لذا لا يمكن الشراء الآن. تحقّق من الاتصال ومن تسجيل دخول هذا الهاتف إلى المتجر ثم حاول مجدداً.',
};

export const PRO_COPY: Record<Lang, ProCopy> = { en, ar };

export function proCopy(language: string | null | undefined): ProCopy {
  return language === 'ar' ? ar : en;
}
