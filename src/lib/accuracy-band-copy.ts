import { arCount, enCount } from '@/lib/details-copy';

/**
 * Words Improve accuracy speaks on its sand band (design language E): the
 * count under the plain title and the coverage stat tiles. The coverage
 * sentences themselves, the share actions and the group names stay in
 * i18n.ts, where their contract tests read them. English and Arabic carry
 * identical keys (accuracy-band-copy.test.cjs).
 */
export const accuracyBandCopyTables = {
  en: {
    /** Under the title: how many message formats the list holds. */
    toCheck: (count: number): string => `${enCount(count, 'message format', 'message formats')} to check`,
    messagesRead: 'Messages read',
    shopsNamed: 'Shops named',
    categorised: 'Categorised',
    /** The denominator under a tile's figure: "of 505". */
    of: (total: number): string => `of ${total.toLocaleString('en-US')}`,
    tileSpoken: (label: string, count: number, total: number | null): string =>
      total === null ? `${label}: ${count}` : `${label}: ${count} of ${total}`,
  },
  ar: {
    toCheck: (count: number): string => `${arCount(count, { one: 'صيغة رسالة واحدة', two: 'صيغتا رسالة', few: 'صيغ رسائل', many: 'صيغة رسالة', other: 'صيغة رسالة' })} للمراجعة`,
    messagesRead: 'رسائل مقروءة',
    shopsNamed: 'متاجر مسمّاة',
    categorised: 'مصنّفة',
    of: (total: number): string => `من ${total.toLocaleString('en-US')}`,
    tileSpoken: (label: string, count: number, total: number | null): string =>
      total === null ? `${label}: ${count}` : `${label}: ${count} من ${total}`,
  },
};

export type AccuracyBandCopy = (typeof accuracyBandCopyTables)['en'];

export function accuracyBandCopy(language: string): AccuracyBandCopy {
  return language === 'ar' ? accuracyBandCopyTables.ar : accuracyBandCopyTables.en;
}
