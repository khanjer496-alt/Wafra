import * as LocalAuthentication from 'expo-local-authentication';
import { StatusBar } from 'expo-status-bar';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBiometricKind } from '@/components/biometric-glyph';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { LockPattern } from '@/components/settings-band/lock-pattern';
import { Fonts, ScreenPadding, Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useStore } from '@/lib/store';
import { t } from '@/lib/i18n';
import { settingsCopy } from '@/lib/settings-copy';

type BiometricState = 'prompting' | 'failed' | 'unavailable';

const PrivacyGateContext = createContext(true);

/** True only when the financial UI is not hidden behind App Lock. */
export function usePrivacyGateCleared(): boolean {
  return useContext(PrivacyGateContext);
}

/** The gap between the lock screen's pattern tiles. */
const PATTERN_GAP = 5;

/** Short trips out of the app — a permission sheet, the share card — do not re-lock. */
const RELOCK_GRACE_MS = 20_000;

/**
 * Blocks the app behind device biometrics or the phone PIN when app lock is on.
 *
 * The lock names the hardware this phone actually uses — Face ID, Touch ID,
 * a fingerprint or a face — instead of drawing a fingerprint on every phone,
 * and it has ONE action: the unlock button, in the bottom of the screen where
 * the thumb is. The system prompt itself offers the phone passcode, so a
 * separate "Use PIN" button only repeated the same call. Nothing from the
 * ledger is drawn behind the lock: no blurred balances, no rows.
 *
 * The copy says the balances stay HIDDEN, not "encrypted until you unlock":
 * the ledger's encryption key is not bound to this lock.
 *
 * Design language E: the lock is a full ink screen with the person's own
 * pattern (one of the four places it may appear — it is drawn from their
 * onboarding answers and never carries money), the plain "Wafra is locked",
 * one sentence, and the one unlock button in cream on ink.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const band = useBand('home');
  const largeText = useLargeTextLayout();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The pattern's six columns fit the screen's width at any size.
  const patternTile = Math.max(24, Math.min(largeText ? 34 : 44, Math.floor((width - ScreenPadding * 2 - PATTERN_GAP * 5) / 6)));
  const { state } = useStore();
  const copy = settingsCopy(state.language);
  // Asked only while App Lock is on; the lock screen is the only reader here.
  const biometricKind = useBiometricKind(state.appLock);
  const [unlocked, setUnlocked] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [biometric, setBiometric] = useState<BiometricState>('prompting');

  const lockRequired = state.hydrated && state.appLock && Platform.OS !== 'web' && !unlocked;

  const tryUnlock = useCallback(async () => {
    try {
      // `authenticateAsync` throws on a device with nothing enrolled, so the
      // third state has to be checked rather than inferred from a failure.
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHardware || !enrolled) {
        setBiometric('unavailable');
        return;
      }
      setBiometric('prompting');
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: t('unlockWafra') });
      if (result.success) setUnlocked(true);
      else setBiometric('failed');
    } catch {
      setBiometric('failed');
    } finally {
      setAttempted(true);
    }
  }, []);

  useEffect(() => {
    if (lockRequired && !attempted) tryUnlock();
  }, [lockRequired, attempted, tryUnlock]);

  /**
   * Re-lock when the app leaves the foreground. Without this the gate is a
   * launch-time formality: unlock once and the process stays unlocked until
   * iOS or Android kills it, so handing someone your unlocked phone hands
   * them your ledger — which is the exact thing App Lock is for.
   *
   * The grace period exists because iOS backgrounds the app for its OWN
   * permission and share dialogs. Re-locking on those would make the setting
   * unusable rather than secure.
   */
  useEffect(() => {
    if (!state.appLock || Platform.OS === 'web') return;
    let leftAt = 0;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        leftAt = leftAt || Date.now();
        return;
      }
      if (next === 'active' && leftAt) {
        const away = Date.now() - leftAt;
        leftAt = 0;
        if (away > RELOCK_GRACE_MS) {
          setUnlocked(false);
          setAttempted(false);
          setBiometric('prompting');
        }
      }
    });
    return () => sub.remove();
  }, [state.appLock]);

  /*
    ONE tree shape whether locked or not. This used to return `children`
    bare when unlocked and `<View><View hidden>{children}</View>…lock UI…`
    when locked, which changes the element TYPE at the child position, so
    React unmounted and remounted `children` — the whole router, the tabs and
    every mounted tab screen — on every lock AND every unlock. With App Lock
    on, a cold launch built the tab tree three times (before hydration, behind
    the biometric prompt, and again after unlocking), and React Navigation
    clears a navigator's state on unmount, so a re-lock also dropped the user
    back onto the first tab. Keeping the wrapper and toggling its props keeps
    the navigator alive across the lock.

    The router's Stack stays mounted; the lock paints over it. Opacity alone
    only hides it from EYES — VoiceOver and TalkBack still walk the tree
    underneath and will happily read out every balance on the locked screen,
    so the subtree has to be removed from the accessibility tree explicitly
    (each platform has its own prop) and made untappable.
  */
  return (
    <PrivacyGateContext.Provider value={!lockRequired}>
    <View style={styles.container}>
      <View
        style={lockRequired ? styles.hidden : styles.container}
        pointerEvents={lockRequired ? 'none' : 'auto'}
        accessibilityElementsHidden={lockRequired}
        importantForAccessibility={lockRequired ? 'no-hide-descendants' : 'auto'}>
        {children}
      </View>
      {lockRequired ? (
      <View
        accessibilityViewIsModal
        testID="lock-screen"
        style={[StyleSheet.absoluteFillObject, styles.root, {
          backgroundColor: band.band,
          paddingTop: insets.top,
          paddingBottom: Spacing.four + insets.bottom,
        }]}>
        <StatusBar style={band.statusBar} />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.centre}
          scrollEnabled={largeText}
          showsVerticalScrollIndicator={false}>
          <LockPattern tile={patternTile} gap={PATTERN_GAP} testID="lock-pattern" />
          <ThemedText accessibilityRole="header"
            style={[styles.title, largeText && styles.titleLarge, { color: band.onBand }]}>
            {copy.lockedTitle}
          </ThemedText>
          <ThemedText type="default" style={[styles.copy, { color: band.onBandSecondary }]}>
            {copy.lockedBody}
          </ThemedText>
        </ScrollView>

        {biometric === 'unavailable' ? (
          <View style={styles.actions}>
            <ThemedText type="smallBold" style={[styles.centreText, { color: band.onBand }]}>{t('phoneHasNoLock')}</ThemedText>
            <ThemedText type="meta" style={[styles.centreText, { color: band.onBandSecondary }]}>
              {t('setPhoneLockBody')}
            </ThemedText>
            <EButton
              palette={band}
              label={t('openPhoneSettings')}
              color={{ fill: band.onBand, text: band.band }}
              onPress={() => Linking.openSettings().catch(() => {})}
              testID="lock-open-settings"
            />
          </View>
        ) : (
          <View style={styles.actions}>
            {biometric === 'failed' ? (
              <ThemedText type="smallBold" accessibilityLiveRegion="polite" style={[styles.centreText, { color: band.onBand }]}>
                {copy.lockedRetry}
              </ThemedText>
            ) : null}
            <ThemedText type="meta" style={[styles.centreText, { color: band.onBandSecondary }]}>
              {copy.lockedFallback}
            </ThemedText>
            <EButton
              palette={band}
              label={copy.unlockWith[biometricKind ?? 'passcode']}
              color={{ fill: band.onBand, text: band.band }}
              onPress={tryUnlock}
              testID="lock-unlock"
            />
          </View>
        )}
      </View>
      ) : null}
    </View>
    </PrivacyGateContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hidden: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
  },
  flex: { flex: 1 },
  root: {
    flex: 1,
    paddingHorizontal: ScreenPadding,
  },
  centre: {
    // The reading half of the screen; the button sits where the thumb is.
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.four,
  },
  title: {
    fontFamily: Fonts.sansSemi,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.9,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  titleLarge: { fontSize: 26, lineHeight: 34, letterSpacing: -0.4 },
  copy: {
    textAlign: 'center',
    maxWidth: 320,
  },
  actions: {
    gap: Spacing.two,
    alignItems: 'stretch',
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  centreText: {
    textAlign: 'center',
  },
});
