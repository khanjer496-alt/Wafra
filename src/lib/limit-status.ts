/**
 * The shared limit health rule, for the language-E status bar: within the
 * limit, near it from 85%, over it once exceeded. Same thresholds as
 * Spending's category rows (spending-overview.tsx). Colour in a list means
 * this status and nothing else — never a category's identity.
 */
export type LimitStatus = 'ok' | 'near' | 'over';

export const NEAR_LIMIT_RATIO = 0.85;

export function limitStatus(spentMinor: number, limitMinor: number): LimitStatus {
  if (!(limitMinor > 0)) return spentMinor > 0 ? 'over' : 'ok';
  const ratio = spentMinor / limitMinor;
  return ratio > 1 ? 'over' : ratio >= NEAR_LIMIT_RATIO ? 'near' : 'ok';
}

/** Filled share of the bar, 0–100, never past the end. */
export function limitFillPercent(spentMinor: number, limitMinor: number): number {
  if (!(limitMinor > 0)) return spentMinor > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, (spentMinor / limitMinor) * 100));
}
