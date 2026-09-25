/**
 * Small, testable facts behind the Settings row subtitles.
 *
 * Each helper answers from data the app already holds and returns null (or a
 * zero) when that data is absent, so a subtitle never invents activity.
 */
import type { Transaction } from '@/lib/types';

/** Epoch-ms sanity bound shared with ios-capture-health. */
const MAX_TIMESTAMP = 8_640_000_000_000_000;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function localMonthKey(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/**
 * SMS-sourced entries whose bank date falls in the current local calendar
 * month. Bank-app notifications (`viaPush`) and statement rows (PDF/CSV/email
 * uploads) share `source: 'sms'` and are excluded. A bank message pasted into
 * Import is stored exactly like one the reader found, so it is counted too —
 * which is why the row says "SMS entries", not "added by the reader".
 */
export function androidSmsAddedThisMonth(
  transactions: readonly Pick<Transaction, 'source' | 'viaPush' | 'captureSource' | 'statementImportId' | 'date'>[],
  now: Date,
): number {
  const month = localMonthKey(now);
  let count = 0;
  for (const tx of transactions) {
    if (tx.source !== 'sms' || tx.viaPush || tx.statementImportId) continue;
    if (tx.captureSource !== undefined) continue;
    if (typeof tx.date === 'string' && tx.date.startsWith(month)) count += 1;
  }
  return count;
}

/**
 * When the iPhone capture queue last handled a message, as a compact label:
 * "09:41" today, otherwise "24 Sep". Null when the native status never
 * recorded a time (older builds), so the row falls back to its plain status.
 */
export function captureLastHandledLabel(
  lastHandledAt: number | null | undefined,
  now: Date,
  language: string,
): string | null {
  if (typeof lastHandledAt !== 'number' || !Number.isFinite(lastHandledAt) ||
    lastHandledAt <= 0 || lastHandledAt > MAX_TIMESTAMP) return null;
  const at = new Date(lastHandledAt);
  const sameDay = at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  const locale = language === 'ar' ? 'ar-AE' : 'en-GB';
  try {
    return new Intl.DateTimeFormat(locale, sameDay
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : { day: 'numeric', month: 'short' }).format(at);
  } catch {
    return sameDay ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : null;
  }
}
