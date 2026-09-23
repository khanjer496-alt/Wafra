import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import { LockGate } from '@/components/lock-gate';
import { SuperwallBillingProvider } from '@/components/superwall-billing-provider';
import { SuperwallOnboarding } from '@/components/superwall-onboarding';
import { ToastProvider } from '@/components/ui/toast';
import { Colors } from '@/constants/theme';
import { LanguageProvider } from '@/hooks/use-language';
import { LedgerMoneyProvider } from '@/hooks/use-ledger-money';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { startMotionPreference } from '@/hooks/use-reduced-motion';
import { PeriodProvider } from '@/lib/period-context';
import { StoreProvider, useStore } from '@/lib/store';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import { marketCurrencyCode } from '@/lib/markets';
// Required at module scope so expo-task-manager can load the wake-only relay
// handler when iOS launches the JS bundle in the background.
import '@/lib/background-relay';
// Android SMS_RECEIVED / bank-app notification events can launch the JS bundle
// without mounting a React tree. Register that short headless task at module
// scope for the same reason the iOS relay handler above is registered here.
import '@/lib/android-live-background';
import { installFeedbackTransport } from '@/lib/feedback-transport';
import { markLaunchPhase } from '@/lib/launch-performance';
import { localSemanticBackgroundCancellation, setLocalSemanticAppActive } from '@/lib/local-semantic-background-policy';
import { waitForForegroundHistoryIdle } from '@/lib/foreground-history-priority';
import { hydrateLocalSemanticInboxShadow } from '@/lib/local-semantic-inbox-shadow';
import { getLocalSemanticEncoder } from '@/lib/local-semantic-runtime';
import { hydrateLocalSemanticShadow } from '@/lib/local-semantic-shadow';
import { startRuntimePerformanceMonitor } from '@/lib/runtime-performance';

// Installed once, at module load, before any screen can offer to send. The
// capture module keeps its promise of holding no network by taking delivery
// through a setter; this is the one call that fills it in.
installFeedbackTransport();

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
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let disposed = false;
    let warmStarted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onState = (next: string) => {
      const active = next === 'active';
      setLocalSemanticAppActive(active);
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (!active || !state.hydrated || warmStarted) return;
      const cancelled = localSemanticBackgroundCancellation();
      // Fonts and ledger hydration have completed; give the first screen a
      // quiet turn before parsing the tokenizer or creating the native session.
      timer = setTimeout(() => {
        timer = null;
        void waitForForegroundHistoryIdle().then(() => {
          if (disposed || cancelled()) return;
          warmStarted = true;
          return getLocalSemanticEncoder({ background: true });
        }).catch(() => {
          if (!cancelled()) return;
          warmStarted = false;
          if (!disposed && AppState.currentState === 'active') onState('active');
        });
      }, 1500);
    };
    onState(AppState.currentState);
    const listener = AppState.addEventListener('change', onState);
    return () => {
      disposed = true;
      setLocalSemanticAppActive(false);
      if (timer !== null) clearTimeout(timer);
      listener.remove();
    };
  }, [state.hydrated]);
  const language = state.language === 'ar' ? 'ar' : 'en';
  const moneySpec = state.ledgerMoney ?? ledgerMoneySpec(marketCurrencyCode(state.marketId));
  return (
    <LanguageProvider language={language}>
      <LedgerMoneyProvider moneySpec={moneySpec}>
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
      </LedgerMoneyProvider>
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
  // SDK 55 extracts and preloads these files during a static web export. The
  // server render cannot observe a browser font-load event, so waiting here
  // returned null and shipped an empty HTML body to crawlers.
  const ready = Platform.OS === 'web' || fontsLoaded || !!fontError;

  useEffect(() => startRuntimePerformanceMonitor(), []);

  // Restore lightweight counters at launch. Optional native model preparation
  // waits for fonts, ledger hydration and an idle navigation window in Direction.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void hydrateLocalSemanticShadow().catch(() => undefined);
    void hydrateLocalSemanticInboxShadow().catch(() => undefined);
  }, []);

  // Ask the OS about Reduce Motion and the screen reader once, here, while
  // the fonts are still loading. Both answers are app-wide and asynchronous,
  // and every entrance animation holds its content still until the
  // screen-reader one arrives — so resolving it before any screen mounts is
  // the difference between Home appearing and Home appearing after a beat.
  useEffect(() => startMotionPreference(), []);

  useEffect(() => {
    if (ready) {
      markLaunchPhase('fonts-ready');
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

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

  /*
    `StoreProvider` mounts BEFORE the fonts are in memory, and only the UI
    below waits for them.

    It used to sit under an `if (!ready) return null`, which made the launch
    strictly serial: eight typefaces had to decode before the provider existed,
    and only then did the SecureStore key read, the SQLCipher open, the chunk
    reads, the JSON parse and the migrations begin. Those are the slow half,
    and they need no font. Starting them here overlaps them with the font load
    instead, so the ledger is often ready by the first painted frame.

    Nothing renders early: with `ready` false the provider's children are
    null, so no screen can paint against a half-hydrated ledger, and the
    splash still hides on `fonts-ready` exactly as before.
  */
  return (
    <StoreProvider>
      <SuperwallBillingProvider>
      {!ready ? null : (
      <Direction>
      <PeriodProvider>
      <ThemeProvider value={navTheme}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <LockGate>
          <SuperwallOnboarding>
          <ToastProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="add-transaction"
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen name="transactions" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="transfers" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="stats" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="recap" options={{ animation: 'fade' }} />
            <Stack.Screen name="import-sms" options={{ animation: 'slide_from_right' }} />
            {/* Every name below has a file behind it in src/app, and nothing that
                lacks one is declared. That is the whole rule for this block: a
                `bills` entry survived here after src/app/bills.tsx became a tab,
                and a declared-but-fileless name resolves to nothing, so every
                push to /bills — Leaving soon, the subscription insight — landed
                on Unmatched Route. Deleting a screen file means deleting its
                line here in the same change. */}
            <Stack.Screen name="cards" options={{ animation: 'slide_from_right' }} />
            {/* Sort merchants. Declared for the push animation every other
                pushed screen has; src/app/categorise.tsx is the file behind
                it, per the rule above. */}
            <Stack.Screen name="categorise" options={{ animation: 'slide_from_right' }} />
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
          </SuperwallOnboarding>
        </LockGate>
      </ThemeProvider>
      </PeriodProvider>
      </Direction>
      )}
      </SuperwallBillingProvider>
    </StoreProvider>
  );
}
