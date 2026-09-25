import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { bandCopy } from '@/lib/band-copy';

export interface ShareSegment {
  key: string;
  label: string;
  /** Any non-negative magnitude (minor units are fine); only shares are shown. */
  value: number;
}

/** Opacity of the band's text colour per rank: the biggest share is the brightest. */
const RANK_OPACITY = [0.92, 0.7, 0.5] as const;
const REST_OPACITY = 0.24;

/** Whole-number shares that add up to 100 (largest remainder), in input order. */
export function sharePercents(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((value) => (Math.max(0, value) / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index]! += 1;
    left -= 1;
  }
  return floors;
}

/**
 * One tone split by share: each segment is the band's text colour at a
 * rank-based strength, so no hue ever stands for a category (a clay segment
 * would vanish on the clay band). The three biggest are named with their
 * share, the rest counted as "+N more". Assistive tech hears every named
 * share plus the rest as one figure. Shows shares only, never amounts.
 */
export function ShareBar({ segments, palette, labelled = 3, label, testID }: {
  segments: readonly ShareSegment[];
  palette: BandPalette;
  /** How many of the largest segments get a visible name. */
  labelled?: number;
  /** What the bar divides ("Spending"), spoken first. */
  label?: string;
  testID?: string;
}) {
  const words = bandCopy(useLanguage());
  const sorted = segments.filter((segment) => segment.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length === 0) return null;
  const percents = sharePercents(sorted.map((segment) => segment.value));
  const named = sorted.slice(0, labelled);
  const restCount = sorted.length - named.length;
  const restPercent = percents.slice(named.length).reduce((sum, value) => sum + value, 0);
  const spoken = [
    ...named.map((segment, index) => `${segment.label} ${words.percent(percents[index]!)}`),
    restCount > 0 ? words.shareOthers(restCount, words.percent(restPercent)) : null,
  ].filter(Boolean).join(', ');
  const opacityAt = (index: number) => RANK_OPACITY[index] ?? REST_OPACITY;

  return <View testID={testID} style={styles.root}>
    <View accessible accessibilityRole="image" accessibilityLabel={label ? `${words.shareOf} ${label}: ${spoken}` : spoken} style={styles.bar}>
      {sorted.map((segment, index) => <View key={segment.key}
        style={[styles.segment, { flexGrow: segment.value, backgroundColor: palette.onBand, opacity: opacityAt(index) }]} />)}
    </View>
    <View style={styles.legend} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {named.map((segment, index) => <View key={segment.key} style={styles.legendItem}>
        <View style={[styles.swatch, { backgroundColor: palette.onBand, opacity: opacityAt(index) }]} />
        <ThemedText type="meta" style={{ color: palette.onBand }}>{`${segment.label} ${words.percent(percents[index]!)}`}</ThemedText>
      </View>)}
      {restCount > 0 ? <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>{words.shareMore(restCount)}</ThemedText> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  bar: { flexDirection: 'row', gap: 3, height: 30 },
  segment: { flexBasis: 0, minWidth: 4, borderRadius: 7 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
});
