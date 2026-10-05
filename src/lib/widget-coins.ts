import { filledCoins } from '@/lib/coin-math';
import type { WidgetSpending } from '@/lib/widget-snapshot';

/**
 * The coins the native widgets draw, as plain arithmetic: the reference both
 * native ports follow (WafraSnapshot.swift `WafraCoinMath`, WidgetGraphics.kt)
 * and the tests check. The drawings never carry a figure the widget does not
 * already write: Today's stack counts payments (shown as words beside it),
 * the Spending row sizes coins by share only when amounts are shown, and the
 * Lock Screen ring fills the same fraction its gauge did.
 */

/** Today's stack: one coin per payment today, at most this many (Home's TODAY_COINS). */
export const WIDGET_TODAY_COINS = 6;
/** Coin width in points/dp in Today's stack. */
export const WIDGET_TODAY_COIN_WIDTH = 22;

export function widgetTodayCoins(count: number | null | undefined): number {
  return typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.min(WIDGET_TODAY_COINS, Math.floor(count))) : 0;
}

/** A flat coin seen from a little above (coin-disc.tsx discGeometry). */
export function widgetDiscGeometry(width: number): { face: number; edge: number } {
  return { face: Math.round(width * 0.36), edge: Math.max(3, Math.round(width * 0.13)) };
}

/** The Spending row: coins lying on their side, share-bar.tsx scaled to the widget's 26pt bar. */
export const WIDGET_COIN_ROW = { height: 26, face: 10, minWidth: 16, overlap: 5 } as const;

export interface WidgetCoin {
  /** "#RRGGBB" from the snapshot. */
  color: string;
  /** Minor units sizing the coin; null draws equal coins (hidden or unknown amounts). */
  value: number | null;
}

/**
 * The Spending widget's coins: each named category in its own colour, then
 * one coin for the rest, as the Spending tab pools them. Null keeps the older
 * share bar: a snapshot without colours (written before them) or a category
 * missing one. Hidden or unknown amounts draw one equal coin per named
 * category and no rest coin, so no size or extra coin hints at an amount.
 */
export function widgetSpendingCoins(spending: WidgetSpending | null | undefined, hidden: boolean): WidgetCoin[] | null {
  if (!spending || spending.categories.length === 0) return null;
  const colors = spending.categories.map((category) => category.color);
  if (!colors.every((color): color is string => typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color))) return null;
  const amounts = [...spending.categories.map((category) => category.amountMinor), spending.otherMinor];
  const known = !hidden && amounts.every((amount) => typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0);
  const sum = known ? amounts.reduce<number>((total, amount) => total + (amount ?? 0), 0) : 0;
  if (!known || !Number.isSafeInteger(sum) || sum <= 0) return colors.map((color) => ({ color, value: null }));
  const coins: WidgetCoin[] = spending.categories.flatMap((category, index) =>
    (category.amountMinor ?? 0) > 0 ? [{ color: colors[index]!, value: category.amountMinor }] : []);
  const rest = spending.otherMinor ?? 0;
  if (rest > 0) {
    if (typeof spending.otherColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(spending.otherColor)) return null;
    coins.push({ color: spending.otherColor, value: rest });
  }
  return coins.length > 0 ? coins : null;
}

/**
 * Coin widths across `available`, flex-grow by value with a minimum width,
 * each coin overlapping the one before by `overlap` (share-bar.tsx). Any
 * unknown value makes every coin equal.
 */
export function widgetCoinWidths(values: readonly (number | null)[], available: number,
  minWidth: number = WIDGET_COIN_ROW.minWidth, overlap: number = WIDGET_COIN_ROW.overlap): number[] {
  const count = values.length;
  if (count === 0) return [];
  const span = Math.max(0, available + overlap * (count - 1));
  if (values.some((value) => value === null || !(value > 0))) return values.map(() => Math.max(minWidth, span / count));
  const fixed = values.map(() => false);
  for (;;) {
    const free = span - minWidth * fixed.filter(Boolean).length;
    const weight = values.reduce<number>((sum, value, index) => fixed[index] ? sum : sum + (value ?? 0), 0);
    let changed = false;
    values.forEach((value, index) => {
      if (!fixed[index] && (weight <= 0 || (free * (value ?? 0)) / weight < minWidth)) {
        fixed[index] = true;
        changed = true;
      }
    });
    if (!changed) return values.map((value, index) => fixed[index] ? minWidth : (free * (value ?? 0)) / weight);
    if (fixed.every(Boolean)) return values.map(() => minWidth);
  }
}

/** Each coin's leading x from the row's reading start; mirrored for right-to-left. */
export function widgetCoinOffsets(widths: readonly number[], available: number,
  overlap: number = WIDGET_COIN_ROW.overlap, rtl = false): number[] {
  let x = 0;
  return widths.map((width) => {
    const at = rtl ? available - x - width : x;
    x += width - overlap;
    return at;
  });
}

/** Coming up's strip: the next 30 days, small tiles on their dates, the next one lifted. */
export const WIDGET_STRIP = { days: 30, tile: 20, lift: 6, height: 30 } as const;

/** Where a pin sits along the strip, as a share of its width (pin-timeline.tsx pinPosition). */
export function widgetPinPosition(dayOffset: number, days: number = WIDGET_STRIP.days): number {
  const clamped = Math.max(0, Math.min(days, dayOffset));
  return 3 + (94 * clamped) / Math.max(1, days);
}

/**
 * Tile centres along a strip `width` wide, soonest first: on their dates,
 * then nudged apart so two tiles never cover each other by more than a
 * third, and kept inside the strip. Mirror (width - x) for right-to-left.
 */
export function widgetStripCenters(dayOffsets: readonly number[], width: number,
  tile: number = WIDGET_STRIP.tile, days: number = WIDGET_STRIP.days): number[] {
  const gap = tile * 0.7;
  const half = tile / 2;
  const centers = dayOffsets.map((offset) => Math.min(width - half, Math.max(half, (width * widgetPinPosition(offset, days)) / 100)));
  for (let index = 1; index < centers.length; index += 1) centers[index] = Math.max(centers[index]!, centers[index - 1]! + gap);
  const last = centers.length - 1;
  if (last >= 0 && centers[last]! > width - half) {
    centers[last] = width - half;
    for (let index = last - 1; index >= 0; index -= 1) centers[index] = Math.min(centers[index]!, centers[index + 1]! - gap);
  }
  return centers.map((center) => Math.max(half, center));
}

/** The circular Lock Screen widget's ring. */
export const WIDGET_RING_COINS = 12;

/** Coins of the ring filled for the gauge's fraction (filledCoins); null without a fraction. */
export function widgetRingCoins(fraction: number | null | undefined): number | null {
  return typeof fraction === 'number' && Number.isFinite(fraction) ? filledCoins(fraction, WIDGET_RING_COINS) : null;
}
