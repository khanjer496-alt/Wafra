import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

interface WafraMarkProps {
  size?: number;
  color?: string;
}

/**
 * Wafra's simple initial: balanced, open, without a growth-arrow promise.
 *
 * One colour, always. No second colour inside the path, no glow, no gradient,
 * no rotation. Minimum sizes: 16px alone, 96px with the wordmark, 120px with
 * وفرة. Clear space is half the mark's height on all four sides.
 */
export function WafraMark({ size = 40, color }: WafraMarkProps) {
  const theme = useTheme();
  const stroke = color ?? theme.primary;
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        d="M7 14 L15.5 34 L24 17 L32.5 34 L41 14"
        fill="none"
        stroke={stroke}
        strokeWidth={4.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
