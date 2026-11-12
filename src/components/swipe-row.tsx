import React, { memo, useCallback, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { ReduceMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import type { IconName } from '@/components/ui/icon.types';
import { BandPalettes, MotionSpring, type BandId } from '@/constants/theme';
import { useBandScheme } from '@/hooks/use-band';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { isRTL } from '@/lib/i18n';

const SPRING = MotionSpring;
const NO_MOTION = { reduceMotion: ReduceMotion.Always };
// Module-level so every row hands the swipeable the SAME function. An inline
// arrow here was a new `onSwipeableWillOpen` each render, and the swipeable
// rebuilds its Pan and Tap gestures (with native gesture-handler updates) when
// that prop changes, for every mounted row on every pass.
const onSwipeableWillOpen = () => tapped();

export interface SwipeAction {
  /** Stable id, also the accessibility action name. */
  name: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  /**
   * Design language E: the action wears a band's colour (Category ochre,
   * Transfer slate on Transactions). Without one, the plain surface; a
   * destructive action is always clay.
   */
  band?: BandId;
  onPress: () => void;
}

/**
 * A list row that reveals its actions when swiped toward the start edge.
 *
 * Swiping only reveals buttons; nothing happens until one is pressed, and
 * each action opens its own confirmation or sheet. The same actions are
 * offered to screen readers through the row's accessibilityActions (the
 * caller passes them to the row), so the gesture is never the only way in.
 * Reduce Motion makes the reveal jump instead of spring.
 *
 * Memoized, with callbacks that only change when what they show changes: the
 * Transactions list mounts ~100 of these, and a pass that handed each one new
 * props or new inline callbacks rebuilt its gestures.
 */
export const SwipeRow = memo(function SwipeRow({ actions, children, testID }: { actions: readonly SwipeAction[]; children: React.ReactNode; testID?: string }) {
  const theme = useTheme();
  const scheme = useBandScheme();
  const { reducedMotion } = useMotionPreference();
  const methods = useRef<SwipeableMethods | null>(null);
  // Changes only with the row's actions, the theme or the band scheme (hooks
  // run before the early return below).
  const renderActions = useCallback(() => <View style={styles.actions}>
    {actions.map((action) => {
      // A destructive action is clay (`danger`) whatever band the screen wears.
      const tone = action.destructive ? null : action.band ?? null;
      const palette = tone ? BandPalettes[scheme][tone] : null;
      const danger = action.destructive ? BandPalettes[scheme].home : null;
      const fill = danger ? danger.danger : palette ? palette.band : theme.backgroundElement;
      const ink = danger ? danger.onDanger : palette ? palette.onBand : theme.text;
      return <Pressable key={action.name} testID={`swipe-action-${action.name}`}
        accessibilityRole="button" accessibilityLabel={action.label}
        onPress={() => { tapped(); methods.current?.close(); action.onPress(); }}
        style={({ pressed }) => [styles.action, { backgroundColor: fill, opacity: pressed ? 0.8 : 1 }]}>
        <Icon name={action.icon} size={18} color={ink} />
        <ThemedText type="meta" style={[styles.label, { color: ink }]}>{action.label}</ThemedText>
      </Pressable>;
    })}
  </View>, [actions, scheme, theme]);
  if (actions.length === 0) return <>{children}</>;
  // Actions sit at the trailing edge: right in English, left in Arabic.
  const rtl = isRTL();
  return <ReanimatedSwipeable ref={methods} testID={testID} friction={2} overshootLeft={false} overshootRight={false}
    rightThreshold={40} leftThreshold={40}
    animationOptions={reducedMotion ? NO_MOTION : SPRING}
    // A tick when the actions snap open: the row has registered the swipe.
    onSwipeableWillOpen={onSwipeableWillOpen}
    renderRightActions={rtl ? undefined : renderActions}
    renderLeftActions={rtl ? renderActions : undefined}>
    {children}
  </ReanimatedSwipeable>;
});

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'stretch' },
  action: { width: 76, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4 },
  label: { fontSize: 12, lineHeight: 16, textAlign: 'center' },
});
