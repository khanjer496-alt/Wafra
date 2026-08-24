/**
 * iOS capture setup.
 *
 * This is the flow the whole iOS product rests on, which is why it is a
 * first-class screen rather than a row in Settings. Android asks for one
 * permission and starts working; iOS cannot, so all of the friction lives
 * here. Once the Shortcut and Message automation exist, the relay can receive
 * while Wafra is closed; the ledger catches up when iOS next lets the app sync.
 *
 * Four steps, with a final proof that the installed Shortcut, relay,
 * encryption and sync path work together. Apple's Message sender trigger
 * cannot be simulated by an app; the flow says plainly that only the next
 * genuine bank alert verifies that last link.
 *
 * Three rules this screen is built around, each one paid for by a dead end
 * that shipped:
 *
 * 1. EVERY step renders `errorBlock`. Failures used to be assigned to `error`
 *    on steps that never rendered it, so a failed install-page open and a
 *    failed disconnect both looked exactly like a button that did nothing.
 * 2. EVERY step past the first can walk BACKWARDS. Once the automation was
 *    confirmed, `setupState` became 'configured', re-entry landed on the test
 *    step, and a user whose test never arrived had no route back to the setup
 *    code the failure message told them to check.
 * 3. Silent delivery is registered on the way OUT of the automation step, not
 *    only by the button that opens Shortcuts. Confirming the automation
 *    without tapping that button used to finish setup with push unregistered
 *    — capture that works only while the app is open, and says nothing.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState as RNAppState,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, Row, ScreenHeader, SectionHeader } from '@/components/ui/layout';
import { PulseDot } from '@/components/ui/states';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t, tf, type StringKey } from '@/lib/i18n';
import {
  createIosCaptureSetup,
  INITIAL_IOS_SETUP_MODEL,
  type IosSetupFailure,
  type IosSetupIntent,
  type IosSetupModel,
} from '@/lib/ios-capture-setup';
import { getActiveMarket } from '@/lib/markets';
import { useStore } from '@/lib/store';

/** Step names as keys, so the progress bar reads in the user's language. */
const STEPS: readonly StringKey[] = [
  'iosStepConnect',
  'iosStepShortcut',
  'iosStepTest',
  'iosStepAutomation',
] as const;

type AnnouncedSetupState = Pick<
  IosSetupModel,
  | 'step'
  | 'failure'
  | 'captured'
  | 'timedOut'
  | 'automationActive'
  | 'automationPrepared'
  | 'listening'
  | 'copied'
>;

/**
 * A failed pairing, said in the user's language and as a next step.
 *
 * `RelayError.message` is written for whoever is reading the stack trace:
 * "Pairing failed (503).", "Could not reach Wafra. Check your connection.",
 * "Pairing returned an unexpected response." Rendering it verbatim put an
 * English literal — and a status code — on the one screen the entire iPhone
 * product depends on, in a build that ships in Arabic. Trusted devices solved
 * this a file over by switching on `RelayError.code`; this is the same move,
 * against the same translated keys, so the two screens cannot disagree about
 * what a rate limit or a revoked device means.
 *
 * The detail line carries what to DO. The step's own "Connect this iPhone"
 * button sits directly under this block and is the retry.
 */
function failureCopy(failure: IosSetupFailure): { message: string; detail: string | null } {
  switch (failure) {
    case 'relay-unavailable':
      return { message: t('iosRelayUnavailable'), detail: null };
    case 'connect-rate-limited':
      return { message: t('trustedTryLater'), detail: t('trustedTryLaterBody') };
    case 'connect-unauthorized':
      return { message: t('trustedAccessEnded'), detail: t('trustedAccessEndedBody') };
    case 'connect-device-limit':
      return { message: t('trustedLimitTitle'), detail: t('trustedLimitBody') };
    case 'disconnect':
      return { message: t('iosDisconnectFailed'), detail: null };
    case 'shortcut-install':
      return { message: t('iosShortcutInstallFailed'), detail: null };
    case 'shortcuts-missing':
      return {
        message: t('iosShortcutsMissing'),
        detail: t('iosShortcutsMissingRecovery'),
      };
    case 'shortcuts-open':
      return { message: t('iosShortcutsOpenFailed'), detail: null };
    case 'shortcut-run':
      return { message: t('iosShortcutRunFailed'), detail: null };
    case 'push-permission':
      return { message: t('iosPushPermissionRequired'), detail: null };
    case 'push-registration':
      return { message: t('iosPushSetupFailed'), detail: null };
    case 'not-hydrated':
      return { message: t('stillLoading'), detail: null };
    case 'load':
    case 'configure':
    case 'connect':
    default:
      return { message: t('iosConnectFailed'), detail: t('trustedUnavailableBody') };
  }
}

