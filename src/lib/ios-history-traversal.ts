/**
 * Experimental extraction coordinator; NOT connected to the shipping Shortcut.
 * The current Apple date-filter adapter has not passed the capability gate.
 * Tests use a synthetic provider, not Apple Messages or an actual iPhone.
 *
 * Inclusive start/exclusive end, integer milliseconds. Newest windows finish
 * first. A page has a one-record overflow sentinel; saturated windows split,
 * never truncate. A saturated terminal window is a visible block. There is no
 * total-message or 30-day ceiling. Checkpoints contain only counts and dates.
 */
export interface HistoryWindow { fromMs: number; untilMs: number }
export interface HistoryTraversalCheckpoint {
  version: 1;
  scope: HistoryWindow;
  /** A contiguous suffix of the frozen scope, not estimated total coverage. */
  coveredFromMs: number;
  /** Oldest first, newest at the end (a stack, bounded by timestamp precision). */
  pending: HistoryWindow[];
  checkedRecords: number;
}
export interface HistoryReference { id: string; receivedAtMs: number }
export interface HistoryTraversalProvider<T extends HistoryReference> {
  /** Set only after the concrete provider's range/saturation tests pass. */
  verifiedRangeContract: boolean;
  read(window: HistoryWindow, limit: number): Promise<{
    records: readonly T[];
    /** False when the provider cannot prove that no additional row was hidden. */
    exhaustive: boolean;
  }>;
  /** Split progress must be durable before another query starts. */
  saveCheckpoint(checkpoint: HistoryTraversalCheckpoint): Promise<void>;
  /**
   * Atomically save deduplicated events AND this checkpoint, or neither.
   * Must recheck consent/generation in the storage transaction. On replay,
   * existing event identities must not produce a second financial entry.
   */
  commitPage(records: readonly T[], checkpoint: HistoryTraversalCheckpoint): Promise<void>;
  /** Consent, cancellation and store-generation fence, not a UI busy flag. */
  isCurrent(): boolean;
}
export type HistoryTraversalBlock = 'unverified-provider' | 'invalid-checkpoint' |
  'invalid-page' | 'dense-boundary' | 'read-failed' | 'write-failed';
