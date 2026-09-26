/**
 * The lock screen's pattern: the same cells, colours and category icons as the
 * person's pattern, without the initial of their name.
 *
 * The lock screen is shown to whoever holds the phone. The owner chose
 * (2026-09-26) to keep the watched-category icons there, as part of what makes
 * the pattern theirs; only the letter tile becomes a plain square in its
 * ground colour. Home and the recap keep the full pattern.
 */
import type { PatternTile } from '@/lib/pattern';

export function redactPatternTiles(tiles: readonly PatternTile[]): PatternTile[] {
  return tiles.map((tile) => {
    if (tile.kind === 'letter') {
      return { key: tile.key, group: tile.group, kind: 'square', col: tile.col, row: tile.row, color: tile.color, order: tile.order };
    }
    return tile;
  });
}
