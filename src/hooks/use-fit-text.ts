import { useState } from 'react';
import { useWindowDimensions, type LayoutChangeEvent } from 'react-native';

import { MIN_FIGURE_SCALE } from '@/lib/large-text-figure';

/**
 * How much a one-line figure must shrink to fit the width its box gives it.
 *
 * Sized from the character count (as `figureFontMultiplier` is), so iOS,
 * Android and the web draw the same size and a figure is never cut to
 * "AED 1,085…". Pass `onLayout` to a box that takes its width from its parent
 * (stretched), never from the text, so the measurement cannot chase itself.
 * `ratio` multiplies the figure's font size, from MIN_FIGURE_SCALE to 1.
 */
export function useFitText(chars: number, fontSize: number, options: { advance?: number; maxScale?: number } = {}) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const scale = Math.min(Math.max(1, fontScale), options.maxScale ?? Number.POSITIVE_INFINITY);
  const wanted = Math.max(1, chars) * fontSize * (options.advance ?? 0.6) * scale;
  const ratio = width > 0 ? Math.max(MIN_FIGURE_SCALE, Math.min(1, width / wanted)) : 1;
  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  };
  return { ratio, onLayout };
}
