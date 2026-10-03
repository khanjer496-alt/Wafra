import { useMemo } from 'react';

import { buildPattern, patternInputFromState, type PatternInput, type PatternTile } from '@/lib/pattern';
import { useStoreSelector } from '@/lib/store';

const sameInput = (a: PatternInput, b: PatternInput): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The person's pattern tiles from the ledger's answers. Subscribes to the
 * derived input only (name, goals, watched categories, reminder presence),
 * so balance updates, imports and limit amounts never re-render it.
 */
export function usePatternTiles(): PatternTile[] {
  const input = useStoreSelector(({ state }) => patternInputFromState(state), sameInput);
  return useMemo(() => buildPattern(input), [input]);
}
