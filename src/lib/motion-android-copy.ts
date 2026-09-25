import { getLanguage } from '@/lib/i18n';

/**
 * Copy for the redesign's motion and Android surfaces: the capture toast, the
 * in-app amount keypad on Add, and the live SMS import screen.
 *
 * English and Arabic carry identical keys (a parity test pins that). Numbers
 * arrive already formatted by the caller where they are money; plain counts
 * are formatted here per language. Arabic counted nouns follow the
 * 1 / 2 / 3–10 / 11+ agreement rules rather than one fixed form.
 */

const enCount = (value: number): string => value.toLocaleString('en-US');
const arCount = (value: number): string => value.toLocaleString('ar-AE');

/** "رسالة واحدة", "رسالتان", "٣ رسائل", "١١ رسالة". */
const arMessages = (count: number): string => {
  if (count === 1) return 'رسالة واحدة';
  if (count === 2) return 'رسالتان';
  const mod100 = count % 100;
  if (mod100 >= 3 && mod100 <= 10) return `${arCount(count)} رسائل`;
  return `${arCount(count)} رسالة`;
};

/** "عرض ترويجي واحد", "عرضان ترويجيان", "٣ عروض ترويجية", "١١ عرضاً ترويجياً". */
const arPromos = (count: number): string => {
  if (count === 1) return 'عرض ترويجي واحد';
  if (count === 2) return 'عرضان ترويجيان';
  const mod100 = count % 100;
  if (mod100 >= 3 && mod100 <= 10) return `${arCount(count)} عروض ترويجية`;
  return `${arCount(count)} عرضاً ترويجياً`;
};

const en = {
  /** The visible toast line; the amount sits beside it as its own figure. */
  captureAdded: (merchant: string, category: string) => `${merchant} added · ${category}`,
  /** What a screen reader hears: the whole fact, amount included. */
  captureAddedSpoken: (merchant: string, category: string, amount: string) =>
    `${merchant} added to ${category}, ${amount}`,

  keypadLabel: 'Amount keypad',
  keypadDecimal: 'Decimal point',
  keypadDelete: 'Delete last digit',
  keypadTypeInstead: 'Type the amount',
  keypadUseKeypad: 'Use the keypad',
  amountEmptySpoken: 'Amount, empty',
  amountSpoken: (currency: string, amount: string) => `Amount, ${currency} ${amount}`,
  currencyChange: (currency: string) => `Currency ${currency}. Change the currency of this entry`,
  suggestedCategories: 'Suggested categories',
  suggestedCategorySpoken: (label: string) => `Suggested category, ${label}`,
  categoryChipSpoken: (label: string) => `Category, ${label}. Change category`,
  dateChipSpoken: (label: string) => `Date, ${label}. Change date`,
  accountChipSpoken: (label: string) => `Account, ${label}. Change account`,
  accountChoose: 'Choose account',

  importChecked: 'checked',
  importFound: 'found',
  importPromosSkipped: 'promos skipped',
  importPromosSpoken: (count: number) =>
    `${enCount(count)} promotional message${count === 1 ? '' : 's'} skipped`,
  importJustFound: 'Just found',
  importFoundHeading: 'Found so far',
  importPercentOf: (total: number) => `of ${enCount(total)} message${total === 1 ? '' : 's'}`,
  importPercentSpoken: (percent: number, total: number) =>
    `${percent}% of ${enCount(total)} message${total === 1 ? '' : 's'} read`,
};

const ar: typeof en = {
  captureAdded: (merchant, category) => `تمت إضافة ${merchant} · ${category}`,
  captureAddedSpoken: (merchant, category, amount) =>
    `تمت إضافة ${merchant} إلى ${category}، ${amount}`,

  keypadLabel: 'لوحة إدخال المبلغ',
  keypadDecimal: 'الفاصلة العشرية',
  keypadDelete: 'حذف آخر رقم',
  keypadTypeInstead: 'اكتب المبلغ',
  keypadUseKeypad: 'استخدم لوحة الأرقام',
  amountEmptySpoken: 'المبلغ، فارغ',
  amountSpoken: (currency, amount) => `المبلغ، ${currency} ${amount}`,
  currencyChange: (currency) => `العملة ${currency}. تغيير عملة هذا الإدخال`,
  suggestedCategories: 'فئات مقترحة',
  suggestedCategorySpoken: (label) => `فئة مقترحة، ${label}`,
  categoryChipSpoken: (label) => `الفئة، ${label}. تغيير الفئة`,
  dateChipSpoken: (label) => `التاريخ، ${label}. تغيير التاريخ`,
  accountChipSpoken: (label) => `الحساب، ${label}. تغيير الحساب`,
  accountChoose: 'اختر الحساب',

  importChecked: 'تمت قراءتها',
  importFound: 'عُثر عليها',
  importPromosSkipped: 'عروض تم تخطيها',
  importPromosSpoken: (count) => count === 0 ? 'لم يتم تخطي أي عرض ترويجي' : `تم تخطي ${arPromos(count)}`,
  importJustFound: 'عُثر عليها الآن',
  importFoundHeading: 'ما عُثر عليه حتى الآن',
  importPercentOf: (total) => `من أصل ${arMessages(total)}`,
  importPercentSpoken: (percent, total) => `تمت قراءة ${arCount(percent)}٪ من أصل ${arMessages(total)}`,
};

export const motionAndroidCopyTables = { en, ar } as const;

export type MotionAndroidCopy = typeof en;

/** The table for `language`, read at render time (never at import time). */
export const motionAndroidCopy = (language: string = getLanguage()): MotionAndroidCopy =>
  language === 'ar' ? ar : en;
