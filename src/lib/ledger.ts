import type { Account, Transaction } from '@/lib/types';

/**
 * What counts as money moving, asked once.
 *
 * This existed in at least four different spellings across analytics.ts,
 * insights.ts, bills.ts, subscriptions.ts, wallet.tsx and three sheets:
 *
 *   t.type !== 'expense' || t.isTransfer
 *   t.isTransfer                              (no type check at all)
 *   !t.isTransfer && inPeriod(...)
 *   t.isTransfer && t.type === 'income'
 *
 * They agreed by luck, not by construction, and one of them silently didn't:
 * archiving an account removed its balance from Wallet and its history from
 * net worth, but its spending went on counting in Home's Out, in Flow's
 * categories and against budgets. Hiding a card half-hid it.
 *
 * Every screen that adds money up now asks these functions instead.
 */

/** Accounts whose rows still count. Pass this to the predicates below. */
export function liveAccountIds(accounts: Account[]): Set<string> {
  return new Set(accounts.filter((a) => !a.archived).map((a) => a.id));
}

/**
 * A transfer is the app moving money between the user's own pockets — a card
 * payment, a savings sweep. Real, and already counted once as the purchase it
 * settles, so counting it again would double the month.
 */
export function isTransfer(t: Transaction): boolean {
  return t.isTransfer === true;
}

/**
 * Does this row belong in a spending or income total?
 *
 * `live` is optional so callers working from a bare transaction list (tests,
 * the importer) still get the transfer rule. Every screen with the accounts
 * to hand should pass it, or a hidden account keeps spending your money.
 */
export function countsInTotals(t: Transaction, live?: Set<string>): boolean {
  if (isTransfer(t)) return false;
  if (live && !live.has(t.accountId)) return false;
  return true;
}

/** Spending: an expense that is not a transfer, on an account still in play. */
export function isSpending(t: Transaction, live?: Set<string>): boolean {
  return t.type === 'expense' && countsInTotals(t, live);
}

/** Income: money arriving from outside, not shuffled between own accounts. */
export function isIncome(t: Transaction, live?: Set<string>): boolean {
  return t.type === 'income' && countsInTotals(t, live);
}

/**
 * The money-in leg of a transfer — a payment landing ON a card.
 *
 * The mirror image of the rule above, and the one thing that must NOT be
 * filtered out as "just a transfer": card settlement depends on finding it.
 */
export function isInboundTransfer(t: Transaction): boolean {
  return isTransfer(t) && t.type === 'income';
}
