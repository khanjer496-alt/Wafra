/**
 * Words the Spending detail screens speak in design language E: one merchant,
 * the merchants directory and foreign activity, all on the clay band. Only
 * strings those screens did not already have live here; the rest stay in
 * merchant-spending-copy.ts and details-copy.ts. English and Arabic carry
 * identical keys (spending-details-copy.test.cjs).
 */

import type { FxRowSource } from '@/lib/fx-summary';

/** Left-to-right isolate: a figure keeps its order inside an Arabic sentence. */
const ltr = (value: string) => `\u2066${value}\u2069`;

export const spendingDetailsCopyTables = {
  en: {
    /** The merchant rule row's action, shown at its end. */
    change: 'Change',
    /** How one foreign row got its ledger amount. */
    rate: {
      bank: 'bank’s rate',
      reference: 'reference rate for that date',
      estimated: 'approximate rate for now',
    } as Record<FxRowSource, string>,
    /** A currency tile's second line: "34% · 3 payments". */
    tileMeta: (percent: number, payments: string) => `${percent}% · ${payments}`,
    /** Spoken for a currency tile. */
    tileSpoken: (code: string, original: string, local: string, percent: number, payments: string) =>
      `${code}. ${original}. ${local}. ${percent}%. ${payments}`,
  },
  ar: {
    change: 'تغيير',
    rate: {
      bank: 'سعر البنك',
      reference: 'السعر المرجعي لذلك اليوم',
      estimated: 'سعر تقريبي مؤقتاً',
    } as Record<FxRowSource, string>,
    tileMeta: (percent: number, payments: string) => `${ltr(`${percent}%`)} · ${payments}`,
    tileSpoken: (code: string, original: string, local: string, percent: number, payments: string) =>
      `${code}. ${ltr(original)}. ${ltr(local)}. ${ltr(`${percent}%`)}. ${payments}`,
  },
};

export type SpendingDetailsCopy = (typeof spendingDetailsCopyTables)['en'];

export function spendingDetailsCopy(language: string): SpendingDetailsCopy {
  return language === 'ar' ? spendingDetailsCopyTables.ar : spendingDetailsCopyTables.en;
}
