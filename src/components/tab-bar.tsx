import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { useTabBarMetrics } from '@/components/ui/tab-bar-metrics';
import { Fonts, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { tapped } from '@/lib/haptics';
import { t, type StringKey } from '@/lib/i18n';
import { useTheme } from '@/hooks/use-theme';
import { prioritizeForegroundNavigation } from '@/lib/foreground-history-priority';
import { recordRuntimeInteraction } from '@/lib/runtime-performance';

const TAB_ICONS: Record<string, IconName> = {
  index: 'home',
  flow: 'chart',
  bills: 'receipt',
  wallet: 'wallet',
};

const TAB_LABELS: Record<string, StringKey> = {
  index: 'tabHome',
  flow: 'tabFlow',
  bills: 'tabBills',
  wallet: 'tabWallet',
};

const LedgerTabButton = ({ focused, icon, label, iconOnly, onPress, onPeek, testID }: {
  focused: boolean; icon: IconName; label: string; iconOnly: boolean; onPress: () => void;
  onPeek: (label: string | null) => void; testID: string;
}) => {
  const theme = useTheme();
  return <Pressable testID={testID} role="tab" aria-selected={focused} accessibilityRole="tab"
    accessibilityLabel={label} accessibilityState={{ selected: focused }}
    onPressIn={() => prioritizeForegroundNavigation()}
    onPress={onPress}
    // At the accessibility text sizes the bar shows icons only, as the iOS
    // system bar does; holding a tab shows its name, like the system's Large
    // Content Viewer. Screen readers always hear the label.
    onLongPress={iconOnly ? () => onPeek(label) : undefined}
    onPressOut={iconOnly ? () => onPeek(null) : undefined}
    android_ripple={{ color: theme.backgroundSelected, borderless: false }}
    style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.7 : 1 }]}>
    {/* Material 3's active indicator: a pill behind the selected icon. It is
        drawn, not animated — this bar is rebuilt on every navigation state
        change and device traces tied tab-press jank to motion started here
        (see perf-config.test.js). Selection is therefore immediate for every
        user, which is also what Reduce Motion asks for. The pill is always
        laid out, transparent when idle, so icons never shift. */}
    <View testID={`${testID}-indicator`} style={[styles.indicator,
      { backgroundColor: focused ? theme.primarySoft : 'transparent' }]}>
      <Icon name={icon} size={iconOnly ? 26 : 22} color={focused ? theme.primary : theme.textSecondary} strokeWidth={focused ? 2.1 : 1.8} />
    </View>
    {!iconOnly && <ThemedText type="meta" style={[styles.tabLabel, focused ? styles.tabLabelFocused : null,
      { color: focused ? theme.text : theme.textSecondary }]}>{label}</ThemedText>}
  </Pressable>;
};

/** Four durable destinations. Manual cash entry belongs in the ledger, not in
 * the centre of the product's navigation: Wafra's promise is automatic
 * capture, so the bar no longer makes hand-entry its largest control. */
export function WafraTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { measuredHeight, setMeasuredHeight } = useTabBarMetrics();
  const navigationPendingRef = React.useRef<string | null>(null);
  const navigationGuardTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Language remains reactive and explicit to t(), without subscribing the
  // navigation controls to every transaction and history-progress update.
  const lang = useLanguage();
  const iconOnly = useLargeTextLayout();
  const [peek, setPeek] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Once React Navigation publishes the new selected index, that transition
    // is complete and the next destination can be accepted immediately.
    navigationPendingRef.current = null;
    if (navigationGuardTimer.current) clearTimeout(navigationGuardTimer.current);
    navigationGuardTimer.current = null;
    return () => {
      if (navigationGuardTimer.current) clearTimeout(navigationGuardTimer.current);
      navigationGuardTimer.current = null;
    };
  }, [state.index]);

  const routes = state.routes.filter((r) => TAB_ICONS[r.name]);

  const renderTab = (route: (typeof routes)[number]) => {
    const index = state.routes.findIndex((r) => r.key === route.key);
    const focused = state.index === index;
    return (
      <LedgerTabButton
        key={route.key}
        testID={`main-tab-${route.name}`}
        focused={focused}
        icon={TAB_ICONS[route.name]}
        label={t(TAB_LABELS[route.name], lang)}
        iconOnly={iconOnly}
        onPeek={setPeek}
        onPress={() => {
          // Count pressure, not destinations. If the process dies during a tap
          // storm the next tester diagnostic can still tell us it happened,
          // without persisting which financial screen the user was viewing.
          recordRuntimeInteraction('main-tab-press');
          // React state can lag one or more taps behind a native transition.
          // Do not enqueue another fragment/navigation transaction in that
          // window; the current one will clear this latch when state.index lands.
          if (!focused && navigationPendingRef.current !== null) return;
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
            navigationPendingRef.current = route.key;
            // Fail open if a native navigation never publishes a state update.
            // This is a guard against accidental tap storms, not a UI lock.
            navigationGuardTimer.current = setTimeout(() => {
              if (navigationPendingRef.current === route.key) navigationPendingRef.current = null;
              navigationGuardTimer.current = null;
            }, 750);
            navigation.navigate(route.name);
          }
        }}
      />
    );
  };

  return (
    <View
      onLayout={({ nativeEvent: { layout } }) => {
        const height = Math.round(layout.height);
        if (height !== measuredHeight) setMeasuredHeight(height);
      }}
      style={[
        styles.wrap,
        { backgroundColor: theme.background, borderTopColor: theme.cardBorder },
      ]}>
      {peek !== null && <View pointerEvents="none" style={[styles.peek, { backgroundColor: theme.inverseSurface }]}>
        <ThemedText type="heading" style={{ color: theme.inverseText }}>{peek}</ThemedText>
      </View>}
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
    paddingTop: 3,
    paddingHorizontal: Spacing.two,
    width: '100%',
    maxWidth: 800,
  },
  tab: {
    flex: 1,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 8,
    paddingBottom: 4,
  },
  indicator: {
    width: 64,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peek: {
    position: 'absolute',
    bottom: '100%',
    marginBottom: Spacing.two,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 12,
    maxWidth: '90%',
  },
  tabLabel: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    flexShrink: 1,
  },
  // Android ignores fontWeight on a custom family; the weight is its own face.
  tabLabelFocused: { fontFamily: Fonts.sansSemi },
});
