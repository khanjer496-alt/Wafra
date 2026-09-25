import React, { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { ReduceMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import type { IconName } from '@/components/ui/icon.types';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { isRTL } from '@/lib/i18n';

const SPRING = { stiffness: 260, damping: 24 };
const NO_MOTION = { reduceMotion: ReduceMotion.Always };

export interface SwipeAction {
  /** Stable id, also the accessibility action name. */
  name: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
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
 */
export function SwipeRow({ actions, children, testID }: { actions: readonly SwipeAction[]; children: React.ReactNode; testID?: string }) {
  const theme = useTheme();
  const { reducedMotion } = useMotionPreference();
  const methods = useRef<SwipeableMethods | null>(null);
  if (actions.length === 0) return <>{children}</>;
  const renderActions = () => <View style={styles.actions}>
    {actions.map((action) => <Pressable key={action.name} testID={`swipe-action-${action.name}`}
      accessibilityRole="button" accessibilityLabel={action.label}
      onPress={() => { methods.current?.close(); action.onPress(); }}
      style={({ pressed }) => [styles.action, {
        backgroundColor: action.destructive ? theme.expenseGraphic : pressed ? theme.backgroundSelected : theme.backgroundElement,
      }]}>
      <Icon name={action.icon} size={18} color={action.destructive ? theme.onPrimary : theme.text} />
      <ThemedText type="meta" style={{ color: action.destructive ? theme.onPrimary : theme.text }}>{action.label}</ThemedText>
    </Pressable>)}
  </View>;
  // Actions sit at the trailing edge: right in English, left in Arabic.
  const rtl = isRTL();
  return <ReanimatedSwipeable ref={methods} testID={testID} friction={2} overshootLeft={false} overshootRight={false}
    rightThreshold={40} leftThreshold={40}
    animationOptions={reducedMotion ? NO_MOTION : SPRING}
    renderRightActions={rtl ? undefined : renderActions}
    renderLeftActions={rtl ? renderActions : undefined}>
    {children}
  </ReanimatedSwipeable>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'stretch' },
  action: { width: 76, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4 },
});
