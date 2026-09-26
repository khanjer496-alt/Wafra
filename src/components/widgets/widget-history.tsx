import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { BandPalette } from '@/constants/theme';
import { shiftISO } from '@/lib/format';
import { widgetDueLabel, widgetMoneyText, widgetWeekShares } from '@/lib/widget-preview';
import type { WidgetSnapshot } from '@/lib/widget-snapshot';
import type { WidgetsCopy } from '@/lib/widgets-copy';

/** Exact daily values belong on a readable full-width chart, not a tiny widget sparkline. */
export function WidgetHistory({ snapshot, palette, words }: {
  snapshot: WidgetSnapshot | null;
  palette: BandPalette;
  words: WidgetsCopy;
}) {
  if (!snapshot || snapshot.hidden) return null;
  const shares = widgetWeekShares(snapshot);
  return <View testID="widgets-week-details" style={styles.root}>
    <ThemedText type="smallBold" style={{ color: palette.text }}>{words.widgetLast7}</ThemedText>
    {snapshot.last7Minor.map((amount, index) => {
      const date = shiftISO(snapshot.todayISO, index - (snapshot.last7Minor.length - 1));
      const label = widgetDueLabel(date, snapshot.todayISO, words);
      const money = widgetMoneyText(amount, snapshot);
      return <View key={date} style={styles.row} accessible
        accessibilityLabel={`${label}, ${amount === null ? words.widgetAmountHidden : money}`}>
        <View style={styles.heading}>
          <ThemedText type="meta" style={{ color: palette.textSecondary }}>{label}</ThemedText>
          <ThemedText type="meta" tabular style={{ color: palette.text, writingDirection: 'ltr' }}>{money}</ThemedText>
        </View>
        <View style={[styles.track, { backgroundColor: palette.rule }]}>
          <View testID={`widgets-week-bar-${date}`} style={[styles.bar, {
            width: `${(shares[index] ?? 0) * 100}%`, backgroundColor: palette.tint,
          }]} />
        </View>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 16, width: '100%' },
  row: { gap: 6 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  track: { height: 6, width: '100%', borderRadius: 3 },
  bar: { height: 6, borderRadius: 3 },
});
