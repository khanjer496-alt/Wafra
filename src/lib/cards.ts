import { toISODate } from '@/lib/format';
import type { Account, AppState, CardDue } from '@/lib/types';

export type DueStatus = 'overdue' | 'urgent' | 'upcoming' | 'settled';

export interface DueWithStatus {
  due: CardDue;
  status: DueStatus;
  /** Days until dueDate; negative when overdue. */
  daysLeft: number;
  /** What is still owed on this statement after payments. */
  remainingFils: number;
  /** True while payments are below a minimum the bank actually stated. */
  belowMinimum: boolean;
  /** False when the bank never stated a minimum, so `due.minDueFils` is a
   *  fallback estimate rather than a figure. Never present it as one. */
  minimumKnown: boolean;
  /** Long overdue and kept only because no later statement replaced it. */
  stale: boolean;
}

/**
 * Payments spread across an account's statements, each payment counted once.
 *
 * A due's matching window (~40 days before to 20 after) is wider than the
 * monthly statement cycle, so consecutive statements overlap. Crediting every
 * payment inside the window to each due independently meant one payment could
 * settle two statements at once — the second month's balance silently
 * vanished from the app while it was still owed.
 *
 * Payments are walked oldest-first and poured into the oldest statement they
 * could belong to, so an overpayment still spills onto the next one.
 */
function allocatePayments(
  state: AppState,
  accountId: string,
  /** Included even when absent from state — callers may hold a due directly. */
  target?: CardDue,
): Map<string, number> {
  const known = state.cardDues.filter((d) => d.accountId === accountId);
  const dues = (target && !known.some((d) => d.id === target.id) ? [...known, target] : known)
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  // Manual "Mark paid" amounts are already attributed to their own statement.
  const allocated = new Map(dues.map((d) => [d.id, d.paidFils] as const));

  const payments = state.transactions
    .filter((t) => t.isTransfer && t.type === 'income' && t.accountId === accountId)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const payment of payments) {
    let left = payment.amountFils;
    for (const due of dues) {
      if (left <= 0) break;
      // Statement date approximated as ~25 days before the due date.
      if (payment.date < shiftISO(due.dueDate, -40)) continue;
      if (payment.date > shiftISO(due.dueDate, 20)) continue;
      const already = allocated.get(due.id) ?? 0;
      const outstanding = due.totalDueFils - already;
      if (outstanding <= 0) continue;
      const take = Math.min(outstanding, left);
      allocated.set(due.id, already + take);
      left -= take;
    }
  }
  return allocated;
}

/**
 * What has been paid toward a due: explicit paidFils (manual "Mark paid")
 * plus its share of the card-payment transfers on that account.
 */
export function duePaidFils(state: AppState, due: CardDue): number {
  return allocatePayments(state, due.accountId, due).get(due.id) ?? due.paidFils;
}

function shiftISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function dueWithStatus(
  state: AppState,
  due: CardDue,
  today: Date,
  /** Set by openDues, which knows whether a later statement superseded this. */
  stale = false,
): DueWithStatus {
  const todayISO = toISODate(today);
  const paid = duePaidFils(state, due);
  const remainingFils = Math.max(0, due.totalDueFils - paid);
  const msPerDay = 86400000;
  const daysLeft = Math.round(
    (new Date(`${due.dueDate}T12:00:00`).getTime() - new Date(`${todayISO}T12:00:00`).getTime()) /
      msPerDay,
  );

  let status: DueStatus;
  if (due.settledAt || remainingFils === 0) status = 'settled';
  else if (daysLeft < 0) status = 'overdue';
  else if (daysLeft <= 3) status = 'urgent';
  else status = 'upcoming';

  // A minimum the bank never stated is an estimate, and "you are under your
  // minimum due" is a claim about the bank's terms. Making that claim from a
  // percentage the app invented tells the user they are about to incur a late
  // fee on a figure no bank ever quoted, so an estimate never triggers it.
  const minimumKnown = !due.minDueEstimated;

  return {
    due,
    status,
    daysLeft,
    remainingFils,
    belowMinimum: minimumKnown && paid < due.minDueFils && status !== 'settled',
    minimumKnown,
    stale: stale && status !== 'settled',
  };
}

/** How long an unpaid due stays actionable before it needs a reason to stay. */
const STALE_OVERDUE_DAYS = 30;

/**
 * Open dues (not settled, on credit cards), most urgent first.
 *
 * A month-old unpaid statement used to be dropped outright, on the theory that
 * the bank had since issued a new one that replaced it. That theory is only
 * true when a newer statement actually exists — and when it did not, the app
 * quietly stopped showing a debt the user still owed, with no trace anywhere
 * that it had decided to stop mentioning it.
 *
 * So the supersession is now checked rather than assumed: an old statement
 * goes only when a later one on the same card has taken over. Otherwise it
 * survives, flagged `stale`, and the caller can present it as old news instead
 * of the app pretending it never happened. Cards that have gone silent
 * altogether are handled by `isInactiveAccount`, not by hiding their debts.
 */
