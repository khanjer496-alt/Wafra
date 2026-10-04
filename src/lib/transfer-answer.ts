import { isTransferCandidate, transferDeclined, transferFingerprint, transferOwnership } from '@/lib/transfer-reconciliation';
import type { TransferAssessment } from '@/lib/transfer-reconciliation-types';
import type { Transaction } from '@/lib/types';

export type TransferAnswer = 'own' | 'external' | 'none';

/** What the person (or the evidence) has already settled; null means "not answered". */
export function currentAnswer(tx: Transaction, assessment?: TransferAssessment): TransferAnswer | null {
  if (transferDeclined(tx)) return 'none';
  if (assessment?.status === 'confirmed-own') return 'own';
  if (assessment?.status === 'confirmed-external') return 'external';
  const ownership = transferOwnership(tx);
  return ownership === 'own' || ownership === 'external' ? ownership : null;
}

/** Rows that could be the other side of an own-account answer, most likely first. */
export function ownCandidates(
  tx: Transaction, assessment: TransferAssessment | undefined, rowsById: ReadonlyMap<string, Transaction>,
): Transaction[] {
  const ids = assessment?.counterpartId ? [assessment.counterpartId] : assessment?.candidateIds ?? [];
  return ids.map(id => rowsById.get(id))
    .filter((row): row is Transaction => !!row && row.id !== tx.id && isTransferCandidate(row) && !transferDeclined(row));
}

/** Freeze exactly what the person saw; the store rechecks these fingerprints when it saves. */
export function buildTransferAnswer({ transaction, answer, counterpart, generation }: {
  transaction: Transaction; answer: TransferAnswer; counterpart?: Transaction; generation: number;
}) {
  const link = answer === 'own' && counterpart ? counterpart : undefined;
  return {
    ids: [transaction.id],
    ownership: answer,
    ...(link ? { counterpartId: link.id } : {}),
    expectedFingerprints: Object.fromEntries([transaction, ...(link ? [link] : [])]
      .map(row => [row.id, transferFingerprint(row)])),
    expectedGeneration: generation,
  };
}
