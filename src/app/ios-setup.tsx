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
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Linking,
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
import { buildImportPlan } from '@/lib/auto-import';
import {
  disableRelayBackgroundSync,
  enableRelayBackgroundSync,
} from '@/lib/background-relay';
import { t, tf, type StringKey } from '@/lib/i18n';
import { getActiveMarket } from '@/lib/markets';
import { requestSilentCapturePermission } from '@/lib/notifications';
import {
  ackRelay,
  DEFAULT_RELAY_URL,
  DEFAULT_SHORTCUT_URL,
  getRelayConfig,
  markRelayConfigured,
  markRelayVerified,
  pairDevice,
  RelayError,
  syncRelay,
  unpairDevice,
  type RelayConfig,
} from '@/lib/relay';
import { shortcutSetupCode, shortcutTestUrl } from '@/lib/relay-protocol';
import { useStore } from '@/lib/store';

/** Step names as keys, so the progress bar reads in the user's language. */
const STEPS: readonly StringKey[] = [
  'iosStepConnect',
  'iosStepShortcut',
  'iosStepAutomation',
  'iosStepTest',
] as const;
type Step = 0 | 1 | 2 | 3;

/**
 * What the user can DO about a failure, rather than only what went wrong.
 * `null` means the message is its own instruction and the step's own buttons
 * are the recovery.
 */
type Recovery = 'settings' | 'shortcut' | null;

/** How long the test step waits for a message before offering help. */
const TEST_TIMEOUT_MS = 120_000;
const POLL_MS = 2_500;

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
function connectFailure(error: unknown): { message: string; detail: string | null } {
  if (!(error instanceof RelayError)) return { message: t('iosConnectFailed'), detail: null };
  switch (error.code) {
    case 'rate_limited':
      return { message: t('trustedTryLater'), detail: t('trustedTryLaterBody') };
    case 'unauthorized':
      return { message: t('trustedAccessEnded'), detail: t('trustedAccessEndedBody') };
    case 'device_limit':
      return { message: t('trustedLimitTitle'), detail: t('trustedLimitBody') };
    default:
      // A dead network and a relay 5xx are both "try again"; anything else is
      // the relay refusing, which is not the user's connection but is still
      // "nothing was changed here".
      return error.retryable
        ? { message: t('iosConnectFailed'), detail: t('trustedUnavailableBody') }
        : { message: t('trustedUnavailableTitle'), detail: t('trustedUnavailableBody') };
  }
}

