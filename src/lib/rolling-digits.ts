/**
 * Which glyphs of a money figure roll when its value changes.
 *
 * The motion rules: money never spins. Only the digits that actually changed
 * roll, once, 60 ms apart; everything else — unchanged digits, group marks,
 * the decimal mark, the sign — stays still. The two strings are aligned from
 * the RIGHT so units stay over units when the figure grows a digit
 * ("99.00" → "100.00" rolls the 1 and the two 0s it pushed, not the cents).
 */

export interface RollingGlyph {
  /** Stable per position counted from the right, so React keeps identity. */
  key: string;
  char: string;
  /** What stood in this position before, or '' when the position is new. */
  previous: string;
  /** True only for a digit whose value differs from the previous figure's. */
  changed: boolean;
  /**
   * Order among changed digits, starting at 0 with the rightmost, used to
   * stagger their start. -1 for a glyph that does not roll.
   */
  order: number;
}

const DIGIT = /^[0-9٠-٩۰-۹]$/;

export function isRollingDigit(char: string): boolean {
  return DIGIT.test(char);
}

/**
 * Split `next` into glyphs and mark which roll relative to `previous`.
 * `previous` null (first appearance) or identical marks nothing: a figure's
 * first paint and a re-render with the same value are both static.
 */
export function diffRollingGlyphs(previous: string | null, next: string): RollingGlyph[] {
  const nextChars = Array.from(next);
  const prevChars = previous === null ? null : Array.from(previous);
  const glyphs: RollingGlyph[] = [];
  let order = 0;
  for (let i = nextChars.length - 1; i >= 0; i--) {
    const fromRight = nextChars.length - 1 - i;
    const char = nextChars[i];
    const prevIndex = prevChars ? prevChars.length - 1 - fromRight : -1;
    const before = prevChars && prevIndex >= 0 ? prevChars[prevIndex] : '';
    const changed = prevChars !== null && previous !== next && isRollingDigit(char) && before !== char;
    glyphs.push({ key: `p${fromRight}`, char, previous: before, changed, order: changed ? order++ : -1 });
  }
  return glyphs.reverse();
}

/** Start delay for a rolling glyph: `order × stagger`, 0 for a static one. */
export function rollingDelay(glyph: RollingGlyph, staggerMs: number): number {
  return glyph.order < 0 ? 0 : glyph.order * staggerMs;
}
