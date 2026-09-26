/**
 * Words the checking screens speak in design language E: Transfers and its
 * review queue on the slate band, and Improve categories on the sand band.
 * Only strings those screens did not already have live here; Review's
 * one-at-a-time words stay in details-copy.ts and the transfer sheets in
 * transfer-review-copy.ts. English and Arabic carry identical keys
 * (review-band-copy.test.cjs).
 */

export const reviewBandCopyTables = {
  en: {
    /** The transfer queue's band headline: pairs plus single entries still unanswered. */
    toCheck: (n: number) => `${n} to check`,
    /** A pair card's two legs: "Out of Current account" / "Into Savings". */
    outOf: 'Out of',
    into: 'Into',
    /** Pairs the reconciler confirmed this month, both legs naming each other. */
    matchedThisMonth: 'Matched this month',
    /** Improve categories when bank-payment nicknames wait too: they are not merchants. */
    namesToPlace: (n: number) => n === 1 ? '1 name to place' : `${n} names to place`,
    /** The one line under the count. `entries` is already counted ("7 entries"). */
    placeLine: (entries: string) => `Wafra couldn’t place these yet. Your answers move their ${entries} and apply to future ones.`,
    /** A row's staged answer, spoken on the chip that holds it. */
    entriesMoved: (entries: string) => `${entries} will move`,
  },
  ar: {
    toCheck: (n: number) => `للمراجعة: ${n}`,
    outOf: 'من',
    into: 'إلى',
    matchedThisMonth: 'مطابقة هذا الشهر',
    namesToPlace: (n: number) => `أسماء تحتاج تصنيفاً: ${n}`,
    placeLine: (entries: string) => `لم يتمكن وفرة من تصنيفها بعد. تنقل إجاباتك ${entries} وتنطبق على القادمة أيضاً.`,
    entriesMoved: (entries: string) => `ستُنقل ${entries}`,
  },
} as const;

export type ReviewBandCopy = { [K in keyof (typeof reviewBandCopyTables)['en']]: (typeof reviewBandCopyTables)['en'][K] extends (...args: infer A) => string ? (...args: A) => string : string };

export function reviewBandCopy(language: string | null | undefined): ReviewBandCopy {
  return language === 'ar' ? reviewBandCopyTables.ar : reviewBandCopyTables.en;
}
