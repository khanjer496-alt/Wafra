/**
 * The end-of-day spend summary, with no notification API in sight.
 *
 * Same split as reminders.ts and for the same reason: the part that can be
 * wrong — which rows count, what the totals are, what the sentence says — is
 * the part that has to be testable, and anything importing expo-notifications
 * is not. notifications.ts schedules whatever this returns and decides
 * nothing.
 *
 * WHAT COUNTS. Exactly what Flow counts, through the same `isSpending` with
 * the same live-accounts and internal-transfer sets. A summary that disagreed
 * with the screen it summarises would be worse than no summary: a move between
 * the user's own accounts is not spending, and a AED 20,000 sweep announced as
 * a day's expenses is the single loudest way to get an app muted.
 *
 * WHEN IT SAYS NOTHING. A day with no spending gets no notification. "You
 * spent AED 0 today" is a push notification whose entire content is that
 * nothing happened, and the cost of sending it is that the next one — the one
 * that matters — is read less carefully.
 */
import { formatAED, monthKey } from '@/lib/format';
import { tf } from '@/lib/i18n';
import { internalTransferIds, isSpending, liveAccountIds } from '@/lib/ledger';
import type { AppState, Transaction } from '@/lib/types';

/** Rows named individually before the rest collapse into "+N more". */
export const SUMMARY_ROWS = 5;

export interface DailySummary {
  /** Total spent on the day, in fils. Always > 0 — see `buildDailySummary`. */
  totalFils: number;
  /** How many rows that total is made of. */
  count: number;
  title: string;
  body: string;
}

/**
 * The day's spending as a notification, or null when there is nothing to say.
 *
 * `dayISO` is the day being summarised, not "today" — the caller decides that,
 * and a test can ask for any day without moving the clock.
 */
export function buildDailySummary(state: AppState, dayISO: string): DailySummary | null {
  const live = liveAccountIds(state.accounts);
  const internal = internalTransferIds(state.transactions, live);

  const rows: Transaction[] = [];
  let totalFils = 0;
  for (const t of state.transactions) {
    if (t.date !== dayISO) continue;
    if (!isSpending(t, live, internal)) continue;
    rows.push(t);
    totalFils += t.amountFils;
  }
  if (rows.length === 0 || totalFils <= 0) return null;

  // Largest first. A summary read on a lock screen gets four seconds, and the
  // AED 2,400 row is the one worth those seconds — chronological order buries
  // it under three coffees.
  rows.sort((a, b) => b.amountFils - a.amountFils);

  const named = rows.slice(0, SUMMARY_ROWS);
  const rest = rows.length - named.length;
  const lines = named.map((t) =>
    tf('dailySummaryLine', { amount: formatAED(t.amountFils), merchant: t.title }),
  );
  if (rest > 0) {
    lines.push(tf('dailySummaryMore', { count: rest, s: rest === 1 ? '' : 's' }));
  }

  // The budget line, only when there is a budget to be against. Wafra's limits
  // are per category and monthly, so this is the month's progress, not the
  // day's — said plainly rather than implied, because a percentage with no
  // period attached is the kind of number a user reads as being about today.
  const budgeted = budgetProgress(state, dayISO, live, internal);
  if (budgeted) lines.push(budgeted);

  return {
    totalFils,
    count: rows.length,
    title: tf('dailySummaryTitle', {
      amount: formatAED(totalFils, { decimals: false }),
      count: rows.length,
      s: rows.length === 1 ? '' : 's',
    }),
    body: lines.join('\n'),
  };
}

/**
 * "AED 4,120 of AED 6,500 monthly limits used" — or null when the user has set
 * no limits, which is most users on day one.
 *
 * Spend is counted only in the categories that HAVE a limit. Comparing all
 * spending against the sum of a few limits is how a percentage over 100 stops
 * meaning anything: rent with no limit set would push every month past it.
 */
function budgetProgress(
  state: AppState,
  dayISO: string,
  live: Set<string>,
  internal: Set<string>,
): string | null {
  const limits = new Map(state.budgets.map((b) => [b.category, b.limitFils]));
  if (limits.size === 0) return null;
  const totalLimit = [...limits.values()].reduce((s, v) => s + v, 0);
  if (totalLimit <= 0) return null;

  const key = monthKey(dayISO);
  let spent = 0;
  for (const t of state.transactions) {
    if (monthKey(t.date) !== key) continue;
    if (!limits.has(t.category)) continue;
    if (!isSpending(t, live, internal)) continue;
    spent += t.amountFils;
  }
  return tf('dailySummaryBudget', {
    spent: formatAED(spent, { decimals: false }),
    limit: formatAED(totalLimit, { decimals: false }),
    percent: Math.round((spent / totalLimit) * 100),
  });
}
