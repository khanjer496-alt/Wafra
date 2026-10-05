import type { TransferAnswer } from '@/lib/transfer-answer';
import type { RouteEnd } from '@/lib/transfer-list';
import { transferFingerprint } from '@/lib/transfer-reconciliation';
import type { TransferAssessment, TransferDecisionBatchRequest, TransferReviewGroup } from '@/lib/transfer-reconciliation-types';
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
  /**
   * A group that cannot be answered as a whole (its entries are ambiguous):
   * its sheet only lists the entries, each answered on its own. Never saved.
   */
  listOnly?: true;
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
  /** Its own likely other side ("Looks like your …"), shown with it rather than merged into one line. */
  hint?: string;
}

/**
 * Which words the answers use for these items: money in only (true), money
 * out only (false), or both ('mixed'). A suggested pair moves money out of one
 * account and into another, so it is both.
 */
export function transferBatchIncoming(items: readonly Pick<TransferBatchItem, 'direction'>[]): boolean | 'mixed' {
  if (items.length > 0 && items.every(item => item.direction === 'income')) return true;
  return items.some(item => item.direction === 'income' || item.direction === 'between') ? 'mixed' : false;
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
 * A list-only group (entries answered one by one) is never answered whole.
 */
export function transferBatchDecisions(
  items: readonly Pick<TransferBatchItem, 'ids' | 'counterpartId' | 'kind' | 'listOnly'>[], answer: TransferAnswer,
): TransferDecisionBatchRequest['decisions'] {
  if (items.some(item => item.listOnly)) throw new Error('These entries are answered one at a time');
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

/** Assessments that name one specific other side worth suggesting. */
const SUGGESTED_STATUSES: ReadonlySet<TransferAssessment['status']> = new Set(['likely-own', 'likely-card-repayment']);

/** A pending group as the Transfers page offers it. */
export type TransferAnswerGroup = TransferReviewGroup & {
  /**
   * One answer may be given to every entry at once: the reconciler marked the
   * group bulk-eligible (one known other side), or every entry is a suggestion
   * whose matching entry sits on the same one other account. A catch-all group
   * (ambiguous, ownership unknown, "Account → ?") is answered entry by entry.
   */
  whole: boolean;
  /**
   * Entries whose id is carried by more than one stored row. Nothing can tell
   * those observations apart, so the store refuses any answer to them: they
   * are shown, read-only, and never ticked or saved.
   */
  duplicate?: true;
};

/** True when every entry's suggested other side exists and is on the same one account. */
function sharesOneSuggestion(ids: readonly string[], assessments: ReadonlyMap<string, TransferAssessment>,
  rowsById: ReadonlyMap<string, Transaction>): boolean {
  const accounts = new Set<string>();
  for (const id of ids) {
    const assessment = assessments.get(id);
    const other = assessment?.counterpartId && SUGGESTED_STATUSES.has(assessment.status)
      ? rowsById.get(assessment.counterpartId) : undefined;
    if (!other || other.id === id) return false;
    accounts.add(other.accountId);
  }
  return accounts.size === 1;
}

/**
 * The groups the Transfers list shows as one route with an "N entries" count:
 * the reconciler's pending groups, keeping only rows still waiting for an
 * answer (pending, no decision, not a leg of a suggested pair, which is asked
 * about as its own route). A group stays when it still holds several entries,
 * or when one of its entries is not listed anywhere else on the page (a likely
 * card repayment, an archived account), so every queued entry can be reached
 * from the page. Duplicate-id observations are split off into their own
 * read-only group.
 */
export function transferAnswerGroups({ groups, pendingIds, rowsById, excludeIds, listedIds,
  assessments = new Map(), duplicateIds = new Set() }: {
  groups: readonly TransferReviewGroup[];
  pendingIds: ReadonlySet<string>;
  rowsById: ReadonlyMap<string, Transaction>;
  excludeIds: ReadonlySet<string>;
  listedIds: ReadonlySet<string>;
  /** The reconciler's assessments, to tell a group with one shared suggestion from a catch-all. */
  assessments?: ReadonlyMap<string, TransferAssessment>;
  /** Ids carried by more than one stored row (duplicateTransactionIds). */
  duplicateIds?: ReadonlySet<string>;
}): TransferAnswerGroup[] {
  const result: TransferAnswerGroup[] = [];
  for (const group of groups) {
    const waiting = group.transactionIds.filter(id => pendingIds.has(id) && !excludeIds.has(id) &&
      !!rowsById.get(id) && !rowsById.get(id)!.transferDecision);
    const transactionIds = waiting.filter(id => !duplicateIds.has(id));
    const duplicates = waiting.filter(id => duplicateIds.has(id));
    if (transactionIds.length > 1 || transactionIds.some(id => !listedIds.has(id))) {
      result.push({ ...group, transactionIds,
        whole: group.bulkEligible || (SUGGESTED_STATUSES.has(group.status) && sharesOneSuggestion(transactionIds, assessments, rowsById)) });
    }
    if (duplicates.length) {
      result.push({ ...group, id: `${group.id}:duplicate`, transactionIds: duplicates, bulkEligible: false, whole: false, duplicate: true });
    }
  }
  return result;
}
