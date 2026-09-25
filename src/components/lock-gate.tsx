import * as LocalAuthentication from 'expo-local-authentication';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BiometricGlyph, useBiometricKind } from '@/components/biometric-glyph';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { WafraMark } from '@/components/wafra-logo';
import { Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useStore } from '@/lib/store';
import { t } from '@/lib/i18n';
import { settingsCopy } from '@/lib/settings-copy';

type BiometricState = 'prompting' | 'failed' | 'unavailable';

const PrivacyGateContext = createContext(true);

/** True only when the financial UI is not hidden behind App Lock. */
export function usePrivacyGateCleared(): boolean {
  return useContext(PrivacyGateContext);
}

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
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { state } = useStore();
  const copy = settingsCopy(state.language);
  const biometricKind = useBiometricKind();
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
      <ThemedView accessibilityViewIsModal style={[StyleSheet.absoluteFillObject, styles.root]}>
        <View style={styles.centre}>
          <WafraMark size={46} />
          <ThemedText type="subtitle" accessibilityRole="header" style={styles.centreText}>
            {copy.lockedTitle}
          </ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.copy}>
            {copy.lockedBody}
          </ThemedText>
        </View>

        {biometric === 'unavailable' ? (
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.backgroundElement,
                borderTopColor: theme.cardBorder,
                paddingBottom: Spacing.four + insets.bottom,
              },
            ]}>
            <View style={[styles.grab, { backgroundColor: theme.cardBorderStrong }]} />
            <ThemedText type="small">{t('phoneHasNoLock')}</ThemedText>
            <ThemedText type="meta" themeColor="textTertiary" style={styles.centreText}>
              {t('setPhoneLockBody')}
            </ThemedText>
            <Button
              label={t('openPhoneSettings')}
              variant="outline"
              onPress={() => Linking.openSettings().catch(() => {})}
              style={styles.fullButton}
            />
          </View>
        ) : (
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.backgroundElement,
                borderTopColor: theme.cardBorder,
                paddingBottom: Spacing.four + insets.bottom,
              },
            ]}>
            <View style={[styles.grab, { backgroundColor: theme.cardBorderStrong }]} />
            <View
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={[styles.sensor, { backgroundColor: theme.primarySoft }]}>
              <BiometricGlyph kind={biometricKind} size={30} color={theme.primary} />
            </View>
            {biometric === 'failed' ? (
              <ThemedText type="small" accessibilityLiveRegion="polite" style={styles.centreText}>
                {copy.lockedRetry}
              </ThemedText>
            ) : null}
            <ThemedText type="meta" themeColor="textSecondary" style={styles.centreText}>
              {copy.lockedFallback}
            </ThemedText>
            <Button
              label={copy.unlockWith[biometricKind ?? 'passcode']}
              onPress={tryUnlock}
              style={styles.fullButton}
            />
          </View>
        )}
      </ThemedView>
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
  root: {
    flex: 1,
    justifyContent: 'space-between',
  },
  centre: {
    // Roughly the upper 60%: the reading half of the screen.
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three - 4,
    paddingHorizontal: ScreenPadding,
  },
  copy: {
    textAlign: 'center',
    maxWidth: 300,
    paddingTop: Spacing.two,
  },
  sheet: {
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderTopWidth: 1,
    borderTopLeftRadius: Radius.bottomSheet + 2,
    borderTopRightRadius: Radius.bottomSheet + 2,
    paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.three - 4,
  },
  grab: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.three,
  },
  sensor: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  centreText: {
    textAlign: 'center',
  },
  fullButton: {
    alignSelf: 'stretch',
    marginTop: Spacing.three - 2,
  },
});
