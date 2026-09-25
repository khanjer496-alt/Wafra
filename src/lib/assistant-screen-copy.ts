/**
 * Copy added to Ask Wafra by the redesign: the transaction count on the
 * evidence button, the compact on-device badge, and labels for the payment
 * rows and the monthly chart. English and Arabic keep identical keys.
 */
import { arabicCount } from '@/lib/settings-copy';

type Lang = 'en' | 'ar';

const en = {
  onThisPhone: 'On this phone',
  onThisPhoneA11y: 'Answers are calculated on this phone from your recorded transactions.',
  seeTransactions: (count: number) => `See ${count} ${count === 1 ? 'transaction' : 'transactions'}`,
  dueToday: 'today',
  dueIn: (days: number) => `in ${days} ${days === 1 ? 'day' : 'days'}`,
  dueLate: (days: number) => `${days} ${days === 1 ? 'day' : 'days'} late`,
  monthlyChartLabel: 'Recorded spending by month',
};

type AssistantScreenCopy = typeof en;

const ar: AssistantScreenCopy = {
  onThisPhone: 'على هذا الهاتف',
  onThisPhoneA11y: 'تُحسب الإجابات على هذا الهاتف من عملياتك المسجّلة.',
  seeTransactions: (count: number) => `عرض ${arabicCount(count, {
    one: 'عملية واحدة', two: 'عمليتين', few: 'عمليات', many: 'عملية',
  })}`,
  dueToday: 'اليوم',
  dueIn: (days: number) => `خلال ${arabicCount(days, { one: 'يوم واحد', two: 'يومين', few: 'أيام', many: 'يومًا' })}`,
  dueLate: (days: number) => `متأخر ${arabicCount(days, { one: 'يومًا واحدًا', two: 'يومين', few: 'أيام', many: 'يومًا' })}`,
  monthlyChartLabel: 'الإنفاق المسجّل حسب الشهر',
};

export const ASSISTANT_SCREEN_COPY: Record<Lang, AssistantScreenCopy> = { en, ar };

export function assistantScreenCopy(language: string | null | undefined): AssistantScreenCopy {
  return language === 'ar' ? ar : en;
}

/** Distinct transactions behind an answer's evidence groups. */
export function evidenceTransactionCount(evidence: readonly { transactionIds: readonly string[] }[] | undefined): number {
  const ids = new Set<string>();
  for (const group of evidence ?? []) for (const id of group.transactionIds) ids.add(id);
  return ids.size;
}
