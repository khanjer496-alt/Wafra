import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

interface WafraMarkProps {
  size?: number;
  color?: string;
}

/** Two-leaf mark from the approved visual direction. It is decorative, not a financial claim. */
export function WafraMark({ size = 40, color }: WafraMarkProps) {
  const theme = useTheme();
  const stroke = color ?? theme.primary;
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path d="M24 26C21 16 27 7 41 3C43 17 37 27 24 30Z" fill={stroke} />
      <Path d="M20 39C8 39 3 31 5 19C18 21 24 28 20 39Z" fill={stroke} />
      <Path d="M21 45C20 33 24 23 33 14" fill="none" stroke={stroke} strokeWidth={2.6} strokeLinecap="round" />
    </Svg>
  );
}
