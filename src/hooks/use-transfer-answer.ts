import { useCallback, useRef, useState } from 'react';

import { useToast } from '@/components/ui/toast';
import { useLanguage } from '@/hooks/use-language';
import { useStoreActions } from '@/lib/store';
import { buildTransferAnswer, type TransferAnswer } from '@/lib/transfer-answer';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { transferFingerprint } from '@/lib/transfer-reconciliation';
import type { Transaction } from '@/lib/types';

type Outcome = 'saved' | 'changed' | 'failed';

/** The store refuses a stale answer with these messages; the person sees "changed", not "failed". */
const STALE_MESSAGES = ['Transfer review is out of date', 'Transfer review changed; open it again'];

function failureDetails(failure: unknown): { code?: unknown; message?: unknown } {
  return typeof failure === 'object' && failure !== null ? failure : {};
}

/** Save one answer through the reviewed resolver, then offer Undo in the toast. */
export function useTransferAnswer() {
  const words = transferActivityCopy(useLanguage()).answers;
  const toast = useToast();
  const { resolveTransfers, getStateGeneration, getStateSnapshot, ensureDurable } = useStoreActions();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  /** Run one resolver call. A ledger write that failed after the in-memory change gets one durability retry. */
  const commit = useCallback(async (request: Parameters<typeof resolveTransfers>[0]): Promise<Outcome> => {
    try {
      await resolveTransfers(request);
      return 'saved';
    } catch (failure) {
      const { code, message } = failureDetails(failure);
      if (code === 'transfer-durability') {
        try {
          await ensureDurable();
          return 'saved';
        } catch {
          return 'failed';
        }
      }
      return typeof message === 'string' && STALE_MESSAGES.includes(message) ? 'changed' : 'failed';
    }
  }, [ensureDurable, resolveTransfers]);

  const undo = useCallback(async (id: string) => {
    if (saving.current) {
      toast.show(words.failed, { tone: 'error' });
      return;
    }
    // Fresh fingerprint: the saved answer itself changed the row since the first tap.
    const row = getStateSnapshot().transactions.find(entry => entry.id === id);
    if (!row) {
      toast.show(words.changed, { tone: 'error' });
      return;
    }
    saving.current = true; setBusy(true);
    try {
      const outcome = await commit({ ids: [id], ownership: null, expectedGeneration: getStateGeneration(),
        expectedFingerprints: { [id]: transferFingerprint(row) } });
      toast.show(outcome === 'saved' ? words.undone : outcome === 'changed' ? words.changed : words.failed,
        { tone: outcome === 'saved' ? 'success' : 'error' });
    } finally {
      saving.current = false; setBusy(false);
    }
  }, [commit, getStateGeneration, getStateSnapshot, toast, words]);

  const answer = useCallback(async ({ transaction, answer: choice, counterpart, label }: {
    transaction: Transaction; answer: TransferAnswer; counterpart?: Transaction; label: string;
  }): Promise<boolean> => {
    if (saving.current) return false;
    const request = buildTransferAnswer({ transaction, answer: choice, counterpart, generation: getStateGeneration() });
    // The row on screen may be older than the store; refuse rather than overwrite.
    const latest = new Map(getStateSnapshot().transactions.map(row => [row.id, row]));
    if (Object.entries(request.expectedFingerprints).some(([id, print]) => {
      const row = latest.get(id);
      return !row || transferFingerprint(row) !== print;
    })) {
      toast.show(words.changed, { tone: 'error' });
      return false;
    }
    saving.current = true; setBusy(true);
    try {
      const outcome = await commit(request);
      if (outcome === 'saved') {
        toast.show(`${words.saved} · ${label}`, { tone: 'success',
          actions: [{ label: words.undo, onPress: () => { void undo(transaction.id); } }] });
        return true;
      }
      toast.show(outcome === 'changed' ? words.changed : words.failed, { tone: 'error' });
      return false;
    } finally {
      saving.current = false; setBusy(false);
    }
  }, [commit, getStateGeneration, getStateSnapshot, toast, undo, words]);

  return { answer, busy };
}
