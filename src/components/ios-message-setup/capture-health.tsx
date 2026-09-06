import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import {
  formatCaptureReceipt,
  iosCaptureHealthCopy,
  iosCaptureHealthMode,
  type IosCaptureHealth,
} from '@/lib/ios-capture-health';

/** Details stay collapsed: setup remains short, diagnostics are available on demand. */
export function IosCaptureHealthPanel({ health, language }: {
  health: IosCaptureHealth | null;
  language: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const copy = iosCaptureHealthCopy(language);
  const summary = copy[iosCaptureHealthMode(health)];
  const detailLabel = expanded ? copy.hide : copy.show;
  return <View testID="ios-capture-health" style={styles.root}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
      accessibilityLabel={`${copy.title}. ${summary}. ${detailLabel}`}
      onPress={() => setExpanded((value) => !value)} style={styles.toggle}>
      <View style={styles.grow}>
        <ThemedText type="smallBold">{copy.title}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{summary}</ThemedText>
      </View>
      <ThemedText type="meta" themeColor="textSecondary">{detailLabel}</ThemedText>
    </Pressable>
    {expanded && <View testID="ios-capture-health-details" style={styles.details}>
      {health && <>
        <ThemedText type="small">{copy.pending}: {health.pending}</ThemedText>
        {health.dropped > 0 && <ThemedText type="small">{copy.dropped}: {health.dropped}</ThemedText>}
        {health.corrupt && <ThemedText type="small">{copy.corrupt}</ThemedText>}
        {([
          [copy.received, health.lastReceivedAt],
          [copy.handled, health.lastHandledAt],
          [copy.first, health.firstCapturedAt],
        ] as const).map(([label, at]) => <View key={label} style={styles.date}>
          <ThemedText type="meta" themeColor="textSecondary">{label}</ThemedText>
          <ThemedText type="small">{formatCaptureReceipt(at, language)}</ThemedText>
        </View>)}
      </>}
      <ThemedText type="meta" themeColor="textSecondary">{copy.explanation}</ThemedText>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 8 },
  toggle: { minHeight: 48, gap: 12, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 150, gap: 4 },
  details: { gap: 12, paddingBottom: 12 },
  date: { gap: 2 },
});
