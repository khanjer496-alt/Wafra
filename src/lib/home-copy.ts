/**
 * Home v3's words: the Spent hero, its trend, the transactions list and the
 * "Needs you" pill. English and Arabic carry the same keys
 * (home-hero.test.cjs checks the parity). Amounts arrive already formatted.
 */
import type { TrendDirection } from '@/lib/home-hero';

const arCount = (count: number, one: string, two: string, few: (n: number) => string, many: (n: number) => string) =>
  count === 1 ? one : count === 2 ? two : count <= 10 ? few(count) : many(count);

const en = {
  spentIn: (month: string) => `Spent in ${month}`,
  /** Between a name and its amount when spoken. */
  comma: ',',
  inLabel: 'In',
  netLabel: 'Net',
  /** The chip's qualifier, after the percentage. */
  versusSameDays: (month: string) => `vs same days of ${month}`,
  versusMonth: (month: string) => `vs ${month}`,
  aboutSame: 'About the same',
  spokenTrend: (direction: TrendDirection, percent: number, month: string, partial: boolean) => {
    const other = partial ? `the same days of ${month}` : month;
    return direction === 'same' ? `about the same as ${other}`
      : `${direction === 'up' ? 'up' : 'down'} ${Math.abs(percent)}% versus ${other}`;
  },
  spokenHero: (spent: string, trend: string | null, income: string, net: string) =>
    [spent + (trend ? `, ${trend}` : ''), `In ${income}`, `Net ${net}`].join('. '),
  showMonth: (month: string) => `Show ${month}`,
  backTo: (month: string) => `Back to ${month}`,
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  heroHintCollapsed: 'Shows spending by category. Swipe sideways, or use the arrow, for the other month.',
  heroHintExpanded: 'Hides spending by category.',
  byCategory: 'Spending by category',
  noSpendingYet: 'Nothing spent yet this month.',
  transactions: 'Transactions',
  seeAll: 'See all',
  seeAllHint: 'Opens every transaction',
  needsYou: 'Needs you',
  /** The pill's one visible line; the full sentence above is what it speaks. */
  needShort: {
    trackingPaused: 'Tracking paused',
    trackingStopped: 'Messages stopped',
    trackingOff: 'Tracking off',
    cardOverdue: 'Card payment overdue',
  },
  dismiss: 'Dismiss',
  trackingPaused: 'Tracking is paused',
  trackingStopped: 'Bank messages stopped arriving',
  trackingOff: 'Tracking is off',
  cardOverdue: (title: string) => `${title} payment overdue`,
  transfersToAnswer: (count: number) => `${count} ${count === 1 ? 'transfer' : 'transfers'} to answer`,
  limitsOver: (count: number) => `${count} ${count === 1 ? 'limit' : 'limits'} over`,
  needHint: {
    tracking: 'Opens tracking setup',
    card: 'Opens the card payment',
    transfers: 'Opens Transfers',
    limit: 'Opens your limits',
  },
};

type HomeCopy = typeof en;

const ar: HomeCopy = {
  spentIn: (month) => `الإنفاق في ${month}`,
  comma: '،',
  inLabel: 'الدخل',
  netLabel: 'الصافي',
  versusSameDays: (month) => `مقارنة بنفس أيام ${month}`,
  versusMonth: (month) => `مقارنة بـ${month}`,
  aboutSame: 'تقريبًا كما هو',
  spokenTrend: (direction, percent, month, partial) => {
    const other = partial ? `بنفس أيام ${month}` : `بـ${month}`;
    return direction === 'same' ? `تقريبًا كما هو مقارنة ${other}`
      : `${direction === 'up' ? 'أعلى' : 'أقل'} بنسبة ${Math.abs(percent)}% مقارنة ${other}`;
  },
  spokenHero: (spent, trend, income, net) =>
    [spent + (trend ? `، ${trend}` : ''), `الدخل ${income}`, `الصافي ${net}`].join('. '),
  showMonth: (month) => `عرض ${month}`,
  backTo: (month) => `العودة إلى ${month}`,
  previousMonth: 'الشهر السابق',
  nextMonth: 'الشهر التالي',
  heroHintCollapsed: 'يعرض الإنفاق حسب الفئة. اسحب جانبًا، أو استخدم السهم، لعرض الشهر الآخر.',
  heroHintExpanded: 'يخفي الإنفاق حسب الفئة.',
  byCategory: 'الإنفاق حسب الفئة',
  noSpendingYet: 'لا إنفاق بعد هذا الشهر.',
  transactions: 'المعاملات',
  seeAll: 'عرض الكل',
  seeAllHint: 'يفتح كل المعاملات',
  needsYou: 'يحتاج إليك',
  needShort: {
    trackingPaused: 'التتبع متوقف',
    trackingStopped: 'توقفت الرسائل',
    trackingOff: 'التتبع غير مفعّل',
    cardOverdue: 'دفعة بطاقة متأخرة',
  },
  dismiss: 'إخفاء',
  trackingPaused: 'التتبع متوقف مؤقتًا',
  trackingStopped: 'توقف وصول رسائل البنك',
  trackingOff: 'التتبع غير مفعّل',
  cardOverdue: (title) => `دفعة ${title} متأخرة`,
  transfersToAnswer: (count) => arCount(count, 'تحويل واحد ينتظر ردك', 'تحويلان ينتظران ردك',
    (n) => `${n} تحويلات تنتظر ردك`, (n) => `${n} تحويلًا ينتظر ردك`),
  limitsOver: (count) => arCount(count, 'تجاوزت حدًا واحدًا', 'تجاوزت حدّين',
    (n) => `تجاوزت ${n} حدود`, (n) => `تجاوزت ${n} حدًا`),
  needHint: {
    tracking: 'يفتح إعداد التتبع',
    card: 'يفتح دفعة البطاقة',
    transfers: 'يفتح التحويلات',
    limit: 'يفتح حدودك',
  },
};

export const HOME_COPY: Record<'en' | 'ar', HomeCopy> = { en, ar };

export function homeCopy(language: string | null | undefined): HomeCopy {
  return language === 'ar' ? ar : en;
}
