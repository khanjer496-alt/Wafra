import { useCallback, useRef, useState } from 'react';

import { useToast } from '@/components/ui/toast';
import { useLanguage } from '@/hooks/use-language';
import { useStoreActions } from '@/lib/store';
import { buildTransferAnswer, buildTransferUndo, type TransferAnswer } from '@/lib/transfer-answer';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { transferFingerprint } from '@/lib/transfer-reconciliation';
import type { Transaction } from '@/lib/types';

/**
 * Callers close the sheet or advance on 'saved' and 'unsaved' only: 'unsaved'
 * means the answer is applied in memory but the ledger write is still pending.
 */
export type TransferAnswerResult = 'saved' | 'unsaved' | 'changed' | 'failed' | 'busy';

type Outcome = Exclude<TransferAnswerResult, 'busy'>;

/** The store refuses a stale answer with these messages; the person sees "changed", not "failed". */
const STALE_MESSAGES = ['Transfer review is out of date', 'Transfer review changed; open it again'];

function failureDetails(failure: unknown): { code?: unknown; message?: unknown; expectedFingerprints?: unknown } {
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
  const saving = useRef(false);

  /**
   * Run one resolver call. When the encrypted write failed after the in-memory
   * change, retry the write only if the ledger is still exactly what the store
   * reported (no restore or edit landed in between); otherwise report 'changed'.
   */
  const commit = useCallback(async (
    save: () => Promise<void>, generation: number, changedIds: readonly string[],
  ): Promise<Outcome> => {
    try {
      await save();
      return 'saved';
    } catch (failure) {
      const { code, message, expectedFingerprints } = failureDetails(failure);
      if (code !== 'transfer-durability') {
        return typeof message === 'string' && STALE_MESSAGES.includes(message) ? 'changed' : 'failed';
      }
      const reported = postDecisionFingerprints(expectedFingerprints, changedIds);
      // Without verifiable fingerprints the write cannot be retried safely; the answer stays in memory.
      if (!reported) return 'unsaved';
      const latest = new Map(getStateSnapshot().transactions.map(row => [row.id, row]));
      if (getStateGeneration() !== generation || changedIds.some(id => {
        const row = latest.get(id);
        return !row || transferFingerprint(row) !== reported[id];
      })) return 'changed';
      try {
        await ensureDurable();
        return 'saved';
      } catch {
        return 'unsaved';
      }
    }
  }, [ensureDurable, getStateGeneration, getStateSnapshot]);

  const undo = useCallback(async (id: string, counterpartId?: string) => {
    if (saving.current) {
      toast.show(words.failed, { tone: 'error' });
      return;
    }
    // Fresh rows: saving the answer itself changed their fingerprints. A
    // counterpart that no longer exists has nothing left to clear.
    const rows = new Map(getStateSnapshot().transactions.map(entry => [entry.id, entry]));
    const row = rows.get(id);
    if (!row) {
      toast.show(words.changed, { tone: 'error' });
      return;
    }
    const counterpart = counterpartId ? rows.get(counterpartId) : undefined;
    const request = buildTransferUndo({ transaction: row, counterpart, generation: getStateGeneration() });
    const changedIds = request.decisions.map(decision => decision.ids[0]);
    saving.current = true; setBusy(true);
    try {
      const outcome = await commit(() => counterpart
        ? resolveTransferBatch(request)
        : resolveTransfers({ ids: [id], ownership: null, expectedFingerprints: request.expectedFingerprints,
          expectedGeneration: request.expectedGeneration }),
      request.expectedGeneration, changedIds);
      toast.show(outcome === 'saved' ? words.undone : outcome === 'unsaved' ? words.unsaved
        : outcome === 'changed' ? words.changed : words.failed,
      { tone: outcome === 'saved' ? 'success' : outcome === 'unsaved' ? 'warning' : 'error' });
    } finally {
      saving.current = false; setBusy(false);
    }
  }, [commit, getStateGeneration, getStateSnapshot, resolveTransferBatch, resolveTransfers, toast, words]);

  const answer = useCallback(async ({ transaction, answer: choice, counterpart, label }: {
    transaction: Transaction; answer: TransferAnswer; counterpart?: Transaction; label: string;
  }): Promise<TransferAnswerResult> => {
    if (saving.current) return 'busy';
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
    saving.current = true; setBusy(true);
    try {
      const outcome = await commit(() => resolveTransfers(request), request.expectedGeneration,
        [transaction.id, ...(request.counterpartId ? [request.counterpartId] : [])]);
      if (outcome === 'saved' || outcome === 'unsaved') {
        const undoAction = { label: words.undo, onPress: () => { void undo(transaction.id, request.counterpartId); } };
        toast.show(outcome === 'saved' ? `${words.saved} · ${label}` : words.unsaved,
          { tone: outcome === 'saved' ? 'success' : 'warning', actions: [undoAction] });
      } else {
        toast.show(outcome === 'changed' ? words.changed : words.failed, { tone: 'error' });
      }
      return outcome;
    } finally {
      saving.current = false; setBusy(false);
    }
  }, [commit, getStateGeneration, getStateSnapshot, resolveTransfers, toast, undo, words]);

  return { answer, busy };
}
