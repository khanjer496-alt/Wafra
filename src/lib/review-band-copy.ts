/**
 * Words Improve categories speaks on the sand band in design language E that
 * it did not already have; Review's one-at-a-time words stay in
 * details-copy.ts and Transfers speaks transfer-activity-copy.ts. English and
 * Arabic carry identical keys (review-band-copy.test.cjs).
 */

export const reviewBandCopyTables = {
  en: {
    /** Improve categories when bank-payment nicknames wait too: they are not merchants. */
    namesToPlace: (n: number) => n === 1 ? '1 name to place' : `${n} names to place`,
    /** The one line under the count. `entries` is already counted ("7 entries"). */
    placeLine: (entries: string) => `No category yet. Answers move ${entries} and apply to future ones.`,
    /** A row's staged answer, spoken on the chip that holds it. */
    entriesMoved: (entries: string) => `${entries} will move`,
  },
  ar: {
    namesToPlace: (n: number) => `أسماء تحتاج تصنيفاً: ${n}`,
    placeLine: (entries: string) => `بلا تصنيف بعد. تنقل الإجابات ${entries} وتنطبق على القادمة أيضاً.`,
    entriesMoved: (entries: string) => `ستُنقل ${entries}`,
  },
} as const;

export type ReviewBandCopy = { [K in keyof (typeof reviewBandCopyTables)['en']]: (typeof reviewBandCopyTables)['en'][K] extends (...args: infer A) => string ? (...args: A) => string : string };

export function reviewBandCopy(language: string | null | undefined): ReviewBandCopy {
  return language === 'ar' ? reviewBandCopyTables.ar : reviewBandCopyTables.en;
}
