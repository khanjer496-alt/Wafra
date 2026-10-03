import React from 'react';

import { PatternMosaic } from '@/components/ui/pattern-mosaic';
import { usePatternTiles } from '@/hooks/use-pattern';

type Props = Omit<React.ComponentProps<typeof PatternMosaic>, 'tiles'>;

/**
 * The signed-in person's own pattern, read from the ledger. Its own component
 * so only it subscribes to the pattern's inputs: the screen around it (Home,
 * the lock screen, the recap cover) does not re-render when they change.
 */
export function YourPattern(props: Props) {
  const tiles = usePatternTiles();
  return <PatternMosaic tiles={tiles} {...props} />;
}
