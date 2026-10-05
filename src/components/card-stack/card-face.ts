/**
 * Pure figures behind the Payment cards stack: the colours a card face is
 * drawn in, and where each card sits stacked and fanned.
 *
 * Nothing here is a money figure. The stack is a drawing beside the card rows,
 * which keep every written figure and spoken label.
 */
import { BandPalettes } from '@/constants/theme';
import { blendHex, contrastRatio } from '@/lib/spending-calendar-tiles';

/** WCAG AA for the bank name and last four digits on a card face. */
export const FACE_TEXT_CONTRAST = 4.5;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export interface CardFaceColors {
  /** The card's own colour, deepened or lifted only when no text colour reads on it. */
  face: string;
  /** Light (cream) or dark (ink) text, whichever reads better on `face`. */
  text: string;
  /** A hairline edge so stacked cards of one colour stay apart. */
  edge: string;
}

/**
 * The face and text colours for a card drawn in `color` (an account's own
 * colour). Text is the app's cream or ink, whichever contrasts more; when
 * neither reaches 4.5:1 (a mid-tone colour), the face moves toward the
 * opposite of the text in small steps until it does. An unreadable colour
 * value falls back to the Accounts band's slate.
 */
export function cardFaceColors(color: string | undefined, scheme: 'light' | 'dark'): CardFaceColors {
  const light = BandPalettes.light.home.onBand;
  const dark = BandPalettes.light.home.band;
  const base = color && HEX.test(color) ? color : BandPalettes[scheme].accounts.band;
  const text = contrastRatio(light, base) >= contrastRatio(dark, base) ? light : dark;
  const away = text === light ? dark : light;
  let face = base;
  for (let step = 1; contrastRatio(text, face) < FACE_TEXT_CONTRAST && step <= 20; step++) {
    face = blendHex(away, base, step * 0.05);
  }
  return { face, text, edge: blendHex(text, face, 0.18) };
}

/** Card geometry, in points. */
export const CARD_HEIGHT = 96;
export const FAN_GAP = 10;
/** How much of each card behind the front one shows above it, stacked. */
export const STACK_PEEK = 14;
/** Cards deeper than this sit exactly behind the deepest visible one. */
export const STACK_MAX_DEPTH = 3;
/** Each card further back is drawn this much smaller. */
export const DEPTH_SCALE = 0.05;
/** Tilt of the stacked cards, as if lying on a table seen from just above. */
export const STACK_TILT_DEG = 8;
/** A card further back is shaded this much more (fraction of the ink overlay). */
export const DEPTH_SHADE = 0.12;
/** Perspective distance for the tilt. */
export const PERSPECTIVE = 900;

export interface StackPlacement {
  /** 0 = front card. */
  depth: number;
  /** Top edge in the fanned list (the layout position). */
  fannedTop: number;
  /** translateY that moves the card from its fanned place to its stacked place. */
  stackedOffset: number;
  /** Scale stacked; 1 fanned. */
  stackedScale: number;
  /** Shade over the face stacked; 0 fanned. */
  stackedShade: number;
}

export interface StackLayout {
  placements: StackPlacement[];
  stackedHeight: number;
  fannedHeight: number;
}

/**
 * Where each of `count` cards sits. Fanned, they are a list top to bottom.
 * Stacked, the front card (index 0) sits lowest and each card behind it peeks
 * out `STACK_PEEK` above, smaller and shaded by depth.
 */
export function stackLayout(count: number): StackLayout {
  const n = Math.max(0, Math.floor(count));
  const deepest = Math.min(Math.max(n - 1, 0), STACK_MAX_DEPTH);
  const placements = Array.from({ length: n }, (_, index): StackPlacement => {
    const depth = Math.min(index, STACK_MAX_DEPTH);
    const fannedTop = index * (CARD_HEIGHT + FAN_GAP);
    const stackedTop = (deepest - depth) * STACK_PEEK;
    return {
      depth,
      fannedTop,
      stackedOffset: stackedTop - fannedTop,
      stackedScale: 1 - depth * DEPTH_SCALE,
      stackedShade: depth * DEPTH_SHADE,
    };
  });
  return {
    placements,
    stackedHeight: n === 0 ? 0 : CARD_HEIGHT + deepest * STACK_PEEK,
    fannedHeight: n === 0 ? 0 : n * CARD_HEIGHT + (n - 1) * FAN_GAP,
  };
}
