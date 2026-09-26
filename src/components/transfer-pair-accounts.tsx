import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import type { BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { reviewBandCopy } from '@/lib/review-band-copy';

/**
 * One own-account movement as one line: "Out of <account>", the swap glyph
 * in the band colour, "Into <account>". Stacks at large text. Used by the
 * transfer queue's pair cards and by both "matched" lists; the parent names
 * the whole row for screen readers.
 */
export function TransferPairAccounts({ outAccount, inAccount, palette, stacked }: {
  outAccount: string; inAccount: string; palette: BandPalette; stacked: boolean;
}) {
  const copy = reviewBandCopy(useLanguage());
  return <View style={[styles.row, stacked && styles.stacked]}>
    <View style={[styles.leg, !stacked && styles.rowLeg]}>
      <ThemedText type="meta" style={{ color: palette.textSecondary }}>{copy.outOf}</ThemedText>
      <ThemedText type="smallBold" numberOfLines={2} style={{ color: palette.text }}>{outAccount}</ThemedText>
    </View>
    <View style={[styles.swap, { backgroundColor: palette.fill }]}>
      <Icon name="repeat" size={17} color={palette.onFill} strokeWidth={2} />
    </View>
    <View style={[styles.leg, !stacked && styles.rowLeg, !stacked && styles.legEnd]}>
      <ThemedText type="meta" style={[{ color: palette.textSecondary }, !stacked && styles.endText]}>{copy.into}</ThemedText>
      <ThemedText type="smallBold" numberOfLines={2} style={[{ color: palette.text }, !stacked && styles.endText]}>{inAccount}</ThemedText>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stacked: { flexDirection: 'column', alignItems: 'flex-start' },
  leg: { minWidth: 0, gap: 2 },
  rowLeg: { flex: 1 },
  legEnd: { alignItems: 'flex-end' },
  endText: { textAlign: 'right' },
  swap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
