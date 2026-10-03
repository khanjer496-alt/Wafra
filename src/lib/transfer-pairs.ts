import { isTransferCandidate } from '@/lib/transfer-reconciliation';
import type { TransferReconciliationResult } from '@/lib/transfer-reconciliation-types';
import type { Transaction } from '@/lib/types';

/**
 * One money movement between two of the person's accounts, shown as a single
 * card: the leg that left (expense) and the leg that arrived (income).
 *
 * `anchorId` is the leg whose assessment names the other one, i.e. the id the
 * store's link request must carry in `ids` with the other as `counterpartId`
 * — exactly the request the per-entry review sheet already makes.
 */
export interface TransferPair {
  key: string;
  out: Transaction;
  in: Transaction;
  anchorId: string;
  counterpartId: string;
}

function pairOf(a: Transaction, b: Transaction, anchorId: string): TransferPair | null {
  if (a.type === b.type || a.accountId === b.accountId) return null;
  const out = a.type === 'expense' ? a : b;
  const inn = a.type === 'income' ? a : b;
  if (out.type !== 'expense' || inn.type !== 'income') return null;
  return {
    key: `${out.id}|${inn.id}`, out, in: inn, anchorId,
    counterpartId: anchorId === a.id ? b.id : a.id,
  };
}

/**
 * Suggested pairs: an unresolved leg the reconciler judged `likely-own` on
 * amount and time, whose named counterpart still exists, is still a transfer
 * candidate, and neither leg carries a decision yet. These are the same
 * conditions under which the review sheet offers "link" for one entry; the
 * store re-validates both legs' fingerprints when the match is saved.
 * Card repayments (`likely-card-repayment`) are deliberately never paired
 * here — card allocation is not decided from this screen.
 */
export function suggestedTransferPairs(
  reconciliation: Pick<TransferReconciliationResult, 'byId' | 'pendingIds'>,
  rowsById: ReadonlyMap<string, Transaction>,
): TransferPair[] {
  const pairs = new Map<string, TransferPair>();
  const used = new Set<string>();
  for (const [id, assessment] of reconciliation.byId) {
    if (assessment.status !== 'likely-own' || !assessment.counterpartId || !reconciliation.pendingIds.has(id)) continue;
    const row = rowsById.get(id);
    const other = rowsById.get(assessment.counterpartId);
    if (!row || !other || !isTransferCandidate(row) || !isTransferCandidate(other)) continue;
    if (row.transferDecision || other.transferDecision) continue;
    const pair = pairOf(row, other, row.id);
    if (!pair || pairs.has(pair.key)) continue;
    // One leg belongs to at most one suggested card.
    if (used.has(pair.out.id) || used.has(pair.in.id)) continue;
    used.add(pair.out.id); used.add(pair.in.id);
    pairs.set(pair.key, pair);
  }
  return [...pairs.values()].sort((a, b) => b.out.date.localeCompare(a.out.date) ||
    (b.out.ts ?? 0) - (a.out.ts ?? 0) || a.key.localeCompare(b.key));
}

/**
 * Confirmed own-account pairs whose two legs name each other. Only the
 * reconciler's confirmed state counts; a suggestion is never shown as matched.
 */
export function matchedTransferPairs(
  reconciliation: Pick<TransferReconciliationResult, 'byId'>,
  rowsById: ReadonlyMap<string, Transaction>,
  include: (pair: TransferPair) => boolean = () => true,
): TransferPair[] {
  const pairs = new Map<string, TransferPair>();
  for (const [id, assessment] of reconciliation.byId) {
    if (assessment.status !== 'confirmed-own' || !assessment.counterpartId) continue;
    const back = reconciliation.byId.get(assessment.counterpartId);
    if (back?.status !== 'confirmed-own' || back.counterpartId !== id) continue;
    const row = rowsById.get(id);
    const other = rowsById.get(assessment.counterpartId);
    if (!row || !other) continue;
    const pair = pairOf(row, other, row.id);
    if (!pair || pairs.has(pair.key) || !include(pair)) continue;
    pairs.set(pair.key, pair);
  }
  return [...pairs.values()].sort((a, b) => b.out.date.localeCompare(a.out.date) ||
    (b.out.ts ?? 0) - (a.out.ts ?? 0) || a.key.localeCompare(b.key));
}
