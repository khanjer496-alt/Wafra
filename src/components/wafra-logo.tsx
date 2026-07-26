import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface WafraMarkProps {
  size?: number;
  color?: string;
}

/**
 * The Wafra mark: a W whose final stroke rises into an arrow — it ends up.
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
        d="M8 15 L15.5 33 L23 19 L30.5 33 L40 11.5"
        fill="none"
        stroke={stroke}
        strokeWidth={4.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M34 11.5 H40 V17.5"
        fill="none"
        stroke={stroke}
        strokeWidth={4.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

interface WafraLogoProps {
  markSize?: number;
  showWordmark?: boolean;
  showArabic?: boolean;
  align?: 'center' | 'flex-start';
}

/** Mark + wordmark lockup: Wafra, with وفرة as the secondary script. */
export function WafraLogo({
  markSize = 44,
  showWordmark = true,
  showArabic = true,
  align = 'center',
}: WafraLogoProps) {
  const theme = useTheme();
  const wordSize = Math.round(markSize * 0.62);
  return (
    <View style={[styles.lockup, { alignItems: align }]}>
      <WafraMark size={markSize} />
      {showWordmark && (
        <View style={{ alignItems: align }}>
          <ThemedText
            style={{
              fontFamily: Fonts.sansSemi,
              fontSize: wordSize,
              lineHeight: Math.round(wordSize * 1.2),
              letterSpacing: wordSize * -0.035,
              color: theme.text,
            }}>
            Wafra
          </ThemedText>
          {showArabic && (
            <ThemedText
              style={{
                // ~52% of the Latin cap height keeps the second script quiet.
                fontFamily: Fonts.arabic,
                fontSize: Math.round(wordSize * 0.52),
                lineHeight: Math.round(wordSize * 0.85),
                color: theme.textSecondary,
              }}>
              وفرة
            </ThemedText>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: {
    gap: Spacing.two + 2,
  },
});
