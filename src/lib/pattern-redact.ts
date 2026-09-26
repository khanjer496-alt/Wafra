/**
 * The lock screen's pattern: the same cells and colours as the person's
 * pattern, with nothing that identifies them.
 *
 * The full pattern carries two personal marks: the initial of their name on
 * the first tile and the icons of the categories they chose to watch. The lock
 * screen is shown to whoever holds the phone, so there each of those becomes a
 * plain shape at the same position — the letter tile a square in its ground
 * colour, a category glyph tile a circle in its glyph colour. Home and the
 * recap keep the full pattern.
 */
import type { PatternTile } from '@/lib/pattern';

export function redactPatternTiles(tiles: readonly PatternTile[]): PatternTile[] {
  return tiles.map((tile) => {
    if (tile.kind === 'letter') {
      return { key: tile.key, group: tile.group, kind: 'square', col: tile.col, row: tile.row, color: tile.color, order: tile.order };
    }
    if (tile.kind === 'glyph') {
      // The key named the category too; the cell is enough to keep it unique.
      return { key: `${tile.group}:${tile.col}:${tile.row}`, group: tile.group, kind: 'circle', col: tile.col, row: tile.row,
        color: tile.mark ?? tile.color, order: tile.order };
    }
    return tile;
  });
}
