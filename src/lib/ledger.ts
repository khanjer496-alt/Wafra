import type { Account, Transaction } from '@/lib/types';
import { isTransferCandidate, isUnassignedTransferAccount, reconcileTransfers, transferOwnership } from '@/lib/transfer-reconciliation';

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
  // Uncertain ownership is displayed separately from confirmed totals.
  if (isTransferCandidate(transaction) && transferOwnership(transaction) === 'unknown') return false;
  if (live && !live.has(transaction.accountId) && !isUnassignedIncome(transaction) && !isUnassignedTransferAccount(transaction.accountId)) return false;
  if (internal?.has(transaction.id)) return false;
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
  const result = reconcileTransfers(transactions, Array.isArray(accounts) ? accounts : []);
  if (!result.corroboratingIds.size && !result.cardRepaymentPairs.size) return result.internalIds;
  return new Set([...result.internalIds, ...result.corroboratingIds, ...result.cardRepaymentPairs.keys()]);
}
