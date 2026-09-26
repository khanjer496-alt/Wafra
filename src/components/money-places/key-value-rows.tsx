import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { BandPalette } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';

export interface KeyValueRow {
  key: string;
  label: string;
  /** Text, or a node when the value needs its own formatting. */
  value: React.ReactNode;
  testID?: string;
}

/**
 * Label · value rows on a sheet (design language E's detail sheets): the
 * label in the secondary text colour, the value bold at the end, a rule
 * between rows. Each row is read as one piece of text. At the accessibility
 * text sizes the value takes its own line under the label.
 */
export function KeyValueRows({ rows, palette, testID }: {
  rows: readonly KeyValueRow[];
  palette: BandPalette;
  testID?: string;
}) {
  const large = useLargeTextLayout();
  return <View testID={testID}>
    {rows.map((row, index) => {
      const text = typeof row.value === 'string' || typeof row.value === 'number';
      return <View key={row.key} testID={row.testID} accessible={text}
        accessibilityLabel={text ? `${row.label}, ${row.value}` : undefined}
        style={[styles.row, large && styles.stack,
          index < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.rule }]}>
        <ThemedText type="small" style={[styles.label, { color: palette.textSecondary }]}>{row.label}</ThemedText>
        {text
          ? <ThemedText type="smallBold" style={[styles.value, { color: palette.text }]}>{row.value}</ThemedText>
          : <View style={[styles.value, !large && styles.nodeEnd]}>{row.value}</View>}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48, paddingVertical: 12 },
  stack: { flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
  label: { flexShrink: 1 },
  value: { flexShrink: 1 },
  nodeEnd: { alignItems: 'flex-end' },
});
