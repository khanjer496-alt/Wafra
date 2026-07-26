import * as LocalAuthentication from 'expo-local-authentication';
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Icon } from '@/components/ui/icon';
import { WafraMark } from '@/components/wafra-logo';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useStore } from '@/lib/store';

/**
 * Blocks the app behind device biometrics/PIN when app lock is enabled.
 * Web (and devices without a screen lock) pass straight through.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const { state } = useStore();
  const [unlocked, setUnlocked] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const lockRequired = state.hydrated && state.appLock && Platform.OS !== 'web' && !unlocked;

  const tryUnlock = useCallback(async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Wafra',
      });
      if (result.success) setUnlocked(true);
    } finally {
      setAttempted(true);
    }
  }, []);

  useEffect(() => {
    if (lockRequired && !attempted) {
      tryUnlock();
    }
  }, [lockRequired, attempted, tryUnlock]);

  if (!lockRequired) return <>{children}</>;

  // Keep the router's Stack mounted; the lock paints over it.
  return (
    <View style={styles.container}>
      <View style={styles.hidden}>{children}</View>
      <ThemedView style={[StyleSheet.absoluteFillObject, styles.root]}>
      <WafraMark size={56} />
      <ThemedText type="smallBold" style={styles.title}>
        Wafra is locked
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Unlock with your fingerprint, face, or device PIN.
      </ThemedText>
      <Pressable
        onPress={tryUnlock}
        style={[styles.button, { backgroundColor: theme.primary }]}>
        <Icon name="lock" size={16} color={theme.onPrimary} />
        <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
          Unlock
        </ThemedText>
      </Pressable>
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
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  title: {
    fontSize: 18,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
    borderRadius: Radius.md,
  },
});
