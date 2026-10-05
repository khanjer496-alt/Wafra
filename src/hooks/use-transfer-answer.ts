import { useCallback, useState } from 'react';

import { useToast } from '@/components/ui/toast';
import { useLanguage } from '@/hooks/use-language';
import { useStoreActions } from '@/lib/store';
import { buildTransferAnswer, buildTransferUndo, buildTransferUndoMany, expectedTransferDecisions, isStaleTransferRejection,
  savedAnswerFingerprints, transferAnswerMoved, transferWriteLock, type TransferAnswer } from '@/lib/transfer-answer';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { transferFingerprint } from '@/lib/transfer-reconciliation';
import type { Transaction } from '@/lib/types';

/**
 * Callers close the sheet or advance on 'saved' and 'unsaved' only: 'unsaved'
 * means the answer is applied in memory but the ledger write is still pending.
 */
export type TransferAnswerResult = 'saved' | 'unsaved' | 'changed' | 'failed' | 'busy';

type Outcome = Exclude<TransferAnswerResult, 'busy'>;

/** A resolver call's outcome and, after a failed write, the post-decision fingerprints the store reported. */
interface Committed { outcome: Outcome; reported?: Record<string, string> }

function failureDetails(failure: unknown): { code?: unknown; expectedFingerprints?: unknown } {
  return typeof failure === 'object' && failure !== null ? failure : {};
}

/** The post-decision fingerprints a durability error carries, or null when they cannot vouch for every changed row. */
function postDecisionFingerprints(value: unknown, changedIds: readonly string[]): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prints = value as Record<string, unknown>;
  if (!Object.values(prints).every(print => typeof print === 'string')) return null;
  return changedIds.every(id => id in prints) ? prints as Record<string, string> : null;
}

