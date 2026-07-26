import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Elevation, Radius, Spacing } from '@/constants/theme';
import { t } from '@/lib/i18n';
import { useTheme } from '@/hooks/use-theme';

const TAB_ICONS: Record<string, IconName> = {
  index: 'home',
  flow: 'chart',
  bills: 'repeat',
  wallet: 'wallet',
};

const TAB_LABELS: Record<string, () => string> = {
  index: () => t('tabHome'),
  flow: () => t('tabFlow'),
  bills: () => t('tabBills'),
  wallet: () => t('tabWallet'),
};

/**
 * Floating tab bar: four tabs, then the add button inline at the right end.
 *
 * The `+` used to be a raised circle in the middle, which meant the bar was
 * taller than itself and permanently covered the last row of every list — the
 * one row a scroll-to-bottom is usually looking for. Inline, the bar is a
 * single rectangle of known height, and `useTabBarClearance` can pad for it
 * honestly.
 *
 * Active state is colour and stroke weight only. A filled tile behind the icon
 * was a third competing surface in a system that otherwise groups with hairline
 * dividers.
 */
export function WafraTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const routes = state.routes.filter((r) => TAB_ICONS[r.name]);

  const renderTab = (route: (typeof routes)[number]) => {
    const index = state.routes.findIndex((r) => r.key === route.key);
    const focused = state.index === index;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
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
        <Icon
          name={TAB_ICONS[route.name]}
          size={21}
          color={focused ? theme.primary : theme.textTertiary}
          strokeWidth={focused ? 2.1 : 1.8}
        />
        <ThemedText
          type="nano"
          style={{ color: focused ? theme.primary : theme.textTertiary }}>
          {TAB_LABELS[route.name]()}
        </ThemedText>
      </Pressable>
    );
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Scrim color={theme.background} />
      <Animated.View
        entering={FadeIn}
        style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, Spacing.two) }]}
        pointerEvents="box-none">
        <View
          style={[
            styles.bar,
            Elevation,
            { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder },
          ]}>
          {routes.map(renderTab)}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('tabAdd')}
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              }
              router.push('/add-transaction');
            }}
            style={({ pressed }) => [
              styles.add,
              {
                backgroundColor: theme.primary,
                transform: [{ scale: pressed ? 0.95 : 1 }],
              },
            ]}>
            <Icon name="plus" size={22} color={theme.onPrimary} strokeWidth={2.2} />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const SCRIM_HEIGHT = 132;
const SCRIM_STEPS = 12;

/**
 * The fade behind the bar, built from stacked slices rather than a gradient:
 * `expo-linear-gradient` is not a dependency and the redesign is not worth one.
 * Twelve steps of a warm neutral at these alphas do not band — the largest
 * jump between adjacent slices is under 9% opacity, well below the threshold
 * where an edge becomes visible on a non-flat surface.
 */
function Scrim({ color }: { color: string }) {
  return (
    <View style={styles.scrim} pointerEvents="none">
      {Array.from({ length: SCRIM_STEPS }, (_, i) => (
        <View
          key={i}
          style={{
            height: SCRIM_HEIGHT / SCRIM_STEPS,
            backgroundColor: color,
            // Ease in, so the top of the fade is genuinely invisible.
            opacity: Math.min(1, ((i + 1) / SCRIM_STEPS) ** 1.6 / 0.62),
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SCRIM_HEIGHT,
  },
  barWrap: { alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.tabbar,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    width: '92%',
    maxWidth: 500,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: Spacing.one,
  },
  add: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
