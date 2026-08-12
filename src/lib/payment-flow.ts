import type { Transaction } from '@/lib/types';

/**
 * Maximum delay between an internal funding alert and the named bill-pay
 * confirmation it enabled. The owner's retained UAE corpus has three proven
 * pairs at 66–115 seconds; five minutes covers delivery skew without turning
 * ordinary same-amount transfers later in the day into one event.
 */
const PAYMENT_FLOW_WINDOW_MS = 5 * 60_000;

interface MatchScore {
  count: number;
  distance: number;
  pairs: [number, number][];
}

const eventTime = (row: Transaction): number | null => {
  if (Number.isFinite(row.ts)) return row.ts!;
  const match = row.smsKey?.match(/^s(\d+)-/);
  return match ? Number(match[1]) : null;
};

/**
 * Preserve the greatest number of chronological pairs, then choose the
 * smallest total delivery skew. A nearest-row greedy choice can strand a
 * later valid pair when two equal utility payments are made close together.
 */
const preferredPairs = (
  funding: Transaction[],
  receipts: Transaction[],
): [number, number][] => {
  const memo = new Map<string, MatchScore>();
  const solve = (fundingIndex: number, receiptIndex: number): MatchScore => {
    if (fundingIndex >= funding.length || receiptIndex >= receipts.length) {
      return { count: 0, distance: 0, pairs: [] };
    }
    const key = `${fundingIndex}:${receiptIndex}`;
    const cached = memo.get(key);
    if (cached) return cached;

    const fundingTime = eventTime(funding[fundingIndex]);
    const receiptTime = eventTime(receipts[receiptIndex]);
    const distance = fundingTime === null || receiptTime === null || fundingTime > receiptTime
      ? Number.POSITIVE_INFINITY
      : receiptTime - fundingTime;
    let best: MatchScore | null = null;
    if (distance <= PAYMENT_FLOW_WINDOW_MS) {
      const tail = solve(fundingIndex + 1, receiptIndex + 1);
      best = {
        count: tail.count + 1,
        distance: tail.distance + distance,
        pairs: [[fundingIndex, receiptIndex], ...tail.pairs],
      };
    }
    const consider = (candidate: MatchScore) => {
      if (
        best === null ||
        candidate.count > best.count ||
        (candidate.count === best.count && candidate.distance < best.distance)
      ) best = candidate;
    };
    consider(solve(fundingIndex + 1, receiptIndex));
    consider(solve(fundingIndex, receiptIndex + 1));
    const resolved = best ?? { count: 0, distance: 0, pairs: [] };
    memo.set(key, resolved);
    return resolved;
  };
  return solve(0, 0).pairs;
};

/**
 * Collapse one economic bill payment that generated two bank alerts.
 *
 * The generic funding row is an internal account movement. The named receipt
 * is the useful ledger event: it carries the biller, category rule and the
 * account the user can correct once. Removing only the unedited funding row
 * prevents both Spent and Cash out from counting the same payment twice while
 * retaining a user correction verbatim.
 */
export const reconcilePaymentFlows = (transactions: Transaction[]): Transaction[] => {
  const buckets = new Map<number, { funding: Transaction[]; receipts: Transaction[] }>();
  for (const row of transactions) {
    if (row.source !== 'sms' || row.type !== 'expense' || !row.paymentFlowSide) continue;
    const bucket = buckets.get(row.amountFils) ?? { funding: [], receipts: [] };
    if (row.paymentFlowSide === 'funding') {
      if (!row.userEdited && row.isTransfer === true) bucket.funding.push(row);
    } else {
      if (row.isTransfer !== true) bucket.receipts.push(row);
    }
    buckets.set(row.amountFils, bucket);
  }

  const removed = new Set<string>();
  for (const bucket of buckets.values()) {
    const funding = bucket.funding.sort((a, b) => (eventTime(a) ?? 0) - (eventTime(b) ?? 0));
    const receipts = bucket.receipts.sort((a, b) => (eventTime(a) ?? 0) - (eventTime(b) ?? 0));
    for (const [fundingIndex] of preferredPairs(funding, receipts)) {
      removed.add(funding[fundingIndex].id);
    }
  }
  return removed.size === 0 ? transactions : transactions.filter((row) => !removed.has(row.id));
};
