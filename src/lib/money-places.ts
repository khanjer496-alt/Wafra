/**
 * Pure figures behind Accounts, the account and goal detail screens, the card
 * payment sheet and the Bills timeline.
 *
 * Nothing here invents data. Each helper returns null (or leaves an option
 * out) when the ledger does not hold what a figure would need: no balance
 * history, no statement date, no minimum the bank never stated.
 */
import { daysBetweenISO, monthKey } from '@/lib/format';
import { isSpending } from '@/lib/ledger';
import type { Account, Bill, CardDue, Goal, Transaction } from '@/lib/types';

/** Wallet opens the account screen for bank and cash accounts; cards keep their statement sheet. */
export function isAccountDetailTarget(account: Pick<Account, 'kind' | 'cardType'>): boolean {
  return account.kind !== 'card' && account.cardType === undefined;
}

/* ── Credit-card usage ──────────────────────────────────────────────── */

export interface CardUsage {
  usedFils: number;
  limitFils: number;
  /** 0–1, capped: an over-limit card fills the bar rather than overflowing it. */
  ratio: number;
}

/**
 * How much of a credit card's limit is in use, or null when that is not known.
 *
 * Only ever drawn with a limit the USER entered — banks quote headroom, never
 * the limit (types.ts). "Used" then comes from a bank figure: the quoted
 * outstanding balance, or limit minus the quoted available credit. With
 * neither, there is no bar, rather than one built from captured spending.
 */
export function cardUsage(
  account: Pick<Account, 'cardType' | 'creditLimitFils' | 'snapshotFils' | 'snapshotKind'>,
): CardUsage | null {
  if (account.cardType !== 'credit') return null;
  const limitFils = account.creditLimitFils;
  if (limitFils === undefined || !Number.isSafeInteger(limitFils) || limitFils <= 0) return null;
  if (account.snapshotFils === undefined) return null;
  let usedFils: number;
  if (account.snapshotKind === 'outstanding') usedFils = Math.abs(account.snapshotFils);
  else if (account.snapshotKind === 'limit') usedFils = Math.max(0, limitFils - account.snapshotFils);
  else return null;
  return { usedFils, limitFils, ratio: Math.min(1, usedFils / limitFils) };
}

/**
 * Spending Wafra captured on each of the given cards in the current money
 * month, in one pass over the ledger.
 *
 * Labelled on screen as captured spending, never as a bank figure: the parser
 * captures no statement date (cards.ts), so "since the statement" cannot be
 * said honestly, and alert history can miss charges. Only cards the caller
 * asks about are summed — Wallet asks for credit cards with an open statement.
 */
export function capturedCardSpendFils(
  transactions: readonly Transaction[],
  cardIds: ReadonlySet<string>,
  now: Date,
  internal?: Set<string>,
): Map<string, number> {
  const totals = new Map<string, number>();
  if (cardIds.size === 0) return totals;
  const key = monthKey(now);
  for (const transaction of transactions) {
    if (!cardIds.has(transaction.accountId)) continue;
    if (!isSpending(transaction, undefined, internal) || monthKey(transaction.date) !== key) continue;
    totals.set(transaction.accountId, (totals.get(transaction.accountId) ?? 0) + transaction.amountFils);
  }
  return totals;
}

/* ── Recording a card payment ───────────────────────────────────────── */

export type CardPaymentChoice = 'full' | 'minimum' | 'other';

export interface CardPaymentOptions {
  /** What is still owed on this statement. Recording it settles the statement. */
  fullFils: number;
  /**
   * What is left to reach the minimum the bank STATED, or null: when the bank
   * never stated one (`minDueEstimated`), when it is already met, or when it
   * is not below the full amount (then "minimum" and "full" are one choice).
   */
  minimumFils: number | null;
}

