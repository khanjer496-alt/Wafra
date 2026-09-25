/**
 * How far Larger Text may grow a one-line money figure.
 *
 * A figure is the reason a hero or a story page exists, so it is never
 * truncated. At the accessibility text sizes it shrinks toward the width it
 * has, but never below 60% of the size Larger Text asked for — the floor
 * `adjustsFontSizeToFit` would use with `minimumFontScale={0.6}` — and past
 * that floor it wraps inside its own row. The full amount is always in the
 * accessibility label of the component that draws it.
 *
 * Computed from the character count rather than with `adjustsFontSizeToFit`,
 * so iOS, Android and the browser harness all draw the same size, and returned
 * as a `maxFontSizeMultiplier` so the system still does the scaling.
 */

/** Geist Mono's advance per em, with room for the separators' tracking. */
export const MONO_ADVANCE = 0.62;

/** The smallest share of the requested Larger Text size a figure may shrink to. */
export const MIN_FIGURE_SCALE = 0.6;

/**
 * @param chars          characters in the figure, sign included
 * @param size           the figure's base point size
 * @param cap            the most Larger Text may grow it (its type ramp cap)
 * @param availableWidth the width it has, in points
 * @param fontScale      the system font scale
 * @returns a maxFontSizeMultiplier, or undefined at the default text size
 */
export function figureFontMultiplier(
  chars: number,
  size: number,
  cap: number,
  availableWidth: number,
  fontScale: number,
): number | undefined {
  if (!(fontScale > 1) || chars <= 0 || size <= 0) return undefined;
  const wanted = Math.min(fontScale, cap);
  const fits = availableWidth / (chars * size * MONO_ADVANCE);
  return Math.max(1, wanted * MIN_FIGURE_SCALE, Math.min(wanted, fits));
}
