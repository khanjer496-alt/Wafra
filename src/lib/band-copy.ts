/**
 * Words the design-language-E building blocks speak (src/components/ui/band*,
 * pattern-mosaic, the tab bar's pill). Screens bring their own copy; these
 * are only the labels a shared component needs to be accessible on its own.
 * English and Arabic carry identical keys (band-copy.test.cjs).
 */

/** Arabic count + noun: ١ ← singular, ٢ ← dual, ٣–١٠ ← plural, ١١+ ← singular accusative. */
function arabicCount(n: number, one: string, two: string, few: string, many: string): string {
  const shown = n.toLocaleString('ar-AE');
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${shown} ${few}`;
  return `${shown} ${many}`;
}

export const bandCopyTables = {
  en: {
    back: 'Back',
    close: 'Close',
    pattern: 'Your pattern',
    /** ShareBar's "+N more" after the three labelled segments. */
    shareMore: (count: number) => `+${count} more`,
    /** ShareBar spoken label: "Groceries 34%, Dining 18%, 5 other categories 32%". */
    shareOthers: (count: number, percent: string) =>
      `${count} other ${count === 1 ? 'category' : 'categories'} ${percent}`,
    shareOf: 'Share of',
    percent: (value: number) => `${value}%`,
    /** WeekTiles spoken label prefix. */
    lastDays: (count: number) => `Last ${count} ${count === 1 ? 'day' : 'days'}`,
    today: 'Today',
    /** DialLimit steppers. */
    lower: (step: string) => `Lower by ${step}`,
    raise: (step: string) => `Raise by ${step}`,
    limitPerMonth: 'per month',
    /** PinTimeline axis. */
    inDays: (days: number) => `+${days}`,
    dueIn: (days: number) => days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`,
    nextDays: (count: number) => `Next ${count} days`,
    morePins: (count: number) => `and ${count} more`,
  },
  ar: {
    back: 'رجوع',
    close: 'إغلاق',
    pattern: 'نمطك',
    shareMore: (count: number) => `+${count.toLocaleString('ar-AE')} أخرى`,
    shareOthers: (count: number, percent: string) =>
      `${arabicCount(count, 'فئة أخرى', 'فئتان أخريان', 'فئات أخرى', 'فئة أخرى')} ${percent}`,
    shareOf: 'حصة',
    percent: (value: number) => `${value.toLocaleString('ar-AE')}٪`,
    lastDays: (count: number) => `آخر ${arabicCount(count, 'يوم', 'يومين', 'أيام', 'يوماً')}`,
    today: 'اليوم',
    lower: (step: string) => `خفض بمقدار ${step}`,
    raise: (step: string) => `رفع بمقدار ${step}`,
    limitPerMonth: 'شهرياً',
    inDays: (days: number) => `+${days.toLocaleString('ar-AE')}`,
    dueIn: (days: number) => days === 0 ? 'اليوم' : days === 1 ? 'غداً'
      : `بعد ${arabicCount(days, 'يوم', 'يومين', 'أيام', 'يوماً')}`,
    nextDays: (count: number) => count === 1 ? 'خلال اليوم القادم' : count === 2 ? 'خلال اليومين القادمين'
      : `خلال الأيام الـ${count.toLocaleString('ar-AE')} القادمة`,
    morePins: (count: number) => `و${arabicCount(count, 'دفعة أخرى', 'دفعتان أخريان', 'دفعات أخرى', 'دفعة أخرى')}`,
  },
};

export type BandCopy = (typeof bandCopyTables)['en'];

export function bandCopy(language: string): BandCopy {
  return language === 'ar' ? bandCopyTables.ar : bandCopyTables.en;
}