/** The choices a statement offers, from the allocator's own figures. */
export function cardPaymentOptions(input: {
  due: Pick<CardDue, 'totalDueFils' | 'minDueFils' | 'minDueEstimated'>;
  remainingFils: number;
}): CardPaymentOptions {
  const fullFils = Math.max(0, input.remainingFils);
  const paidFils = Math.max(0, input.due.totalDueFils - fullFils);
  const stated = !input.due.minDueEstimated && input.due.minDueFils > 0;
  const minimumLeft = stated ? Math.max(0, input.due.minDueFils - paidFils) : 0;
  return {
    fullFils,
    minimumFils: minimumLeft > 0 && minimumLeft < fullFils ? minimumLeft : null,
  };
}

export type CardPaymentResolution =
  | { ok: true; amountFils: number; settles: boolean }
  | { ok: false; reason: 'nothing-owed' | 'no-minimum' | 'invalid' | 'over-remaining' };

/**
 * The payment a choice records, or why it cannot be recorded.
 *
 * An amount above what is left on the statement is refused rather than
 * capped: the allocator would pour the surplus into the next statement
 * (cards.ts), and a typed amount silently changed into another is a number
 * the user never entered. `settles` is true only when the whole remainder is
 * recorded — a partial payment leaves the statement open and does not stamp
 * it as the user's settlement.
 */
export function resolveCardPayment(
  choice: CardPaymentChoice,
  otherFils: number | null,
  options: CardPaymentOptions,
): CardPaymentResolution {
  if (options.fullFils <= 0) return { ok: false, reason: 'nothing-owed' };
  if (choice === 'full') return { ok: true, amountFils: options.fullFils, settles: true };
  if (choice === 'minimum') {
    return options.minimumFils === null
      ? { ok: false, reason: 'no-minimum' }
      : { ok: true, amountFils: options.minimumFils, settles: false };
  }
  if (otherFils === null || !Number.isSafeInteger(otherFils) || otherFils <= 0) {
    return { ok: false, reason: 'invalid' };
  }
  if (otherFils > options.fullFils) return { ok: false, reason: 'over-remaining' };
  return { ok: true, amountFils: otherFils, settles: otherFils === options.fullFils };
}

/* ── One account's month, as recorded ──────────────────────────────── */

export interface AccountMonthFlow {
  inFils: number;
  outFils: number;
  /** Rows counted; zero means "nothing recorded", not "nothing happened". */
  count: number;
}

/**
 * Money recorded into and out of one account in the current money month.
 *
 * This is movement on the account — own transfers included, because they did
 * move money in or out of it — and it is only what Wafra has recorded, which
 * is why the screen labels it "recorded" rather than calling it income and
 * spending. `duplicates` are the second alerts one bank move can produce
 * (ledger.ts `corroboratingTransferIdsForState`), counted once.
 */
export function accountMonthFlow(
  transactions: readonly Transaction[],
  accountId: string,
  now: Date,
  duplicates?: ReadonlySet<string>,
): AccountMonthFlow {
  const key = monthKey(now);
  let inFils = 0;
  let outFils = 0;
  let count = 0;
  for (const transaction of transactions) {
    if (transaction.accountId !== accountId || duplicates?.has(transaction.id)) continue;
    if (monthKey(transaction.date) !== key) continue;
    if (transaction.type === 'income') inFils += transaction.amountFils;
    else outFils += transaction.amountFils;
    count += 1;
  }
  return { inFils, outFils, count };
}

/**
 * The newest rows on one account, newest first — for the detail screen.
 * `duplicates` are left out, as in `accountMonthFlow` and Transactions: a
 * second alert for one bank move is not a second row.
 */
export function recentAccountTransactions(
  transactions: readonly Transaction[],
  accountId: string,
  limit = 8,
  duplicates?: ReadonlySet<string>,
): Transaction[] {
  const rows: Transaction[] = [];
  for (const transaction of transactions) {
    if (transaction.accountId === accountId && !duplicates?.has(transaction.id)) rows.push(transaction);
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || (b.ts ?? 0) - (a.ts ?? 0));
  return rows.slice(0, limit);
}

/* ── Goals ──────────────────────────────────────────────────────────── */

export interface GoalProgress {
  ratio: number;
  percent: number;
  leftFils: number;
  reached: boolean;
}