export function openDues(state: AppState, today: Date): DueWithStatus[] {
  const creditIds = new Set(
    state.accounts.filter((a) => a.cardType === 'credit' && !a.archived).map((a) => a.id),
  );
  // How a card is identified, since two account rows can describe one physical
  // card. Not the digits alone: a person can hold a FAB and an Emirates NBD
  // card whose last four happen to match, and collapsing those would hide a
  // real statement. Bank, digits and type together — the same identity the
  // store merges duplicate rows on. Accounts with no digits fall back to their
  // own id, because there is nothing to compare.
  const cardKey = new Map<string, string>();
  for (const a of state.accounts) {
    cardKey.set(
      a.id,
      a.last4 ? `${a.bankName ?? ''}|${a.last4}|${a.cardType ?? a.kind}` : `id:${a.id}`,
    );
  }
  const keyOf = (accountId: string) => cardKey.get(accountId) ?? `id:${accountId}`;

  // Latest statement date per card, to tell "replaced" from "still owed".
  const newestByCard = new Map<string, string>();
  for (const d of state.cardDues) {
    const k = keyOf(d.accountId);
    const seen = newestByCard.get(k);
    if (!seen || d.dueDate > seen) newestByCard.set(k, d.dueDate);
  }

  const open = state.cardDues
    .filter((d) => creditIds.has(d.accountId))
    .map((d) => {
      const daysLeft = Math.round(
        (new Date(`${d.dueDate}T12:00:00`).getTime() -
          new Date(`${toISODate(today)}T12:00:00`).getTime()) /
          86400000,
      );
      const superseded = (newestByCard.get(keyOf(d.accountId)) ?? d.dueDate) > d.dueDate;
      return dueWithStatus(state, d, today, daysLeft < -STALE_OVERDUE_DAYS && !superseded);
    })
    .filter(
      (d) =>
        d.status !== 'settled' &&
        // Long overdue AND replaced by a later statement: genuinely history.
        (d.daysLeft >= -STALE_OVERDUE_DAYS || d.stale),
    )
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // One statement, one row. A card has a single statement per due date, so two
  // records that agree on the account and the date are the same statement
  // stored twice — a reminder SMS read as a fresh statement, or state written
  // before importBatch collapsed dues per account. Home was listing the same
  // Emirates NBD statement twice and counting it twice in the total.
  //
  // The larger balance wins: a due and its reminder can disagree, and the one
  // still owing more is the one that has not been paid down.
  //
  // Keyed on the CARD, not the account row. Two account records can describe
  // one physical card — a hand-added card that the SMS scan had already
  // discovered, or state written by an older version — and keying on the
  // account id let both through: Home listed "FAB Credit Card •5793 · 15 Jun ·
  // 8,144" twice, one above the other, and counted it twice in the total.
  //
  // A card is identified by its last four digits. Accounts with no digits at
  // all cannot be compared that way, so they fall back to their own id.
  const byStatement = new Map<string, DueWithStatus>();
  for (const d of open) {
    const key = `${keyOf(d.due.accountId)}|${d.due.dueDate}`;
    const seen = byStatement.get(key);
    if (!seen || d.remainingFils > seen.remainingFils) byStatement.set(key, d);
  }
  return [...byStatement.values()].sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * ISO date of the last known activity on an account: newest transaction or
 * the bank's latest snapshot SMS, whichever is later. Null = no history.
 */
export function accountLastActivityISO(state: AppState, accountId: string): string | null {
  let latest: string | null = null;
  for (const t of state.transactions) {
    if (t.accountId !== accountId) continue;
    if (!latest || t.date > latest) latest = t.date;
  }
  const acc = state.accounts.find((a) => a.id === accountId);
  if (acc?.snapshotTs) {
    const snapISO = toISODate(new Date(acc.snapshotTs));
    if (!latest || snapISO > latest) latest = snapISO;
  }
  return latest;
}

/** No charge and no bank SMS for this long = the card is expired or unused. */
export const DORMANT_AFTER_DAYS = 90;

/**
 * Hidden from the main lists: manually hidden, or silent for months. A
 * full-history scan resurrects every card the user ever owned; the dead ones
 * identify themselves by never texting again. Accounts with no history at all
 * (freshly added by hand) are left alone.
 */
export function isInactiveAccount(state: AppState, account: Account, today: Date): boolean {
  if (account.archived) return true;
  const last = accountLastActivityISO(state, account.id);
  if (!last) return false;
  const silentDays = Math.round(
    (new Date(`${toISODate(today)}T12:00:00`).getTime() - new Date(`${last}T12:00:00`).getTime()) /
      86400000,
  );
  return silentDays > DORMANT_AFTER_DAYS;
}

/** Display name for an auto-created card account. */
export function cardAccountName(last4: string, kind: 'credit' | 'debit' | 'account'): string {
  if (kind === 'credit') return `Credit Card •${last4}`;
  if (kind === 'debit') return `Debit Card •${last4}`;
  return `Account •${last4}`;
}

const HINT_COLORS = ['#60A5FA', '#F472B6', '#A78BFA', '#FB923C', '#22D3EE', '#4ADE80'];

export function colorForHint(last4: string): string {
  const n = Number(last4) || 0;
  return HINT_COLORS[n % HINT_COLORS.length];
}

/** Bank identity from an SMS sender ID, per the active market pack. */
export { bankFromSender } from '@/lib/markets';
