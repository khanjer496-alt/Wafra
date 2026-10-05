import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { CoinColors } from '@/constants/theme';
import { GOLD, type CoinTone } from '@/components/ui/coins/coin-disc';

/**
 * A coin seen face-on: a disc with a rim, a ring stamped inside it and a soft
 * highlight. The one that travels along a transfer's route or drops into a
 * category. Decorative: the caller writes the amount.
 */
export function CoinToken({ size, tone = GOLD, style, testID }: {
  size: number;
  tone?: CoinTone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return <View testID={testID} style={[styles.coin, { pointerEvents: 'none',
    width: size, height: size, borderRadius: size / 2, backgroundColor: tone.face, borderColor: tone.rim,
    borderBottomWidth: Math.max(2, size * 0.1),
  }, style]}>
    <View style={[styles.ring, { width: size * 0.66, height: size * 0.66, borderRadius: size * 0.33, borderColor: tone.side }]} />
    <View style={[styles.shine, { width: size * 0.3, height: size * 0.16, borderRadius: size * 0.08, top: size * 0.16, start: size * 0.2,
      backgroundColor: CoinColors.shine }]} />
  </View>;
}

const styles = StyleSheet.create({
  coin: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 1.5, opacity: 0.6 },
  shine: { position: 'absolute', opacity: 0.5 },
});
