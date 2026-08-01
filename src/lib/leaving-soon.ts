import type { IconName } from '@/components/ui/icon';
import { billsForMonth } from '@/lib/bills';
import { openDues } from '@/lib/cards';
import { getCategory } from '@/lib/categories';
import {
  activeSubscriptions,
  daysUntilNext,
  detectSubscriptions,
  type Subscription,
} from '@/lib/subscriptions';
import type { AppState } from '@/lib/types';

export type OutgoingKind = 'card' | 'bill' | 'subscription';

export interface Outgoing {
  id: string;
  kind: OutgoingKind;
  title: string;
  icon: IconName;
  amountFils: number;
  /** ISO date the money is expected to leave. */
  dateISO: string;
  /** Negative once the date has passed. */
  daysLeft: number;
  overdue: boolean;
  /** Due within three days — worth colouring, not yet worth alarming about. */
  urgent: boolean;
  /** Present for card dues, so a row can open the right payment sheet. */
  dueId?: string;
  subscription?: Subscription;
  billId?: string;
}

/**
 * Everything with a date on it, in one list: card statements, fixed bills and
 * detected subscriptions.
 *
 * Home used to carry these as three separate sections, which meant the
 * question "what leaves my account next" was answered three times in three
 * orders and never once as a single figure.
 */
export function leavingSoon(
  state: AppState,
  today: Date,
  opts: { withinDays?: number; kinds?: OutgoingKind[] } = {},
): Outgoing[] {
  const withinDays = opts.withinDays ?? 9;
  const kinds = new Set<OutgoingKind>(opts.kinds ?? ['card', 'bill', 'subscription']);
  const items: Outgoing[] = [];

  if (kinds.has('card')) {
    for (const { due, daysLeft, remainingFils } of openDues(state, today)) {
      const account = state.accounts.find((a) => a.id === due.accountId);
      items.push({
        id: `card-${due.id}`,
        kind: 'card',
        title: account?.name ?? 'Card payment',
        icon: 'wallet',
        amountFils: remainingFils,
        dateISO: due.dueDate,
        daysLeft,
        overdue: daysLeft < 0,
        urgent: daysLeft >= 0 && daysLeft <= 3,
        dueId: due.id,
      });
    }
  }

  if (kinds.has('bill')) {
    for (const { bill, status, dueISO, daysLeft } of billsForMonth(
      state.bills,
      state.transactions,
      today,
    )) {
      if (status === 'paid') continue;
      items.push({
        id: `bill-${bill.id}`,
        kind: 'bill',
        title: bill.title,
        icon: getCategory(bill.category).icon,
        amountFils: bill.amountFils,
        // The date bills.ts already worked out, rather than reconstructing it
        // from daysLeft — one derivation, one answer.
        dateISO: dueISO,
        daysLeft,
        overdue: daysLeft < 0,
        urgent: daysLeft >= 0 && daysLeft <= 3,
        billId: bill.id,
      });
    }
  }

  if (kinds.has('subscription')) {
    const subs = activeSubscriptions(detectSubscriptions(state.transactions, state.notSubscriptions, today));
    for (const sub of subs) {
      // A bill and a detected subscription can describe the same debit; the
      // bill wins, because the user set it up by hand.
      const key = sub.title.trim().toLowerCase();
      if (state.bills.some((b) => b.title.trim().toLowerCase() === key)) continue;
      const daysLeft = daysUntilNext(sub, today);
      items.push({
        id: `sub-${key}`,
        kind: 'subscription',
        title: sub.title,
        icon: getCategory(sub.category).icon,
        amountFils: sub.lastAmountFils,
        dateISO: sub.nextExpectedISO,
        daysLeft,
        overdue: daysLeft < 0,
        urgent: daysLeft >= 0 && daysLeft <= 3,
        subscription: sub,
      });
    }
  }

  return items
    .filter((i) => i.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft || b.amountFils - a.amountFils);
}

export function outgoingTotalFils(items: Outgoing[]): number {
  return items.reduce((sum, i) => sum + i.amountFils, 0);
}

/** "in 5 days", "today", "3 days late" — the phrase a row's meta line ends with. */
export function daysPhrase(daysLeft: number): string {
  if (daysLeft < 0) return `${-daysLeft} day${daysLeft === -1 ? '' : 's'} late`;
  if (daysLeft === 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  return `in ${daysLeft} days`;
}
