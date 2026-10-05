import { useRef, useState } from 'react';

import { useToast } from '@/components/ui/toast';
import { useLanguage } from '@/hooks/use-language';
import { useTransferAnswer } from '@/hooks/use-transfer-answer';
import { useStoreActions } from '@/lib/store';
import type { TransferAnswer } from '@/lib/transfer-answer';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { transferBatchChangedIds, transferBatchDecisions, transferRowsChanged, type TransferBatchItem } from '@/lib/transfer-batch';
import type { Transaction } from '@/lib/types';

/** One answer for several items, with everything frozen at the moment they were picked. */
export interface TransferBatch {
  items: TransferBatchItem[];
  answer: TransferAnswer | null;
  expectedFingerprints: Record<string, string>;
  expectedGeneration: number;
}

/**
 * The Transfers page's "answer several at once": a group row, or the rows
 * ticked in select mode. This is the bulk review screen's confirmation,
 * moved here unchanged in what it guarantees: one explicit-selection
 * `resolveTransferBatch` request, fingerprints and generation frozen when the
 * items were picked and checked again against authoritative state before the
 * write, a repeated-tap guard, and a durability retry that only re-persists
 * (it never applies the decisions a second time) and holds the sheet open
 * until the answer is safely saved or the ledger has moved on.
 */
export function useTransferBatch({ rowsById, onSaved }: {
  /** The ledger rows as this render sees them, to show when the frozen preview went stale. */
  rowsById: ReadonlyMap<string, Transaction>;
  /** The rows the save changed, once it is applied. */
  onSaved?: (changedIds: string[]) => void;
}) {
  const words = transferActivityCopy(useLanguage());
  const toast = useToast();
  const { resolveTransferBatch, getStateGeneration, getStateSnapshot, ensureDurable } = useStoreActions();
  const { undoMany } = useTransferAnswer();
  const [batch, setBatch] = useState<TransferBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsDurability, setNeedsDurability] = useState(false);
  const saving = useRef(false);
  const stale = !!batch && (getStateGeneration() !== batch.expectedGeneration ||
    transferRowsChanged(batch.expectedFingerprints, rowsById));

  /** Open the sheet on these items. Refused (with a toast) when the ledger moved since they were picked. */
  const open = (items: TransferBatchItem[], answer: TransferAnswer | null): boolean => {
    if (saving.current || items.length === 0) return false;
    // Keep the details and fingerprints captured at selection time. Never
    // replace a checked item with a newer import while opening confirmation.
    if (items.some(item => item.expectedGeneration !== getStateGeneration())) {
      toast.show(words.batch.changed, { tone: 'error' });
      return false;
    }
    setBatch({ items, answer,
      expectedFingerprints: Object.fromEntries(items.flatMap(item => Object.entries(item.expectedFingerprints))),
      expectedGeneration: items[0].expectedGeneration });
    setError(null);
    setNeedsDurability(false);
    return true;
  };

  /** Pick or change the answer. Fixed once a save is applied and only its write is pending. */
  const choose = (answer: TransferAnswer) => {
    if (saving.current || needsDurability) return;
    setBatch(current => current ? { ...current, answer } : current);
    setError(null);
  };

  const close = () => {
    if (saving.current || (needsDurability && !stale)) return;
    setBatch(null);
    setError(null);
    setNeedsDurability(false);
  };

  // Pass the current preview explicitly. A default named `selection` plus a
  // body-local binding was misbound by the production web transform.
  const save = async (target: TransferBatch | null) => {
    const selection = target;
    if (!selection || selection.answer === null || saving.current || stale) return;
    // A retry does not enter the resolver again. Check its post-decision
    // fingerprints against authoritative state, even before React re-renders.
    const latest = new Map(getStateSnapshot().transactions.map(row => [row.id, row]));
    if (getStateGeneration() !== selection.expectedGeneration || transferRowsChanged(selection.expectedFingerprints, latest)) {
      setError(words.batch.changed);
      return;
    }
    const changedIds = transferBatchChangedIds(selection.items);
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      if (needsDurability) await ensureDurable();
      else await resolveTransferBatch({
        decisions: transferBatchDecisions(selection.items, selection.answer),
        expectedFingerprints: selection.expectedFingerprints, expectedGeneration: selection.expectedGeneration,
      });
      toast.show(words.batch.saved(changedIds.length), { tone: 'success',
        actions: [{ label: words.answers.undo, onPress: () => { void undoMany?.(changedIds); } }] });
      setBatch(null);
      setNeedsDurability(false);
      onSaved?.(changedIds);
    } catch (failure) {
      const details = typeof failure === 'object' && failure !== null ? failure : {};
      const code = 'code' in details ? details.code : undefined;
      if (code === 'transfer-durability') {
        const fingerprints = 'expectedFingerprints' in details ? details.expectedFingerprints : undefined;
        if (fingerprints && typeof fingerprints === 'object' && !Array.isArray(fingerprints) &&
          Object.values(fingerprints).every(value => typeof value === 'string') &&
          changedIds.every(id => id in fingerprints)) {
          // Advance the guard to the rows the store did change, so the retry
          // checks the decided rows rather than the ones shown before saving.
          setBatch({ ...selection, expectedFingerprints: {
            ...selection.expectedFingerprints, ...fingerprints as Record<string, string>,
          } });
        }
        setNeedsDurability(true);
      }
      setError(code === 'transfer-durability' || needsDurability ? words.batch.durability : words.batch.failed);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return { batch, busy, error, stale, needsDurability, open, choose, close, save };
}
