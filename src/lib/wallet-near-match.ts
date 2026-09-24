import {
  emptyAlertReviewTray,
  partitionReviewsByCapacity,
  type AlertReviewTrayState,
  type ReviewEntry,
} from '@/lib/alert-review-tray';
import type { ImportPlan, WalletNearMatch } from '@/lib/import-plan';
import { canonicalUniversalSourceKey } from '@/lib/universal-import';

/**
 * How every capture collector turns an import plan's possible Apple Pay
 * duplicates into durable Review items.
 *
 * The planner withholds a bank alert that nearly matches an unbound Wallet
 * row. A collector stages the returned `reviews` in the SAME synchronous turn
 * as its importBatch (the store persists one ledger snapshot, so the batch's
 * durable write carries the tray too), awaits that durability, and only then
 * acknowledges the source or lets its cursor stand.
 *
 * A review the tray cannot hold without evicting another possible money
 * movement is never dropped: `post` restores the posting the alert would have
 * made (a visible duplicate is recoverable); `defer` hands it back so a
 * queue-backed collector can keep its native record for a later drain.
 */
export interface WalletNearMatchSettlement {
  plan: ImportPlan;
  reviews: ReviewEntry[];
  deferred: WalletNearMatch[];
}

export function settleWalletNearMatches(
  plan: ImportPlan,
  tray: AlertReviewTrayState | null | undefined,
  now: number,
  overflow: 'post' | 'defer' = 'post',
): WalletNearMatchSettlement {
  const matches = plan.walletNearMatches ?? [];
  if (matches.length === 0) return { plan, reviews: [], deferred: [] };
  const { deferred } = partitionReviewsByCapacity(
    tray ?? emptyAlertReviewTray(),
    matches.map((match) => match.review),
    now,
  );
  const full = new Set<ReviewEntry>(deferred);
  const staged = matches.filter((match) => !full.has(match.review));
  const overflowed = matches.filter((match) => full.has(match.review));
  const reviews = staged.map((match) => match.review);
  if (overflowed.length === 0) return { plan, reviews, deferred: [] };
  if (overflow === 'defer') return { plan, reviews, deferred: overflowed };
  return {
    plan: {
      ...plan,
      batch: {
        ...plan.batch,
        transactions: [...plan.batch.transactions, ...overflowed.map((match) => match.transaction)],
      },
      txCount: plan.txCount + overflowed.length,
    },
    reviews,
    deferred: [],
  };
}

/** Whether each exact review source is pending or already decided (live tombstone). */
export function walletNearMatchesRetained(
  tray: AlertReviewTrayState | null | undefined,
  reviews: readonly ReviewEntry[],
  now: number,
): boolean {
  return reviews.every((review) => {
    const key = canonicalUniversalSourceKey(review.sourceKey, review.observedAt);
    return (tray?.pending ?? []).some((entry) =>
      canonicalUniversalSourceKey(entry.sourceKey, entry.observedAt) === key) ||
      (tray?.tombstones ?? []).some((entry) =>
        entry.expiresAt > now && canonicalUniversalSourceKey(entry.sourceKey) === key);
  });
}

/** Source-free refusal: the caller must not acknowledge or advance past the alert. */
export class WalletNearMatchStagingError extends Error {
  constructor() {
    super('Possible Apple Pay duplicate was not kept for Review');
    this.name = 'WalletNearMatchStagingError';
  }
}

export interface StagedWalletNearMatches {
  /** The plan to import (with fallback postings when Review was full). */
  plan: ImportPlan;
  /** Newly admitted review items (0 for replays of already staged ones). */
  admitted: number;
  /**
   * Await before acknowledging, committing or discarding the source. Rejects
   * when an item is not durably retained, so the caller keeps its source.
   */
  settle: () => Promise<void>;
}

/**
 * Settle and stage a plan's possible Apple Pay duplicates. The staging write
 * is dispatched synchronously: call this in the same turn as the importBatch
 * that follows. Nothing is dispatched when there are none.
 */
export function stageWalletNearMatches(
  plan: ImportPlan,
  getTray: () => AlertReviewTrayState | null | undefined,
  stage: ((items: ReviewEntry[]) => { admitted: number; durable: Promise<void> }) | undefined,
): StagedWalletNearMatches {
  const settled = settleWalletNearMatches(plan, getTray(), Date.now());
  if (settled.reviews.length === 0) return { plan: settled.plan, admitted: 0, settle: async () => {} };
  if (!stage) throw new WalletNearMatchStagingError();
  const receipt = stage(settled.reviews);
  // Staging dispatches synchronously. Any item the tray refused is posted in
  // this same batch, before a cursor or history checkpoint can move past it.
  const now = Date.now();
  const kept = settled.reviews.filter((review) => walletNearMatchesRetained(getTray(), [review], now));
  const refused = new Set(settled.reviews.filter((review) => !kept.includes(review)));
  const fallback = (plan.walletNearMatches ?? []).filter((match) => refused.has(match.review));
  const staged = fallback.length === 0 ? settled.plan : {
    ...settled.plan,
    batch: {
      ...settled.plan.batch,
      transactions: [...settled.plan.batch.transactions, ...fallback.map((match) => match.transaction)],
    },
    txCount: settled.plan.txCount + fallback.length,
  };
  return {
    plan: staged,
    admitted: receipt.admitted,
    settle: async () => {
      await receipt.durable;
      if (!walletNearMatchesRetained(getTray(), kept, Date.now())) {
        throw new WalletNearMatchStagingError();
      }
    },
  };
}