export type HistoryTraversalResult = {
  status: 'complete' | 'paused' | 'blocked';
  checkpoint: HistoryTraversalCheckpoint;
  queries: number;
  reason?: HistoryTraversalBlock;
};
const MAX_DATE_MS = 8_640_000_000_000_000;
const validMs = (n: number): boolean => Number.isSafeInteger(n) && n >= 0 && n <= MAX_DATE_MS;
const exactKeys = (value: object, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const validWindow = (w: HistoryWindow): boolean => Boolean(w) && typeof w === 'object' &&
  exactKeys(w, ['fromMs', 'untilMs']) &&
  validMs(w.fromMs) && validMs(w.untilMs) && w.fromMs < w.untilMs;
const clone = (c: HistoryTraversalCheckpoint): HistoryTraversalCheckpoint => ({
  version: 1, scope: { fromMs: c.scope.fromMs, untilMs: c.scope.untilMs },
  coveredFromMs: c.coveredFromMs, checkedRecords: c.checkedRecords,
  pending: c.pending.map((w) => ({ fromMs: w.fromMs, untilMs: w.untilMs })),
});

/** Scope comes from the observed oldest retained message, or explicit user dates. */
export function beginHistoryTraversal(scope: HistoryWindow): HistoryTraversalCheckpoint {
  if (!validWindow(scope)) throw new Error('invalid-history-scope');
  return { version: 1, scope: { ...scope }, coveredFromMs: scope.untilMs,
    pending: [{ ...scope }], checkedRecords: 0 };
}

export function validHistoryTraversal(c: HistoryTraversalCheckpoint): boolean {
  if (!c || typeof c !== 'object' ||
    !exactKeys(c, ['version', 'scope', 'coveredFromMs', 'pending', 'checkedRecords']) ||
    c.version !== 1 || !validWindow(c.scope) ||
    !Number.isSafeInteger(c.checkedRecords) || c.checkedRecords < 0 ||
    !validMs(c.coveredFromMs) || c.coveredFromMs < c.scope.fromMs ||
    c.coveredFromMs > c.scope.untilMs || !Array.isArray(c.pending) ||
    c.pending.length > 64) return false;
  let cursor = c.scope.fromMs;
  for (const w of c.pending) {
    if (!validWindow(w) || w.fromMs !== cursor || w.untilMs > c.coveredFromMs) return false;
    cursor = w.untilMs;
  }
  return cursor === c.coveredFromMs;
}

/**
 * A bounded amount of work per invocation. Resume the persisted checkpoint;
 * reaching the query budget pauses, and never implies that history is complete.
 */
export async function traverseHistory<T extends HistoryReference>(
  provider: HistoryTraversalProvider<T>,
  saved: HistoryTraversalCheckpoint,
  options: { pageRecords?: number; maxQueries?: number } = {},
): Promise<HistoryTraversalResult> {
  let checkpoint = saved;
  let queries = 0;
  const result = (status: HistoryTraversalResult['status'], reason?: HistoryTraversalBlock): HistoryTraversalResult =>
    ({ status, checkpoint, queries, ...(reason ? { reason } : {}) });
  if (!validHistoryTraversal(saved)) return result('blocked', 'invalid-checkpoint');
  checkpoint = clone(saved);
  if (!provider.verifiedRangeContract) return result('blocked', 'unverified-provider');
  const pageRecords = options.pageRecords ?? 50;
  const maxQueries = options.maxQueries ?? 16;
  if (!Number.isSafeInteger(pageRecords) || pageRecords < 1 || pageRecords > 500 ||
    !Number.isSafeInteger(maxQueries) || maxQueries < 1 || maxQueries > 1000) {
    throw new Error('invalid-history-work-budget');
  }
  while (checkpoint.pending.length > 0) {
    if (!provider.isCurrent() || queries >= maxQueries) return result('paused');
    const window = checkpoint.pending[checkpoint.pending.length - 1];
    let page: Awaited<ReturnType<typeof provider.read>>;
    try { queries += 1; page = await provider.read({ ...window }, pageRecords + 1); }
    catch { return result('blocked', 'read-failed'); }
    if (!provider.isCurrent()) return result('paused');
    if (!page || !Array.isArray(page.records) || typeof page.exhaustive !== 'boolean' ||
      page.records.length > pageRecords + 1) return result('blocked', 'invalid-page');
    const ids = new Set<string>();
    let previous = window.untilMs;
    for (const row of page.records) {
      if (!row || typeof row.id !== 'string' || row.id.length === 0 || row.id.length > 128 ||
        ids.has(row.id) || !validMs(row.receivedAtMs) || row.receivedAtMs < window.fromMs ||
        row.receivedAtMs >= window.untilMs || row.receivedAtMs > previous) {
        return result('blocked', 'invalid-page');
      }
      ids.add(row.id); previous = row.receivedAtMs;
    }
    const next = clone(checkpoint);
    next.pending.pop();
    const overflow = page.records.length > pageRecords || !page.exhaustive;
    if (overflow) {
      if (window.untilMs - window.fromMs <= 1) return result('blocked', 'dense-boundary');
      const middle = window.fromMs + Math.floor((window.untilMs - window.fromMs) / 2);
      next.pending.push({ fromMs: window.fromMs, untilMs: middle },
        { fromMs: middle, untilMs: window.untilMs });
    } else {
      next.coveredFromMs = window.fromMs;
      next.checkedRecords += page.records.length;
      if (!Number.isSafeInteger(next.checkedRecords)) return result('blocked', 'invalid-page');
    }
    if (!validHistoryTraversal(next)) return result('blocked', 'invalid-checkpoint');
    // isCurrent is rechecked by the adapter inside the atomic write too.
    if (!provider.isCurrent()) return result('paused');
    try {
      if (overflow) await provider.saveCheckpoint(clone(next));
      else await provider.commitPage(page.records, clone(next));
    } catch { return result('blocked', 'write-failed'); }
    checkpoint = next;
    // Cooperatively let unrelated foreground/new-alert work run. Not a worker.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return result('complete');
}
