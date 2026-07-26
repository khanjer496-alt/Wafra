import type { Account, AppState } from './types';

/** Current balance of an account: opening balance plus all its transactions. */
export function accountBalanceFils(state: AppState, accountId: string): number {
  const account = state.accounts.find((a) => a.id === accountId);
  let balance = account?.openingFils ?? 0;
  for (const t of state.transactions) {
    if (t.accountId !== accountId) continue;
    balance += t.type === 'income' ? t.amountFils : -t.amountFils;
  }
  return balance;
}

/**
 * The balance we can actually STAND BEHIND for an account, or null when we
 * can't know it. SMS history is partial by nature (missed messages, deleted
 * threads, pre-history balances), so a derived running balance on an
 * SMS-fed account is fiction — only the bank's own quoted figures count:
 * - credit cards: the bank's "outstanding" snapshot (as a negative);
 * - debit/bank accounts: the bank's "balance" snapshot;
 * - manual accounts (no SMS rows): opening balance + manual entries, which
 *   the user controls fully.
 */
export function reliableBalanceFils(state: AppState, account: Account): number | null {
  if (account.cardType === 'credit') {
    return account.snapshotKind === 'outstanding' && account.snapshotFils !== undefined
      ? -account.snapshotFils
      : null;
  }
  if (account.snapshotKind === 'balance' && account.snapshotFils !== undefined) {
    return account.snapshotFils;
  }
  const hasSmsRows = state.transactions.some(
    (t) => t.accountId === account.id && t.source === 'sms',
  );
  return hasSmsRows ? null : accountBalanceFils(state, account.id);
}

export function netWorthFils(state: AppState): number {
  // Only bank-quoted or fully-manual balances count; unknowable accounts and
  // hidden (dead card) accounts contribute nothing.
  return state.accounts.reduce((sum, a) => {
    if (a.archived) return sum;
    const fils = reliableBalanceFils(state, a);
    return fils === null ? sum : sum + fils;
  }, 0);
}
