/**
 * What the Transactions screen needs to set transfer rows apart, and the check
 * that lets it keep the PREVIOUS answer when a ledger change did not alter it.
 *
 * Every edit replaces the transactions array, so the separation is recomputed;
 * the result is almost always the same ids. Handing the screen a new object each
 * time re-rendered it and re-ran the transfer-id memo, the section projection
 * and every cell for nothing. Returning the earlier object when its contents are
 * equal turns that second pass into a no-op (React bails out of an identical
 * state).
 */
export interface TransferSeparation {
  separateTransferIds: ReadonlySet<string>;
  /**
   * Transfers waiting for an answer (ownership not settled), whether or not the
   * reconciler queued them: the same rule as Home's Needs you and the Transfers card.
   */
  reviewTransferIds: ReadonlySet<string>;
  /** Transfer legs still waiting for their other side (the Needs review chip). */
  pendingTransferIds: ReadonlySet<string>;
  /** The other leg of each linked or likely own pair among the separated rows, so the strip counts a pair once. */
  separatedPartnerIds: ReadonlyMap<string, string>;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function sameMap(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

export function sameTransferSeparation(a: TransferSeparation, b: TransferSeparation): boolean {
  return a === b ||
    (sameSet(a.separateTransferIds, b.separateTransferIds) &&
      sameSet(a.reviewTransferIds, b.reviewTransferIds) &&
      sameSet(a.pendingTransferIds, b.pendingTransferIds) &&
      sameMap(a.separatedPartnerIds, b.separatedPartnerIds));
}

/** The previous separation when `next` says exactly the same thing, otherwise `next`. */
export function keepEqualSeparation<T extends TransferSeparation>(previous: T | null | undefined, next: T): T {
  return previous && sameTransferSeparation(previous, next) ? previous : next;
}
