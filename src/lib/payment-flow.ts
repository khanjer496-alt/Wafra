import type { Transaction } from '@/lib/types';

/**
 * Maximum delay between an internal funding alert and the named bill-pay
 * confirmation it enabled. The owner's retained UAE corpus has three proven
 * pairs at 66–115 seconds; five minutes covers delivery skew without turning
 * ordinary same-amount transfers later in the day into one event.
 */
const PAYMENT_FLOW_WINDOW_MS = 5 * 60_000;
const COMPOUND_BILL_WINDOW_MS = 3 * 24 * 60 * 60_000;

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

const providerKey = (title: string): string => {
  const key = title.normalize('NFKC').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (/^(?:e and(?: uae)?|etisalat|e digital app)$/.test(key)) return 'etisalat';
  return key;
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
    if (row.source !== 'sms' || row.type !== 'expense') continue;
    const bucket = buckets.get(row.amountFils) ?? { funding: [], receipts: [] };
    const inferredFunding =
      row.paymentFlowSide === undefined &&
      row.isTransfer === true &&
      /^(?:Outgoing|Bank) transfer$/i.test(row.title);
    if (row.paymentFlowSide === 'funding' || inferredFunding) {
      if (!row.userEdited && !row.transferDecision && row.isTransfer === true) bucket.funding.push(row);
    } else if (row.paymentFlowSide === 'receipt') {
      if (row.isTransfer !== true) bucket.receipts.push(row);
    } else {
      continue;
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

  // A biller can confirm each service separately after one combined checkout.
  // e& is a concrete example: two line receipts (e.g. mobile + home internet)
  // can add exactly to one card debit. Those are allocations of one economic
  // event, not three expenses. Only fold when we have 2+ explicit biller
  // receipts, their exact integer-fils sum equals an independently captured
  // ordinary expense, all rows share the same category, and every event is
  // close in time. This deliberately refuses amount-only guessing.
  const ordinary = transactions.filter(row =>
    row.source === 'sms' && row.type === 'expense' &&
    row.paymentFlowSide === undefined && row.isTransfer !== true &&
    !row.userEdited && !row.transferDecision && eventTime(row) !== null);
  const receiptRows = transactions.filter(row =>
    row.source === 'sms' && row.type === 'expense' &&
    row.paymentFlowSide === 'receipt' && row.isTransfer !== true &&
    !row.userEdited && !row.transferDecision && eventTime(row) !== null);

  for (const parent of ordinary) {
    const parentTime = eventTime(parent)!;
    const candidates = receiptRows.filter(row =>
      !removed.has(row.id) &&
      row.category === parent.category &&
      providerKey(row.title) === providerKey(parent.title) &&
      Math.abs(eventTime(row)! - parentTime) <= COMPOUND_BILL_WINDOW_MS &&
      row.amountFils > 0 && row.amountFils < parent.amountFils);
    // Bill bundles are intentionally bounded. Exhaustive subset search over a
    // large history would be both slow and dangerously eager.
    if (candidates.length < 2 || candidates.length > 8) continue;
    let match: Transaction[] | null = null;
    const limit = 1 << candidates.length;
    for (let mask = 1; mask < limit && !match; mask++) {
      if ((mask & (mask - 1)) === 0) continue; // require at least two receipts
      let sum = 0;
      const rows: Transaction[] = [];
      for (let i = 0; i < candidates.length; i++) {
        if ((mask & (1 << i)) === 0) continue;
        sum += candidates[i].amountFils;
        if (sum > parent.amountFils) break;
        rows.push(candidates[i]);
      }
      if (rows.length >= 2 && sum === parent.amountFils) match = rows;
    }
    if (match) for (const child of match) removed.add(child.id);
  }
  return removed.size === 0 ? transactions : transactions.filter((row) => !removed.has(row.id));
};
