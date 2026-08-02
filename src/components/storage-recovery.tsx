/**
 * What the app shows when it could not read the encrypted ledger.
 *
 * This screen exists because of a specific, silent way to lose someone's data.
 * Hydration fails, `loadPersisted` throws, the store presents an empty state —
 * and until now the next thing the user saw was onboarding, offering "start
 * with sample data" over a ledger that was still sitting on the device. The
 * store latches writes off in that situation, so the overwrite no longer
 * happens; but a welcome screen is still a lie about what the app knows, and
 * the first thing it invites you to do is exactly the wrong thing.
 *
 * So the rules here are narrow and deliberate:
 *
 *   - No onboarding, no sample data, no fresh start. Nothing on this screen
 *     leads anywhere except a retry or an explicit, confirmed erase.
 *   - It says what is true: the encrypted ledger has not been changed. That is
 *     the single fact the user needs, and it is the one a generic error screen
 *     never gives them.
 *   - No native error text, ever. The error that got us here may carry a
 *     merchant, an amount or the failing SQL. The store hands over a category
 *     from a closed vocabulary, which is enough to choose the right sentence
 *     and cannot carry a ledger row. See `storage-diagnostics.ts`.
 *   - Erase is two taps with a different question in between, and the second
 *     one names what it destroys. It is the only irreversible thing the app
 *     can do to itself.
 */
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Colors, Fonts, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { committed } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import type { StorageFailure } from '@/lib/storage-diagnostics';
import { useStore } from '@/lib/store';

/** Matches the onboarding surface it stands in for: night, whatever the OS says. */
const night = Colors.dark;

/**
 * `failure` arrives as a prop rather than off the store on purpose: the gate is
 * what decides this screen is warranted, so it is also what says which failure
 * it is showing. Only the ACTIONS are pulled from the store here.
 */
export function StorageRecovery({ failure }: { failure: StorageFailure | null }) {
  const { retryingHydration, retryHydration, clearAll } = useStore();
  const [confirmingErase, setConfirmingErase] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [eraseFailed, setEraseFailed] = useState(false);
  /**
   * Set only when a retry actually came back unsuccessful. Without it, a second
   * attempt looks identical to the first and the button reads as if it did
   * nothing.
   */
  const [retriedInVain, setRetriedInVain] = useState(false);

  // A key that no longer opens the file is not a transient failure, so the
  // screen does not imply that pressing the button again might help.
  const keyMismatch = failure?.category === 'key-mismatch';

  const onRetry = async () => {
    setRetriedInVain(false);
    // The outcome comes back from the call rather than being inferred from
    // `hydrationFailed`, which this closure captured before the read ran.
    if (!(await retryHydration())) setRetriedInVain(true);
  };

  const onErase = async () => {
    setErasing(true);
    setEraseFailed(false);
    try {
      await clearAll();
      committed();
    } catch {
      // `clearAll` throws when the erase or the blank-store write failed. The
      // reason is already recorded to logcat and to the diagnostics file; what
      // belongs on screen is only that it did not finish.
      setEraseFailed(true);
      setErasing(false);
      setConfirmingErase(false);
    }
  };

  if (confirmingErase) {
    return (
      <View style={[StyleSheet.absoluteFillObject, styles.root]}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.top}>
              <View style={[styles.halo, { backgroundColor: night.expenseSoftBg }]}>
                <Icon name="trash" size={26} color={night.expense} />
              </View>
              <ThemedText style={styles.headline} accessibilityRole="header">
                {t('storageRecoveryEraseTitle')}
              </ThemedText>
              <ThemedText style={styles.sub}>{t('storageRecoveryEraseBody')}</ThemedText>
            </View>
            <View style={styles.actions}>
              <Button
                variant="danger"
                label={t('storageRecoveryEraseConfirm')}
                disabled={erasing}
                onPress={() => void onErase()}
                labelColor={night.expense}
                style={{ borderColor: night.expenseSoftBorder, backgroundColor: night.expenseSoftBg }}
              />
              {/* Cancel is the ordinary-weight, safe option and it is listed
                  second so the destructive one is never the resting choice. */}
              <Button
                variant="ghost"
                label={t('storageRecoveryEraseKeep')}
                disabled={erasing}
                onPress={() => setConfirmingErase(false)}
                labelColor={night.text}
                style={styles.ghost}
              />
              {erasing && <ActivityIndicator color={night.primary} />}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={[StyleSheet.absoluteFillObject, styles.root]}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.top}>
            <View style={styles.halo}>
              <Icon name="lock" size={26} color={night.primary} />
            </View>
            <ThemedText style={styles.headline} accessibilityRole="header">
              {t('storageRecoveryTitle')}
            </ThemedText>
            <ThemedText style={styles.sub} accessibilityLiveRegion="polite">
              {keyMismatch ? t('storageRecoveryKeyBody') : t('storageRecoveryBody')}
            </ThemedText>
            {!keyMismatch && <ThemedText style={styles.hint}>{t('storageRecoveryHint')}</ThemedText>}
            {retriedInVain && (
              <ThemedText accessibilityLiveRegion="polite" style={[styles.note, { color: night.warning }]}>
                {t('storageRecoveryRetryFailed')}
              </ThemedText>
            )}
            {eraseFailed && (
              <ThemedText accessibilityLiveRegion="polite" style={[styles.note, { color: night.warning }]}>
                {t('storageRecoveryEraseFailed')}
              </ThemedText>
            )}
          </View>

          <View style={styles.actions}>
            <Button
              label={retryingHydration ? t('storageRecoveryRetrying') : t('storageRecoveryRetry')}
              disabled={retryingHydration}
              onPress={() => void onRetry()}
              labelColor={night.onPrimary}
              style={{ backgroundColor: night.primary }}
            />
            {retryingHydration && <ActivityIndicator color={night.primary} />}
            {/* Erase never fires from here. It opens the question above, which
                is the only place the destructive call exists. */}
            <Button
              variant="ghost"
              label={t('storageRecoveryEraseCta')}
              disabled={retryingHydration}
              onPress={() => setConfirmingErase(true)}
              labelColor={night.textSecondary}
              style={styles.ghost}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', backgroundColor: night.background },
  safe: { flex: 1, width: '100%', maxWidth: 520 },
  body: {
    flexGrow: 1,
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.four,
    justifyContent: 'space-between',
  },
  top: { paddingTop: Spacing.five, gap: Spacing.three },
  halo: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: night.primarySoft,
  },
  headline: {
    fontFamily: Fonts.sansSemi,
    fontSize: 29,
    lineHeight: 36,
    letterSpacing: -0.85,
    color: night.text,
    maxWidth: 360,
  },
  sub: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 22, color: night.textSecondary },
  hint: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: night.textTertiary },
  note: { fontSize: 12, lineHeight: 18 },
  actions: { marginTop: Spacing.five, gap: Spacing.two + 2 },
  ghost: { borderWidth: 1, borderColor: night.cardBorderStrong, borderRadius: Radius.control },
});
