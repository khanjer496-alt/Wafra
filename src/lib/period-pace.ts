/**
 * "Day X of Y" for a running money month. The caller passes the period's own
 * first and last covered dates (monthStartISO / monthEndISO, which follow a
 * salary-day month start), never the calendar month. Null when today is not
 * inside the period, so a past or future month never shows a pace.
 */
const dayNumber = (iso: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const value = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(value) ? Math.round(value / 86_400_000) : null;
};

export function periodDayProgress(startISO: string, endISO: string, todayISO: string): { day: number; of: number } | null {
  const start = dayNumber(startISO);
  const end = dayNumber(endISO);
  const today = dayNumber(todayISO);
  if (start === null || end === null || today === null || end < start) return null;
  if (today < start || today > end) return null;
  return { day: today - start + 1, of: end - start + 1 };
}
