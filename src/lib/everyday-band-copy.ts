/**
 * Words the everyday screens speak in design language E: Spending's band
 * (Categories · Compare · Calendar), Transactions, the entry and limit
 * sheets, and Add. Only strings those screens did not already have live
 * here; everything older stays in its own copy module. English and Arabic
 * carry identical keys (everyday-band-copy.test.cjs).
 */

export const everydayBandCopyTables = {
  en: {
    /** BandSegmented's spoken name on Spending. */
    spendingViews: 'Spending views',
    /** The band's period action, spoken with the period it shows. */
    choosePeriod: (period: string) => `Choose period, ${period}`,
    spentThisMonth: 'Spent this month',
    spentIn: (period: string) => `Spent in ${period}`,
    /** The running money month: "Day 25 of 30". */
    dayOf: (day: number, of: number) => `Day ${day} of ${of}`,
    /** A category row without a limit says so. */
    shareNoLimit: (share: string) => `${share} of spending · no limit`,
    nearLimit: 'near',
    overLimit: 'over',
    /** Compare's sentence on the band. `partial`: the period is still running. */
    compareMore: (amount: string, other: string, partial: boolean) =>
      partial ? `${amount} more than by this point in ${other}` : `${amount} more than in ${other}`,
    compareLess: (amount: string, other: string, partial: boolean) =>
      partial ? `${amount} less than by this point in ${other}` : `${amount} less than in ${other}`,
    compareSame: (other: string, partial: boolean) =>
      partial ? `About the same as by this point in ${other}` : `About the same as in ${other}`,
    /** The window both sides cover while the period runs. */
    compareWindow: (day: number) => day === 1 ? 'Day 1 of each month' : `Days 1–${day} of each month`,
    fixedLeftOut: 'rent and fixed costs left out',
    /** Calendar band. */
    calendarKey: 'Brighter tile, more spent',
    calendarRecent: 'Recent spending',
    calendarGrid: (period: string) => `Spending by day, ${period}`,
    /** Add's band. */
    amountLabel: 'Amount',
    suggested: 'Suggested',
    entryType: 'Entry type',
    merchantLabel: 'Merchant',
    /** Limit sheet. */
    monthlyLimit: 'Monthly limit',
    exactLimit: 'Exact amount',
  },
  ar: {
    spendingViews: 'طرق عرض الإنفاق',
    choosePeriod: (period: string) => `اختيار الفترة، ${period}`,
    spentThisMonth: 'الإنفاق هذا الشهر',
    spentIn: (period: string) => `الإنفاق في ${period}`,
    dayOf: (day: number, of: number) => `اليوم ${day} من ${of}`,
    shareNoLimit: (share: string) => `${share} من الإنفاق · بلا حد`,
    nearLimit: 'قريب من الحد',
    overLimit: 'فوق الحد',
    compareMore: (amount: string, other: string, partial: boolean) =>
      partial ? `\u2066${amount}\u2069 أكثر مما أنفقت حتى هذه المرحلة من ${other}` : `\u2066${amount}\u2069 أكثر مما أنفقت في ${other}`,
    compareLess: (amount: string, other: string, partial: boolean) =>
      partial ? `\u2066${amount}\u2069 أقل مما أنفقت حتى هذه المرحلة من ${other}` : `\u2066${amount}\u2069 أقل مما أنفقت في ${other}`,
    compareSame: (other: string, partial: boolean) =>
      partial ? `تقريباً مثل ما أنفقت حتى هذه المرحلة من ${other}` : `تقريباً مثل ما أنفقت في ${other}`,
    compareWindow: (day: number) => day === 1 ? 'اليوم الأول من كل شهر' : `الأيام 1–${day} من كل شهر`,
    fixedLeftOut: 'دون الإيجار والتكاليف الثابتة',
    calendarKey: 'كلما كان المربع أفتح كان الإنفاق أكبر',
    calendarRecent: 'أحدث المصروفات',
    calendarGrid: (period: string) => `الإنفاق اليومي، ${period}`,
    amountLabel: 'المبلغ',
    suggested: 'مقترح',
    entryType: 'نوع الحركة',
    merchantLabel: 'التاجر',
    monthlyLimit: 'الحد الشهري',
    exactLimit: 'المبلغ بالضبط',
  },
};

export type EverydayBandCopy = (typeof everydayBandCopyTables)['en'];

export function everydayBandCopy(language: string): EverydayBandCopy {
  return language === 'ar' ? everydayBandCopyTables.ar : everydayBandCopyTables.en;
}
