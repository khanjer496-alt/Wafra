import type { Account, Transaction } from '@/lib/types';
import type { TransferAssessment, TransferReconciliationResult } from '@/lib/transfer-reconciliation-types';
import { isTransferCandidate, reconcileTransfers, transferOwnership } from '@/lib/transfer-reconciliation';

export interface TransferActivityRecord {
  transaction: Transaction;
  assessment: TransferAssessment;
  ownership: 'own' | 'external' | 'unknown';
  /** Ownership is settled: explicit, chosen by the person, or proven by reconciliation. */
  confirmed: boolean;
  /**
   * The reconciler queued this row for an ownership decision (a credible
   * own-account match or an ambiguous pairing). A generic transfer with no link
   * to another owned account is unconfirmed but is NOT a review chore.
   */
  needsReview: boolean;
}

const UNCONFIRMED_STATUSES: ReadonlySet<TransferAssessment['status']> =
  new Set(['ownership-unknown', 'ambiguous', 'likely-own', 'counterpart-missing']);

/** Presentation membership only: internalIds also contains non-transfer postings. */
function confirmedOwnership(transaction: Transaction, assessment: TransferAssessment): 'own' | 'external' | undefined {
  if (assessment.status === 'confirmed-own') return 'own';
  if (assessment.status === 'confirmed-external') return 'external';
  if (assessment.status === 'counterpart-missing' && transferOwnership(transaction) === 'own') return 'own';
  return undefined;
}

const duplicateIdsCache = new WeakMap<readonly Transaction[], ReadonlySet<string>>();

/**
 * Ids carried by more than one stored row. The reconciler marks every such
 * observation ambiguous and cannot tell them apart, so a per-id surface
 * (Transfers, its React keys, the Transactions separation set) must not claim
 * any of them. Cached per immutable ledger array.
 */
export function duplicateTransactionIds(transactions: readonly Transaction[]): ReadonlySet<string> {
  const cached = duplicateIdsCache.get(transactions);
  if (cached) return cached;
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const transaction of transactions) {
    if (seen.has(transaction.id)) duplicates.add(transaction.id);
    else seen.add(transaction.id);
  }
  duplicateIdsCache.set(transactions, duplicates);
  return duplicates;
}

/** Use this same set when excluding confirmed transfers from transaction browsing. */
export function confirmedTransferIds(
  transactions: readonly Transaction[], reconciliation: TransferReconciliationResult,
): Set<string> {
  const ids = new Set<string>();
  for (const transaction of transactions) {
    const assessment = reconciliation.byId.get(transaction.id);
    if (assessment && confirmedOwnership(transaction, assessment)) ids.add(transaction.id);
  }
  return ids;
}

/**
 * A read-only projection of existing reconciliation; never pairs rows or changes
 * cash flow. Keep both legs visible, including confirmed own transfers whose
 * other posting has not been imported. Uncertain ownership stays uncertain.
 *
 * Rows on archived accounts are left out, as they are hidden from every total.
 * Rows whose account is not a known account (an unresolved or holding source)
 * are still listed, labelled "Account not identified"; Transactions keeps such
 * a row in its own list and hidden count too unless it counts in totals.
 * Duplicate-id observations are left to the review queue.
 */
export function getTransferActivity(
  transactions: Transaction[], accounts: Account[],
  reconciliation: TransferReconciliationResult = reconcileTransfers(transactions, accounts),
): TransferActivityRecord[] {
  const result: TransferActivityRecord[] = [];
  const duplicates = duplicateTransactionIds(transactions);
  const archived = new Set(accounts.filter(account => account.archived).map(account => account.id));
  for (const transaction of transactions) {
    if (duplicates.has(transaction.id) || archived.has(transaction.accountId)) continue;
    const assessment = reconciliation.byId.get(transaction.id);
    if (!assessment) continue;
    const ownership = confirmedOwnership(transaction, assessment);
    if (ownership) {
      result.push({ transaction, assessment, ownership, confirmed: true, needsReview: false });
      continue;
    }
    // Card repayments (including likely ones) and corroborating bank
    // observations have their own surfaces. Do not let internalIds, legacy
    // isTransfer, or a likely match turn them into transfers here.
    if (!isTransferCandidate(transaction) || !UNCONFIRMED_STATUSES.has(assessment.status)) continue;
    result.push({ transaction, assessment, ownership: transferOwnership(transaction) ?? 'unknown',
      confirmed: false, needsReview: reconciliation.pendingIds.has(transaction.id) });
  }
  return result;
}

