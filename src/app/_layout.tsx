import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';

import { LockGate } from '@/components/lock-gate';
import { OnboardingGate } from '@/components/onboarding-gate';
import { ToastProvider } from '@/components/ui/toast';
import { Colors } from '@/constants/theme';
import { LanguageProvider } from '@/hooks/use-language';
import { PeriodProvider } from '@/lib/period-context';
import { StoreProvider, useStore } from '@/lib/store';
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

// Held until the faces are in memory. A money screen that paints in the system
// font and then reflows into Geist Mono moves every figure sideways, which
// reads as a glitch on the one screen that most needs to look exact.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';
  const palette = Colors[dark ? 'dark' : 'light'];

  // Weight is a family here, not a `fontWeight`: Android applies no synthetic
  // weights to a bundled face, so 400/500/600 have to be three separate files.
  const [fontsLoaded, fontError] = useFonts({
    'Geist-Regular': require('../../assets/fonts/Geist-Regular.ttf'),
    'Geist-Medium': require('../../assets/fonts/Geist-Medium.ttf'),
    'Geist-SemiBold': require('../../assets/fonts/Geist-SemiBold.ttf'),
    'GeistMono-Regular': require('../../assets/fonts/GeistMono-Regular.ttf'),
    'GeistMono-Medium': require('../../assets/fonts/GeistMono-Medium.ttf'),
    'GeistMono-SemiBold': require('../../assets/fonts/GeistMono-SemiBold.ttf'),
    'NotoKufiArabic-Regular': require('../../assets/fonts/NotoKufiArabic-Regular.ttf'),
    'NotoKufiArabic-Bold': require('../../assets/fonts/NotoKufiArabic-Bold.ttf'),
  });

  // A font that fails to decode must not leave the user on the splash forever;
  // the app falls back to the system face, which is ugly but usable.
  const ready = fontsLoaded || !!fontError;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

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
            <Stack.Screen name="stats" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="import-sms" options={{ animation: 'slide_from_right' }} />
            {/* Every name below has a file behind it in src/app, and nothing that
                lacks one is declared. That is the whole rule for this block: a
                `bills` entry survived here after src/app/bills.tsx became a tab,
                and a declared-but-fileless name resolves to nothing, so every
                push to /bills — Leaving soon, the subscription insight — landed
                on Unmatched Route. Deleting a screen file means deleting its
                line here in the same change. */}
            <Stack.Screen name="cards" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="trusted-devices" options={{ animation: 'slide_from_right' }} />
            {/* The iOS setup wizard shipped under two filenames during the
                merge — ios-setup.tsx and iphone-setup.tsx. ios-setup.tsx won:
                it is the one every live push targets (Home, Settings,
                onboarding-gate), the one whose copy lives in i18n.ts, and the
                one contracts.test.js and onboarding.test.js assert against.
                iphone-setup.tsx was deleted along with its line here — leaving
                a Stack.Screen for a deleted file is exactly the fileless-name
                bug described above. */}
            <Stack.Screen name="ios-setup" options={{ animation: 'slide_from_right' }} />
            {/* Reachable only from a hand-typed deep link; it must still look
                like the app rather than like a crash. */}
            <Stack.Screen name="+not-found" options={{ animation: 'fade' }} />
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
