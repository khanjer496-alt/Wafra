import type { AppState, Transaction } from '@/lib/types';

/**
 * Why a message ended up on this list — two very different failures that were
 * being reported as one.
 *
 * A real export of 177 entries turned out to be almost entirely `uncategorized`:
 * the merchant name was read correctly every time, it just had no category
 * rule. Calling all of that "could not read" overstated the problem and buried
 * the handful of messages the grammar genuinely cannot parse.
 */
export type UnreadReason = 'unread' | 'uncategorized';

/** The title the parser falls back to when it cannot find a merchant at all. */
const GENERIC_MERCHANT = 'Card purchase';

export interface UnreadFormat {
  /** One representative message for this format. */
  raw: string;
  title: string;
  category: string;
  /** How many transactions share this format. */
  count: number;
  amountFils: number;
  reason: UnreadReason;
}

/**
 * Bank message formats the parser could not read confidently, one entry per
 * format rather than per transaction.
 *
 * Digits are blanked to build the key, so ten Carrefour charges that differ
 * only in amount and date collapse into a single row. That is what makes the
 * list short enough to act on: a user with 400 unparsed rows usually has
 * three unrecognised formats.
 */
export function unreadFormats(
  transactions: Transaction[],
  categoryLabel: (id: Transaction['category']) => string,
): UnreadFormat[] {
  const byFormat = new Map<string, UnreadFormat>();
  for (const tx of transactions) {
    if (!tx.raw) continue;
    const key = tx.raw.replace(/\d/g, '#');
    const cur = byFormat.get(key);
    if (cur) {
      cur.count += 1;
      continue;
    }
    byFormat.set(key, {
      raw: tx.raw,
      title: tx.title,
      category: categoryLabel(tx.category),
      count: 1,
      amountFils: tx.amountFils,
      reason: tx.title === GENERIC_MERCHANT ? 'unread' : 'uncategorized',
    });
  }
  // Unread first: those are the ones where the app shows the user nothing
  // useful at all, and they are usually the short list.
  return [...byFormat.values()].sort(
    (a, b) => Number(b.reason === 'unread') - Number(a.reason === 'unread') || b.count - a.count,
  );
}

/**
 * Distinct unrecognised formats. Cheap enough to call on every Home render —
 * it walks transactions once and allocates a set of keys, not the full rows.
 */
export function unreadFormatCount(state: AppState): number {
  const keys = new Set<string>();
  for (const tx of state.transactions) {
    if (tx.raw) keys.add(tx.raw.replace(/\d/g, '#'));
  }
  return keys.size;
}

/**
 * Below this, staying quiet is the right call: one stray format is usually a
 * one-off promo the parser was right to skip, and nagging over it trains
 * people to ignore the prompt that matters.
 */
export const REPORT_PROMPT_THRESHOLD = 3;
