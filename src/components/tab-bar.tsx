import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
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

/** Four durable destinations. Manual cash entry belongs in the ledger, not in
 * the centre of the product's navigation: Wafra's promise is automatic
 * capture, so the bar no longer makes hand-entry its largest control. */
export function WafraTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
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
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityLabel={t(TAB_LABELS[route.name], lang)}
        accessibilityState={{ selected: focused }}
        style={styles.tab}
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
        }}>
        <Icon
          name={TAB_ICONS[route.name]}
          size={21}
          color={focused ? theme.primary : theme.textTertiary}
          strokeWidth={focused ? 2.1 : 1.8}
        />
        <ThemedText
          type="meta"
          style={[styles.tabLabel, { color: focused ? theme.primary : theme.textTertiary }]}>
          {t(TAB_LABELS[route.name], lang)}
        </ThemedText>
      </Pressable>
    );
  };

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: theme.backgroundElement, borderTopColor: theme.cardBorder },
      ]}>
      <Animated.View
        entering={reducedMotion ? undefined : FadeIn.duration(180)}
        style={[styles.bar, { paddingBottom: Math.max(insets.bottom, Spacing.two) }]}>
        {routes.map(renderTab)}
      </Animated.View>
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
  tabLabel: {
    fontSize: 10.5,
    lineHeight: 14,
  },
});
