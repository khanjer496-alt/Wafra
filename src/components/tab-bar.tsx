import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { SpringPressable } from '@/components/ui/spring-pressable';
import { Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { tapped } from '@/lib/haptics';
import { t, type Lang, type StringKey } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import { useTheme } from '@/hooks/use-theme';

const TAB_ICONS: Record<string, IconName> = {
  index: 'home',
  flow: 'chart',
  bills: 'repeat',
  wallet: 'wallet',
};

const TAB_LABELS: Record<string, StringKey> = {
  index: 'tabHome',
  flow: 'tabFlow',
  bills: 'tabBills',
  wallet: 'tabWallet',
};

const TAB_SPRING = {
  damping: 18,
  stiffness: 330,
  mass: 0.7,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
} as const;

const AnimatedTabButton = ({
  focused,
  icon,
  label,
  onPress,
}: {
  focused: boolean;
  icon: IconName;
  label: string;
  onPress: () => void;
}) => {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const focus = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    const next = focused ? 1 : 0;
    focus.value = reducedMotion ? next : withSpring(next, TAB_SPRING);
  }, [focus, focused, reducedMotion]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: focus.value,
    transform: [
      { scaleX: interpolate(focus.value, [0, 1], [0.55, 1]) },
      { scaleY: interpolate(focus.value, [0, 1], [0.8, 1]) },
    ],
  }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(focus.value, [0, 1], [0, -2]) },
      { scale: interpolate(focus.value, [0, 1], [1, 1.08]) },
    ],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(focus.value, [0, 1], [0.72, 1]),
    transform: [{ translateY: interpolate(focus.value, [0, 1], [0, -1]) }],
  }));

  return (
    <SpringPressable
      role="tab"
      aria-selected={focused}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      opacityTo={0.8}
      scaleTo={0.92}
      style={styles.tab}
      onPress={onPress}>
      <View style={styles.iconStage}>
        <Animated.View
          style={[
            styles.activePill,
            { backgroundColor: theme.backgroundSelected },
            pillStyle,
          ]}
        />
        <Animated.View style={iconStyle}>
          <Icon
            name={icon}
            size={21}
            color={focused ? theme.primary : theme.textTertiary}
            strokeWidth={focused ? 2.1 : 1.8}
          />
        </Animated.View>
      </View>
      <Animated.View style={labelStyle}>
        <ThemedText
          type="meta"
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={[styles.tabLabel, { color: focused ? theme.primary : theme.textTertiary }]}>
          {label}
        </ThemedText>
      </Animated.View>
    </SpringPressable>
  );
};

/** Four durable destinations. Manual cash entry belongs in the ledger, not in
 * the centre of the product's navigation: Wafra's promise is automatic
 * capture, so the bar no longer makes hand-entry its largest control. */
export function WafraTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  /**
   * The language, read off the store and passed into every `t()` below.
   *
   * Two things had to be true and only one was. React-navigation re-renders a
   * tab bar when the NAVIGATION state changes and nothing else, so the bar had
   * to subscribe to the store — and `t()` reading a module-level variable is
   * invisible to React Compiler's memoisation, so the label had to take the
   * language as an argument. With only the first, switching to Arabic in
   * Settings and pressing Back left five English labels under four Arabic
   * screens until the user happened to change tabs.
   */
  const { state: store } = useStore();
  const lang: Lang = store.language === 'ar' ? 'ar' : 'en';

  const routes = state.routes.filter((r) => TAB_ICONS[r.name]);

  const renderTab = (route: (typeof routes)[number]) => {
    const index = state.routes.findIndex((r) => r.key === route.key);
    const focused = state.index === index;
    return (
      <AnimatedTabButton
        key={route.key}
        focused={focused}
        icon={TAB_ICONS[route.name]}
        label={t(TAB_LABELS[route.name], lang)}
        onPress={() => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            // The interaction the user makes more than any other, and it had
            // no feedback at all. A tick fires only on an actual switch —
            // tapping the tab you are already on is not a choice.
            tapped();
            navigation.navigate(route.name);
          }
        }}
      />
    );
  };

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: theme.backgroundElement, borderTopColor: theme.cardBorder },
      ]}>
      <View role="tablist" style={[styles.bar, { paddingBottom: Math.max(insets.bottom, Spacing.two) }]}>
        {routes.map(renderTab)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 5,
    paddingHorizontal: Spacing.two,
    width: '100%',
    maxWidth: 800,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 5,
  },
  iconStage: {
    width: 46,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activePill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
  },
  tabLabel: {
    fontSize: 11,
    lineHeight: 14,
  },
});
