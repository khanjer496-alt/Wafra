import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

const sameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * "Now", refreshed every time the app returns to the foreground.
 *
 * Use this only for text finer than a day ("scanned 5 min ago"). Its value is
 * a new object on every resume, so a memo keyed on it recomputes on every
 * app switch.
 */
export function useResumeClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(new Date());
    });
    return () => subscription.remove();
  }, []);
  return now;
}

/**
 * Today's date, re-read every time the app returns to the foreground.
 *
 * Tab screens stay mounted for the life of the process, so a `useMemo(() =>
 * new Date(), [])` on one of them is the date the app was OPENED, not today.
 * After midnight Bills filed "Mark paid" on yesterday's date and under the
 * previous month's key, Wallet's "this month" figures stopped moving, and a
 * due that had just become overdue still read as upcoming. Home already
 * refreshed its clock on resume; this is that behaviour, shared.
 *
 * The object changes only when the local calendar day does. Every consumer
 * reads it at day granularity (ISO date, month key, days until), and handing
 * back a fresh Date on each resume invalidated their ledger-wide memos on
 * every app switch: Wallet, Bills and Cards re-walked the ledger (or, while
 * frozen behind another tab, on the next tab focus) although the answer could
 * not have changed. Time-of-day text uses `useResumeClock`.
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      const now = new Date();
      setToday((previous) => (sameLocalDay(previous, now) ? previous : now));
    });
    return () => subscription.remove();
  }, []);
  return today;
}
