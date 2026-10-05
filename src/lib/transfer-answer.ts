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

/**
 * Rows that could be the other side of an own-account answer, most likely
 * first. A likely card repayment names its card receipt only as a suggestion:
 * answering "own" saves the answer without linking the two, on every path, so
 * it offers nothing to link here.
 */
export function ownCandidates(
  tx: Transaction, assessment: TransferAssessment | undefined, rowsById: ReadonlyMap<string, Transaction>,
): Transaction[] {
  if (assessment?.status === 'likely-card-repayment') return [];
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

/**
 * Remove an answer. A linked own answer leaves a decision on each side, and the
 * resolver keeps the other side's decision when one row is cleared, so both rows
 * are cleared together as two single-row decisions (a multi-id decision would
 * trigger the legacy group rule). The other side is cleared only while its own
 * decision still names this row: a newer answer given to it since is kept.
 * Pass the rows as they are now, not as shown when the answer was given:
 * saving the answer changed their fingerprints.
 */
export function buildTransferUndo({ transaction, counterpart, generation }: {
  transaction: Transaction; counterpart?: Transaction; generation: number;
}) {
  const linked = !!counterpart && counterpart.id !== transaction.id &&
    counterpart.transferDecision?.counterpartId === transaction.id;
  const rows = linked ? [transaction, counterpart] : [transaction];
  return {
    decisions: rows.map(row => ({ ids: [row.id], ownership: null })),
    expectedFingerprints: Object.fromEntries(rows.map(row => [row.id, transferFingerprint(row)])),
    expectedGeneration: generation,
  };
}

/**
 * Remove the answers one save gave to several rows (a group or a selection),
 * each row cleared as its own single-row decision, as above. Every row named
 * must still exist; pass them as they are now.
 */
export function buildTransferUndoMany({ rows, generation }: { rows: readonly Transaction[]; generation: number }) {
  const unique = [...new Map(rows.map(row => [row.id, row] as const)).values()];
  return {
    decisions: unique.map(row => ({ ids: [row.id], ownership: null })),
    expectedFingerprints: Object.fromEntries(unique.map(row => [row.id, transferFingerprint(row)])),
    expectedGeneration: generation,
  };
}

/** The store refuses an answer given to a ledger that moved with these messages. */
const STALE_MESSAGES: readonly string[] = ['Transfer review is out of date', 'Transfer review changed; open it again'];

/** True when a resolver failure means "the ledger changed since this was shown", not "the save failed". */
export function isStaleTransferRejection(failure: unknown): boolean {
  const message = typeof failure === 'object' && failure !== null && 'message' in failure ? failure.message : undefined;
  return typeof message === 'string' && STALE_MESSAGES.includes(message);
}

/** The fingerprints of these rows as they are in `rows` now; a missing row is left out. */
export function transferFingerprintsOf(ids: readonly string[], rows: ReadonlyMap<string, Transaction>): Record<string, string> {
  return Object.fromEntries(ids.flatMap(id => {
    const row = rows.get(id);
    return row ? [[id, transferFingerprint(row)] as const] : [];
  }));
}

/**
 * True when an answer is no longer what was saved (or shown): a row in
 * `expected` is gone or its fingerprint differs. Undo and Clear refuse then,
 * rather than clearing an answer given since.
 */
export function transferAnswerMoved(expected: Readonly<Record<string, string>>, rows: ReadonlyMap<string, Transaction>): boolean {
  return Object.entries(expected).some(([id, print]) => {
    const row = rows.get(id);
    return !row || transferFingerprint(row) !== print;
  });
}
