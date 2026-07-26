import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface BarGroup {
  label: string;
  /** Values in display order; each rendered as its own bar within the group. */
  values: { value: number; color: string }[];
}

interface BarChartProps {
  groups: BarGroup[];
  height?: number;
  highlightIndex?: number;
  /** When provided, each group becomes tappable. */
  onPressGroup?: (index: number) => void;
  /**
   * When provided, values print above each column (stacked in bar order, so
   * the top figure belongs to the left bar). Keep it compact: "74k", "1.2M".
   */
  valueFormatter?: (value: number) => string;
}

/** Grouped vertical bar chart built from plain views (no chart lib needed). */
export function BarChart({
  groups,
  height = 140,
  highlightIndex,
  onPressGroup,
  valueFormatter,
}: BarChartProps) {
  const theme = useTheme();
  const max = Math.max(1, ...groups.flatMap((g) => g.values.map((v) => v.value)));
  const valueLines = valueFormatter
    ? Math.max(0, ...groups.map((g) => g.values.length))
    : 0;
  const valuesHeight = valueLines > 0 ? valueLines * 13 + 4 : 0;

  return (
    <View style={[styles.row, { height: height + 26 + valuesHeight }]}>
      {groups.map((group, gi) => {
        const dim = highlightIndex !== undefined && highlightIndex !== gi;
        return (
          <Pressable
            key={group.label + gi}
            disabled={!onPressGroup}
            onPress={() => onPressGroup?.(gi)}
            style={styles.group}>
            {valueFormatter && (
              <View style={[styles.values, { height: valuesHeight, opacity: dim ? 0.4 : 1 }]}>
                {group.values.map((v, vi) => (
                  <ThemedText
                    key={vi}
                    type="micro"
                    tabular
                    themeColor={dim ? 'textSecondary' : undefined}
                    style={[styles.valueText, !dim && { color: v.color }]}>
                    {valueFormatter(v.value)}
                  </ThemedText>
                ))}
              </View>
            )}
            <View style={[styles.bars, { height }]}>
              {group.values.map((v, vi) => (
                <Animated.View
                  key={vi}
                  entering={FadeInUp.delay(gi * 60 + vi * 40).springify()}
                  style={[
                    styles.bar,
                    {
                      height: Math.max(4, (v.value / max) * height),
                      backgroundColor: v.color,
                      opacity: dim ? 0.35 : 1,
                    },
                  ]}
                />
              ))}
            </View>
            <ThemedText
              type="small"
              themeColor={highlightIndex === gi ? 'text' : 'textSecondary'}
              style={styles.label}>
              {group.label}
            </ThemedText>
          </Pressable>
        );
      })}
      <View style={[styles.baseline, { backgroundColor: theme.cardBorder }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  group: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
  },
  values: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  valueText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
  },
  bar: {
    width: 12,
    borderRadius: Radius.sm / 2,
  },
  label: {
    fontSize: 12,
  },
  baseline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 25,
    height: StyleSheet.hairlineWidth,
  },
});
