import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/hooks/use-theme';

/** Original Claude W-arrow: one colour, no leaves, rotation, glow or gradient.
 * Keep clear space of half the mark's height around standalone brand use. */
export function WafraMark({ size = 40, color }: { size?: number; color?: string }) {
  const theme = useTheme();
  const stroke = color ?? theme.primary;
  return <Svg width={size} height={size} viewBox="0 0 48 48" accessible={false}>
    <Path d="M8 15 L15.5 33 L23 19 L30.5 33 L40 11.5" fill="none" stroke={stroke}
      strokeWidth={4.2} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M34 11.5 H40 V17.5" fill="none" stroke={stroke}
      strokeWidth={4.2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}
