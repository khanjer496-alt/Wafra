import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { WafraTile } from './alive-scenes';

const night = Colors.dark;

/** Rows of a statement: a description bar and an amount bar, never real data. */
const ROWS: readonly (readonly [number, number])[] = [[0.62, 0.22], [0.48, 0.18], [0.7, 0.2], [0.4, 0.24]];

function Sheet({ tag, tone, style }: { tag: string; tone: string; style?: object }) {
  return (
    <View style={[styles.sheet, style]}>
      <View style={styles.sheetHead}>
        <View style={[styles.tag, { borderColor: tone }]}>
          <ThemedText allowFontScaling={false} style={[styles.tagText, { color: tone }]}>{tag}</ThemedText>
        </View>
        <View style={[styles.bar, { width: '34%', opacity: 0.5 }]} />
      </View>
      {ROWS.map(([label, amount], index) => (
        <View key={index} style={styles.row}>
          <View style={[styles.bar, { width: `${Math.round(label * 100)}%` }]} />
          <View style={[styles.bar, styles.amount, { width: `${Math.round(amount * 100)}%` }]} />
        </View>
      ))}
    </View>
  );
}

/**
 * Decorative: two downloaded statements sliding into Wafra. Carries no words a
 * screen reader needs; the step's title and sentence say what to do.
 */
export function StatementScene({ reducedMotion }: { reducedMotion: boolean }) {
  const entering = (delay: number) => (reducedMotion ? undefined : FadeInDown.delay(delay).duration(360));
  return (
    <View
      style={styles.root}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="onboarding-statement-scene">
      <Animated.View entering={entering(40)} style={styles.back}>
        <Sheet tag="CSV" tone={night.warning} />
      </Animated.View>
      <Animated.View entering={entering(120)} style={styles.front}>
        <Sheet tag="PDF" tone={night.expense} />
      </Animated.View>
      <Animated.View entering={entering(220)} style={styles.tile}>
        <WafraTile size={44} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    maxWidth: 340,
    aspectRatio: 1.7,
    alignSelf: 'center',
  },
  back: { position: 'absolute', top: '4%', start: '6%', width: '58%', transform: [{ rotate: '-5deg' }], opacity: 0.8 },
  front: { position: 'absolute', top: '14%', start: '30%', width: '58%', transform: [{ rotate: '3deg' }] },
  tile: { position: 'absolute', end: '2%', bottom: '2%' },
  sheet: {
    borderWidth: 1,
    borderColor: night.cardBorderStrong,
    backgroundColor: night.backgroundElement,
    borderRadius: Radius.tile,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.one },
  tag: { borderWidth: 1, borderRadius: Radius.chip, paddingHorizontal: 5, paddingVertical: 1 },
  tagText: { fontFamily: Fonts.monoSemi, fontSize: 10, lineHeight: 13, letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  bar: { height: 6, borderRadius: Radius.full, backgroundColor: night.backgroundSelected },
  amount: { backgroundColor: night.primarySoft },
});
