import { isCaptureTimestamp } from '@/lib/ios-capture-health';

/**
 * The capture status band's figure: the time the queue was last handled
 * (the figure) and which day that was (its qualifier). Pure; the receipt is
 * the native queue's own timestamp, never "now" standing in for a missing one.
 * Returns null when there is no real receipt.
 */
export function handledTimeParts(at: number | null, now: number, language: string, words: { today: string; yesterday: string }):
  { time: string; day: string } | null {
  if (!isCaptureTimestamp(at)) return null;
  const locale = language === 'ar' ? 'ar-AE' : 'en-GB';
  const when = new Date(at);
  const today = new Date(now);
  const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  try {
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(when);
    const day = dayKey(when) === dayKey(today) ? words.today
      : dayKey(when) === dayKey(yesterday) ? words.yesterday
        : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(when);
    return { time, day };
  } catch {
    return null;
  }
}
