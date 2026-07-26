import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ProgressBarProps {
  /** 0..1; values above 1 are clamped but can switch the color to danger. */
  ratio: number;
  color: string;
  height?: number;
}

export function ProgressBar({ ratio, color, height = 8 }: ProgressBarProps) {
  const theme = useTheme();
  const clamped = Math.max(0.02, Math.min(ratio, 1));
  return (
    <View style={[styles.track, { backgroundColor: theme.track, height, borderRadius: height / 2 }]}>
      <View
        style={[
          styles.fill,
          {
            width: `${clamped * 100}%`,
            backgroundColor: color,
            borderRadius: height / 2,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    overflow: 'hidden',
    borderRadius: Radius.full,
  },
  fill: {
    height: '100%',
  },
});