/** Save one answer through the reviewed resolver, then offer Undo in the toast. */
export function useTransferAnswer() {
  const words = transferActivityCopy(useLanguage()).answers;
  const toast = useToast();
  const { resolveTransfers, resolveTransferBatch, getStateGeneration, getStateSnapshot, ensureDurable } = useStoreActions();
  const [busy, setBusy] = useState(false);

  /**
   * Run one resolver call. When the encrypted write failed after the in-memory
   * change, retry the write only if the ledger is still exactly what the store
   * reported (no restore or edit landed in between); otherwise report 'changed'.
   */
  const commit = useCallback(async (
    save: () => Promise<void>, generation: number, changedIds: readonly string[],
  ): Promise<Committed> => {
    try {
      await save();
      return { outcome: 'saved' };
    } catch (failure) {
      const { code, expectedFingerprints } = failureDetails(failure);
      // The store refuses a stale answer; the person sees "changed", not "failed".
      if (code !== 'transfer-durability') return { outcome: isStaleTransferRejection(failure) ? 'changed' : 'failed' };
      const reported = postDecisionFingerprints(expectedFingerprints, changedIds);
      // Without verifiable fingerprints the write cannot be retried safely; the answer stays in memory.
      if (!reported) return { outcome: 'unsaved' };
      const latest = new Map(getStateSnapshot().transactions.map(row => [row.id, row]));
      if (getStateGeneration() !== generation || changedIds.some(id => {
        const row = latest.get(id);
        return !row || transferFingerprint(row) !== reported[id];
      })) return { outcome: 'changed' };
      try {
        await ensureDurable();
        return { outcome: 'saved', reported };
      } catch {
        return { outcome: 'unsaved', reported };
      }
    }
  }, [ensureDurable, getStateGeneration, getStateSnapshot]);

  /** Hold the app-wide transfer write lock (and this hook's busy flag) for one write. */
  const locked = useCallback(async <T,>(write: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await write();
    } finally {
      transferWriteLock.release(); setBusy(false);
    }
  }, []);

  const report = useCallback((outcome: Outcome) => {
    toast.show(outcome === 'saved' ? words.undone : outcome === 'unsaved' ? words.unsaved
      : outcome === 'changed' ? words.changed : words.failed,
    { tone: outcome === 'saved' ? 'success' : outcome === 'unsaved' ? 'warning' : 'error' });
  }, [toast, words]);

  /**
   * Take one answer back (the toast's Undo, or Clear my answer). `expected` is
   * what the rows looked like when the answer was saved or shown: if the entry
   * has changed since (a newer answer, an edit), nothing is cleared and the
   * person is told it changed. The other side of a link is cleared only while
   * its decision still names this entry.
   */
  const undo = useCallback(async (id: string, counterpartId?: string, expected?: Readonly<Record<string, string>> | null) => {
    // Another transfer write (a save, another Undo) is running: refuse rather than interleave.
    if (transferWriteLock.held()) {
      toast.show(words.failed, { tone: 'error' });
      return;
    }
    // The save could not vouch for what it left: nothing can be safely taken back.
    if (expected === null) {
      toast.show(words.changed, { tone: 'error' });
      return;
    }
    // Fresh rows: saving the answer itself changed their fingerprints. A
    // counterpart that no longer exists has nothing left to clear.
    const rows = new Map(getStateSnapshot().transactions.map(entry => [entry.id, entry]));
    const row = rows.get(id);
    const checked = expected ? Object.fromEntries(Object.entries(expected).filter(([key]) => key === id || rows.has(key))) : {};
    if (!row || transferAnswerMoved(checked, rows)) {
      toast.show(words.changed, { tone: 'error' });
      return;
    }
    const counterpart = counterpartId ? rows.get(counterpartId) : undefined;
    const request = buildTransferUndo({ transaction: row, counterpart, generation: getStateGeneration() });
    const changedIds = request.decisions.map(decision => decision.ids[0]);
    if (!transferWriteLock.acquire()) {
      toast.show(words.failed, { tone: 'error' });
      return;
    }
    await locked(async () => {
      report((await commit(() => changedIds.length > 1
        ? resolveTransferBatch(request)
        : resolveTransfers({ ids: [id], ownership: null, expectedFingerprints: request.expectedFingerprints,
          expectedGeneration: request.expectedGeneration }),
      request.expectedGeneration, changedIds)).outcome);
    });
  }, [commit, getStateGeneration, getStateSnapshot, locked, report, resolveTransferBatch, resolveTransfers, toast, words]);

  /**
   * Undo for an answer saved to several rows at once (a group or a selection
   * on the Transfers page). Each row is cleared on its own, from the rows as
   * they are now; a row that has gone since, or (with `expected`, the rows as
   * the save left them) one answered or edited since, means the ledger changed
   * and nothing is cleared.
   */
  const undoMany = useCallback(async (ids: readonly string[], expected?: Readonly<Record<string, string>> | null) => {
    if (transferWriteLock.held()) {
      toast.show(words.failed, { tone: 'error' });
      return;
    }
    const rows = new Map(getStateSnapshot().transactions.map(entry => [entry.id, entry]));
    const current = ids.map(id => rows.get(id));
    if (expected === null || !current.length || current.some(row => !row) || (expected && transferAnswerMoved(expected, rows))) {
      toast.show(words.changed, { tone: 'error' });
      return;
    }
    const request = buildTransferUndoMany({ rows: current as Transaction[], generation: getStateGeneration() });
    if (!transferWriteLock.acquire()) {
      toast.show(words.failed, { tone: 'error' });
      return;
    }
    await locked(async () => {
      report((await commit(() => resolveTransferBatch(request), request.expectedGeneration,
        request.decisions.map(decision => decision.ids[0]))).outcome);
    });
  }, [commit, getStateGeneration, getStateSnapshot, locked, report, resolveTransferBatch, toast, words]);

  const answer = useCallback(async ({ transaction, answer: choice, counterpart, label }: {
    transaction: Transaction; answer: TransferAnswer; counterpart?: Transaction; label: string;
  }): Promise<TransferAnswerResult> => {
    if (transferWriteLock.held()) return 'busy';
    const request = buildTransferAnswer({ transaction, answer: choice, counterpart, generation: getStateGeneration() });
    // The row on screen may be older than the store; refuse rather than overwrite.
    const latest = new Map(getStateSnapshot().transactions.map(row => [row.id, row]));
    if (Object.entries(request.expectedFingerprints).some(([id, print]) => {
      const row = latest.get(id);
      return !row || transferFingerprint(row) !== print;
    })) {
      toast.show(words.changed, { tone: 'error' });
      return 'changed';
    }
    if (!transferWriteLock.acquire()) return 'busy';
    return locked(async () => {
      const changedIds = [transaction.id, ...(request.counterpartId ? [request.counterpartId] : [])];
      const started = Date.now();
      const { outcome, reported } = await commit(() => resolveTransfers(request), request.expectedGeneration, changedIds);
      if (outcome === 'saved' || outcome === 'unsaved') {
        // The rows as this answer left them, so Undo clears exactly this answer and never a newer one: the
        // store's own post-decision fingerprints when it reported them, else the ledger's rows, accepted
        // only when they carry exactly this decision.
        const after = reported ?? savedAnswerFingerprints(expectedTransferDecisions([request]),
          new Map(getStateSnapshot().transactions.map(row => [row.id, row])), started);
        const undoAction = { label: words.undo, onPress: () => { void undo(transaction.id, request.counterpartId, after); } };
        toast.show(outcome === 'saved' ? `${words.saved} · ${label}` : words.unsaved,
          { tone: outcome === 'saved' ? 'success' : 'warning', actions: [undoAction] });
      } else {
        toast.show(outcome === 'changed' ? words.changed : words.failed, { tone: 'error' });
      }
      return outcome;
    });
  }, [commit, getStateGeneration, getStateSnapshot, locked, resolveTransfers, toast, undo, words]);

  /** True while any transfer write runs (this hook's or another's), before React re-renders. */
  const pending = useCallback(() => transferWriteLock.held(), []);

  return { answer, undo, undoMany, busy, pending };
}
