import { arCount } from '@/lib/details-copy';

/** "دفعة واحدة", "دفعتان", "5 دفعات", "14 دفعة", "100 دفعة". */
const arPayments = (n: number) => arCount(n, { one: 'دفعة واحدة', two: 'دفعتان', few: 'دفعات', many: 'دفعة' });

const DAYS_SHORT_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
// Arabic weekday names without the article, so every day keeps its own word
// (the first letters of "الأحد" and "الاثنين" are the same two).
const DAYS_SHORT_AR = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] as const;

/**
 * Words of the monthly/yearly recap story in design language E: full-bleed
 * band cards, headlines that say what the card shows. English and Arabic
 * carry identical keys (recap-copy.test.cjs).
 */
export const recapCopy = {
  en: {
    /** The story's spoken name, and its position. */
    recap: 'Wafra recap',
    position: (index: number, total: number) => `Wafra recap, ${index} of ${total}`,
    close: 'Close recap',
    done: 'Done',
    /** Cover: "Naser’s August 2026", or "Your August 2026" without a name. */
    coverTitle: (name: string | null, period: string) => name ? `${name}’s ${period}` : `Your ${period}`,
    spent: 'spent',
    spentLess: (percent: number, previous: string) => `spent, ${percent}% less than ${previous}`,
    spentMore: (percent: number, previous: string) => `spent, ${percent}% more than ${previous}`,
    spentSame: (previous: string) => `spent, about the same as ${previous}`,
    payments: 'Payments',
    merchants: 'Merchants',
    moneyIn: 'Money in',
    net: 'Net',
    /** Categories card. */
    categories: 'Where it went',
    topCategory: 'took the largest share',
    categoryShares: 'Share of spending by category',
    /** Where and when card. */
    merchant: 'Most spent at',
    paymentsCount: (n: number) => `${n} ${n === 1 ? 'payment' : 'payments'}`,
    timeTitle: 'Payments by time of day',
    timeHeadline: (bucket: string) => `${bucket} had the most payments`,
    timedBase: (timed: number) => `Of ${timed} ${timed === 1 ? 'payment' : 'payments'} that had a time.`,
    timeBar: (bucket: string, n: number) => `${bucket}: ${n} ${n === 1 ? 'payment' : 'payments'}`,
    morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night',
    /** Account card. */
    account: 'Most used card',
    accountFallback: 'Most used account',
    spentLabel: 'Spent',
    /** Rhythm card. */
    rhythm: 'When you spent',
    busiest: (day: string) => `${day} had the most payments`,
    weekdays: 'Payments by weekday',
    dayShort: (day: number) => DAYS_SHORT_EN[day] ?? '',
    noSpend: 'No-spend days',
    average: 'Average payment',
    favoriteTime: 'Busiest time of day',
    /** Highlight card. */
    biggest: 'Largest payment',
    monthly: 'Month by month',
    quietest: 'Quietest month',
    highest: 'Highest month',
    /** Last card. */
    finale: 'Your recap',
  },
  ar: {
    recap: 'ملخص وفرة',
    position: (index: number, total: number) => `ملخص وفرة، ${index} من ${total}`,
    close: 'إغلاق الملخص',
    done: 'تم',
    coverTitle: (name: string | null, period: string) => name ? `${period} · ${name}` : `ملخص ${period}`,
    spent: 'أنفقت',
    spentLess: (percent: number, previous: string) => `أنفقت، أقل بنسبة ${percent}% من ${previous}`,
    spentMore: (percent: number, previous: string) => `أنفقت، أكثر بنسبة ${percent}% من ${previous}`,
    spentSame: (previous: string) => `أنفقت، بقدر ${previous} تقريباً`,
    payments: 'الدفعات',
    merchants: 'المتاجر',
    moneyIn: 'الدخل',
    net: 'الصافي',
    categories: 'أين ذهب المال',
    topCategory: 'أخذت الحصة الأكبر',
    categoryShares: 'حصة كل فئة من الإنفاق',
    merchant: 'أعلى إنفاق لدى',
    paymentsCount: (n: number) => arPayments(n),
    timeTitle: 'الدفعات حسب وقت اليوم',
    timeHeadline: (bucket: string) => `${bucket} شهد أكبر عدد من الدفعات`,
    timedBase: (timed: number) => `الدفعات التي عُرف وقتها: ${timed}.`,
    timeBar: (bucket: string, n: number) => `${bucket}: ${arPayments(n)}`,
    morning: 'الصباح', afternoon: 'بعد الظهر', evening: 'المساء', night: 'الليل',
    account: 'البطاقة الأكثر استخداماً',
    accountFallback: 'الحساب الأكثر استخداماً',
    spentLabel: 'الإنفاق',
    rhythm: 'متى أنفقت',
    busiest: (day: string) => `يوم ${day} شهد أكبر عدد من الدفعات`,
    weekdays: 'الدفعات حسب أيام الأسبوع',
    dayShort: (day: number) => DAYS_SHORT_AR[day] ?? '',
    noSpend: 'أيام بلا إنفاق',
    average: 'متوسط الدفعة',
    favoriteTime: 'أكثر أوقات اليوم دفعاً',
    biggest: 'أكبر دفعة',
    monthly: 'شهراً بشهر',
    quietest: 'أهدأ شهر',
    highest: 'أعلى شهر',
    finale: 'ملخصك',
  },
} as const;

export type RecapWords = (typeof recapCopy)['en'] | (typeof recapCopy)['ar'];

export function recapWords(language: string): RecapWords {
  return language === 'ar' ? recapCopy.ar : recapCopy.en;
}
