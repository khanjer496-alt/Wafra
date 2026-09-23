export interface DonutHitSlice {
  key: string;
  value: number;
}

/**
 * Resolve one touch to the slice painted under it.
 *
 * The hit band is deliberately wider than the visible ring so small slices are
 * still easy to tap on a phone. Visual gaps belong to their neighbouring slice
 * instead of becoming dead zones.
 */
export function donutSliceAtPoint(
  slices: readonly DonutHitSlice[],
  size: number,
  thickness: number,
  x: number,
  y: number,
  hitSlop = 14,
): string | null {
  if (!(size > 0) || !(thickness > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const positive = slices.filter((slice) => Number.isFinite(slice.value) && slice.value > 0);
  const total = positive.reduce((sum, slice) => sum + slice.value, 0);
  if (!(total > 0)) return null;

  const center = size / 2;
  const radius = size / 2 - thickness / 2;
  const distance = Math.hypot(x - center, y - center);
  const inner = Math.max(0, radius - thickness / 2 - hitSlop);
  const outer = radius + thickness / 2 + hitSlop;
  if (distance < inner || distance > outer) return null;

  // The chart starts at 12 o'clock and advances clockwise. atan2 starts at
  // 3 o'clock, so rotate by a quarter turn and normalize into [0, 2π).
  let angle = Math.atan2(y - center, x - center) + Math.PI / 2;
  if (angle < 0) angle += Math.PI * 2;
  const target = angle / (Math.PI * 2) * total;

  let cursor = 0;
  for (const slice of positive) {
    cursor += slice.value;
    if (target < cursor) return slice.key;
  }
  return positive.at(-1)?.key ?? null;
}