/** Saved against target. Nothing about pace: a goal stores no history. */
export function goalProgress(goal: Pick<Goal, 'savedFils' | 'targetFils'>): GoalProgress {
  const target = Math.max(0, goal.targetFils);
  const saved = Math.max(0, goal.savedFils);
  const ratio = target > 0 ? Math.min(1, saved / target) : 0;
  return {
    ratio,
    percent: Math.floor(ratio * 100),
    leftFils: Math.max(0, target - saved),
    reached: target > 0 && saved >= target,
  };
}

/* ── Bills timeline ─────────────────────────────────────────────────── */

export interface TimelineInput {
  id: string;
  title: string;
  dateISO: string;
}

export interface TimelinePin extends TimelineInput {
  /** Days from today, 0 … windowDays. */
  day: number;
  /** Position along the strip, 0–1. */
  position: number;
  /** 0 for the first pin on a day, 1 for the second, … — stacked, never hidden. */
  lane: number;
}

/**
 * Pins for the next `windowDays` days, soonest first. Anything already past
 * or beyond the window stays in the list below and off the strip: the strip
 * is a picture of the window its label names, nothing more.
 */
export function timelinePins(
  items: readonly TimelineInput[],
  todayISO: string,
  windowDays = 30,
): TimelinePin[] {
  const pins: TimelinePin[] = [];
  for (const item of items) {
    const day = daysBetweenISO(todayISO, item.dateISO);
    if (!Number.isFinite(day) || day < 0 || day > windowDays) continue;
    pins.push({ ...item, day, position: windowDays > 0 ? day / windowDays : 0, lane: 0 });
  }
  pins.sort((a, b) => a.day - b.day || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const perDay = new Map<number, number>();
  for (const pin of pins) {
    const lane = perDay.get(pin.day) ?? 0;
    pin.lane = lane;
    perDay.set(pin.day, lane + 1);
  }
  return pins;
}

/**
 * Where a pin's label hangs from its dot, so the first and last labels stay
 * inside the strip. A label is centred on its dot unless half of it would
 * cross an edge; then it runs inward from the dot. `stripWidth` is 0 until the
 * strip has been measured, and the same rule is applied to a typical phone
 * strip meanwhile.
 */
export function timelineLabelAnchor(
  position: number,
  stripWidth: number,
  labelWidth = 88,
): 'start' | 'center' | 'end' {
  const width = stripWidth > 0 ? stripWidth : 320;
  const half = labelWidth / 2;
  if (position * width < half) return 'start';
  if ((1 - position) * width < half) return 'end';
  return 'center';
}

/* ── Editing a hand-made bill ───────────────────────────────────────── */

/** What "Edit bill" may change on a reminder the user created. */
export interface BillEdit {
  title?: string;
  amountFils?: number;
  dueDay?: number;
}

/**
 * A hand-made reminder with an edit applied, or null when the edit cannot be.
 *
 * Detected reminders (`autoDetected`) are refused outright: the next bank
 * notice refreshes their amount and due day (`mergeImportedBills`), so an edit
 * would be silently undone and the user told nothing. A yearly reminder keeps
 * its anniversary in step with the new day — `dueDay` must always equal that
 * date's day (types.ts) — and a day the anniversary month does not have is
 * refused rather than clamped into a different date.
 */
export function applyBillEdit(bill: Bill, patch: BillEdit): Bill | null {
  if (bill.autoDetected) return null;
  let next = bill;
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) return null;
    next = { ...next, title };
  }
  if (patch.amountFils !== undefined) {
    if (!Number.isSafeInteger(patch.amountFils) || patch.amountFils <= 0) return null;
    next = { ...next, amountFils: patch.amountFils };
  }
  if (patch.dueDay !== undefined) {
    const day = patch.dueDay;
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    if (next.yearlyOnISO) {
      const year = Number(next.yearlyOnISO.slice(0, 4));
      const month = Number(next.yearlyOnISO.slice(5, 7));
      if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
      next = { ...next, dueDay: day, yearlyOnISO: `${next.yearlyOnISO.slice(0, 8)}${String(day).padStart(2, '0')}` };
    } else {
      next = { ...next, dueDay: day };
    }
  }
  return next;
}