/**
 * Row-local membership test for primary tabs, which must not rebuild the
 * transfer graph on render. True only when the row's own evidence guarantees
 * that getTransferActivity lists it: an explicitly external transfer
 * (confirmed-external, or ambiguous when it also matched a pairing) with a
 * unique id. Everything else, including unknown ownership whose status
 * (for example a likely card repayment that Transfers does not list) needs the
 * whole ledger, stays in the activity list. Callers apply their own
 * live-account and internal-id rules first, so archived rows and corroborating
 * observations (which are internal) never reach this test.
 */
export function isListedExternalTransfer(transaction: Transaction, duplicates: ReadonlySet<string>): boolean {
  return transferOwnership(transaction) === 'external' && !duplicates.has(transaction.id);
}

const PAIRED_STATUSES: ReadonlySet<TransferAssessment['status']> = new Set(['confirmed-own', 'likely-own']);

/**
 * The other leg of each linked (`confirmed-own`) or likely own-account pair
 * among `records`, recorded both ways, so a count can name one movement once.
 * A pair needs one outgoing and one incoming leg on different accounts, both
 * present in `records`; it is enough for one leg to name the other. A leg
 * belongs to at most one pair (the first that names it, in record order).
 * Counting only: no amount is read or changed.
 */
export function transferPartnerIds(
  records: readonly Pick<TransferActivityRecord, 'transaction' | 'assessment'>[],
): Map<string, string> {
  const byId = new Map(records.map(record => [record.transaction.id, record.transaction] as const));
  const partners = new Map<string, string>();
  for (const { transaction, assessment } of records) {
    if (!PAIRED_STATUSES.has(assessment.status) || !assessment.counterpartId) continue;
    const other = byId.get(assessment.counterpartId);
    if (!other || other.id === transaction.id || partners.has(transaction.id) || partners.has(other.id)) continue;
    if (other.type === transaction.type || other.accountId === transaction.accountId) continue;
    if ((transaction.type !== 'expense' && transaction.type !== 'income') ||
      (other.type !== 'expense' && other.type !== 'income')) continue;
    partners.set(transaction.id, other.id);
    partners.set(other.id, transaction.id);
  }
  return partners;
}

/**
 * One question per movement. When both legs of a pair are queued, keep the
 * outgoing leg and drop the incoming one; answering it settles the pair. Order
 * is kept. A leg whose partner is not queued is asked about on its own.
 */
export function onePerPair<T extends Pick<TransferActivityRecord, 'transaction' | 'assessment'>>(queue: readonly T[]): T[] {
  const partners = transferPartnerIds(queue);
  return queue.filter(item => item.transaction.type !== 'income' || !partners.has(item.transaction.id));
}

/**
 * The Transfers question card's queue: the rows the reconciler queued, newest
 * first, one question per movement (onePerPair). Home counts this same queue,
 * so Home's notice and the card's "N need an answer" agree.
 */
export function transferQuestionQueue<T extends Pick<TransferActivityRecord, 'transaction' | 'assessment' | 'needsReview'>>(
  activity: readonly T[],
): T[] {
  return onePerPair(activity.filter(item => item.needsReview)
    .sort((a, b) => b.transaction.date.localeCompare(a.transaction.date) || (b.transaction.ts ?? 0) - (a.transaction.ts ?? 0)));
}

/**
 * Queued ids the card can never ask about: duplicate-id observations, rows on
 * archived accounts and queued rows Transfers does not list (a likely card
 * repayment). Only the review screen ("See all") reaches them, so a screen
 * that shows the queue must keep that way open while this is above zero. The
 * incoming leg a pair question settles is asked about, not counted here.
 */
export function unaskedPendingIds(
  activity: readonly Pick<TransferActivityRecord, 'transaction' | 'needsReview'>[], pendingIds: ReadonlySet<string>,
): Set<string> {
  const asked = new Set(activity.filter(item => item.needsReview).map(item => item.transaction.id));
  return new Set([...pendingIds].filter(id => !asked.has(id)));
}
