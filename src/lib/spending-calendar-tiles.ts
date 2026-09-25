/**
 * Colours for Spending's calendar tiles on the band (design language E).
 *
 * A day's tile is the band's own text colour laid over the band at a
 * strength that grows with the day's everyday spending — one tone, never a
 * hue per category. The day number on a filled tile is set in the dark ink
 * the palette uses on light fills (`onAccent`), and the weakest fill is chosen
 * per palette so that ink always reads at 4.5:1; an empty day keeps the band
 * behind it and the band's own text colour. Pure, so the contrast rule is
 * tested for every band and scheme.
 */
import type { BandPalette } from '@/constants/theme';

type Rgb = readonly [number, number, number];

function parseHex(hex: string): Rgb {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value.slice(0, 6);
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as unknown as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** `top` laid over `bottom` at `alpha` (0–1), as an opaque hex. */
export function blendHex(top: string, bottom: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const t = parseHex(top);
  const b = parseHex(bottom);
  return toHex([0, 1, 2].map((i) => t[i]! * a + b[i]! * (1 - a)) as unknown as Rgb);
}

function luminance(hex: string): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseHex(hex).map(channel) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The strongest fill a tile ever takes: the busiest day. */
export const MAX_TILE_ALPHA = 0.92;

/**
 * The weakest fill at which the dark ink still reads at 4.5:1 on this band.
 * Found by stepping up from 0.2; a band where even the strongest fill fails
 * (none today) would use the strongest.
 */
export function minTileAlpha(palette: BandPalette): number {
  for (let step = 20; step <= MAX_TILE_ALPHA * 100; step += 1) {
    const alpha = step / 100;
    if (contrastRatio(palette.onAccent, blendHex(palette.onBand, palette.band, alpha)) >= 4.5) return alpha;
  }
  return MAX_TILE_ALPHA;
}

export interface CalendarTileColors {
  /** Null for a day with nothing spent: the band shows through. */
  background: string | null;
  text: string;
}

/**
 * A day's tile. `share` is the day's everyday spending against the busiest
 * lived day of the month (0–1). Zero is an empty day.
 */
export function calendarTileColors(palette: BandPalette, share: number, minAlpha = minTileAlpha(palette)): CalendarTileColors {
  if (!(share > 0)) return { background: null, text: palette.onBand };
  const clamped = Math.min(1, share);
  const alpha = minAlpha + (MAX_TILE_ALPHA - minAlpha) * clamped;
  const background = blendHex(palette.onBand, palette.band, alpha);
  // Dark ink on the light fills of a dark band (Spending's clay); a band
  // whose own text is dark fills toward that dark, so its tiles take the band
  // colour for their numbers instead. The better of the two, always.
  const text = contrastRatio(palette.onAccent, background) >= contrastRatio(palette.band, background)
    ? palette.onAccent : palette.band;
  return { background, text };
}