export default function IosSetupScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    fromOnboarding?: string;
    shortcutResult?: string;
  }>();
  const {
    state,
    importBatch,
    stageReviewAlerts,
    ensureDurable,
    setMarket,
    setOnboarded,
    setPrivateMode,
  } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const controllerRef = useRef<ReturnType<typeof createIosCaptureSetup> | null>(null);
  const [setup, setSetup] = useState(INITIAL_IOS_SETUP_MODEL);
  const consumedShortcutCallback = useRef<string | null>(null);
  const previousAnnouncedSetup = useRef<AnnouncedSetupState>({
    step: 0,
    failure: null,
    captured: null,
    timedOut: false,
    automationActive: false,
    automationPrepared: false,
    listening: false,
    copied: null,
  });
  const banks = getActiveMarket().banks.map((bank) => bank.name);

  useEffect(() => {
    const controller = createIosCaptureSetup({
      fromOnboarding: params.fromOnboarding === '1',
      ledger: {
        getState: () => stateRef.current,
        importBatch,
        stageReviewAlerts,
        ensureDurable,
        setMarket: (market) => setMarket(market),
      },
      leavePrivateMode: () => setPrivateMode(false),
    });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setSetup);
    void controller.send({ type: 'load' });
    return () => {
      unsubscribe();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [
    ensureDurable,
    importBatch,
    params.fromOnboarding,
    setMarket,
    setPrivateMode,
    stageReviewAlerts,
  ]);

  const send = useCallback((intent: IosSetupIntent): Promise<void> =>
    controllerRef.current?.send(intent) ?? Promise.resolve(), []);
  const goToStep = useCallback((step: 0 | 1 | 2 | 3) => {
    void send({ type: 'go-to-step', step });
  }, [send]);
  const connect = useCallback(() => void send({ type: 'connect' }), [send]);
  const leavePrivateModeAndConnect = useCallback(
    () => void send({ type: 'confirm-private-mode' }),
    [send],
  );
  const disconnect = useCallback(() => send({ type: 'disconnect' }), [send]);
  const copy = useCallback(
    (target: 'setup' | 'url' | 'token') => send({ type: 'copy', target }),
    [send],
  );
  const installShortcut = useCallback(() => send({ type: 'install-shortcut' }), [send]);
  const shortcutInstalled = useCallback(() => send({ type: 'shortcut-installed' }), [send]);
  const openAutomation = useCallback(() => send({ type: 'open-automation' }), [send]);
  const automationReady = useCallback(() => send({ type: 'automation-ready' }), [send]);
  const startTest = useCallback(() => void send({ type: 'start-test' }), [send]);
  const continueToAutomation = useCallback(
    () => void send({ type: 'continue-to-automation' }),
    [send],
  );

  // A background task may persist the first real Message proof in a separate
  // JS lifecycle. Re-read the device-bound generation whenever Wafra becomes
  // active so this still-mounted setup screen cannot stay on “waiting”.
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') void send({ type: 'refresh-proof' });
    });
    return () => sub.remove();
  }, [send]);

  useEffect(() => {
    if (setup.loading) return;
    const result = params.shortcutResult;
    if (result === undefined) {
      consumedShortcutCallback.current = null;
      return;
    }
    if (result !== 'success' && result !== 'cancel' && result !== 'error') return;
    if (consumedShortcutCallback.current === result) return;
    consumedShortcutCallback.current = result;
    void send({ type: 'shortcut-callback', result });
    // Consume the callback so another safe test returning the same result can
    // be observed, while a render caused by this send cannot process it twice.
    router.setParams({ shortcutResult: undefined });
  }, [params.shortcutResult, router, send, setup.loading]);

  const finish = useCallback(() => {
    if (params.fromOnboarding === '1') {
      router.replace('/?onboarding=complete');
      return;
    }
    setOnboarded();
    router.replace('/');
  }, [params.fromOnboarding, router, setOnboarded]);

  const leave = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    finish();
  }, [finish, router]);

  const {
    step,
    pairing,
    disconnecting,
    preparing,
    listening,
    captured,
    timedOut,
    copied,
    captureOn,
    automationActive,
    automationPrepared,
    paired,
    loading,
    relayAvailable,
    shortcutAvailable,
    askPrivateMode,
    failure,
    recovery,
  } = setup;
  const errorCopy = failure ? failureCopy(failure) : null;
  const error = errorCopy?.message ?? null;
  const errorDetail = errorCopy?.detail ?? null;
  // A known failure on this mounted attempt blocks confirmation. A clean
  // remount does not: iOS may reclaim Wafra while Shortcuts is open, and the
  // next source-bound relay probe remains the durable proof of installation.
  const shortcutAdvanceBlocked =
    disconnecting ||
    preparing ||
    failure === 'shortcut-install' ||
    failure === 'shortcuts-missing';

  useEffect(() => {
    const previous = previousAnnouncedSetup.current;
    const current: AnnouncedSetupState = {
      step,
      failure,
      captured,
      timedOut,
      automationActive,
      automationPrepared,
      listening,
      copied,
    };
    if (loading) return;
    previousAnnouncedSetup.current = current;

    const announcements: string[] = [];
    if (step !== previous.step) {
      announcements.push(tf('iosStepProgress', {
        n: step + 1,
        total: STEPS.length,
        name: t(STEPS[step]),
      }));
    }
    if (failure && failure !== previous.failure && error) {
      announcements.push(errorDetail ? `${error}. ${errorDetail}` : error);
    } else if (captured && captured !== previous.captured) {
      announcements.push(
        `${captured.merchant}. ${t(captured.isTest ? 'iosTestCaught' : 'iosCaught')}`,
      );
    } else if (timedOut && !previous.timedOut) {
      announcements.push(t('iosTimedOut'));
    } else if (automationActive && !previous.automationActive) {
      announcements.push(`${t('iosAlreadyWorkingTitle')}. ${t('iosAlreadyWorkingBody')}`);
    } else if (automationPrepared && !previous.automationPrepared) {
      announcements.push(`${t('iosAutomationWaitingTitle')}. ${t('iosAutomationWaitingBody')}`);
    } else if (listening && !previous.listening) {
      announcements.push(t('iosWaitingLabel'));
    }
    if (copied && copied !== previous.copied) announcements.push(t('iosCopied'));

    if (announcements.length > 0) {
      AccessibilityInfo.announceForAccessibility(announcements.join('. '));
    }
  }, [
    automationActive,
    automationPrepared,
    captured,
    copied,
    error,
    errorDetail,
    failure,
    listening,
    loading,
    step,
    timedOut,
  ]);
  const errorBlock = error ? (
    <View accessibilityLiveRegion="polite">
      <Block style={styles.note}>
        <Icon name="alert" size={16} color={theme.expense} />
        <View style={styles.noteCopy}>
          <ThemedText type="meta" style={[styles.noteLine, { color: theme.expense }]}>
            {error}
          </ThemedText>
          {/* What went wrong, then what to do about it — the second line is
              the only part a user can act on. */}
          {errorDetail && (
            <ThemedText type="meta" themeColor="textSecondary" style={styles.noteLine}>
              {errorDetail}
            </ThemedText>
          )}
        </View>
      </Block>
      {recovery === 'settings' && (
        <Button
          label={t('openSettings')}
          variant="outline"
          onPress={() => void send({ type: 'open-settings' })}
          style={styles.ctaSecondary}
        />
      )}
      {recovery === 'shortcut' && failure === 'shortcuts-missing' && (
        <Button
          label={t('iosInstallShortcuts')}
          variant="outline"
          onPress={() => void send({ type: 'open-shortcuts-store' })}
          style={styles.ctaSecondary}
        />
      )}
    </View>
  ) : null;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={t('iosSetupTitle')} onBack={leave} />

        <ThemedText type="meta" themeColor="textSecondary" style={styles.progressLabel}>
          {tf('iosStepProgress', { n: step + 1, total: STEPS.length, name: t(STEPS[step]) })}
        </ThemedText>
        <View
          style={styles.progress}
          accessibilityRole="progressbar"
          accessibilityLabel={tf('iosStepProgress', {
            n: step + 1,
            total: STEPS.length,
            name: t(STEPS[step]),
          })}>
          {STEPS.map((key, i) => (
            <View
              key={key}
              style={[
                styles.progressBar,
                { backgroundColor: i <= step ? theme.primary : theme.track },
              ]}
            />
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {step === 0 && (
            <Animated.View entering={FadeInDown.duration(240)}>
              <ThemedText type="title" accessibilityRole="header">
                {t('iosIntroTitle')}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>
                {t('iosIntroBody1')}
              </ThemedText>
              <ThemedText type="micro" themeColor="textTertiary" style={styles.previewTime}>
                {t('iosPreviewTime')}
              </ThemedText>

              <View style={[styles.preview, { borderColor: theme.cardBorder }]}>
                {([
                  ['upload', 'iosPreviewInstall', 'iosPreviewInstallBody'],
                  ['check', 'iosPreviewProof', 'iosPreviewProofBody'],
                  ['spark', 'iosPreviewAutomation', 'iosPreviewAutomationBody'],
                ] as const).map(([icon, title, body], index) => (
                  <View
                    key={title}
                    style={[
                      styles.previewRow,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: theme.cardBorder,
                      },
                    ]}>
                    <View style={[styles.previewIcon, { backgroundColor: theme.primarySoft }]}>
                      <Icon name={icon} size={16} color={theme.primary} />
                    </View>
                    <View style={styles.previewCopy}>
                      <ThemedText type="smallBold">{t(title)}</ThemedText>
                      <ThemedText type="meta" themeColor="textSecondary">
                        {t(body)}
                      </ThemedText>
                    </View>
                  </View>
                ))}
              </View>

              <Block style={styles.note}>
                <Icon name="lock" size={16} color={theme.textSecondary} />
                <ThemedText type="meta" themeColor="textSecondary" style={styles.noteText}>
                  {t('iosPrivacyNote')}
                </ThemedText>
              </Block>

              {/* A build with no relay can never pair. Saying so before the
                  tap beats a disabled button with no explanation, and beats a
                  button that fails identically every time it is pressed. */}
              {!relayAvailable && (
                <Block style={styles.note}>
                  <Icon name="alert" size={16} color={theme.warning} />
                  <ThemedText type="meta" themeColor="textSecondary" style={styles.noteText}>
                    {t('iosRelayUnavailable')}
                  </ThemedText>
                </Block>
              )}

              {errorBlock}

              <Button
                label={pairing || loading ? t('iosConnecting') : t('iosConnectCta')}
                disabled={pairing || loading || !relayAvailable}
                onPress={connect}
                style={styles.cta}
              />
              <Button
                label={t('iosContinueManual')}
                variant="outline"
                wrapLabel
                onPress={finish}
                style={styles.ctaSecondary}
              />
            </Animated.View>
          )}

          {step === 1 && paired && (
            <Animated.View entering={FadeInDown.duration(240)}>
              <ThemedText type="title" accessibilityRole="header">
                {t('iosShortcutTitle')}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>
                {t('iosShortcutBody')}
              </ThemedText>

              <Block style={styles.note}>
                <Icon name="lock" size={16} color={theme.textTertiary} />
                <ThemedText type="meta" themeColor="textSecondary" style={styles.noteText}>
                  {t('onboardCapturePrivacyIos')}
                </ThemedText>
              </Block>

              {shortcutAvailable && (
                <Block style={styles.note}>
                  <Icon name="alert" size={16} color={theme.warning} />
                  <ThemedText type="meta" themeColor="textSecondary" style={styles.noteText}>
                    {t('iosShortcutReplaceNote')}
                  </ThemedText>
                </Block>
              )}

              {shortcutAvailable ? (
                <>
                  <SectionHeader title={t('iosSetupCode')} />
                  <Row
                    last
                    onPress={disconnecting || preparing ? undefined : () => void copy('setup')}
                    accessibilityLabel={t('iosCopySetupCode')}>
                    <ThemedText type="nano" numberOfLines={1} style={styles.mono}>
                      WAFRA ··· {setup.tokenPreview?.slice(-6)}
                    </ThemedText>
                    <ThemedText type="nano" style={{ color: theme.primary }}>
                      {copied === 'setup' ? t('iosCopied') : t('iosCopy')}
                    </ThemedText>
                  </Row>
                </>
              ) : (
                <>
                  <Block style={styles.note}>
                    <Icon name="alert" size={16} color={theme.warning} />
                    <ThemedText type="nano" themeColor="textSecondary" style={styles.noteText}>
                      {t('iosShortcutMissing')}
                    </ThemedText>
                  </Block>
                  <SectionHeader title={t('iosYourAddress')} />
                  <Row
                    onPress={disconnecting || preparing ? undefined : () => void copy('url')}
                    accessibilityLabel={t('iosCopyAddress')}>
                    <ThemedText type="nano" numberOfLines={1} style={styles.mono}>
                      {setup.ingestUrl}
                    </ThemedText>
                    <ThemedText type="nano" style={{ color: theme.primary }}>
                      {copied === 'url' ? t('iosCopied') : t('iosCopy')}
                    </ThemedText>
                  </Row>
                  <Row
                    last
                    onPress={disconnecting || preparing ? undefined : () => void copy('token')}
                    accessibilityLabel={t('iosCopyToken')}>
                    <ThemedText type="nano" numberOfLines={1} style={styles.mono}>
                      {setup.tokenPreview}
                    </ThemedText>
                    <ThemedText type="nano" style={{ color: theme.primary }}>
                      {copied === 'token' ? t('iosCopied') : t('iosCopy')}
                    </ThemedText>
                  </Row>
                </>
              )}

              {errorBlock}

              <Button
                label={shortcutAvailable ? t('iosOpenShortcut') : t('iosOpenShortcutsApp')}
                icon="upload"
                wrapLabel
                disabled={disconnecting || preparing}
                onPress={() => void installShortcut()}
                style={styles.cta}
              />
              <Button
                label={t('iosInstalledIt')}
                variant="ghost"
                disabled={shortcutAdvanceBlocked}
                onPress={() => void shortcutInstalled()}
                style={styles.ctaSecondary}
              />
              <Button
                label={disconnecting ? t('iosDisconnecting') : t('iosDisconnect')}
                variant="ghost"
                disabled={disconnecting}
                onPress={() => void disconnect()}
                style={styles.ctaSecondary}
              />
            </Animated.View>
          )}

          {step === 2 && (
            <Animated.View entering={FadeInDown.duration(240)}>
              <ThemedText type="title" accessibilityRole="header">
                {t('iosTestTitle')}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>
                {t('iosTestBody')}
              </ThemedText>
              {(captured || captureOn) && (
                <ThemedText type="nano" themeColor="textTertiary" style={styles.body}>
                  {t('iosTestLimit')}
                </ThemedText>
              )}

              {captured && (
                <Animated.View entering={FadeIn.duration(300)}>
                  <Block style={[styles.caught, { borderColor: theme.primaryBorder }]}>
                    <Icon name="check" size={20} color={theme.primary} />
                    <View style={styles.caughtText}>
                      <ThemedText>{captured.merchant}</ThemedText>
                      <ThemedText type="nano" themeColor="textSecondary">
                        {captured.isTest ? t('iosTestCaught') : t('iosCaught')}
                      </ThemedText>
                    </View>
                  </Block>
                </Animated.View>
              )}

              {listening && (
                <View accessibilityLiveRegion="polite" accessibilityLabel={t('iosWaitingLabel')}>
                  <Block style={styles.listening}>
                    <PulseDot color={theme.primary} />
                    <ThemedText type="nano" themeColor="textSecondary" style={styles.noteText}>
                      {t('iosListening')}
                    </ThemedText>
                  </Block>
                </View>
              )}

              {timedOut && (
                <Block style={styles.note}>
                  <Icon name="alert" size={16} color={theme.warning} />
                  <ThemedText type="nano" themeColor="textSecondary" style={styles.noteText}>
                    {t('iosTimedOut')}
                  </ThemedText>
                </Block>
              )}

              {errorBlock}

              {(captured || captureOn) && !listening ? (
                <Button
                  label={t('iosContinueToAutomation')}
                  wrapLabel
                  onPress={continueToAutomation}
                  style={styles.cta}
                />
              ) : !listening && paired ? (
                <Button
                  label={timedOut ? t('iosTryAgain') : t('iosStartListening')}
                  onPress={startTest}
                  style={styles.cta}
                />
              ) : null}

              {(timedOut || (
                recovery === 'shortcut' && failure !== 'shortcuts-missing'
              )) && (
                <Button
                  label={t('iosReinstallShortcut')}
                  variant="ghost"
                  onPress={() => goToStep(1)}
                  style={styles.ctaSecondary}
                />
              )}

              <Button
                label={t('iosBackToShortcut')}
                variant="ghost"
                onPress={() => goToStep(1)}
                style={styles.ctaSecondary}
              />

              {!captured && !captureOn && !listening && (
                <Button
                  label={t('iosSkipForNow')}
                  variant="ghost"
                  wrapLabel
                  onPress={finish}
                  style={styles.ctaSecondary}
                />
              )}
            </Animated.View>
          )}

          {step === 3 && (
            <Animated.View entering={FadeInDown.duration(240)}>
              <ThemedText type="title" accessibilityRole="header">
                {automationActive
                  ? t('iosAlreadyWorkingTitle')
                  : automationPrepared
                    ? t('iosAutomationWaitingTitle')
                    : t('iosAutomationTitle')}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>
                {automationActive
                  ? t('iosAlreadyWorkingBody')
                  : automationPrepared
                    ? t('iosAutomationWaitingBody')
                    : t('iosAutomationBody')}
              </ThemedText>

              {!automationPrepared && !automationActive && (
                <>
                  <Block style={styles.automationSteps}>
                    <ThemedText type="nano">{t('iosAutomationTrigger')}</ThemedText>
                    <ThemedText type="nano">{t('iosAutomationSenders')}</ThemedText>
                    <ThemedText type="nano">{t('iosAutomationImmediate')}</ThemedText>
                    <ThemedText type="nano">{t('iosAutomationAction')}</ThemedText>
                    <ThemedText type="nano">{t('iosAutomationInput')}</ThemedText>
                  </Block>

                  {banks.length > 0 && (
                    <>
                      <SectionHeader title={t('iosRunFor')} />
                      <Block>
                        <ThemedText type="nano" themeColor="textSecondary">
                          {banks.join(' · ')}
                        </ThemedText>
                      </Block>
                    </>
                  )}

                  <Block style={styles.note}>
                    <Icon name="alert" size={16} color={theme.warning} />
                    <ThemedText type="meta" themeColor="textSecondary" style={styles.noteText}>
                      {t('iosSenderCaveat')}
                    </ThemedText>
                  </Block>
                </>
              )}

              {errorBlock}

              {automationPrepared || automationActive ? (
                <Button label={t('iosDone')} onPress={finish} style={styles.cta} />
              ) : (
                <>
                  <Button
                    label={t('iosOpenShortcutsApp')}
                    icon="upload"
                    onPress={() => void openAutomation()}
                    style={styles.cta}
                  />
                  <Button
                    label={t('iosAutomationReadyTest')}
                    variant="ghost"
                    wrapLabel
                    disabled={preparing || failure === 'shortcuts-missing'}
                    onPress={() => void automationReady()}
                    style={styles.ctaSecondary}
                  />
                </>
              )}

              {!automationActive && (
                <Button
                  label={t('iosBackToTest')}
                  variant="ghost"
                  onPress={() => goToStep(2)}
                  style={styles.ctaSecondary}
                />
              )}
            </Animated.View>
          )}
        </ScrollView>
      </SafeAreaView>

      {askPrivateMode && (
        <ConfirmSheet
          visible
          onClose={() => void send({ type: 'cancel-private-mode' })}
          question={t('iosPrivateModeTitle')}
          body={t('iosPrivateModeBody')}
          confirmLabel={t('iosTurnOffPrivateMode')}
          onConfirm={leavePrivateModeAndConnect}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  progress: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.three,
  },
  progressLabel: { paddingHorizontal: ScreenPadding, paddingBottom: Spacing.two },
  progressBar: { flex: 1, height: 3, borderRadius: 2 },
  previewTime: { marginTop: Spacing.three },
  preview: {
    marginTop: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    overflow: 'hidden',
  },
  previewRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  previewIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCopy: { flex: 1, minWidth: 0, gap: 2 },
  content: {
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.six,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  body: { marginTop: Spacing.two, lineHeight: 21 },
  note: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
    marginTop: Spacing.four,
  },
  noteText: { flex: 1, lineHeight: 18 },
  // The error note carries two lines — what happened, and what to do — so its
  // copy needs a column, not a single Text.
  noteCopy: { flex: 1, gap: Spacing.half },
  noteLine: { lineHeight: 18 },
  listening: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', marginTop: Spacing.four },
  caught: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
    marginTop: Spacing.four,
    borderWidth: 1,
    borderRadius: Radius.control,
  },
  caughtText: { flex: 1, gap: 2 },
  automationSteps: { marginTop: Spacing.four, gap: Spacing.three },
  cta: { marginTop: Spacing.five },
  ctaSecondary: { marginTop: Spacing.two },
  mono: { flex: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
