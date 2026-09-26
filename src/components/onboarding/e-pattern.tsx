/**
 * E7 · The pattern, revealed (ink). The whole mosaic from the person's own
 * answers — the name's initial, the goals, the watched categories, and the
 * reminders that have something to remind about — with a key to what each
 * kind of tile means. The key lists only the kinds actually in the pattern.
 * It never carries money (pattern.ts has no amount field).
 */
import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { EBody, EHeadline, EStepFrame, fitPatternTile } from '@/components/onboarding/e-frame';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { Icon } from '@/components/ui/icon';
import { PatternMosaic } from '@/components/ui/pattern-mosaic';
import { Fonts, PatternPalette } from '@/constants/theme';
import { useBand, useBandScheme } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { getCategory } from '@/lib/categories';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import type { PatternGroup, PatternTile } from '@/lib/pattern';

const SWATCH = 26;

/** A small copy of the first tile of a group, for the key. */
function Swatch({ tile }: { tile: PatternTile }) {
  const palette = PatternPalette[useBandScheme()];
  const fill = palette.fill[tile.color];
  if (tile.kind === 'letter') {
    return <View style={[styles.swatch, { backgroundColor: fill, borderRadius: 6 }]}>
      <Text allowFontScaling={false} style={[styles.swatchLetter, { color: palette.mark[tile.mark ?? 'cream'] }]}>{tile.letter}</Text>
    </View>;
  }
  if (tile.kind === 'glyph') {
    return <View style={[styles.swatch, { backgroundColor: fill, borderRadius: 6 }]}>
      <Icon name={getCategory(tile.category ?? 'other').icon} size={14} color={palette.mark[tile.mark ?? 'ink']} strokeWidth={2} />
    </View>;
  }
  if (tile.kind === 'dot') {
    return <View style={styles.swatch}><View style={[styles.dot, { backgroundColor: fill }]} /></View>;
  }
  if (tile.kind === 'ring') {
    return <View style={[styles.swatch, { borderRadius: SWATCH / 2, borderWidth: SWATCH / 6, borderColor: fill }]} />;
  }
  if (tile.kind === 'quarter') {
    return <View style={[styles.swatch, { backgroundColor: fill, borderTopLeftRadius: SWATCH,
      transform: tile.rotation ? [{ rotate: `${tile.rotation}deg` }] : undefined }]} />;
  }
  return <View style={[styles.swatch, { backgroundColor: fill, borderRadius: tile.kind === 'circle' ? SWATCH / 2 : 6 }]} />;
}

export function PatternStep({ tiles, name, continueLabel, onContinue, onBack, onClose, disabled }: {
  tiles: readonly PatternTile[];
  name: string | null;
  continueLabel: string;
  onContinue: () => void;
  onBack?: () => void;
  onClose?: () => void;
  disabled: boolean;
}) {
  const words = onboardingECopy(useLanguage());
  const band = useBand('home');
  const largeText = useLargeTextLayout();
  const tile = fitPatternTile(useWindowDimensions().width, 52);
  const legend: { group: PatternGroup; label: string }[] = [
    { group: 'name', label: words.legendYou },
    { group: 'goals', label: words.legendGoals },
    { group: 'watch', label: words.legendWatch },
    { group: 'remind', label: words.legendRemind },
  ];
  const shown = legend.flatMap((entry) => {
    const first = tiles.find((item) => item.group === entry.group);
    return first ? [{ ...entry, tile: first }] : [];
  });
  return <EStepFrame palette={band} step={null} onBack={onBack} onClose={onClose} backDisabled={disabled} testID="onboarding-pattern"
    footer={<EButton palette={band} color={{ fill: band.accent, text: band.onAccent }} label={continueLabel}
      onPress={onContinue} disabled={disabled} testID="onboarding-pattern-continue" />}>
    <View style={styles.mosaic}>
      <PatternMosaic tiles={tiles} tile={tile} animate testID="onboarding-pattern-mosaic" />
    </View>
    <EHeadline palette={band} size={44}>{words.patternTitle(name)}</EHeadline>
    <View style={[styles.legend, largeText && styles.legendStacked]} testID="onboarding-pattern-legend">
      {shown.map((entry) => <View key={entry.group} style={[styles.legendItem, largeText && styles.legendItemStacked]}>
        <Swatch tile={entry.tile} />
        <ThemedText type="small" style={{ color: band.onBand }}>{entry.label}</ThemedText>
      </View>)}
    </View>
    <EBody palette={band} style={styles.note}>{words.patternNote}</EBody>
  </EStepFrame>;
}

const styles = StyleSheet.create({
  mosaic: { alignItems: 'center', paddingTop: 36, paddingBottom: 12 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, columnGap: 14 },
  legendStacked: { flexDirection: 'column' },
  legendItem: { flexBasis: '46%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendItemStacked: { flexBasis: 'auto' },
  swatch: { width: SWATCH, height: SWATCH, alignItems: 'center', justifyContent: 'center' },
  swatchLetter: { fontFamily: Fonts.sansSemi, fontSize: 15, lineHeight: 18 },
  dot: { width: SWATCH / 3, height: SWATCH / 3, borderRadius: SWATCH / 6 },
  note: { fontSize: 15, lineHeight: 22 },
});
