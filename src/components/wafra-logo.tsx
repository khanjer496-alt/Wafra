import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

interface WafraMarkProps {
  size?: number;
  color?: string;
}

/** The Wafra mark: a W whose final stroke rises into an arrow — it ends up. */
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
}

/** Mark + wordmark lockup: Wafra with وفرة as the secondary script. */
export function WafraLogo({ markSize = 44, showWordmark = true }: WafraLogoProps) {
  const theme = useTheme();
  return (
    <View style={styles.lockup}>
      <WafraMark size={markSize} />
      {showWordmark && (
        <View style={styles.words}>
          <ThemedText style={[styles.wordmark, { color: theme.text }]}>Wafra</ThemedText>
          <ThemedText style={[styles.script, { color: theme.textSecondary }]}>وفرة</ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: {
    alignItems: 'center',
    gap: 10,
  },
  words: {
    alignItems: 'center',
    gap: 0,
  },
  wordmark: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  script: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
});
