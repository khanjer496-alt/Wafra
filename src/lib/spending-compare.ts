/**
 * The direction Spending's Compare sentence states, from the existing
 * like-for-like figures (`comparableSpend`: everyday spending, fixed costs
 * left out, the same elapsed stretch of both periods). A change smaller than
 * the noise floor, or 2% of the earlier figure, reads as "about the same" —
 * the rule the Compare view has always used.
 */
import type { ComparableSpend } from '@/lib/analytics';

export type CompareDirection = 'more' | 'less' | 'same';

export function compareDirection(comparison: ComparableSpend, noiseFloorFils: number): CompareDirection {
  const floor = Math.max(noiseFloorFils, comparison.previousFils * 0.02, 1);
  if (Math.abs(comparison.deltaFils) < floor) return 'same';
  return comparison.deltaFils > 0 ? 'more' : 'less';
}
