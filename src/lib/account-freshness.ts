/**
 * How old an account's bank-reported balance is, in plain words.
 *
 * A balance a bank quoted three weeks ago is still the latest fact Wafra has,
 * but it is not "your balance" any more. Saying how old it is, and marking it
 * quiet after two weeks, keeps an old number from passing as a current one.
 * Accounts silent for 90+ days already move to the Inactive drawer; this covers
 * the stretch before that.
 */
export const QUIET_AFTER_DAYS = 14;

export interface AccountFreshness {
  label: string;
  /** No bank text for QUIET_AFTER_DAYS or more. */
  quiet: boolean;
}

const words = {
  en: {
    today: (time: string) => `Bank alert · today ${time}`,
    yesterday: 'Bank alert · yesterday',
    daysAgo: (n: number) => `Bank alert · ${n} days ago`,
    quiet: (n: number) => `No bank alert for ${n} days`,
  },
  ar: {
    today: (time: string) => `تنبيه البنك · اليوم ${time}`,
    yesterday: 'تنبيه البنك · أمس',
    daysAgo: (n: number) => `تنبيه البنك · قبل ${n} أيام`,
    quiet: (n: number) => `لا تنبيهات من البنك منذ ${n} يوماً`,
  },
} as const;

const localDay = (date: Date): number =>
  Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);

export function accountFreshness(snapshotTs: number, now: Date, language: string): AccountFreshness {
  const w = words[language === 'ar' ? 'ar' : 'en'];
  const at = new Date(snapshotTs);
  const days = Math.max(0, localDay(now) - localDay(at));
  if (days === 0) {
    const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    return { label: w.today(time), quiet: false };
  }
  if (days === 1) return { label: w.yesterday, quiet: false };
  if (days < QUIET_AFTER_DAYS) return { label: w.daysAgo(days), quiet: false };
  return { label: w.quiet(days), quiet: true };
}
