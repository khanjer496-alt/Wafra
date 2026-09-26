import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GrowBar } from '@/components/ui/grow-bar';
import type { BandPalette } from '@/constants/theme';
import { formatAED, formatAmount } from '@/lib/format';

export interface HistoryMonth {
  label: string;
  fils: number;
  current?: boolean;
}

const BAR_HEIGHT = 70;

/**
 * Six months of one bill as tiles on the sheet: whole-unit values above each
 * bar, the month under it, bars in the bill band's tint growing from the
 * baseline 50ms apart (in place under Reduce Motion). Equal bars mean the
 * price has not moved — a finding, not an empty state. A month with no charge
 * keeps a short stub so the row still reads as six months. Spoken as one
 * image, month by month.
 */
export function BillHistoryTiles({ months, palette, label, testID }: {
  months: readonly HistoryMonth[];
  palette: BandPalette;
  /** What the strip is ("Last 6 months"), spoken first. */
  label: string;
  testID?: string;
}) {
  const max = Math.max(1, ...months.map((month) => month.fils));
  const spoken = `${label}: ${months.map((month) => `${month.label} ${formatAED(month.fils, { decimals: false })}`).join(', ')}`;
  return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={spoken} style={styles.row}>
    {months.map((month, index) => {
      const height = month.fils > 0 ? Math.max(6, Math.round((month.fils / max) * BAR_HEIGHT)) : 3;
      return <View key={`${month.label}-${index}`} style={styles.column} importantForAccessibility="no-hide-descendants">
        <ThemedText type="nano" tabular numberOfLines={1} style={{ color: palette.textSecondary }}>
          {month.fils > 0 ? formatAmount(month.fils, { decimals: false }) : ' '}
        </ThemedText>
        <View style={styles.slot}>
          <GrowBar axis="height" size={height} delay={index * 50}
            style={[styles.bar, { backgroundColor: month.fils > 0 ? palette.tint : palette.rule }]} />
        </View>
        <ThemedText type="nano" numberOfLines={1} style={{ color: month.current ? palette.text : palette.textSecondary }}>
          {month.label}
        </ThemedText>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  column: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4 },
  slot: { height: BAR_HEIGHT, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 6 },
});
