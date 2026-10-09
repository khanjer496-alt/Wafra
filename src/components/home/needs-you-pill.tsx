/**
 * Home's "Needs you" pill: a small floating pill just above the tab bar, shown
 * only when something truly needs the person (home-needs-you.ts picks the one
 * with the highest priority). The pill is a button that goes where the need
 * is answered; the × beside it hides that need for the rest of the session.
 *
 * It slides up into place when it appears (native driver, once per need) and
 * lands at once under Reduce Motion, with a screen reader, or while Home
 * cannot be seen. It sits at the start edge (the end edge keeps Android's Add
 * button) and Home pads its sheet by NEEDS_YOU_CLEARANCE so the last row is
 * never under it.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { nativeDriver } from '@/components/ui/coins/coin-motion';
import { Icon, type IconName } from '@/components/ui/icon';
import { Elevation, type BandPalette } from '@/constants/theme';
import { useAppActive } from '@/hooks/use-app-active';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';

/** The pill's height plus the gap above it: what Home's sheet adds at its end while it shows. */
export const NEEDS_YOU_CLEARANCE = 44 + 12;
/** Android's floating Add (56pt) and its gap: the pill stops short of it. */
const ADD_BUTTON_ROOM = 56 + 16 + 12;

export function NeedsYouPill({ needKey, label, spokenLabel, hint, icon, warning, dismissLabel, onPress, onDismiss, band, hold, inline = false }: {
  /** Which need is shown: a new one slides in again. */
  needKey: string;
  /** One short visible line ("Card payment overdue"). */
  label: string;
  /** The full sentence a screen reader hears ("Skywards Infinite payment overdue"). */
  spokenLabel?: string;
  hint: string;
  icon: IconName;
  /** Tracking or an overdue payment: drawn in the warning colours. */
  warning: boolean;
  dismissLabel: string;
  onPress: () => void;
  onDismiss: () => void;
  band: BandPalette;
  /**
   * Drawn in the sheet, full width at its top, instead of floating above the
   * tab bar: with large text or on a short window a floating pill would sit
   * on the first rows (needsYouInline).
   */
  inline?: boolean;
  /** Home cannot be seen yet: the slide waits. */
  hold: boolean;
}) {
  const clearance = useTabBarClearance();
  const motion = useMotionPreference();
  const active = useAppActive();
  const live = motion.ready && active && !hold && !motion.reducedMotion;
  const rise = useRef<Animated.Value | null>(null);
  if (!rise.current) rise.current = new Animated.Value(0);
  const value = rise.current;
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (shown.current === needKey) return;
    if (motion.reducedMotion || (motion.ready && !active)) {
      shown.current = needKey;
      value.setValue(1);
      return;
    }
    if (!live) return;
    shown.current = needKey;
    value.setValue(0);
    const run = Animated.spring(value, { toValue: 1, stiffness: 260, damping: 24, mass: 1, useNativeDriver: nativeDriver });
    run.start();
    return () => { run.stop(); value.setValue(1); };
  }, [needKey, live, motion.reducedMotion, motion.ready, active, value]);
  const ground = warning ? band.statusNearSoft : band.band;
  const ink = warning ? band.statusNear : band.onBand;
  // Inline it fades in where it stands; floating it also rises from the tab bar.
  const placement = inline ? [styles.inline, { opacity: value }]
    : [styles.frame, { bottom: clearance, end: Platform.OS === 'android' ? ADD_BUTTON_ROOM : 16 },
      { opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }] }];
  return <Animated.View testID="home-needs-you" pointerEvents="box-none" style={placement}>
    <View style={[styles.pill, inline && styles.pillInline, { backgroundColor: ground, borderColor: band.bandRule }]}>
      <Pressable testID="home-needs-you-open" accessibilityRole="button" accessibilityLabel={spokenLabel ?? label} accessibilityHint={hint}
        onPress={onPress} style={({ pressed }) => [styles.open, { opacity: pressed ? 0.7 : 1 }]}>
        <Icon name={icon} size={16} color={ink} strokeWidth={2.2} />
        {/* One line at every text size: capped scaling, then an ellipsis; the full sentence is spoken. */}
        <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.2}
          style={[styles.text, { color: ink }]}>{label}</ThemedText>
      </Pressable>
      <Pressable testID="home-needs-you-dismiss" accessibilityRole="button" accessibilityLabel={dismissLabel}
        onPress={onDismiss} hitSlop={4} style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}>
        <Icon name="close" size={16} color={ink} />
      </Pressable>
    </View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', start: 16, alignItems: 'flex-start' },
  inline: { alignSelf: 'stretch' },
  pill: { height: 44, maxWidth: '100%', borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row',
    alignItems: 'center', paddingStart: 14, paddingEnd: 2, elevation: 3,
    shadowColor: Elevation.shadowColor, shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  pillInline: { alignSelf: 'stretch', elevation: 0, shadowOpacity: 0 },
  open: { height: 44, flexShrink: 1, flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingEnd: 4 },
  text: { flexShrink: 1, fontSize: 14, lineHeight: 18 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
