/**
 * Words the capture and import screens speak in design language E: capture
 * status, Apple Pay setup, statement import and reading past bank texts.
 * Only strings those screens did not already have live here; everything
 * older stays in its own copy module (details-copy, ios-apple-pay-setup,
 * supplement-copy, motion-android-copy, i18n). English and Arabic carry
 * identical keys (capture-band-copy.test.cjs).
 */

export const captureBandCopyTables = {
  en: {
    /** Capture status: the band figure's label, over the time. */
    lastHandledLabel: 'Last message handled',
    today: 'Today',
    yesterday: 'Yesterday',
    /** Capture status stat tiles (the queue label is details-copy's). */
    inReview: 'in Review',
    addedThisMonth: 'added from alerts this month',
    /** A numbered setup step, spoken with whether its gates are met. */
    step: (index: number, done: boolean) => done ? `Step ${index}, done` : `Step ${index}`,
  },
  ar: {
    lastHandledLabel: 'آخر رسالة عولجت',
    today: 'اليوم',
    yesterday: 'أمس',
    inReview: 'في المراجعة',
    addedThisMonth: 'أُضيفت من التنبيهات هذا الشهر',
    step: (index: number, done: boolean) => done ? `الخطوة ${index}، مكتملة` : `الخطوة ${index}`,
  },
};

export type CaptureBandCopy = (typeof captureBandCopyTables)['en'];

export function captureBandCopy(language: string): CaptureBandCopy {
  return language === 'ar' ? captureBandCopyTables.ar : captureBandCopyTables.en;
}
