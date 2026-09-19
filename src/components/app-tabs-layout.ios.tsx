import { NativeTabs } from 'expo-router/unstable-native-tabs';
import React, { useRef } from 'react';

import { TabBarMetricsProvider } from '@/components/ui/tab-bar-metrics';
import { useAutoImport } from '@/hooks/use-auto-import';
import { useHistoryImport } from '@/hooks/use-history-import';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { prioritizeForegroundNavigation } from '@/lib/foreground-history-priority';
import { tapped } from '@/lib/haptics';
import { t } from '@/lib/i18n';

/**
 * iOS gets the system tab bar. Android and the web keep the hand-built bar in
 * `app-tabs-layout.tsx`; Metro picks this file only for the iOS bundle.
 *
 * The system bar is what the Human Interface Guidelines mean by a tab bar on
 * iOS 26: Liquid Glass, scroll-edge transparency, SF Symbols in the system
 * weight, the system label font (so Arabic labels render in the platform
 * face, not a Latin cut with no Arabic coverage), and the large-text layout
 * the OS provides for the accessibility text sizes. None of that has to be
 * re-implemented, and none of it can be re-implemented faithfully.
 *
 * Content insets stay manual. `ScreenScaffold` reserves
 * `useTabBarClearance()` at the bottom of every tab screen, and with
 * `nativeChrome` set below that hook reads the safe-area inset the tab
 * screen receives, which under a `UITabBarController` already contains the
 * bar. Letting react-native-screens ALSO adjust the first scroll view would
 * stack a second inset on top, so every trigger opts out of the automatic one.
 */

/** Same owner as the Android/web shell: capture lives in the tab shell, not in
 * whichever tab happened to render first. Kept inline rather than imported
 * because `./app-tabs-layout` resolves to THIS file on iOS. */
function CaptureOwner() {
  useHistoryImport();
  useAutoImport(true, false);
  return null;
}

const TABS = [
  { name: 'index', label: 'tabHome', sf: { default: 'house', selected: 'house.fill' } },
  { name: 'flow', label: 'tabFlow', sf: { default: 'chart.bar.xaxis', selected: 'chart.bar.xaxis' } },
  { name: 'bills', label: 'tabBills', sf: { default: 'doc.text', selected: 'doc.text.fill' } },
  { name: 'wallet', label: 'tabWallet', sf: { default: 'wallet.pass', selected: 'wallet.pass.fill' } },
] as const;

export default function TabsLayout() {
  const theme = useTheme();
  const lang = useLanguage();
  // `focus` fires once per actual switch and never for a tap on the tab that
  // is already selected, which is exactly when the custom bar ticks. The
  // first focus is the shell mounting, not a choice, so it stays silent.
  const focusedTab = useRef<string | null>(null);

  return (
    <TabBarMetricsProvider nativeChrome>
      <CaptureOwner />
      <NativeTabs tintColor={theme.primary}>
        {TABS.map((tab) => (
          <NativeTabs.Trigger
            key={tab.name}
            name={tab.name}
            disableAutomaticContentInsets
            listeners={{
              tabPress: () => prioritizeForegroundNavigation(),
              focus: () => {
                if (focusedTab.current !== null && focusedTab.current !== tab.name) tapped();
                focusedTab.current = tab.name;
              },
            }}>
            <NativeTabs.Trigger.Icon sf={tab.sf} />
            <NativeTabs.Trigger.Label>{t(tab.label, lang)}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        ))}
      </NativeTabs>
    </TabBarMetricsProvider>
  );
}
