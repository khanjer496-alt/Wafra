import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GrowBar } from '@/components/ui/grow-bar';
import type { BandPalette } from '@/constants/theme';
import { formatAED } from '@/lib/format';

export interface HistoryMonth {
  label: string;
  fils: number;
  current?: boolean;
}

/** Exact monthly values above proportional bars, with room for large text. */
export function BillHistoryTiles({ months, palette, label, testID }: {
  months: readonly HistoryMonth[];
  palette: BandPalette;
  /** What the strip is ("Last 6 months"), spoken first. */
  label: string;
  testID?: string;
}) {
  const max = Math.max(1, ...months.map((month) => month.fils));
  const spoken = `${label}: ${months.map((month) => `${month.label} ${formatAED(month.fils)}`).join(', ')}`;
  return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={spoken} style={styles.row}>
    {months.map((month, index) => {
      return <View key={`${month.label}-${index}`} style={styles.column} importantForAccessibility="no-hide-descendants">
        <View style={styles.heading}>
          <ThemedText type="meta" style={{ color: month.current ? palette.text : palette.textSecondary }}>{month.label}</ThemedText>
          <ThemedText type="meta" tabular maxFontSizeMultiplier={1.5} style={[styles.value, { color: palette.text }]}>
            {formatAED(month.fils)}
          </ThemedText>
        </View>
        <View style={[styles.slot, { backgroundColor: palette.rule }]}>
          <GrowBar axis="width" size={Math.max(0, month.fils) / max * 100} delay={index * 50}
            style={[styles.bar, { backgroundColor: palette.tint }]} />
        </View>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  row: { gap: 14 },
  column: { gap: 6 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 },
  value: { writingDirection: 'ltr', flexShrink: 1 },
  slot: { height: 8, width: '100%', borderRadius: 4 },
  bar: { height: 8, borderRadius: 4 },
});
