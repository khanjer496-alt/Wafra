/**
 * The arithmetic behind Wafra's coin drawings, kept pure so it is tested:
 * how many coins of a fixed stack a share fills, and where a moving coin sits
 * along a route. The drawings never carry the figure itself; the amount is
 * always written beside them in full.
 */

/**
 * Coins of a `total`-coin stack that a share fills. Any money left shows at
 * least one coin, and only a share of 1 or more fills the whole stack, so a
 * nearly empty or nearly full budget is never drawn as exactly empty or full.
 */
export function filledCoins(share: number, total: number): number {
  const count = Math.max(1, Math.floor(total));
  if (!Number.isFinite(share) || share <= 0) return 0;
  if (share >= 1) return count;
  return Math.min(count - 1, Math.max(1, Math.round(share * count)));
}

/** A share between 0 and 1 from a part and a whole; 0 when the whole is not positive. */
export function shareOf(part: number, whole: number): number {
  if (!(whole > 0) || !Number.isFinite(part)) return 0;
  return Math.min(1, Math.max(0, part / whole));
}
