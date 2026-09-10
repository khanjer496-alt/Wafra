import type { Account, Transaction } from '@/lib/types';
import { isTransferCandidate, reconcileTransfers, transferOwnership } from '@/lib/transfer-reconciliation';

/** A known business receipt with unknown bank attribution. Not a bank account
 * and never a balance/snapshot target. The user assigns it from entry details. */
export const UNASSIGNED_INCOME_ACCOUNT_ID = '__unassigned-income__';
export const isUnassignedIncome = (transaction: Transaction): boolean =>
  transaction.accountId === UNASSIGNED_INCOME_ACCOUNT_ID && transaction.type === 'income';

/** Account visibility is applied to totals, never to transfer identity. */
export function liveAccountIds(accounts: Account[]): Set<string> {
  return new Set([UNASSIGNED_INCOME_ACCOUNT_ID,
    ...accounts.filter((account) => !account.archived).map((account) => account.id)]);
}

export function isTransfer(transaction: Transaction): boolean {
  const ownership = transferOwnership(transaction);
  return ownership === 'own' || (ownership === null && transaction.isTransfer === true);
}

export function countsInTotals(
  transaction: Transaction,
  live?: Set<string>,
  internal?: Set<string>,
): boolean {
  if (transaction.accountId === UNASSIGNED_INCOME_ACCOUNT_ID && transaction.type !== 'income') return false;
  if (isTransfer(transaction)) return false;
  // Commerce/income analytics remain conservative: an unresolved transfer is
  // not yet a purchase or earned income. Cash-flow list totals use the separate
  // countsInCashflowTotals predicate below so they do not silently drop money.
  if (isTransferCandidate(transaction) && transferOwnership(transaction) === 'unknown') return false;
  if (live && !live.has(transaction.accountId) && !isUnassignedIncome(transaction)) return false;
  if (internal?.has(transaction.id)) return false;
  return true;
}

/**
 * Whether a recorded row changes the selected period's cash-flow position.
 *
 * `countsInTotals` deliberately excludes unresolved transfers because category,
 * merchant and subscription analytics must not call an unknown transfer a
 * purchase or earned income. A transaction list's signed Net answers a simpler
 * question: how much recorded money came in versus went out. For that view an
 * unresolved transfer on a real, visible account must remain visible until it
 * is proven to be between the user's own accounts; otherwise years of legitimate
 * credits can disappear from Net merely because an old SMS did not identify the
 * counterparty.
 */
export function countsInCashflowTotals(
  transaction: Transaction,
  live?: Set<string>,
  internal?: Set<string>,
): boolean {
  if (transaction.accountId === UNASSIGNED_INCOME_ACCOUNT_ID && transaction.type !== 'income') return false;
  const ownership = transferOwnership(transaction);
  if (ownership === 'own' || internal?.has(transaction.id)) return false;
  // Card repayments, bill-funding observations and explicit manual own-transfer
  // rows are non-candidate transfer roles. Preserve their existing exclusion.
  if (ownership === null && transaction.isTransfer === true) return false;
  // A credit whose own destination account is unknown is not enough evidence to
  // put money into the user's cash-flow total. It remains in the review queue.
  if (isUnassignedIncome(transaction) && ownership === 'unknown') return false;
  if (live && !live.has(transaction.accountId) && !isUnassignedIncome(transaction)) return false;
  return true;
}

export function isSpending(
  transaction: Transaction, live?: Set<string>, internal?: Set<string>,
): boolean {
  return transaction.type === 'expense' && countsInTotals(transaction, live, internal);
}

export function isIncome(
  transaction: Transaction, live?: Set<string>, internal?: Set<string>,
): boolean {
  return transaction.type === 'income' && countsInTotals(transaction, live, internal);
}

/** A payment arriving ON a card still counts towards settling its statement. */
export function isInboundTransfer(transaction: Transaction): boolean {
  return isTransfer(transaction) && transaction.type === 'income';
}

/** Ownership needs evidence from complete accounts, never just visible IDs.
 * Legacy Set callers can still exclude explicit/user-owned rows, but cannot
 * establish a bank identity. New callers should supply the full account list.
 */
export function internalTransferIds(
  transactions: Transaction[], accounts: Set<string> | Account[],
): Set<string> {
  return reconcileTransfers(transactions, Array.isArray(accounts) ? accounts : []).internalIds;
}
