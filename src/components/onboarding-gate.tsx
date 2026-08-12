import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StorageRecovery } from '@/components/storage-recovery';
import { ThemedText } from '@/components/themed-text';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { WafraMark } from '@/components/wafra-logo';
import { Colors, Fonts, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import {
  buildImportPlan,
  isSmsInboxAccessError,
  isSmsScanningAvailable,
  requestSmsPermission,
  scanInbox,
} from '@/lib/auto-import';
import { committed, tapped } from '@/lib/haptics';
import { t, tf, type StringKey } from '@/lib/i18n';
import { disableRelayBackgroundSync } from '@/lib/background-relay';
import { getRelayConfigStrict, unpairDevice } from '@/lib/relay';
import { openShortcutsApp } from '@/lib/shortcut-cleanup';
import { useStore } from '@/lib/store';
import NotificationReader from '../../modules/notification-reader';

type Step =
  | 'welcome'
  | 'capture'
  | 'scanning'
  | 'complete';
type CompletionOutcome = 'automatic' | 'manual' | 'denied' | 'failed';
type ShortcutCleanupState = 'revoked' | 'uncertain' | null;

/** Onboarding is night mode regardless of the OS theme: the first screen sets
 * the tone, and the mark is at its strongest on charcoal. */
const night = Colors.dark;

/**
 * THE PRIVACY CLAIM IS DIFFERENT ON IPHONE, AND IT HAS TO STILL BE TRUE.
 *
 * Do not collapse these two lists back into one. On Android the capture path is
 * modules/sms-reader: the inbox is parsed on-device and no bank-message text
 * ever leaves the phone, so the on-device claim is literally true and is stated
 * at full strength. On iPhone it is false. Apple lets no app read Messages, so
 * the only route is a Shortcuts automation the user builds, which POSTs each
 * alert to Wafra's relay. Telling an iPhone user the text never leaves the
 * phone would be a lie told on the exact screen where trust is established —
 * and it is the kind of claim App Review reads on a finance app.
 *
 * What replaces it on iOS is not a softer claim, it is a more specific one, and
 * it is the argument server/README.md actually makes: the relay parses, DROPS
 * the message text (no table for it, no log line), and seals the parsed row to
 * a key only this iPhone holds. Anything added here must survive that split —
 * a new bullet needs an iOS wording and an Android wording, not one that is
 * only checked on the platform the author happened to be testing on.
 *
 * The branch is Platform.OS, not a relay-capability probe, so the copy is
 * decided before any relay state is loaded and cannot flip mid-screen.
 */
function points(): [IconName, string, string][] {
  if (Platform.OS === 'ios') {
    return [
      ['mail', t('iosOnboardAutomatic'), t('iosOnboardAutomaticBody')],
      ['calendar', t('warnsBeforeMoneyLeaves'), t('onboardWarnsDetail')],
      ['lock', t('iosOnboardPrivate'), t('iosOnboardPrivateBody')],
    ];
  }
  return [
    ['mail', t('onboardReadsSms'), t('onboardPrivacyBody')],
    ['calendar', t('warnsBeforeMoneyLeaves'), t('onboardWarnsDetail')],
    ['lock', t('noServerTitle'), t('onboardNoServerDetail')],
  ];
}

function captureCopy(): { title: StringKey; body: StringKey } {
  if (Platform.OS === 'ios') {
    return { title: 'onboardCaptureTitleIos', body: 'onboardCaptureBodyIos' };
  }
  if (Platform.OS === 'android') {
    return { title: 'onboardCaptureTitleAndroid', body: 'onboardCaptureBodyAndroid' };
  }
  return { title: 'onboardCaptureTitleWeb', body: 'onboardCaptureBodyWeb' };
}

function BackHeader({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.progressHeader}>
      <View style={styles.progressTopline}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onboardBack')}
          hitSlop={10}
          onPress={() => {
            tapped();
            onBack();
          }}
          style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}>
          <Icon name="chevron-left" size={18} color={night.textSecondary} />
          <ThemedText style={styles.backLabel}>{t('onboardBack')}</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * First run questionnaire and platform capture hand-off.
 *
 * It remains an overlay above the mounted navigator. Replacing the navigator
 * itself corrupts expo-router route state, and keeping it mounted also lets
 * iOS return from its first-class Shortcut setup to the personalised summary.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ onboarding?: string }>();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const {
    state,
    storageFailure,
    storageRecoveryState,
    hydrationFailed,
    importBatch,
    stageReviewAlerts,
    setMarket,
    setOnboarded,
    setCaptureOptOut,
  } = useStore();
  const [step, setStep] = useState<Step>('welcome');
  const [progress, setProgress] = useState({ scanned: 0, found: 0 });
  const [result, setResult] = useState<{ tx: number; accounts: number } | null>(null);
  const [smsDenied, setSmsDenied] = useState(false);
  const [completionOutcome, setCompletionOutcome] = useState<CompletionOutcome>('manual');
  const [shortcutCleanup, setShortcutCleanup] = useState<ShortcutCleanupState>(null);

  const activeStep: Step = params.onboarding === 'complete' ? 'complete' : step;
  const capture = captureCopy();

  /**
   * A failed read is not a first run, and an incomplete erase is not a usable
   * blank ledger. This gate is where both distinctions have to be made.
   *
   * `state.onboarded === false` means one of two completely different things:
   * this phone has never run the app, or the ledger could not be read and the
   * store is presenting an empty state it did not get from disk. They looked
   * identical here, so an unreadable database was answered with a welcome
   * screen and a "Start with sample data" button — an invitation to replace a
   * ledger that is still on the device. `hydrationFailed` is the store's answer
   * to which one it is, and while it is set NOTHING below runs: not the
   * questionnaire, not the demo data, not the welcome step.
   */
  const showRecovery = hydrationFailed;

  // The guided iOS setup is itself onboarding. Do not paint this gate over it.
  const showOverlay =
    !showRecovery && state.hydrated && !state.onboarded && pathname !== '/ios-setup';
  const notifAvailable = Platform.OS === 'android' &&
    NotificationReader?.isAvailable?.() === true;

  const startScan = async () => {
    setSmsDenied(false);
    let granted = false;
    try {
      granted = await requestSmsPermission();
    } catch {
      setCompletionOutcome('failed');
      setStep('complete');
      return;
    }
    if (!granted) {
      setSmsDenied(true);
      setCompletionOutcome('denied');
      setStep('complete');
      return;
    }
    try {
      // A user may return from the manual completion screen and choose
      // automatic capture instead. Clear the durable opt-out before the first
      // read so setup cannot report success over a permanently blocked pipe.
      await setCaptureOptOut(false);
      setStep('scanning');
      const {
        parsed,
        reviewCandidates,
        newestTs,
        detectedLaunchMarket,
        commit,
      } = await scanInbox(0, {}, (scanned, found) => setProgress({ scanned, found }));
      if (detectedLaunchMarket && detectedLaunchMarket !== state.marketId) {
        if (!setMarket(detectedLaunchMarket)) {
          throw new Error('market_mismatch');
        }
      }
      const reviewReceipt = stageReviewAlerts(reviewCandidates);
      await reviewReceipt.durable;
      const importPlan = buildImportPlan(
        parsed,
        detectedLaunchMarket ? { ...state, marketId: detectedLaunchMarket } : state,
        newestTs,
      );
      await importBatch(importPlan.batch).durable;
      await commit();
      setResult({ tx: importPlan.txCount, accounts: importPlan.newAccountCount });
      setCompletionOutcome('automatic');
      setStep('complete');
      committed();
    } catch (error) {
      setResult({ tx: 0, accounts: 0 });
      if (Platform.OS === 'android' && isSmsInboxAccessError(error)) {
        setSmsDenied(true);
        setCompletionOutcome('denied');
      } else {
        setCompletionOutcome('failed');
      }
      setStep('complete');
    }
  };

  const beginCapture = async () => {
    if (Platform.OS === 'ios') {
      try {
        await setCaptureOptOut(false);
      } catch {
        setCompletionOutcome('failed');
        setStep('complete');
        return;
      }
      // The return query survives a cold route remount and tells the gate to
      // show the summary instead of restarting the questionnaire.
      router.push('/ios-setup?fromOnboarding=1');
      return;
    }
    if (Platform.OS === 'android' && isSmsScanningAvailable()) {
      void startScan();
      return;
    }
    setCompletionOutcome('manual');
    setStep('complete');
  };

  const continueManually = async () => {
    setSmsDenied(false);
    setResult(null);
    try {
      // This choice says "no SMS access" even when Android retained a grant
      // from an older install or test run. Persist the capture opt-out before
      // showing success so a mounted foreground importer cannot race it.
      await setCaptureOptOut(true);
      if (Platform.OS === 'ios') {
        // The user may have started Shortcut setup and then backed out. An
        // app-only flag is not enough: that Shortcut would still send bank
        // alerts and the background task could still collect them. Revoke the
        // actual relay identity before calling this choice complete.
        try {
          const relay = await getRelayConfigStrict();
          if (relay) {
            // Revoke the server-side ingest token first. Removing only the
            // local wake registration would still leave the installed
            // Shortcut able to forward bank alerts over the network.
            await unpairDevice(relay);
            setShortcutCleanup('revoked');
          }
        } catch {
          // A strict Keychain read failure is just as uncertain as a failed
          // revoke: absence was not proven, so never claim the Shortcut's
          // remote token is gone. Keep Retry available and show the immediate
          // local stop (delete the Shortcut).
          setShortcutCleanup('uncertain');
          throw new Error('relay_cleanup_uncertain');
        } finally {
          // Once the app is opted out, the local background registration is
          // redundant. Its cleanup is best-effort and must never prevent the
          // more important authenticated relay revocation above.
          try {
            await disableRelayBackgroundSync();
          } catch {
            // CaptureExecutor still enforces the durable opt-out.
          }
        }
      }
      setCompletionOutcome('manual');
      setStep('complete');
    } catch {
      setCompletionOutcome('failed');
      setStep('complete');
    }
  };

  const goBack = () => {
    if (activeStep === 'complete') {
      setStep('capture');
      if (params.onboarding) router.setParams({ onboarding: undefined });
    } else if (activeStep === 'scanning') {
      setStep('capture');
    } else {
      setStep('welcome');
    }
  };

  const openWafra = () => {
    committed();
    setOnboarded();
  };

  /**
   * Recovery replaces the app outright rather than overlaying it.
   *
   * The onboarding overlay keeps `children` mounted underneath because
   * expo-router's state does not survive the navigator being swapped out. Here
   * that trade does not apply and the opposite one does: the screens under
   * this would be rendering an empty ledger as though it were the user's, and
   * `storageFailure` tells us it is not. Nothing reads better than nothing.
   */
  if (showRecovery) {
    return <StorageRecovery failure={storageFailure} recoveryState={storageRecoveryState} />;
  }

  // Do not render financial screens against the reducer's blank bootstrap
  // state. Besides flashing false AED 0 figures, mounting every tab here used
  // to start expensive ledger projections before encrypted hydration finished.
  if (!state.hydrated) {
    return (
      <View style={styles.loadingRoot} accessibilityLiveRegion="polite">
        <StatusBar style="light" />
        <View style={styles.markHalo}>
          <WafraMark size={44} color={night.primary} />
        </View>
        <ThemedText style={styles.loadingLabel}>{t('loadingLedger')}</ThemedText>
      </View>
    );
  }

  if (!showOverlay) return <>{children}</>;

  const entering = reducedMotion ? undefined : FadeInDown.duration(320);
  const automaticCompletion =
    params.onboarding === 'complete' || completionOutcome === 'automatic';
  const failedCompletion =
    activeStep === 'complete' && !automaticCompletion && completionOutcome === 'failed';

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View
        style={styles.hidden}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {children}
      </View>
      <View style={[StyleSheet.absoluteFillObject, styles.root]}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {activeStep === 'welcome' ? (
            <Animated.ScrollView
              entering={reducedMotion ? undefined : FadeIn.duration(400)}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.welcomeBody}>
              <View style={styles.welcomeTop}>
                <View style={styles.markHalo}>
                  <WafraMark size={44} color={night.primary} />
                </View>
                <ThemedText
                  style={styles.headline}
                  accessibilityRole="header"
                  // Display type must still fit as a heading at the largest
                  // accessibility sizes; body/list text below remains fully
                  // scalable and the whole surface remains scrollable.
                  maxFontSizeMultiplier={1.6}>
                  {t(Platform.OS === 'ios' ? 'iosOnboardHeadline' : 'onboardHeadline')}
                </ThemedText>
                <ThemedText style={styles.sub}>
                  {t(Platform.OS === 'ios' ? 'iosOnboardSub' : 'onboardSub')}
                </ThemedText>
              </View>

              <View style={styles.points}>
                {points().map(([icon, title, detail], index) => (
                  <View
                    key={title}
                    style={[
                      styles.point,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: night.cardBorder,
                      },
                    ]}>
                    <View style={styles.pointIcon}>
                      <Icon name={icon} size={19} color={night.textSecondary} />
                    </View>
                    <View style={styles.pointText}>
                      <ThemedText style={styles.pointTitle}>{title}</ThemedText>
                      <ThemedText style={styles.pointDetail}>{detail}</ThemedText>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.actions}>
                <Button
                  label={t('onboardPersonalizeCta')}
                  onPress={() => setStep('capture')}
                  labelColor={night.onPrimary}
                  style={{ backgroundColor: night.primary }}
                />
              </View>
            </Animated.ScrollView>
          ) : (
            <>
              {activeStep !== 'scanning' && <BackHeader onBack={goBack} />}
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}>
                <Animated.View key={activeStep} entering={entering} style={styles.questionBody}>
                  {activeStep === 'capture' && (
                    <>
                      <View style={styles.captureHero}>
                        <View style={styles.captureIcon}>
                          <Icon
                            name={Platform.OS === 'web' ? 'check' : 'mail'}
                            size={27}
                            color={night.primary}
                          />
                        </View>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t(capture.title)}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>{t(capture.body)}</ThemedText>
                      </View>
                      {Platform.OS !== 'web' && (
                        <View style={styles.capturePrivacy}>
                          <Icon name="lock" size={17} color={night.textSecondary} />
                          <ThemedText style={styles.capturePrivacyText}>
                            {t(Platform.OS === 'ios'
                              ? 'onboardCapturePrivacyIos'
                              : 'onboardCapturePrivacyAndroid')}
                          </ThemedText>
                        </View>
                      )}
                      <View style={styles.captureActions}>
                        <Button
                          label={
                            Platform.OS === 'ios'
                              ? t('onboardCaptureIosCta')
                              : Platform.OS === 'android'
                                ? t('onboardCaptureAndroidCta')
                                : t('continueWord')
                          }
                          onPress={() => void beginCapture()}
                          labelColor={night.onPrimary}
                          style={styles.primaryButton}
                        />
                        {Platform.OS !== 'web' && (
                          <Button
                            variant="outline"
                            label={t(Platform.OS === 'android'
                              ? 'onboardCaptureNoSms'
                              : 'iosContinueManual')}
                            onPress={() => void continueManually()}
                            labelColor={night.text}
                            style={styles.ghost}
                          />
                        )}
                      </View>
                    </>
                  )}

                  {activeStep === 'scanning' && (
                    <View
                      style={styles.scanning}
                      accessibilityLiveRegion="polite"
                      accessibilityLabel={tf('onboardScanProgress', {
                        read: progress.scanned,
                        matched: progress.found,
                      })}>
                      <View style={styles.captureIcon}>
                        <Icon name="mail" size={27} color={night.primary} />
                      </View>
                      <ThemedText style={styles.questionTitle} accessibilityRole="header">
                        {t('readingInbox')}
                      </ThemedText>
                      <ThemedText style={styles.questionBodyCopy}>
                        {tf('onboardScanProgress', {
                          read: progress.scanned,
                          matched: progress.found,
                        })}
                      </ThemedText>
                    </View>
                  )}

                  {activeStep === 'complete' && (
                    <>
                      <View style={styles.completeHero}>
                        <View
                          style={[
                            styles.completeMark,
                            failedCompletion && { backgroundColor: night.warning },
                          ]}>
                          <Icon
                            name={failedCompletion ? 'alert' : 'check'}
                            size={30}
                            color={night.onPrimary}
                            strokeWidth={2.1}
                          />
                        </View>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t(
                            automaticCompletion
                                ? 'onboardCompleteTitle'
                                : completionOutcome === 'failed'
                                  ? 'onboardCompleteNeedsAttentionTitle'
                                  : 'onboardCompleteManualTitle'
                          )}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>
                          {t(
                            automaticCompletion
                                ? 'onboardCompleteBodyAutomatic'
                                : completionOutcome === 'failed'
                                  ? 'onboardCompleteNeedsAttentionBody'
                                  : 'onboardCompleteManualBody'
                          )}
                        </ThemedText>
                        {smsDenied && (
                          <View style={styles.permissionRecovery}>
                            <ThemedText
                              accessibilityLiveRegion="polite"
                              style={[styles.inlineNote, { color: night.warning }]}>
                              {t('onboardSmsDenied')}
                            </ThemedText>
                            <Button
                              variant="outline"
                              label={t('retryHistoryRead')}
                              onPress={() => void startScan()}
                              labelColor={night.text}
                              style={styles.ghost}
                            />
                            <Button
                              variant="outline"
                              label={t('openPhoneSettings')}
                              onPress={() => void Linking.openSettings().catch(() => {})}
                              labelColor={night.text}
                              style={styles.ghost}
                            />
                          </View>
                        )}
                        {result && result.tx > 0 && (
                          <ThemedText style={[styles.inlineNote, { color: night.primary }]}>
                            {tf('onboardImportResult', {
                              entries: result.tx,
                              ending: result.tx === 1 ? 'y' : 'ies',
                              cards:
                                result.accounts > 0
                                  ? tf('onboardCardsFound', {
                                      count: result.accounts,
                                      s: result.accounts === 1 ? '' : 's',
                                    })
                                  : '',
                            })}
                          </ThemedText>
                        )}
                      </View>

                      <View style={styles.captureActions}>
                        {notifAvailable && !NotificationReader?.isEnabled?.() && (
                          <>
                            <ThemedText style={styles.notifNote}>{t('notifNoteOnboard')}</ThemedText>
                            <Button
                              label={t('alsoReadNotifs')}
                              onPress={() => NotificationReader?.openSettings()}
                              labelColor={night.text}
                              style={styles.ghost}
                            />
                          </>
                        )}
                        <Button
                          label={t('openWafra')}
                          onPress={openWafra}
                          labelColor={night.onPrimary}
                          style={styles.primaryButton}
                        />
                      </View>
                    </>
                  )}
                </Animated.View>
              </ScrollView>
            </>
          )}
        </SafeAreaView>
      </View>
      <ConfirmSheet
        visible={shortcutCleanup !== null}
        onClose={() => setShortcutCleanup(null)}
        question={t('shortcutStillInstalledTitle')}
        body={t(shortcutCleanup === 'uncertain'
          ? 'shortcutCleanupUncertain'
          : 'shortcutCleanupLeft')}
        confirmLabel={t('iosOpenShortcutsApp')}
        cancelLabel={t('iosDone')}
        onConfirm={openShortcutsApp}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hidden: { ...StyleSheet.absoluteFillObject, opacity: 0 },
  root: { flex: 1, alignItems: 'center', backgroundColor: night.background },
  loadingRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    backgroundColor: night.background,
  },
  loadingLabel: {
    color: night.textSecondary,
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
  },
  safe: { flex: 1, width: '100%', maxWidth: 520 },
  welcomeBody: {
    flex: 1,
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.four,
    alignItems: 'stretch',
    justifyContent: 'space-between',
  },
  welcomeTop: { paddingTop: Spacing.five, gap: Spacing.three },
  markHalo: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: night.primarySoft,
  },
  headline: {
    fontFamily: Fonts.sansSemi,
    fontSize: 32,
    lineHeight: 39,
    letterSpacing: -1.05,
    color: night.text,
    maxWidth: 360,
  },
  sub: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 22, color: night.textSecondary },
  points: { paddingVertical: Spacing.three },
  point: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 2,
    paddingVertical: Spacing.three,
  },
  pointIcon: { width: 30, alignItems: 'center' },
  pointText: { flex: 1, gap: 2 },
  pointTitle: { fontFamily: Fonts.sansMedium, fontSize: 14.5, lineHeight: 20, color: night.text },
  pointDetail: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: night.textTertiary },
  actions: { gap: Spacing.two + 2 },
  ghost: { borderWidth: 1, borderColor: night.cardBorderStrong },
  progressHeader: { paddingHorizontal: ScreenPadding, paddingTop: Spacing.two },
  progressTopline: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { minHeight: 44, flexDirection: 'row', gap: 4, alignItems: 'center' },
  backLabel: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12 },
  scrollContent: { flexGrow: 1, paddingHorizontal: ScreenPadding, paddingBottom: Spacing.four },
  questionBody: { flex: 1, paddingTop: Spacing.five },
  questionTitle: {
    fontFamily: Fonts.sansSemi,
    fontSize: 29,
    lineHeight: 36,
    letterSpacing: -0.8,
    color: night.text,
  },
  questionBodyCopy: { color: night.textSecondary, fontSize: 14, lineHeight: 22 },
  inlineNote: { marginTop: Spacing.three, fontSize: 12, lineHeight: 18 },
  permissionRecovery: { gap: Spacing.two, width: '100%' },
  primaryButton: { marginTop: Spacing.four, backgroundColor: night.primary },
  captureHero: { gap: Spacing.three, alignItems: 'flex-start' },
  captureIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: night.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureActions: { marginTop: 'auto', paddingTop: Spacing.five, gap: Spacing.two },
  scanning: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  completeHero: { gap: Spacing.three, alignItems: 'flex-start' },
  completeMark: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: night.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifNote: { color: night.textSecondary, fontSize: 12, lineHeight: 18 },
  capturePrivacy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: night.cardBorder,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
  capturePrivacyText: {
    flex: 1,
    color: night.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
});
