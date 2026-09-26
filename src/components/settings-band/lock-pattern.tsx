import React, { useMemo } from 'react';

import { PatternMosaic } from '@/components/ui/pattern-mosaic';
import { usePatternTiles } from '@/hooks/use-pattern';
import { redactPatternTiles } from '@/lib/pattern-redact';

type Props = Omit<React.ComponentProps<typeof PatternMosaic>, 'tiles'>;

/**
 * The person's pattern as the lock screen shows it: same cells and colours,
 * no initial and no category glyphs (pattern-redact.ts). Subscribes only to
 * the pattern's inputs, like YourPattern, never to money.
 */
export function LockPattern(props: Props) {
  const tiles = usePatternTiles();
  const redacted = useMemo(() => redactPatternTiles(tiles), [tiles]);
  return <PatternMosaic tiles={redacted} {...props} />;
}
