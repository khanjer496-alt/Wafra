/**
 * How old an account's reported balance is, and who reported it, in plain words.
 *
 * A balance a bank quoted three weeks ago is still the latest fact Wafra has,
 * but it is not "your balance" any more. Saying how old it is, and marking it
 * quiet after two weeks, keeps an old number from passing as a current one.
 * Accounts silent for 90+ days already move to the Inactive drawer; this covers
 * the stretch before that.
 *
 * A figure the user typed in ("Set today's balance") is theirs, not the bank's,
 * and is never labelled as a bank alert.
 */
import type { Account } from '@/lib/types';

export const QUIET_AFTER_DAYS = 14;

/** Who put the latest balance figure on an account. */
export type SnapshotOrigin = 'bank' | 'manual';

export interface AccountFreshness {
  label: string;
  /** No new figure for QUIET_AFTER_DAYS or more. */
  quiet: boolean;
}

/**
 * The origin of the account's current snapshot, or null when it has none.
 *
 * The user's figure counts as theirs only while it is still the snapshot: a
 * newer bank alert replaces `snapshotTs`, and the figure is the bank's again.
 */
export function snapshotOrigin(
  account: Pick<Account, 'snapshotTs' | 'manualSnapshotTs'>,
): SnapshotOrigin | null {
  if (account.snapshotTs === undefined) return null;
  return account.manualSnapshotTs !== undefined && account.manualSnapshotTs === account.snapshotTs
    ? 'manual'
    : 'bank';
}

/** "قبل يومين", "قبل ٣ أيام", "قبل ١١ يوماً" — Arabic counts agree with the noun. */
const arabicDaysAgo = (n: number): string =>
  n === 2 ? 'قبل يومين' : n >= 3 && n <= 10 ? `قبل ${n} أيام` : `قبل ${n} يوماً`;

const words = {
  en: {
    bank: {
      today: (time: string) => `Bank alert · today ${time}`,
      yesterday: 'Bank alert · yesterday',
      daysAgo: (n: number) => `Bank alert · ${n} days ago`,
      quiet: (n: number) => `No bank alert for ${n} days`,
    },
    manual: {
      today: (time: string) => `Set by you · today ${time}`,
      yesterday: 'Set by you · yesterday',
      daysAgo: (n: number) => `Set by you · ${n} days ago`,
      quiet: (n: number) => `Set by you ${n} days ago`,
    },
  },
  ar: {
    bank: {
      today: (time: string) => `تنبيه البنك · اليوم ${time}`,
      yesterday: 'تنبيه البنك · أمس',
      daysAgo: (n: number) => `تنبيه البنك · ${arabicDaysAgo(n)}`,
      quiet: (n: number) => `لا تنبيهات من البنك منذ ${n} يوماً`,
    },
    manual: {
      today: (time: string) => `أدخلته بنفسك · اليوم ${time}`,
      yesterday: 'أدخلته بنفسك · أمس',
      daysAgo: (n: number) => `أدخلته بنفسك · ${arabicDaysAgo(n)}`,
      quiet: (n: number) => `أدخلته بنفسك ${arabicDaysAgo(n)}`,
    },
  },
} as const;

const localDay = (date: Date): number =>
  Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);

export function accountFreshness(
  snapshotTs: number,
  now: Date,
  language: string,
  origin: SnapshotOrigin = 'bank',
): AccountFreshness {
  const w = words[language === 'ar' ? 'ar' : 'en'][origin];
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

/** The freshness line for an account's own snapshot, or null when it has none. */
export function accountSnapshotFreshness(
  account: Pick<Account, 'snapshotTs' | 'manualSnapshotTs'>,
  now: Date,
  language: string,
): AccountFreshness | null {
  const origin = snapshotOrigin(account);
  if (origin === null || account.snapshotTs === undefined) return null;
  return accountFreshness(account.snapshotTs, now, language, origin);
}
