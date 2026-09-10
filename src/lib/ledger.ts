import type { Account, Transaction } from '@/lib/types';
import { isObservedUnassignedTransferAccount, isTransferCandidate, isUnassignedTransferAccount, reconcileTransfers, transferOwnership } from '@/lib/transfer-reconciliation';

/** A known business receipt with unknown bank attribution. Not a bank account
 * and never a balance/snapshot target. The user assigns it from entry details. */
export const UNASSIGNED_INCOME_ACCOUNT_ID = '__unassigned-income__';
/** A parsed money event can exist before any account has been discovered. This
 * is an unresolved attribution, not a bank/card and not balance evidence. */
export const UNASSIGNED_TRANSACTION_ACCOUNT_ID = '__unassigned-transaction__';
export const isUnassignedIncome = (transaction: Transaction): boolean =>
  transaction.accountId === UNASSIGNED_INCOME_ACCOUNT_ID && transaction.type === 'income';

/** Account visibility is applied to totals, never to transfer identity. */
export function liveAccountIds(accounts: Account[]): Set<string> {
  return new Set([UNASSIGNED_INCOME_ACCOUNT_ID, UNASSIGNED_TRANSACTION_ACCOUNT_ID,
    ...accounts.filter((account) => !account.archived).map((account) => account.id)]);
}

export function isTransfer(transaction: Transaction): boolean {
  const ownership = transferOwnership(transaction);
  return ownership === 'own' || (ownership === null && transaction.isTransfer === true);
}

/**
 * Money that changed location or form without representing consumption or
 * earned income. Keep these rows in Activity/account cash-flow views, but do
 * not let them inflate Spending, Income, merchant analytics, or Net.
 */
export function isMoneyMovementOnly(transaction: Transaction): boolean {
  if (transaction.category === 'cash-withdrawal' || transaction.category === 'investing') return true;
  return transaction.type === 'income' && transaction.title.trim().toLowerCase() === 'cash deposit';
}

export function countsInTotals(
  transaction: Transaction,
  live?: Set<string>,
  internal?: Set<string>,
): boolean {
  if (transaction.accountId === UNASSIGNED_INCOME_ACCOUNT_ID && transaction.type !== 'income') return false;
  if (isTransfer(transaction)) return false;
  // Uncertain ownership is displayed separately from confirmed totals.
  if (isTransferCandidate(transaction) && transferOwnership(transaction) === 'unknown') return false;
  if (isMoneyMovementOnly(transaction)) return false;
  if (live && !live.has(transaction.accountId) && !isUnassignedIncome(transaction) && !isUnassignedTransferAccount(transaction.accountId)) return false;
  if (internal?.has(transaction.id)) return false;
  return true;
}

/**
 * Cash-flow totals answer a different question from spending analytics.
 *
 * An unresolved bank transfer on a real visible account still moved money, so
 * it remains eligible for cash-movement views. Exact Income / Spending / Net
 * figures additionally exclude it through isUnresolvedTransferMovement() and
 * surface the uncertainty separately. Category, merchant, subscription and
 * budget analytics continue to use countsInTotals().
 */
export function countsInCashflowTotals(
  transaction: Transaction,
  live?: Set<string>,
  internal?: Set<string>,
): boolean {
  if (transaction.accountId === UNASSIGNED_INCOME_ACCOUNT_ID && transaction.type !== 'income') return false;
  if (internal?.has(transaction.id)) return false;
  const ownership = transferOwnership(transaction);
  if (ownership === 'own') return false;
  // Settlement/funding rows are deliberately not transfer candidates. Preserve
  // their existing exclusion instead of re-labelling card payments as income.
  if (ownership === null && transaction.isTransfer === true) return false;
  // A bank-scoped hashed source proves that one stable masked account is the
  // user's, even though the bank never exposed four displayable digits. Keep
  // that real movement in cash-flow totals. The `:unknown` holding still proves
  // no source account and must remain excluded.
  if (isUnassignedTransferAccount(transaction.accountId) &&
      !isObservedUnassignedTransferAccount(transaction.accountId)) return false;
  if (live && !live.has(transaction.accountId) && !isUnassignedIncome(transaction) &&
      !isObservedUnassignedTransferAccount(transaction.accountId)) return false;
  return true;
}

/**
 * A real bank movement that Wafra can see, but cannot yet prove was either an
 * external payment or a move between the user's own accounts.
 *
 * These rows stay visible in activity, but must not silently swing an exact
 * Income / Spending / Net figure in either direction. They are reported as one
 * aggregate uncertainty bucket instead of becoming thousands of review tasks.
 */
export function isUnresolvedTransferMovement(
  transaction: Transaction,
  live?: Set<string>,
  internal?: Set<string>,
): boolean {
  if (internal?.has(transaction.id) || isUnassignedIncome(transaction)) return false;
  return isTransferCandidate(transaction) && transferOwnership(transaction) === 'unknown' &&
    countsInCashflowTotals(transaction, live, internal);
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
  const result = reconcileTransfers(transactions, Array.isArray(accounts) ? accounts : []);
  if (!result.corroboratingIds.size && !result.cardRepaymentPairs.size && !result.knownCardRepayments.size) return result.internalIds;
  return new Set([...result.internalIds, ...result.corroboratingIds, ...result.cardRepaymentPairs.keys(), ...result.knownCardRepayments.keys()]);
}
