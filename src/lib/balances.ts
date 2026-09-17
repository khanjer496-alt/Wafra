import type { Account, AppState } from './types';
import { reconcileTransfers } from '@/lib/transfer-reconciliation';

/**
 * The two slices of state a balance is a function of.
 *
 * Named rather than taking the whole AppState because the card diagnostic
 * builds its report from a narrowed state, and "net worth needs the accounts
 * and the transactions" is worth saying in the type rather than leaving a
 * caller to discover it by passing the wrong thing.
 */
type BalanceState = Pick<AppState, 'accounts' | 'transactions'>;

export interface NetWorthBreakdown {
  /** Known positive balances in exact ledger minor units. */
  balanceFils: number;
  /** Absolute value of known negative balances, including card amounts owed. */
  debtFils: number;
  /** `balanceFils - debtFils`. */
  totalFils: number;
  activeAccountCount: number;
  knownAccountCount: number;
  unknownAccountCount: number;
  /** The same reliable figure used by the headline, keyed for Wallet rows. */
  balanceByAccountId: Readonly<Record<string, number | null>>;
}

let netWorthBreakdownCache: {
  accounts: Account[];
  transactions: AppState['transactions'];
  value: NetWorthBreakdown;
} | null = null;

/** Current balance of an account: opening balance plus all its transactions. */
export function accountBalanceFils(state: BalanceState, accountId: string): number {
  const account = state.accounts.find((a) => a.id === accountId);
  let balance = account?.openingFils ?? 0;
  // Corroborating rows are a bank-capture concept. A fully manual account can
  // never own one, so rebuilding the complete transfer graph just to add its
  // own entries is pure render-path cost. This matters because reliableBalance
  // uses this function for manual accounts and Wallet/Card lists can call it on
  // first paint. Keep the exact reconciliation path for any account that has
  // captured-bank evidence; skip it only where it provably cannot affect the
  // answer.
  const hasCapturedRows = state.transactions.some(
    (t) => t.accountId === accountId && (t.source === 'sms' || Boolean(t.smsKey)),
  );
  const secondary = hasCapturedRows
    ? reconcileTransfers(state.transactions, state.accounts).corroboratingIds
    : null;
  for (const t of state.transactions) {
    if (t.accountId !== accountId || secondary?.has(t.id)) continue;
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
  return netWorthBreakdown(state).totalFils;
}

/**
 * The auditable version of Wallet's headline.
 *
 * This projection exists so the UI can show the equation behind its estimate,
 * not merely the final number. It also avoids calling `reliableBalanceFils`
 * once per account (and scanning every transaction each time) on a screen that
 * can contain dozens of discovered cards. Transactions are indexed once, then
 * the exact same reliability rules are applied to each active account.
 */
export function netWorthBreakdown(state: BalanceState): NetWorthBreakdown {
  if (netWorthBreakdownCache?.accounts === state.accounts &&
      netWorthBreakdownCache.transactions === state.transactions) {
    return netWorthBreakdownCache.value;
  }
  const runningByAccount = new Map<string, number>();
  const smsAccountIds = new Set<string>();
  // Legacy captured rows can carry a durable smsKey even if an old snapshot
  // predates the explicit `source: 'sms'` field. Keep track of those accounts
  // so the rare legacy case can fall back to the exact reconciled balance
  // without charging every modern Wallet paint for a full transfer-graph walk.
  const capturedIdentityAccountIds = new Set<string>();

  for (const account of state.accounts) {
    if (!account.archived) runningByAccount.set(account.id, account.openingFils ?? 0);
  }
  for (const transaction of state.transactions) {
    if (!runningByAccount.has(transaction.accountId)) continue;
    // `balanceByAccountId` consumes this running sum only for accounts with no
    // SMS history. Corroborating transfer alerts are bank-captured SMS rows, so
    // any account on which they could change the sum is marked unknown below
    // (or replaced by the bank's own snapshot) and the sum is never read. The
    // old unconditional reconcileTransfers() therefore spent seconds rebuilding
    // a 10k+ row transfer graph on the first Accounts paint for a result that
    // could not affect the value shown.
    if (transaction.source === 'sms') smsAccountIds.add(transaction.accountId);
    if (transaction.smsKey) capturedIdentityAccountIds.add(transaction.accountId);
    runningByAccount.set(
      transaction.accountId,
      (runningByAccount.get(transaction.accountId) ?? 0) +
        (transaction.type === 'income' ? transaction.amountFils : -transaction.amountFils),
    );
  }

  let balanceFils = 0;
  let debtFils = 0;
  let knownAccountCount = 0;
  let unknownAccountCount = 0;
  const balanceByAccountId: Record<string, number | null> = {};

  for (const account of state.accounts) {
    if (account.archived) continue;

    let reliable: number | null;
    if (account.cardType === 'credit') {
      reliable =
        account.snapshotKind === 'outstanding' && account.snapshotFils !== undefined
          ? -account.snapshotFils
          : null;
    } else if (account.snapshotKind === 'balance' && account.snapshotFils !== undefined) {
      reliable = account.snapshotFils;
    } else if (smsAccountIds.has(account.id)) {
      reliable = null;
    } else if (capturedIdentityAccountIds.has(account.id)) {
      // Preserve the pre-`source` legacy edge exactly. accountBalanceFils pays
      // for reconciliation only on this captured account, while ordinary modern
      // SMS accounts above remain unknown and fully-manual accounts below use
      // the already-built running index.
      reliable = accountBalanceFils(state, account.id);
    } else {
      reliable = runningByAccount.get(account.id) ?? 0;
    }

    if (reliable === null) {
      balanceByAccountId[account.id] = null;
      unknownAccountCount += 1;
      continue;
    }

    balanceByAccountId[account.id] = reliable;
    knownAccountCount += 1;
    if (reliable < 0) debtFils += Math.abs(reliable);
    else balanceFils += reliable;
  }

  const value = {
    balanceFils,
    debtFils,
    totalFils: balanceFils - debtFils,
    activeAccountCount: knownAccountCount + unknownAccountCount,
    knownAccountCount,
    unknownAccountCount,
    balanceByAccountId,
  };
  netWorthBreakdownCache = { accounts: state.accounts, transactions: state.transactions, value };
  return value;
}
