import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * "Now", refreshed every time the app returns to the foreground.
 *
 * Tab screens stay mounted for the life of the process, so a `useMemo(() =>
 * new Date(), [])` on one of them is the date the app was OPENED, not today.
 * After midnight Bills filed "Mark paid" on yesterday's date and under the
 * previous month's key, Wallet's "this month" figures stopped moving, and a
 * due that had just become overdue still read as upcoming. Home already
 * refreshed its clock on resume; this is that behaviour, shared.
 *
 * The value only changes on an actual foreground return, so memos keyed on
 * it are not invalidated by ordinary renders.
 */
export function useToday(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(new Date());
    });
    return () => subscription.remove();
  }, []);
  return now;
}
