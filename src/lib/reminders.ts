/**
 * What to remind the user about, and when — with no notification API in sight.
 *
 * This used to live inside `syncPaymentReminders`, tangled up with
 * expo-notifications, which meant the one part that can actually be wrong (the
 * dates) was the one part that could not be tested. It was wrong in two ways:
 *
 * - The due date was `new Date(year, month, bill.dueDay)`, unclamped. Due-day
 *   31 in February rolled forward to 2 or 3 March, so the "due today" reminder
 *   arrived days AFTER the bill was due — the opposite of what a reminder is.
 * - It used the raw calendar month while the rest of the app groups by the
 *   salary-day reporting month, so with a month start of the 25th the reminder
 *   set and the Bills screen disagreed about which month a bill sat in.
 *
 * Both are gone: the date comes from `billDueISO`, the same function the Bills
 * screen and Home's "leaving soon" list read.
 */
import { billsForMonth } from '@/lib/bills';
import { openDues } from '@/lib/cards';
import { formatAED, shiftISO } from '@/lib/format';
import { daysUntilNext, detectSubscriptions } from '@/lib/subscriptions';
import type { AppState } from '@/lib/types';

export type ReminderKind = 'bill' | 'card' | 'subscription';

export interface PaymentReminder {
  /** Stable across rebuilds: the same obligation on the same day is the same id. */
  id: string;
  kind: ReminderKind;
  /** ISO date the reminder fires on. */
  dateISO: string;
  /** That date at 09:00 local — what actually gets scheduled. */
  date: Date;
  title: string;
  body: string;
}

/** iOS caps pending local notifications at 64; this stays well inside it. */
export const MAX_REMINDERS = 24;

/** The reminder day at 09:00 local. Nobody wants a bill at midnight. */
function at9(dateISO: string): Date {
  return new Date(`${dateISO}T09:00:00`);
}

/**
 * Every reminder worth scheduling from the current state, soonest first and
 * capped. Pure: same state and `now` in, same list out.
 */
export function buildPaymentReminders(
  state: AppState,
  now: Date,
  limit = MAX_REMINDERS,
): PaymentReminder[] {
  const pending: PaymentReminder[] = [];
  const add = (
    id: string,
    kind: ReminderKind,
    dateISO: string,
    title: string,
    body: string,
  ) => {
    const date = at9(dateISO);
    // A reminder for a moment that has already passed is not a reminder.
    if (date.getTime() <= now.getTime()) return;
    pending.push({ id, kind, dateISO, date, title, body });
  };

  // Bills: the day before, and the day itself.
  const billTitles = new Set(state.bills.map((b) => b.title.toLowerCase()));
  for (const { bill, status, dueISO } of billsForMonth(
    state.bills,
    state.transactions,
    now,
  )) {
    // Paid covers both marked-paid and auto-reconciled-from-the-debit, so
    // this is the only check needed — the old second `paidMonths` guard below
    // the loop body was unreachable.
    if (status === 'paid') continue;
    for (const [offset, label] of [[-1, 'tomorrow'], [0, 'today']] as const) {
      add(
        `bill-${bill.id}-${offset}`,
        'bill',
        shiftISO(dueISO, offset),
        `${bill.title} due ${label}`,
        `${formatAED(bill.amountFils, { decimals: false })} · mark it paid in Wafra once done.`,
      );
    }
  }

  // Card dues: three days out, then the day itself. A statement needs the
  // lead time a bill does not — the money has to be moved.
  for (const { due, remainingFils } of openDues(state, now)) {
    const account = state.accounts.find((a) => a.id === due.accountId);
    const name = account?.name ?? 'Credit card';
    for (const [offset, label] of [[-3, 'in 3 days'], [0, 'today']] as const) {
      add(
        `card-${due.id}-${offset}`,
        'card',
        shiftISO(due.dueDate, offset),
        `${name} payment due ${label}`,
        `${formatAED(remainingFils, { decimals: false })} outstanding · minimum ${formatAED(due.minDueFils, { decimals: false })}.`,
      );
    }
  }

  // Subscriptions: the day before the next expected charge. Merchants already
  // tracked as bill reminders are skipped — one reminder per obligation.
  for (const sub of detectSubscriptions(state.transactions, state.notSubscriptions, now)) {
    if (sub.status === 'stopped') continue; // cancelled services need no renewal reminders
    if (billTitles.has(sub.title.toLowerCase())) continue;
    const days = daysUntilNext(sub, now);
    if (days < 1 || days > 30) continue;
    add(
      `sub-${sub.title.trim().toLowerCase()}`,
      'subscription',
      shiftISO(sub.nextExpectedISO, -1),
      `${sub.title} renews tomorrow`,
      `Around ${formatAED(sub.avgAmountFils, { decimals: false })} will be charged.`,
    );
  }

  pending.sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  return pending.slice(0, limit);
}
