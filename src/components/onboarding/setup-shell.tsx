import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { OnboardingAtmosphere, WafraTile } from './alive-scenes';
import { ThemedText } from '@/components/themed-text';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { Button } from '@/components/ui/controls';
import { ScreenHeader, type ScreenHeaderProps } from '@/components/ui/screen-header';
import { Colors, Spacing } from '@/constants/theme';
import { ThemeScope } from '@/hooks/use-theme';
import { hasArabicScript } from '@/lib/i18n';

/** Keep the subtree stable while durable onboarding origin is restored. */
export function SetupShell({ onboarding, children }: { onboarding: boolean; children: React.ReactNode }) {
  return <ThemeScope.Provider value={onboarding ? 'dark' : undefined}>
    <View testID={onboarding ? 'onboarding-setup-shell' : 'settings-setup-shell'}
      style={[styles.root, onboarding && { backgroundColor: Colors.dark.background }]}>
      <View pointerEvents="none" accessible={false} style={styles.atmosphere}>
        {onboarding && <OnboardingAtmosphere />}
      </View>
      {children}
      {onboarding && <StatusBar style="light" />}
    </View>
  </ThemeScope.Provider>;
}

export function SetupHeader({ onboarding, ...props }: ScreenHeaderProps & { onboarding: boolean }) {
  if (!onboarding) return <ScreenHeader mode="inline" {...props} />;
  return <View style={styles.header}>
    <Stack.Screen options={{ headerShown: false, title: props.title }} />
    <View style={styles.toolbar}>
      {props.back ? <ActionIconButton icon="chevron-left" label={props.back.label}
        onPress={props.back.onPress} disabled={props.back.disabled} variant="plain" /> : <View />}
      <View style={styles.actions}>{props.actions?.map(action => <Button key={action.label}
        label={action.label} onPress={action.onPress} disabled={action.disabled} variant="ghost" wrapLabel />)}</View>
    </View>
    <WafraTile size={40} />
    <ThemedText type="heading" accessibilityRole="header"
      style={[styles.title, hasArabicScript(props.title) && styles.arabicTitle]}>{props.title}</ThemedText>
    {props.subtitle && <ThemedText themeColor="textSecondary" style={styles.subtitle}>{props.subtitle}</ThemedText>}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  // Clip the decorative wash, never the scrollable content or focus rings.
  atmosphere: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  header: { gap: Spacing.three, paddingBottom: Spacing.three },
  toolbar: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  actions: { flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap' },
  // Match the existing onboarding hero; Arabic keeps room for its full metrics.
  title: { fontSize: 25, lineHeight: 31 },
  arabicTitle: { lineHeight: 38 },
  subtitle: { lineHeight: 23 },
});
