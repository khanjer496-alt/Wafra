import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';

import { LockGate } from '@/components/lock-gate';
import { OnboardingGate } from '@/components/onboarding-gate';
import { ToastProvider } from '@/components/ui/toast';
import { Colors } from '@/constants/theme';
import { LanguageProvider } from '@/hooks/use-language';
import { PeriodProvider } from '@/lib/period-context';
import { StoreProvider, useStore } from '@/lib/store';
import { WEB_FONTS } from '@/lib/web-fonts';
import { sweepStaleExportFiles } from '@/lib/file-sharing';
// Required at module scope so expo-task-manager can load the wake-only relay
// handler when iOS launches the JS bundle in the background.
import '@/lib/background-relay';

/**
 * Mirrors the whole app left-to-right or right-to-left, live.
 *
 * The obvious tool for this is I18nManager.forceRTL, and it cannot do it:
 * `isRTL` is an EXPORTED CONSTANT of the native module, read once when that
 * module is constructed, so forceRTL writes a preference that nothing
 * re-reads until the process restarts. That is why switching to Arabic used
 * to mean closing the app.
 *
 * Yoga has always been able to lay out a subtree in either direction, and RN
 * exposes it as the `direction` style. Setting it on the root flips every
 * flex row beneath it on the spot — which is nearly the whole app, since the
 * layout is built from rows and gaps rather than from left/right offsets.
 *
 * What this does NOT reach: react-navigation reads I18nManager.isRTL itself
 * for its push animation and edge-swipe direction. Those stay as they were
 * until the next launch. A screen sliding in from the same side is a much
 * smaller thing to be wrong than every screen being laid out backwards.
 */
function Direction({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  const language = state.language === 'ar' ? 'ar' : 'en';
  return (
    <LanguageProvider language={language}>
      <View
        // Static translation lookups are legal throughout the existing app, but
        // React Compiler cannot see the module-level language they read and
        // may retain their first result. A language change is intentionally a
        // one-off navigator remount: all compiled text is evaluated again
        // after the reducer has updated the language, and screen-local form
        // state cannot straddle two opposite writing directions.
        key={language}
        style={[StyleSheet.absoluteFill, { direction: language === 'ar' ? 'rtl' : 'ltr' }]}>
        {children}
      </View>
    </LanguageProvider>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';
  const palette = Colors[dark ? 'dark' : 'light'];

  const [webFontsLoaded, webFontError] = useFonts(WEB_FONTS);
  useEffect(() => {
    void sweepStaleExportFiles();
  }, []);
  // A browser font that fails to decode must not leave the preview blank.
  if (Platform.OS === 'web' && !webFontsLoaded && !webFontError) return null;

  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(dark ? DarkTheme.colors : DefaultTheme.colors),
      background: palette.background,
      card: palette.card,
      text: palette.text,
      border: palette.cardBorder,
      primary: palette.primary,
    },
  };

  return (
    <StoreProvider>
      <Direction>
      <PeriodProvider>
      <ThemeProvider value={navTheme}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <LockGate>
          <OnboardingGate>
          <ToastProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="add-transaction"
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen name="transactions" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="import-sms" options={{ animation: 'slide_from_right' }} />
            {/* No `bills` screen here: it is a tab now, and src/app/bills.tsx is
                gone. Declaring a name with no file behind it left a route that
                resolved to nothing, so every push to /bills — the Leaving soon
                rows, the subscription insight — landed on Unmatched Route. */}
            <Stack.Screen name="cards" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="trusted-devices" options={{ animation: 'slide_from_right' }} />
          </Stack>
          </ToastProvider>
          </OnboardingGate>
        </LockGate>
      </ThemeProvider>
      </PeriodProvider>
      </Direction>
    </StoreProvider>
  );
}
