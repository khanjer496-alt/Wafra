import { toWholeDirhamFils } from './format';
import type { Account, AppState } from './types';

/**
 * The two slices of state a balance is a function of.
 *
 * Named rather than taking the whole AppState because the card diagnostic
 * builds its report from a narrowed state, and "net worth needs the accounts
 * and the transactions" is worth saying in the type rather than leaving a
 * caller to discover it by passing the wrong thing.
 */
type BalanceState = Pick<AppState, 'accounts' | 'transactions'>;

/** Current balance of an account: opening balance plus all its transactions. */
export function accountBalanceFils(state: BalanceState, accountId: string): number {
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
export function reliableBalanceFils(state: BalanceState, account: Account): number | null {
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

export function netWorthFils(state: BalanceState): number {
  // Only bank-quoted or fully-manual balances count; unknowable accounts and
  // hidden (dead card) accounts contribute nothing.
  //
  // Each part is snapped to the whole dirham it is DISPLAYED as before it is
  // added in. Summing raw fils and rounding once at the end is arithmetically
  // purer and reads as a bug: the fils of two accounts carried, so Wallet's
  // headline came out a dirham above the two rows printed directly under it.
  // A finance app disagreeing with itself on one screen costs more than half a
  // dirham of precision on a figure that is shown to the dirham anyway.
  return state.accounts.reduce((sum, a) => {
    if (a.archived) return sum;
    const fils = reliableBalanceFils(state, a);
    return fils === null ? sum : sum + toWholeDirhamFils(fils);
  }, 0);
}