export default function IosSetupScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ fromOnboarding?: string }>();
  const { state, importBatch, ensureDurable, setOnboarded, setPrivateMode } = useStore();

  const [step, setStep] = useState<Step>(0);
  const [cfg, setCfg] = useState<RelayConfig | null>(null);
  const [pairing, setPairing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<Recovery>(null);
  // Most people should not have to tap eight banks before setup can begin.
  // Start with every supported UAE sender and let privacy-conscious users
  // narrow the list; the Shortcuts trigger remains editable later.
  const [banks, setBanks] = useState<string[]>(() =>
    getActiveMarket().banks.map((bank) => bank.name),
  );
  const [copied, setCopied] = useState<string | null>(null);
  // Reading the pasteboard on return can trigger Apple's cross-app paste
  // permission sheet. Track only values Wafra deliberately placed there and
  // clear them on the user's explicit continue action without reading them
  // back first.
  const sensitiveCopyPending = useRef(false);
  /**
   * Private mode has to come off before this screen can pair, and that is the
   * user's call, not the wizard's. It was an `Alert.alert` with the whole
   * turn-it-off-and-connect sequence inside a button's `onPress` — code the
   * web export never draws and therefore never runs, so "Connect this iPhone"
   * did nothing at all for anyone in private mode. Drawn as a sheet instead.
   */
  const [askPrivateMode, setAskPrivateMode] = useState(false);

  // Test step
  const [listening, setListening] = useState(false);
  const [captured, setCaptured] = useState<{ merchant: string; isTest: boolean } | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  // The polling loop closes over state; a ref keeps it reading the live one.
  const stateRef = useRef(state);
  stateRef.current = state;

  /** The relay has answered at least once, so capture is live, not proposed. */
  const captureOn = cfg?.setupState === 'verified';

  const fail = useCallback((message: string, how: Recovery = null, detail: string | null = null) => {
    setError(message);
    setErrorDetail(detail);
    setRecovery(how);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setErrorDetail(null);
    setRecovery(null);
  }, []);

  useEffect(() => {
    (async () => {
      const existing = await getRelayConfig();
      if (existing) {
        setCfg(existing);
        setStep(existing.setupState === 'paired' ? 1 : 3);
      }
    })();
  }, []);

  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  /**
   * Move within the wizard. Anything in flight on the step being left has to
   * stop, or a poll started on the test step keeps running behind the
   * automation instructions and lands a success on a screen that never asked.
   */
  const goToStep = useCallback(
    (next: Step) => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      pollTimer.current = null;
      setListening(false);
      setTimedOut(false);
      setCaptured(null);
      clearError();
      setStep(next);
    },
    [clearError],
  );

  const performConnect = useCallback(async () => {
    if (!DEFAULT_RELAY_URL) {
      fail(t('iosRelayUnavailable'));
      return;
    }
    setPairing(true);
    clearError();
    try {
      const paired = await pairDevice(DEFAULT_RELAY_URL);
      setCfg(paired);
      setStep(1);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch (e) {
      const failure = connectFailure(e);
      fail(failure.message, null, failure.detail);
    } finally {
      setPairing(false);
    }
  }, [clearError, fail]);

  const connect = useCallback(() => {
    if (!state.privateMode) {
      void performConnect();
      return;
    }
    setAskPrivateMode(true);
  }, [performConnect, state.privateMode]);

  /** The other side of that question. Reached only from the sheet. */
  const leavePrivateModeAndConnect = useCallback(() => {
    void (async () => {
      try {
        await setPrivateMode(false);
        await performConnect();
      } catch {
        fail(t('iosConnectFailed'));
      }
    })();
  }, [fail, performConnect, setPrivateMode]);

  const finish = useCallback(() => {
    if (params.fromOnboarding === '1') {
      // Return to the personalised onboarding summary. The query makes this
      // resilient even if Expo Router remounted the gate while Shortcuts was
      // in front of the app.
      router.replace('/?onboarding=complete');
      return;
    }
    setOnboarded();
    router.replace('/');
  }, [params.fromOnboarding, router, setOnboarded]);

  /**
   * The header back button leaves the screen; the in-flow ghost buttons move
   * between steps. `router.back()` alone is a no-op when this screen is the
   * only entry in the stack — a cold launch straight into it left the user
   * with a header chevron that did nothing and no way out but finishing.
   */
  const leave = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    finish();
  }, [finish, router]);

  const disconnect = useCallback(async () => {
    if (!cfg) return;
    setDisconnecting(true);
    clearError();
    try {
      await disableRelayBackgroundSync();
      await unpairDevice(cfg);
      setCfg(null);
      setBanks(getActiveMarket().banks.map((bank) => bank.name));
      goToStep(0);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch {
      fail(t('iosDisconnectFailed'));
    } finally {
      setDisconnecting(false);
    }
  }, [cfg, clearError, fail, goToStep]);

  const copy = useCallback(async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    sensitiveCopyPending.current = label === 'setup' || label === 'token';
    setCopied(label);
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 2000);
  }, []);

  /**
   * The setup code carries the ingest bearer token. Take it off the pasteboard
   * on the user's explicit continue action. Do not read it back first: iOS can
   * show a cross-app paste permission sheet for that read, directly inside the
   * setup path. The button copy tells the user that continuing clears it.
   */
  const clearSetupCodeFromPasteboard = useCallback(async () => {
    if (!sensitiveCopyPending.current) return;
    try {
      await Clipboard.setStringAsync('');
      sensitiveCopyPending.current = false;
    } catch {
      // Pasteboard cleanup is best-effort; the token also remains in Shortcut.
    }
  }, []);

  const installShortcut = useCallback(async () => {
    if (!cfg) return;
    const code = shortcutSetupCode(cfg.ingestUrl, cfg.ingestToken);
    try {
      await Clipboard.setStringAsync(code);
      sensitiveCopyPending.current = true;
      setCopied('setup');
      if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
      await Linking.openURL(DEFAULT_SHORTCUT_URL ?? 'shortcuts://');
      clearError();
    } catch {
      fail(t('iosShortcutInstallFailed'));
    }
  }, [cfg, clearError, fail]);

  const shortcutInstalled = useCallback(async () => {
    await clearSetupCodeFromPasteboard();
    setCopied(null);
    goToStep(2);
  }, [clearSetupCodeFromPasteboard, goToStep]);

  /**
   * Register the silent wake. This is what lets a bank alert file itself while
   * Wafra is closed, so nothing may leave the automation step without it — and
   * a denial has to point at the one place that can undo it, iPhone Settings.
   */
  const ensureSilentDelivery = useCallback(
    async (active: RelayConfig): Promise<boolean> => {
      const notificationAllowed = await requestSilentCapturePermission();
      if (!notificationAllowed) {
        fail(t('iosPushPermissionRequired'), 'settings');
        return false;
      }
      const backgroundReady = await enableRelayBackgroundSync(active);
      if (!backgroundReady) {
        fail(t('iosPushSetupFailed'));
        return false;
      }
      clearError();
      return true;
    },
    [clearError, fail],
  );

  const openAutomation = useCallback(async () => {
    if (!cfg) return;
    if (!(await ensureSilentDelivery(cfg))) return;
    try {
      await Linking.openURL('shortcuts://');
    } catch {
      fail(t('iosShortcutsOpenFailed'));
    }
  }, [cfg, ensureSilentDelivery, fail]);

  /**
   * Poll the relay until the user's test message shows up, then file it for
   * real — the transaction they see at the end of setup is a genuine one, not
   * a mock. Any message works; most people just forward one they already have.
   *
   * The config is an argument rather than a closure read: the step that starts
   * this test also writes a new config in the same tick, and a `cfg` read here
   * was either stale or, once, null — which returned before scheduling the
   * next tick and left the "Waiting for the Shortcut…" pulse running forever
   * with no timeout and no way back.
   */
  const poll = useCallback(
    async (active: RelayConfig) => {
      try {
        const { parsed, ids, testReceived } = await syncRelay(active);
        if (parsed.length > 0 || testReceived > 0) {
          const newestTs = parsed.reduce((m, p) => Math.max(m, p.smsTs ?? 0), 0);
          // A redelivered row can dedupe against an import that reached React
          // state but whose first SQLCipher write failed. Flush that state when
          // the delivery makes no new changes; otherwise use the batch's own
          // durability receipt.
          let durable = Promise.resolve();
          if (parsed.length > 0) {
            const plan = buildImportPlan(parsed, stateRef.current, newestTs);
            if (plan.txCount > 0 || plan.dueCount > 0 || plan.healedCount > 0) {
              durable = importBatch(plan.batch).durable;
            } else {
              durable = ensureDurable();
            }
          }
          await durable;
          await ackRelay(active, ids);
          const verified = await markRelayVerified(active);
          setCfg(verified);
          setCaptured({
            merchant: testReceived > 0 ? 'Wafra Capture' : parsed[0].merchant,
            isTest: testReceived > 0,
          });
          setListening(false);
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }
          return;
        }
        // Corrupt/unreadable queue rows are unrecoverable and should not block a
        // future valid test until their 30-day queue retention ends.
        if (ids.length > 0) await ackRelay(active, ids);
      } catch {
        // Keep listening. A flaky minute on mobile data should not end the step.
      }
      if (Date.now() - startedAt.current > TEST_TIMEOUT_MS) {
        setListening(false);
        setTimedOut(true);
        return;
      }
      pollTimer.current = setTimeout(() => void poll(active), POLL_MS);
    },
    [ensureDurable, importBatch],
  );

  const startTest = useCallback(
    (active: RelayConfig) => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      clearError();
      setCaptured(null);
      setTimedOut(false);
      setListening(true);
      startedAt.current = Date.now();
      void poll(active);
      if (Platform.OS !== 'web') {
        // A rejected run URL means the Shortcut is gone or renamed. That is a
        // different problem from "nothing arrived", and it has a different
        // fix, so it must not wait out a two-minute timeout to say so.
        Linking.openURL(shortcutTestUrl()).catch(() => {
          if (pollTimer.current) clearTimeout(pollTimer.current);
          pollTimer.current = null;
          setListening(false);
          fail(t('iosShortcutRunFailed'), 'shortcut');
        });
      }
    },
    [clearError, fail, poll],
  );

  /**
   * Confirming the automation and running the proof are one action.
   *
   * They were two buttons, and the first of them did nothing the user could
   * see: it wrote 'configured' and advanced to a screen whose only content was
   * another button. Merging them removes a tap without removing a decision —
   * the decision is "I built the automation", and the test is what answers it.
   */
  const automationReady = useCallback(async () => {
    if (!cfg) return;
    if (!(await ensureSilentDelivery(cfg))) return;
    await clearSetupCodeFromPasteboard();
    const configured = await markRelayConfigured(cfg);
    setCfg(configured);
    setStep(3);
    startTest(configured);
  }, [cfg, clearSetupCodeFromPasteboard, ensureSilentDelivery, startTest]);

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
          onPress={() => {
            Linking.openSettings().catch(() => {});
          }}
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
                  ['spark', 'iosPreviewAutomation', 'iosPreviewAutomationBody'],
                  ['check', 'iosPreviewProof', 'iosPreviewProofBody'],
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
              {!DEFAULT_RELAY_URL && (
                <Block style={styles.note}>
                  <Icon name="alert" size={16} color={theme.warning} />
                  <ThemedText type="meta" themeColor="textSecondary" style={styles.noteText}>
                    {t('iosRelayUnavailable')}
                  </ThemedText>
                </Block>
              )}

              {errorBlock}

              <Button
                label={pairing ? t('iosConnecting') : t('iosConnectCta')}
                disabled={pairing || !DEFAULT_RELAY_URL}
                onPress={connect}
                style={styles.cta}
              />
              <Button
                label={t('iosContinueManual')}
                variant="ghost"
                onPress={finish}
                style={styles.ctaSecondary}
              />
            </Animated.View>
          )}

          {step === 1 && cfg && (
            <Animated.View entering={FadeInDown.duration(240)}>
              <ThemedText type="title" accessibilityRole="header">
                {t('iosShortcutTitle')}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>
                {t('iosShortcutBody')}
              </ThemedText>

              {DEFAULT_SHORTCUT_URL && (
                <Block style={styles.note}>
                  <Icon name="alert" size={16} color={theme.warning} />
                  <ThemedText type="meta" themeColor="textSecondary" style={styles.noteText}>
                    {t('iosShortcutReplaceNote')}
                  </ThemedText>
                </Block>
              )}

              {DEFAULT_SHORTCUT_URL ? (
                <>
                  <SectionHeader title={t('iosSetupCode')} />
                  <Row
                    last
                    onPress={() => copy('setup', shortcutSetupCode(cfg.ingestUrl, cfg.ingestToken))}
                    accessibilityLabel={t('iosCopySetupCode')}>
                    <ThemedText type="nano" numberOfLines={1} style={styles.mono}>
                      WAFRA ··· {cfg.ingestToken.slice(-6)}
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
                    onPress={() => copy('url', cfg.ingestUrl)}
                    accessibilityLabel={t('iosCopyAddress')}>
                    <ThemedText type="nano" numberOfLines={1} style={styles.mono}>
                      {cfg.ingestUrl}
                    </ThemedText>
                    <ThemedText type="nano" style={{ color: theme.primary }}>
                      {copied === 'url' ? t('iosCopied') : t('iosCopy')}
                    </ThemedText>
                  </Row>
                  <Row
                    last
                    onPress={() => copy('token', cfg.ingestToken)}
                    accessibilityLabel={t('iosCopyToken')}>
                    <ThemedText type="nano" numberOfLines={1} style={styles.mono}>
                      {cfg.ingestToken.slice(0, 10)}···{cfg.ingestToken.slice(-6)}
                    </ThemedText>
                    <ThemedText type="nano" style={{ color: theme.primary }}>
                      {copied === 'token' ? t('iosCopied') : t('iosCopy')}
                    </ThemedText>
                  </Row>
                </>
              )}

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

              {errorBlock}

              <Button
                label={DEFAULT_SHORTCUT_URL ? t('iosOpenShortcut') : t('iosOpenShortcutsApp')}
                icon="upload"
                onPress={() => void installShortcut()}
                style={styles.cta}
              />
              <Button
                label={t('iosInstalledIt')}
                variant="ghost"
                onPress={() => void shortcutInstalled()}
                style={styles.ctaSecondary}
              />
              <Button
                label={disconnecting ? t('iosConnecting') : t('iosDisconnect')}
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
                {t('iosAutomationTitle')}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>
                {t('iosAutomationBody')}
              </ThemedText>

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

              {errorBlock}

              <Button
                label={t('iosOpenShortcutsApp')}
                icon="upload"
                onPress={() => void openAutomation()}
                style={styles.cta}
              />
              <Button
                label={t('iosAutomationReadyTest')}
                variant="ghost"
                onPress={() => void automationReady()}
                style={styles.ctaSecondary}
              />
              <Button
                label={t('iosBackToShortcut')}
                variant="ghost"
                onPress={() => goToStep(1)}
                style={styles.ctaSecondary}
              />
            </Animated.View>
          )}

          {step === 3 && (
            <Animated.View entering={FadeInDown.duration(240)}>
              <ThemedText type="title" accessibilityRole="header">
                {captureOn ? t('iosAlreadyWorkingTitle') : t('iosTestTitle')}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>
                {captureOn ? t('iosAlreadyWorkingBody') : t('iosTestBody')}
              </ThemedText>
              {captureOn && (
                <ThemedText type="nano" themeColor="textTertiary" style={styles.body}>
                  {t('iosIntroBody2')}
                </ThemedText>
              )}
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

              {captured ? (
                <Button label={t('iosDone')} onPress={finish} style={styles.cta} />
              ) : captureOn && !listening ? (
                <Button label={t('iosDone')} onPress={finish} style={styles.cta} />
              ) : !listening && cfg ? (
                <Button
                  label={timedOut ? t('iosTryAgain') : t('iosStartListening')}
                  onPress={() => startTest(cfg)}
                  style={styles.cta}
                />
              ) : null}

              {captureOn && !captured && !listening && cfg && (
                <Button
                  label={t('iosRunTestAgain')}
                  variant="ghost"
                  onPress={() => startTest(cfg)}
                  style={styles.ctaSecondary}
                />
              )}

              {(timedOut || recovery === 'shortcut') && (
                <Button
                  label={t('iosReinstallShortcut')}
                  variant="ghost"
                  onPress={() => goToStep(1)}
                  style={styles.ctaSecondary}
                />
              )}

              <Button
                label={t('iosBackToAutomation')}
                variant="ghost"
                onPress={() => goToStep(2)}
                style={styles.ctaSecondary}
              />

              {!captured && !captureOn && (
                <Button
                  label={t('iosSkipForNow')}
                  variant="ghost"
                  onPress={finish}
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
          onClose={() => setAskPrivateMode(false)}
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
