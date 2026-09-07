import type { Account, Transaction } from '@/lib/types';

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
  return transaction.isTransfer === true;
}

export function countsInTotals(
  transaction: Transaction,
  live?: Set<string>,
  internal?: Set<string>,
): boolean {
  if (transaction.accountId === UNASSIGNED_INCOME_ACCOUNT_ID && transaction.type !== 'income') return false;
  if (isTransfer(transaction)) return false;
  if (live && !live.has(transaction.accountId) && !isUnassignedIncome(transaction)) return false;
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

interface TimedTransfer {
  transaction: Transaction;
  at: number;
  /** Original position preserves the old stable-sort tie-break. */
  order: number;
}

const TRANSFER_WINDOW_MS = 3 * 86_400_000;
const OUTGOING_TRANSFER = /^(?:outgoing|bank|own account|self|savings) transfer$/i;
const INCOMING_TRANSFER = /^(?:(?:incoming|bank|own account|self) transfer|inward remittance)$/i;

function lowerBound(candidates: readonly TimedTransfer[], at: number): number {
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (candidates[middle].at < at) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Pair only evidenced, equal-amount transfers between different owned accounts.
 *
 * Preserve the shipping rules: income order, closest timestamp within three
 * days (inclusive), original outgoing order for equal distances, and at most
 * one match per outgoing ID. Salaries and ordinary purchases cannot pair.
 * Archived accounts remain eligible: hiding an account cannot create income.
 *
 * Previously each incoming transfer filtered and sorted its entire amount
 * bucket, repeatedly parsing the same dates. Index each bucket by time once,
 * then inspect only its three-day window. No transaction is mutated, no match
 * is persisted, and no cross-ledger cache can become stale after edits/erase.
 */
export function internalTransferIds(
  transactions: Transaction[],
  accounts: Set<string> | Account[],
): Set<string> {
  const accountIds = Array.isArray(accounts)
    ? new Set(accounts.map((account) => account.id))
    : new Set(transactions.map((transaction) => transaction.accountId));
  const outgoing = new Map<number, TimedTransfer[]>();
  const paired = new Set<string>();

  for (let order = 0; order < transactions.length; order += 1) {
    const transaction = transactions[order];
    if (transaction.accountId === UNASSIGNED_INCOME_ACCOUNT_ID || transaction.type !== 'expense' || !accountIds.has(transaction.accountId) ||
      !(transaction.isTransfer === true || OUTGOING_TRANSFER.test(transaction.title.trim()))) {
      continue;
    }
    const at = transaction.ts ?? Date.parse(`${transaction.date}T12:00:00Z`);
    // Non-finite timestamps could never pass the old absolute-distance guard.
    if (!Number.isFinite(at)) continue;
    const entry = { transaction, at, order };
    const bucket = outgoing.get(transaction.amountFils);
    if (bucket) bucket.push(entry);
    else outgoing.set(transaction.amountFils, [entry]);
  }
  for (const bucket of outgoing.values()) {
    bucket.sort((a, b) => a.at - b.at || a.order - b.order);
  }

  for (const transaction of transactions) {
    if (transaction.accountId === UNASSIGNED_INCOME_ACCOUNT_ID || transaction.type !== 'income' || transaction.isTransfer ||
      !accountIds.has(transaction.accountId) || transaction.category === 'salary' ||
      !INCOMING_TRANSFER.test(transaction.title.trim())) continue;
    const candidates = outgoing.get(transaction.amountFils);
    if (!candidates) continue;
    const arrived = transaction.ts ?? Date.parse(`${transaction.date}T12:00:00Z`);
    if (!Number.isFinite(arrived)) continue;

    let closest: TimedTransfer | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (let i = lowerBound(candidates, arrived - TRANSFER_WINDOW_MS);
      i < candidates.length && candidates[i].at <= arrived + TRANSFER_WINDOW_MS; i += 1) {
      const candidate = candidates[i];
      if (paired.has(candidate.transaction.id) ||
        candidate.transaction.accountId === transaction.accountId) continue;
      const delta = Math.abs(candidate.at - arrived);
      if (delta < distance || (delta === distance && candidate.order < (closest?.order ?? Infinity))) {
        closest = candidate;
        distance = delta;
      }
      // Equal timestamps are already ordered by original position.
      if (distance === 0) break;
    }
    if (!closest) continue;
    paired.add(closest.transaction.id);
    paired.add(transaction.id);
  }
  return paired;
}
