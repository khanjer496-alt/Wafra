import React from 'react';
import { StyleSheet, View } from 'react-native';

import { GrowBar } from '@/components/ui/grow-bar';
import type { BandPalette } from '@/constants/theme';
import { limitFillPercent, limitStatus, type LimitStatus } from '@/lib/limit-status';

/** The status colour for a limit on the sheet. */
export function limitStatusColor(palette: BandPalette, status: LimitStatus): string {
  return status === 'over' ? palette.statusOver : status === 'near' ? palette.statusNear : palette.statusOk;
}

/**
 * A limit bar on the sheet: the share of the limit used, coloured by status
 * only — green within the limit, amber from 85%, red over it. Not the system
 * status bar (that is expo-status-bar's, driven by BandScaffold). Decorative
 * for assistive tech: the row it sits in speaks the figures and the status.
 */
export function StatusBar({ spentMinor, limitMinor, palette, height = 8, testID }: {
  spentMinor: number;
  limitMinor: number;
  palette: BandPalette;
  height?: number;
  testID?: string;
}) {
  const status = limitStatus(spentMinor, limitMinor);
  const percent = limitFillPercent(spentMinor, limitMinor);
  return <View testID={testID} accessible={false} importantForAccessibility="no-hide-descendants"
    style={[styles.track, { height, borderRadius: height / 2, backgroundColor: palette.rule }]}>
    <GrowBar axis="width" size={percent} delay={200}
      style={[styles.fill, { borderRadius: height / 2, backgroundColor: limitStatusColor(palette, status) }]} />
  </View>;
}

/** Alias for call sites where `StatusBar` would read as the system bar. */
export const LimitStatusBar = StatusBar;

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden' },
  fill: { height: '100%' },
});
