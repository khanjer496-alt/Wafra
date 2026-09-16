import type { Account, AppState, Transaction } from '@/lib/types';
import {
  isTransferCandidate,
  isUnassignedTransferAccount,
  reconcileTransfers,
  reconciliationInternalIds,
  transferOwnership,
  TRANSFER_NORMALIZATION_VERSION,
} from '@/lib/transfer-reconciliation';

/**
 * Human-readable account label with its last-four bank identifier appended
 * as `·NNNN`, unless the name already ends with those four digits.
 *
 * Two identically-named cards ("FAB Credit Card") are only distinguishable by
 * their last four, so the label carries them wherever a picker or a details
 * row shows an account. Guards against double-appending — some entries store
 * the digits inside `name` already ("FAB ·4821") — by returning `name` as is
 * when it contains the full last-four sequence.
 */
export function accountDisplayName(account: Pick<Account, 'name' | 'last4'>): string {
  if (!account.last4) return account.name;
  return account.name.includes(account.last4) ? account.name : `${account.name} ·${account.last4}`;
}

/** A known business receipt with unknown bank attribution. Not a bank account
 * and never a balance/snapshot target. The user assigns it from entry details. */
export const UNASSIGNED_INCOME_ACCOUNT_ID = '__unassigned-income__';
/** A parsed money event can exist before any account has been discovered. This
 * is an unresolved attribution, not a bank/card and not balance evidence. */
export const UNASSIGNED_TRANSACTION_ACCOUNT_ID = '__unassigned-transaction__';
export const isUnassignedIncome = (transaction: Transaction): boolean =>
  transaction.accountId === UNASSIGNED_INCOME_ACCOUNT_ID && transaction.type === 'income';

/** Account visibility is applied to totals, never to transfer identity. */
let liveAccountIdsCache: { accounts: Account[]; value: Set<string> } | null = null;

export function liveAccountIds(accounts: Account[]): Set<string> {
  if (liveAccountIdsCache?.accounts === accounts) return liveAccountIdsCache.value;
  const value = new Set([UNASSIGNED_INCOME_ACCOUNT_ID, UNASSIGNED_TRANSACTION_ACCOUNT_ID,
    ...accounts.filter((account) => !account.archived).map((account) => account.id)]);
  liveAccountIdsCache = { accounts, value };
  return value;
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
  return transaction.type === 'income' && transaction.title?.trim().toLowerCase() === 'cash deposit';
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
  // A holding transfer source is not a user's known account, so it cannot yet
  // establish cash flow for the ledger. Ordinary unassigned parsed activity is
  // still governed by the live-account set below.
  if (isUnassignedTransferAccount(transaction.accountId)) return false;
  if (live && !live.has(transaction.accountId) && !isUnassignedIncome(transaction)) return false;
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
let internalIdsCache: { transactions: Transaction[]; accounts: Account[]; value: Set<string> } | null = null;
let persistedInternalIdsCache: {
  transactions: Transaction[];
  accounts: Account[];
  ids: string[];
  value: Set<string>;
} | null = null;

/**
 * Seed the analytics cache from the exact durable reconciliation receipt.
 * Store snapshots are immutable, so matching array identities make this cache
 * authoritative until a transaction/account mutation replaces either array.
 */
export function primeInternalTransferIds(
  transactions: Transaction[],
  accounts: Account[],
  ids: readonly string[],
): void {
  internalIdsCache = { transactions, accounts, value: new Set(ids) };
}

export function internalTransferIds(
  transactions: Transaction[], accounts: Set<string> | Account[],
): Set<string> {
  if (Array.isArray(accounts) &&
      internalIdsCache?.transactions === transactions && internalIdsCache.accounts === accounts) {
    return internalIdsCache.value;
  }
  const accountRows = Array.isArray(accounts) ? accounts : [];
  const value = reconciliationInternalIds(reconcileTransfers(transactions, accountRows));
  if (Array.isArray(accounts)) internalIdsCache = { transactions, accounts, value };
  return value;
}

/**
 * Fast UI/analytics path for a complete AppState snapshot.
 *
 * The store persists the exact reconciliation result together with a semantic
 * version and primes the in-memory cache after every authoritative dispatch.
 * Rebuilding the complete transfer graph from a 10k-20k row ledger on a tab
 * press is therefore redundant work and can hold React Native's JS thread for
 * seconds. Use the durable receipt when it describes this snapshot; fall back
 * to full reconciliation only for old/restored states that do not have one.
 *
 * While an Android history import is running the store deliberately exposes a
 * provisional receipt for UI calculations. It is not stamped as final until
 * import completion, but it is the same snapshot the rest of the UI uses.
 */
export function internalTransferIdsForState(
  state: Pick<AppState,
    'transactions' | 'accounts' | 'transferInternalIds' | 'transferNormalizationVersion' | 'historyImport'>,
): Set<string> {
  const ids = state.transferInternalIds;
  const receiptUsable = Array.isArray(ids) && (
    state.transferNormalizationVersion === TRANSFER_NORMALIZATION_VERSION ||
    state.historyImport?.status === 'running'
  );
  if (!receiptUsable) return internalTransferIds(state.transactions, state.accounts);
  if (persistedInternalIdsCache?.transactions === state.transactions &&
      persistedInternalIdsCache.accounts === state.accounts &&
      persistedInternalIdsCache.ids === ids) {
    return persistedInternalIdsCache.value;
  }
  const value = new Set(ids);
  persistedInternalIdsCache = {
    transactions: state.transactions,
    accounts: state.accounts,
    ids,
    value,
  };
  // Keep the legacy array-identity cache hot for callers that still only have
  // transactions/accounts. This makes mixed old/new call sites converge on the
  // same O(1) result instead of unexpectedly rebuilding the graph later.
  internalIdsCache = { transactions: state.transactions, accounts: state.accounts, value };
  return value;
}
