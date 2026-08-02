/**
 * iOS capture setup.
 *
 * This is the flow the whole iOS product rests on, which is why it is a
 * first-class screen rather than a row in Settings. Android asks for one
 * permission and starts working; iOS cannot, so all of the friction lives
 * here. Once the Shortcut and Message automation exist, the relay can receive
 * while Wafra is closed; the ledger catches up when iOS next lets the app sync.
 *
 * Five steps, with a final proof that the installed Shortcut, relay,
 * encryption and sync path work together. Apple's Message sender trigger
 * cannot be simulated by an app; the flow says plainly that only the next
 * genuine bank alert verifies that last link.
 */
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
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

/** How long the test step waits for a message before offering help. */
const TEST_TIMEOUT_MS = 120_000;
const POLL_MS = 2_500;

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
  // Most people should not have to tap eight banks before setup can begin.
  // Start with every supported UAE sender and let privacy-conscious users
  // narrow the list; the Shortcuts trigger remains editable later.
  const [banks, setBanks] = useState<string[]>(() =>
    getActiveMarket().banks.map((bank) => bank.name),
  );
  const [copied, setCopied] = useState<string | null>(null);

  // Test step
  const [listening, setListening] = useState(false);
  const [captured, setCaptured] = useState<{ merchant: string; isTest: boolean } | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  // The polling loop closes over state; a ref keeps it reading the live one.
  const stateRef = useRef(state);
  stateRef.current = state;

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

  const performConnect = useCallback(async () => {
    if (!DEFAULT_RELAY_URL) {
      setError(t('iosRelayUnavailable'));
      return;
    }
    setPairing(true);
    setError(null);
    try {
      const paired = await pairDevice(DEFAULT_RELAY_URL);
      setCfg(paired);
      setStep(1);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('iosConnectFailed'));
    } finally {
      setPairing(false);
    }
  }, []);

  const connect = useCallback(() => {
    if (!state.privateMode) {
      void performConnect();
      return;
    }
    Alert.alert(t('iosPrivateModeTitle'), t('iosPrivateModeBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('iosTurnOffPrivateMode'),
        onPress: () => {
          void (async () => {
            try {
              await setPrivateMode(false);
              await performConnect();
            } catch {
              setError(t('iosConnectFailed'));
            }
          })();
        },
      },
    ]);
  }, [performConnect, setPrivateMode, state.privateMode]);

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

  const disconnect = useCallback(async () => {
    if (!cfg) return;
    setDisconnecting(true);
    setError(null);
    try {
      await disableRelayBackgroundSync();
      await unpairDevice(cfg);
      setCfg(null);
      setBanks(getActiveMarket().banks.map((bank) => bank.name));
      setStep(0);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch {
      setError(t('iosDisconnectFailed'));
    } finally {
      setDisconnecting(false);
    }
  }, [cfg]);

  const copy = useCallback(async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(label);
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 2000);
  }, []);

  const installShortcut = useCallback(async () => {
    if (!cfg) return;
    const code = shortcutSetupCode(cfg.ingestUrl, cfg.ingestToken);
    try {
      await Clipboard.setStringAsync(code);
      setCopied('setup');
      if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
      await Linking.openURL(DEFAULT_SHORTCUT_URL ?? 'shortcuts://');
    } catch {
      setError(t('iosConnectFailed'));
    }
  }, [cfg]);

  const shortcutInstalled = useCallback(async () => {
    // The code contains the bearer token. Clear it once the user confirms the
    // Shortcut consumed it, but do not overwrite unrelated clipboard content.
    try {
      const current = await Clipboard.getStringAsync();
      if (cfg && current === shortcutSetupCode(cfg.ingestUrl, cfg.ingestToken)) {
        await Clipboard.setStringAsync('');
      }
    } catch {
      // Pasteboard cleanup is best-effort; the token also remains in Shortcut.
    }
    setCopied(null);
    setStep(2);
  }, [cfg]);

  const openAutomation = useCallback(async () => {
    if (!cfg) return;
    try {
      const notificationAllowed = await requestSilentCapturePermission();
      if (!notificationAllowed) {
        setError(t('iosPushPermissionRequired'));
        return;
      }
      const backgroundReady = await enableRelayBackgroundSync(cfg);
      if (!backgroundReady) {
        setError(t('iosPushSetupFailed'));
        return;
      }
      setError(null);
      await Linking.openURL('shortcuts://');
    } catch {
      setError(t('iosConnectFailed'));
    }
  }, [cfg]);

  const automationReady = useCallback(async () => {
    if (!cfg) return;
    const configured = await markRelayConfigured(cfg);
    setCfg(configured);
    setStep(3);
  }, [cfg]);

  /**
   * Poll the relay until the user's test message shows up, then file it for
   * real — the transaction they see at the end of setup is a genuine one, not
   * a mock. Any message works; most people just forward one they already have.
   */
  const poll = useCallback(async () => {
    const active = cfg;
    if (!active) return;
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
    pollTimer.current = setTimeout(poll, POLL_MS);
  }, [cfg, ensureDurable, importBatch]);

  const startTest = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setCaptured(null);
    setTimedOut(false);
    setListening(true);
    startedAt.current = Date.now();
    void poll();
    if (Platform.OS !== 'web') {
      Linking.openURL(shortcutTestUrl()).catch(() => {
        setListening(false);
        setTimedOut(true);
      });
    }
  }, [poll]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={t('iosSetupTitle')} onBack={() => router.back()} />

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

              {error && (
                <ThemedText type="nano" style={[styles.error, { color: theme.expense }]}>
                  {error}
                </ThemedText>
              )}
              <Button
                label={pairing ? t('iosConnecting') : t('iosConnectCta')}
                disabled={pairing}
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

              <Button
                label={DEFAULT_SHORTCUT_URL ? t('iosOpenShortcut') : t('iosOpenShortcutsApp')}
                icon="upload"
                onPress={installShortcut}
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
                onPress={disconnect}
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

              {error && (
                <ThemedText type="meta" style={[styles.error, { color: theme.expense }]}>
                  {error}
                </ThemedText>
              )}

              <Button
                label={t('iosOpenShortcutsApp')}
                icon="upload"
                onPress={() => void openAutomation()}
                style={styles.cta}
              />
              <Button
                label={t('iosAutomationReady')}
                variant="ghost"
                onPress={() => void automationReady()}
                style={styles.ctaSecondary}
              />
            </Animated.View>
          )}

          {step === 3 && (
            <Animated.View entering={FadeInDown.duration(240)}>
              <ThemedText type="title" accessibilityRole="header">
                {t('iosTestTitle')}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>
                {t('iosTestBody')}
              </ThemedText>
              <ThemedText type="nano" themeColor="textTertiary" style={styles.body}>
                {t('iosTestLimit')}
              </ThemedText>

              {captured ? (
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
                  <Button
                    label={t('iosDone')}
                    onPress={finish}
                    style={styles.cta}
                  />
                </Animated.View>
              ) : listening ? (
                <View
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={t('iosWaitingLabel')}>
                  <Block style={styles.listening}>
                    <PulseDot color={theme.primary} />
                    <ThemedText type="nano" themeColor="textSecondary" style={styles.noteText}>
                      {t('iosListening')}
                    </ThemedText>
                  </Block>
                </View>
              ) : timedOut ? (
                <>
                  <Block style={styles.note}>
                    <Icon name="alert" size={16} color={theme.warning} />
                    <ThemedText type="nano" themeColor="textSecondary" style={styles.noteText}>
                      {t('iosTimedOut')}
                    </ThemedText>
                  </Block>
                  <Button label={t('iosTryAgain')} onPress={startTest} style={styles.cta} />
                </>
              ) : (
                <Button label={t('iosStartListening')} onPress={startTest} style={styles.cta} />
              )}

              <Button
                label={t('iosSkipForNow')}
                variant="ghost"
                onPress={finish}
                style={styles.ctaSecondary}
              />
            </Animated.View>
          )}
        </ScrollView>
      </SafeAreaView>
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
  error: { marginTop: Spacing.three },
  cta: { marginTop: Spacing.five },
  ctaSecondary: { marginTop: Spacing.two },
  mono: { flex: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  bankDot: { width: 10, height: 10, borderRadius: 5 },
  bankName: { flex: 1 },
});
