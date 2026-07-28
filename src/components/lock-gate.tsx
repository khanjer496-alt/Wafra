import * as LocalAuthentication from 'expo-local-authentication';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { WafraMark } from '@/components/wafra-logo';
import { EASE, Motion, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useStore } from '@/lib/store';
import { t } from '@/lib/i18n';

const EASING = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);

type BiometricState = 'prompting' | 'failed' | 'unavailable';

/** Short trips out of the app — a permission sheet, the share card — do not re-lock. */
const RELOCK_GRACE_MS = 20_000;

/** The breathing ring around the sensor target: scale 1 → 1.4, opacity .85 → .3. */
function SensorRing({ color }: { color: string }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: Motion.pulse / 2, easing: EASING }), -1, true);
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * 0.12 }],
    opacity: 0.85 - progress.value * 0.55,
  }));

  return <Animated.View style={[styles.ring, { borderColor: color }, style]} pointerEvents="none" />;
}

/**
 * Blocks the app behind device biometrics or the phone PIN when app lock is on.
 *
 * Every interactive element sits in the bottom 40% of the screen, so unlocking
 * is a thumb movement rather than a reach. Web — and devices with no screen
 * lock configured — pass straight through to a copy-only state.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { state } = useStore();
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
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Wafra' });
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

  if (!lockRequired) return <>{children}</>;

  return (
    <View style={styles.container}>
      {/*
        The router's Stack stays mounted; the lock paints over it. Opacity
        alone only hides it from EYES — VoiceOver and TalkBack still walk the
        tree underneath and will happily read out every balance on the locked
        screen, so the subtree has to be removed from the accessibility tree
        explicitly (each platform has its own prop) and made untappable.
      */}
      <View
        style={styles.hidden}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {children}
      </View>
      <ThemedView accessibilityViewIsModal style={[StyleSheet.absoluteFillObject, styles.root]}>
        <View style={styles.centre}>
          <WafraMark size={46} />
          <ThemedText type="micro" themeColor="textTertiary">
            Locked
          </ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.copy}>
            Your balances are hidden until the phone says it&apos;s you. Nothing left the phone while
            it was closed.
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
            <ThemedText type="small">This phone has no screen lock</ThemedText>
            <ThemedText type="meta" themeColor="textTertiary" style={styles.centreText}>
              Set up a fingerprint, face unlock, or a PIN and Wafra can use it.
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Unlock with your fingerprint"
              onPress={tryUnlock}
              style={[
                styles.sensor,
                { backgroundColor: theme.backgroundSelected, borderColor: theme.cardBorder },
              ]}>
              <SensorRing color={theme.primary} />
              <Icon name="fingerprint" size={38} color={theme.text} />
            </Pressable>
            <ThemedText type="small">
              {biometric === 'failed' ? t('trySensorAgain') : 'Touch the sensor to unlock'}
            </ThemedText>
            <ThemedText type="meta" themeColor="textTertiary">
              Fingerprint, face unlock, or your phone PIN
            </ThemedText>
            <Button
              label="Use PIN instead"
              variant="outline"
              onPress={tryUnlock}
              style={styles.fullButton}
            />
          </View>
        )}
      </ThemedView>
    </View>
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
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 38,
    borderWidth: 2,
  },
  centreText: {
    textAlign: 'center',
  },
  fullButton: {
    alignSelf: 'stretch',
    marginTop: Spacing.three - 2,
  },
});
