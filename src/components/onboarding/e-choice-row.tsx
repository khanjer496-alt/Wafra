/**
 * The one selectable row every multi-select onboarding step uses. A picked
 * row is tinted with a solid outline and a filled check circle; an unpicked
 * one is an outline with an empty circle — never a full colour inversion,
 * so a list with several picked still reads as a list of choices.
 *
 * Picking is more than the tick: the row's ground lifts toward the band's
 * text colour (a paint-only wash, so the row never re-lays out) and the
 * check pops in on the coin spring. Reduce Motion shows the picked state at once.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { COIN_POP, nativeDriver, useAnimatedNumber } from '@/components/ui/coins/coin-motion';
import { Icon } from '@/components/ui/icon';
import type { BandPalette } from '@/constants/theme';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { tapped } from '@/lib/haptics';

/** How strongly a picked row's ground is washed with the band's text colour. */
export const CHOICE_WASH = 0.14;

/** The row surface: outline at rest, tinted with a solid outline when active. */
export function choiceSurface(palette: BandPalette, active: boolean) {
  return {
    borderColor: active ? palette.onBand : palette.bandRule,
    backgroundColor: active ? palette.tile : 'transparent',
  };
}

/** A 26pt check circle: empty ring, or filled with a check. */
export function CheckCircle({ checked, palette }: { checked: boolean; palette: BandPalette }) {
  return <View style={[styles.check, checked
    ? { backgroundColor: palette.onBand, borderColor: palette.onBand }
    : { borderColor: palette.onBandSecondary }]}>
    {checked ? <Icon name="check" size={16} color={palette.band} strokeWidth={2.6} /> : null}
  </View>;
}

export function EChoiceRow({ label, checked, onPress, palette, disabled, testID }: {
  label: string;
  checked: boolean;
  onPress: () => void;
  palette: BandPalette;
  disabled?: boolean;
  testID?: string;
}) {
  const motion = useMotionPreference();
  const picked = useAnimatedNumber(checked ? 1 : 0);
  const settled = useRef(false);
  useEffect(() => {
    // The value starts where the prop puts it; only a change animates.
    if (!settled.current || !motion.ready || motion.reducedMotion) {
      settled.current = true;
      picked.setValue(checked ? 1 : 0);
      return;
    }
    const move = Animated.spring(picked, { toValue: checked ? 1 : 0, ...COIN_POP, useNativeDriver: nativeDriver });
    move.start();
    // A quick second tap retargets from wherever the row is.
    return () => move.stop();
  }, [checked, motion.ready, motion.reducedMotion, picked]);
  const paint = useMemo(() => ({
    wash: { opacity: picked.interpolate({ inputRange: [0, 1], outputRange: [0, CHOICE_WASH], extrapolate: 'clamp' }) },
    // The spring overshoots 1 a little: the check swells for a beat, then settles.
    check: { transform: [{ scale: picked.interpolate({ inputRange: [0, 0.5, 1, 1.2], outputRange: [1, 0.86, 1, 1.12] }) }] },
  }), [picked]);
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label}
    accessibilityState={{ checked, disabled: !!disabled }} aria-checked={checked} disabled={disabled} testID={testID}
    onPress={() => { tapped(); onPress(); }}
    style={({ pressed }) => [styles.row, choiceSurface(palette, checked), { opacity: pressed ? 0.8 : 1 }]}>
    <Animated.View testID={testID ? `${testID}-wash` : undefined}
      style={[styles.wash, { backgroundColor: palette.onBand }, paint.wash]} />
    <Animated.View style={paint.check}>
      <CheckCircle checked={checked} palette={palette} />
    </Animated.View>
    <ThemedText type="smallBold" style={[styles.label, { color: palette.onBand }]}>{label}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60, borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden',
  },
  wash: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, pointerEvents: 'none' },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, minWidth: 0, fontSize: 17, lineHeight: 23 },
});
