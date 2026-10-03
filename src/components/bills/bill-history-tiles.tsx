import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GrowBar } from '@/components/ui/grow-bar';
import type { BandPalette } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { formatAED, formatAmount } from '@/lib/format';

/** Tallest bar in the column chart, in points. */
const COLUMN_HEIGHT = 64;
/** A column fits about eight characters of amount above its bar. */
const COLUMN_CHARS = 8;

export interface HistoryMonth {
  label: string;
  fils: number;
  current?: boolean;
}

/**
 * Exact monthly values above proportional bars. Six months sit side by side as
 * columns (the design's chart; the currency is on the figure above), unless
 * the text is at an accessibility size or an amount is too long for a column:
 * then each month takes a full-width row, so no value is ever cut.
 */
export function BillHistoryTiles({ months, palette, label, testID }: {
  months: readonly HistoryMonth[];
  palette: BandPalette;
  /** What the strip is ("Last 6 months"), spoken first. */
  label: string;
  testID?: string;
}) {
  const max = Math.max(1, ...months.map((month) => month.fils));
  const spoken = `${label}: ${months.map((month) => `${month.label} ${formatAED(month.fils)}`).join(', ')}`;
  const large = useLargeTextLayout();
  const values = months.map((month) => formatAmount(month.fils));
  if (!large && values.every((value) => value.length <= COLUMN_CHARS)) {
    return <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={spoken} style={styles.columns}>
      {months.map((month, index) => <View key={`${month.label}-${index}`} style={styles.cell}
        importantForAccessibility="no-hide-descendants">
        <ThemedText type="meta" tabular style={[styles.value, { color: month.fils > 0 ? palette.text : palette.textSecondary }]}>
          {/* This month before its charge: a dash, not a 0 that reads as missed. */}
          {month.current && month.fils === 0 ? '—' : values[index]}
        </ThemedText>
        <View style={styles.well}>
          {month.fils > 0
            ? <GrowBar axis="height" size={Math.max(4, Math.max(0, month.fils) / max * COLUMN_HEIGHT)} delay={index * 50}
              style={[styles.columnBar, { backgroundColor: palette.tint, opacity: month.current ? 1 : 0.72 }]} />
            : <View style={[styles.empty, { backgroundColor: palette.rule }]} />}
        </View>
        <ThemedText type="meta" style={{ color: month.current ? palette.text : palette.textSecondary }}>{month.label}</ThemedText>
      </View>)}
    </View>;
  }
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
  columns: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  cell: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4 },
  well: { height: COLUMN_HEIGHT, width: '100%', justifyContent: 'flex-end' },
  columnBar: { width: '100%', borderTopLeftRadius: 6, borderTopRightRadius: 6, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  empty: { height: 2, width: '100%', borderRadius: 1 },
  slot: { height: 8, width: '100%', borderRadius: 4 },
  bar: { height: 8, borderRadius: 4 },
});
