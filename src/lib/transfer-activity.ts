import type { Account, Transaction } from '@/lib/types';
import type { TransferAssessment, TransferReconciliationResult } from '@/lib/transfer-reconciliation-types';
import { isTransferCandidate, reconcileTransfers, transferOwnership } from '@/lib/transfer-reconciliation';

export interface TransferActivityRecord {
  transaction: Transaction;
  assessment: TransferAssessment;
  ownership: 'own' | 'external' | 'unknown';
  needsReview: boolean;
}

/** Presentation membership only: internalIds also contains non-transfer postings. */
function confirmedOwnership(transaction: Transaction, assessment: TransferAssessment): 'own' | 'external' | undefined {
  if (assessment.status === 'confirmed-own') return 'own';
  if (assessment.status === 'confirmed-external') return 'external';
  if (assessment.status === 'counterpart-missing' && transferOwnership(transaction) === 'own') return 'own';
  return undefined;
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
 */
export function getTransferActivity(
  transactions: Transaction[], accounts: Account[],
  reconciliation: TransferReconciliationResult = reconcileTransfers(transactions, accounts),
): TransferActivityRecord[] {
  const result: TransferActivityRecord[] = [];
  for (const transaction of transactions) {
    const assessment = reconciliation.byId.get(transaction.id);
    if (!assessment) continue;
    const ownership = confirmedOwnership(transaction, assessment);
    if (ownership) {
      result.push({ transaction, assessment, ownership, needsReview: false });
      continue;
    }
    // Card repayments and duplicate bank observations have their own surfaces.
    // Do not let internalIds, legacy isTransfer, or a likely match turn them
    // into confirmed transfers here.
    if (!isTransferCandidate(transaction) || !['ownership-unknown', 'ambiguous', 'likely-own', 'counterpart-missing'].includes(assessment.status)) continue;
    result.push({ transaction, assessment, ownership: transferOwnership(transaction) ?? 'unknown', needsReview: true });
  }
  return result;
}
