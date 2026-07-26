import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Radius, Spacing } from '@/constants/theme';
import { t } from '@/lib/i18n';
import { useTheme } from '@/hooks/use-theme';

const TAB_ICONS: Record<string, IconName> = {
  index: 'home',
  stats: 'chart',
  bills: 'repeat',
  budgets: 'target',
  wallet: 'wallet',
};

const TAB_LABELS: Record<string, () => string> = {
  index: () => t('tabHome'),
  stats: () => t('tabInsights'),
  bills: () => t('tabBills'),
  budgets: () => t('tabBudgets'),
  wallet: () => t('tabWallet'),
};

/**
 * Floating pill tab bar with a raised center button that opens the
 * add-transaction sheet. Routes are split 2 / 2 around the center button.
 */
export function WafraTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const routes = state.routes.filter((r) => TAB_ICONS[r.name]);
  const left = routes.slice(0, 2);
  const right = routes.slice(2);

  const renderTab = (route: (typeof routes)[number]) => {
    const index = state.routes.findIndex((r) => r.key === route.key);
    const focused = state.index === index;
    return (
      <Pressable
        key={route.key}
        style={styles.tab}
        onPress={() => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        }}>
        <View
          style={[
            styles.iconWrap,
            focused && { backgroundColor: `${theme.primary}1f` },
          ]}>
          <Icon
            name={TAB_ICONS[route.name]}
            size={22}
            color={focused ? theme.primary : theme.textSecondary}
            strokeWidth={focused ? 2.4 : 2}
          />
        </View>
        <ThemedText
          type="small"
          style={[
            styles.label,
            { color: focused ? theme.primary : theme.textSecondary },
          ]}>
          {TAB_LABELS[route.name]()}
        </ThemedText>
      </Pressable>
    );
  };

  return (
    <Animated.View
      entering={FadeIn}
      style={[
        styles.wrap,
        { paddingBottom: Math.max(insets.bottom, Spacing.two) },
      ]}
      pointerEvents="box-none">
      <View
        style={[
          styles.bar,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.cardBorder,
            shadowColor: '#000',
          },
        ]}>
        {left.map(renderTab)}
        <View style={styles.centerSlot}>
          <Pressable
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              }
              router.push('/add-transaction');
            }}
            style={({ pressed }) => [
              styles.fab,
              {
                backgroundColor: theme.primary,
                transform: [{ scale: pressed ? 0.94 : 1 }],
              },
            ]}>
            <Icon name="plus" size={26} color={theme.onPrimary} strokeWidth={2.6} />
          </Pressable>
        </View>
        {right.map(renderTab)}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    marginHorizontal: Spacing.three,
    width: '92%',
    maxWidth: 500,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.one,
  },
  iconWrap: {
    width: 40,
    height: 30,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
  },
  centerSlot: {
    width: 68,
    alignItems: 'center',
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Platform.select({ ios: -26, android: -30 }) ?? -28,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
});
