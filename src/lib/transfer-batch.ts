import type { TransferAnswer } from '@/lib/transfer-answer';
import type { RouteEnd } from '@/lib/transfer-list';
import { transferFingerprint } from '@/lib/transfer-reconciliation';
import type { TransferDecisionBatchRequest, TransferReviewGroup } from '@/lib/transfer-reconciliation-types';
import type { Transaction } from '@/lib/types';

/**
 * One thing the person answers on the Transfers page with a single tap: a
 * suggested pair (both legs), one entry, or a group of entries the reconciler
 * put together (same account, same kind, same other side). Everything is
 * frozen when it is picked; the store re-checks every fingerprint and the
 * generation before it changes anything.
 */
export interface TransferBatchItem {
  key: string;
  kind: 'pair' | 'entry' | 'group';
  /**
   * The rows this item answers. A pair carries only its anchor leg here (the
   * leg whose assessment names the other) and the other leg as `counterpartId`.
   */
  ids: string[];
  /** A suggested pair's other leg: linked when the answer is own, answered alongside otherwise. */
  counterpartId?: string;
  direction: 'income' | 'expense' | 'between';
  expectedFingerprints: Record<string, string>;
  expectedGeneration: number;
  /** What the person saw when they picked it; never refreshed from a newer ledger. */
  preview: TransferBatchPreview;
}

/** One picked item drawn as its Transfers route. */
export interface TransferBatchPreview {
  from: RouteEnd; to: RouteEnd;
  fromLabel: string; toLabel: string;
  amountFils: number;
  sign: 'none' | 'minus' | 'plus';
  /** Bank entries it stands for (a pair is two). */
  count: number;
  dates: string;
  /** The whole route as one sentence for screen readers. */
  spoken: string;
  /** A pair whose legs differ in amount names the other leg's amount; the two are never merged. */
  note?: string;
}

/** The rows an answer to these items changes: every id, and a pair's other leg. */
export function transferBatchChangedIds(items: readonly Pick<TransferBatchItem, 'ids' | 'counterpartId'>[]): string[] {
  return items.flatMap(item => [...item.ids, ...(item.counterpartId ? [item.counterpartId] : [])]);
}

/**
 * The explicit-selection request for one answer. Every entry is its own
 * singleton decision (never a legacy multi-id group decision, which needs a
 * known-counterparty group); a suggested pair answered "own" is one linked
 * decision, exactly as the per-pair Match made it; a pair answered otherwise is
 * answered leg by leg. The person's answer applies to every row they saw.
 */
export function transferBatchDecisions(
  items: readonly Pick<TransferBatchItem, 'ids' | 'counterpartId' | 'kind'>[], answer: TransferAnswer,
): TransferDecisionBatchRequest['decisions'] {
  return items.flatMap(item => {
    if (item.kind === 'pair' && item.counterpartId) {
      return answer === 'own'
        ? [{ ids: [item.ids[0]], ownership: 'own' as const, counterpartId: item.counterpartId }]
        : [{ ids: [item.ids[0]], ownership: answer }, { ids: [item.counterpartId], ownership: answer }];
    }
    return item.ids.map(id => ({ ids: [id], ownership: answer }));
  });
}

/** Fingerprint exactly the rows shown, at the moment they are picked. */
export function freezeTransferRows(rows: readonly Transaction[]): Record<string, string> {
  return Object.fromEntries(rows.map(row => [row.id, transferFingerprint(row)]));
}

/** True when the ledger moved since the fingerprints were taken (or a row is gone). */
export function transferRowsChanged(
  expectedFingerprints: Readonly<Record<string, string>>, rowsById: ReadonlyMap<string, Transaction>,
): boolean {
  return Object.entries(expectedFingerprints).some(([id, expected]) => {
    const current = rowsById.get(id);
    return !current || transferFingerprint(current) !== expected;
  });
}

/**
 * The groups the Transfers list shows as one route with an "N entries" count:
 * the reconciler's pending groups, keeping only rows still waiting for an
 * answer (pending, no decision, not a leg of a suggested pair, which is asked
 * about as its own route). A group stays when it still holds several entries,
 * or when one of its entries is not listed anywhere else on the page (a likely
 * card repayment, an archived account, a duplicate observation), so every
 * queued entry can be reached from the page.
 */
export function transferAnswerGroups({ groups, pendingIds, rowsById, excludeIds, listedIds }: {
  groups: readonly TransferReviewGroup[];
  pendingIds: ReadonlySet<string>;
  rowsById: ReadonlyMap<string, Transaction>;
  excludeIds: ReadonlySet<string>;
  listedIds: ReadonlySet<string>;
}): TransferReviewGroup[] {
  const result: TransferReviewGroup[] = [];
  for (const group of groups) {
    const transactionIds = group.transactionIds.filter(id => pendingIds.has(id) && !excludeIds.has(id) &&
      !!rowsById.get(id) && !rowsById.get(id)!.transferDecision);
    if (transactionIds.length > 1 || transactionIds.some(id => !listedIds.has(id))) result.push({ ...group, transactionIds });
  }
  return result;
}
