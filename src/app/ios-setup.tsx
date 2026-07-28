/**
 * iOS capture setup.
 *
 * This is the flow the whole iOS product rests on, which is why it is a
 * first-class screen rather than a row in Settings. Android asks for one
 * permission and starts working; iOS cannot, so all of the friction lives
 * here — and the deal we make with the user is that it is the ONLY friction.
 * Once the Shortcut exists, capture is silent forever after.
 *
 * Four steps, and the last one is the important one: the user does not leave
 * until a real message has round-tripped through the relay and landed in the
 * ledger in front of them. A setup flow that ends with "you're all set!" and
 * no evidence is how people end up trusting a tracker that silently stopped
 * working three weeks ago.
 */
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
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
import { getActiveMarket } from '@/lib/markets';
import {
  ackRelay,
  DEFAULT_RELAY_URL,
  getRelayConfig,
  pairDevice,
  syncRelay,
  type RelayConfig,
} from '@/lib/relay';
import { useStore } from '@/lib/store';

/**
 * The published Shortcut. It contains the automation skeleton only — no URL
 * and no token — because a Shortcut link is public and anything baked into it
 * would be a shared credential. The user pastes their own pair from step 3.
 */
const SHORTCUT_URL = 'https://www.icloud.com/shortcuts/wafra-capture';

const STEPS = ['Connect', 'Banks', 'Shortcut', 'Test'] as const;
type Step = 0 | 1 | 2 | 3;

/** How long the test step waits for a message before offering help. */
const TEST_TIMEOUT_MS = 120_000;
const POLL_MS = 2_500;

export default function IosSetupScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state, importBatch } = useStore();

  const [step, setStep] = useState<Step>(0);
  const [cfg, setCfg] = useState<RelayConfig | null>(null);
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banks, setBanks] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  // Test step
  const [listening, setListening] = useState(false);
  const [captured, setCaptured] = useState<{ merchant: string; amountFils: number } | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  // The polling loop closes over state; a ref keeps it reading the live one.
  const stateRef = useRef(state);
  stateRef.current = state;

  const marketBanks = getActiveMarket().banks;

  useEffect(() => {
    (async () => {
      const existing = await getRelayConfig();
      if (existing) {
        setCfg(existing);
        setStep(1);
      }
    })();
  }, []);

  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  const connect = useCallback(async () => {
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
      setError(e instanceof Error ? e.message : 'Could not connect.');
    } finally {
      setPairing(false);
    }
  }, []);

  const copy = useCallback(async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(label);
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 2000);
  }, []);

  /**
   * Poll the relay until the user's test message shows up, then file it for
   * real — the transaction they see at the end of setup is a genuine one, not
   * a mock. Any message works; most people just forward one they already have.
   */
  const poll = useCallback(async () => {
    const active = cfg;
    if (!active) return;
    try {
      const { parsed, ids } = await syncRelay(active);
      if (parsed.length > 0) {
        const newestTs = parsed.reduce((m, p) => Math.max(m, p.smsTs ?? 0), 0);
        const plan = buildImportPlan(parsed, stateRef.current, newestTs);
        if (plan.txCount > 0) importBatch(plan.batch);
        await ackRelay(active, ids);
        const first = parsed[0];
        setCaptured({ merchant: first.merchant, amountFils: first.amountFils });
        setListening(false);
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        return;
      }
    } catch {
      // Keep listening. A flaky minute on mobile data should not end the step.
    }
    if (Date.now() - startedAt.current > TEST_TIMEOUT_MS) {
      setListening(false);
      setTimedOut(true);
      return;
    }
    pollTimer.current = setTimeout(poll, POLL_MS);
  }, [cfg, importBatch]);

  const startTest = useCallback(() => {
    setCaptured(null);
    setTimedOut(false);
    setListening(true);
    startedAt.current = Date.now();
    pollTimer.current = setTimeout(poll, POLL_MS);
  }, [poll]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Automatic capture" onBack={() => router.back()} />

        <View
          style={styles.progress}
          accessibilityRole="progressbar"
          accessibilityLabel={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
          {STEPS.map((label, i) => (
            <View
              key={label}
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
                iPhone works differently
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>
                Apple does not let any app read your messages. So instead of reading them, Wafra
                has your iPhone forward bank alerts to it — using a Shortcut you set up once, in
                about two minutes.
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>
                After that it is automatic. Alerts get filed while your phone is locked, and there
                is nothing to open or tap again.
              </ThemedText>

              <Block style={styles.note}>
                <Icon name="lock" size={16} color={theme.textSecondary} />
                <ThemedText type="nano" themeColor="textSecondary" style={styles.noteText}>
                  Wafra reads the message, files the transaction, and throws the text away. It is
                  never stored and never logged.
                </ThemedText>
              </Block>

              {error && (
                <ThemedText type="nano" style={[styles.error, { color: theme.expense }]}>
                  {error}
                </ThemedText>
              )}
              <Button
                label={pairing ? 'Connecting…' : 'Connect this iPhone'}
                disabled={pairing}
                onPress={connect}
                style={styles.cta}
              />
            </Animated.View>
          )}

          {step === 1 && (
            <Animated.View entering={FadeInDown.duration(240)}>
              <ThemedText type="title" accessibilityRole="header">
                Which banks text you?
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>
                Pick the ones that send you card and account alerts. You will point the Shortcut at
                these senders, so it only ever sees your bank messages — nothing else in your
                inbox.
              </ThemedText>

              <SectionHeader title={`SELECTED · ${banks.length}`} />
              {marketBanks.map((b, i) => {
                const on = banks.includes(b.name);
                return (
                  <Row
                    key={b.name}
                    last={i === marketBanks.length - 1}
                    onPress={() => {
                      setBanks((prev) =>
                        prev.includes(b.name) ? prev.filter((x) => x !== b.name) : [...prev, b.name],
                      );
                      if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
                    }}
                    accessibilityLabel={`${b.name}${on ? ', selected' : ''}`}>
                    <View style={[styles.bankDot, { backgroundColor: b.color }]} />
                    <ThemedText style={styles.bankName}>{b.name}</ThemedText>
                    {on && <Icon name="check" size={16} color={theme.primary} />}
                  </Row>
                );
              })}

              <Button
                label={banks.length ? 'Next' : 'Skip — I will pick later'}
                variant={banks.length ? 'filled' : 'outline'}
                onPress={() => setStep(2)}
                style={styles.cta}
              />
            </Animated.View>
          )}

          {step === 2 && cfg && (
            <Animated.View entering={FadeInDown.duration(240)}>
              <ThemedText type="title" accessibilityRole="header">
                Install the Shortcut
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>
                Open the Shortcut, then paste these two values into it when it asks. They belong to
                this iPhone only.
              </ThemedText>

              <SectionHeader title="YOUR ADDRESS" />
              <Row onPress={() => copy('url', cfg.ingestUrl)} accessibilityLabel="Copy your Wafra address">
                <ThemedText type="nano" numberOfLines={1} style={styles.mono}>
                  {cfg.ingestUrl}
                </ThemedText>
                <ThemedText type="nano" style={{ color: theme.primary }}>
                  {copied === 'url' ? 'COPIED' : 'COPY'}
                </ThemedText>
              </Row>
              <Row last onPress={() => copy('token', cfg.token)} accessibilityLabel="Copy your secret key">
                <ThemedText type="nano" numberOfLines={1} style={styles.mono}>
                  {cfg.token.slice(0, 10)}···{cfg.token.slice(-6)}
                </ThemedText>
                <ThemedText type="nano" style={{ color: theme.primary }}>
                  {copied === 'token' ? 'COPIED' : 'COPY'}
                </ThemedText>
              </Row>

              {banks.length > 0 && (
                <>
                  <SectionHeader title="SET THE AUTOMATION TO RUN FOR" />
                  <Block>
                    <ThemedText type="nano" themeColor="textSecondary">
                      {banks.join(' · ')}
                    </ThemedText>
                  </Block>
                </>
              )}

              <Button
                label="Open the Shortcut"
                icon="upload"
                onPress={() => Linking.openURL(SHORTCUT_URL).catch(() => {})}
                style={styles.cta}
              />
              <Button
                label="I have installed it"
                variant="outline"
                onPress={() => setStep(3)}
                style={styles.ctaSecondary}
              />
            </Animated.View>
          )}

          {step === 3 && (
            <Animated.View entering={FadeInDown.duration(240)}>
              <ThemedText type="title" accessibilityRole="header">
                Let us prove it works
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.body}>
                Forward any bank message to yourself, or wait for the next real one. When it
                arrives, it will appear here.
              </ThemedText>

              {captured ? (
                <Animated.View entering={FadeIn.duration(300)}>
                  <Block style={[styles.caught, { borderColor: theme.primaryBorder }]}>
                    <Icon name="check" size={20} color={theme.primary} />
                    <View style={styles.caughtText}>
                      <ThemedText>{captured.merchant}</ThemedText>
                      <ThemedText type="nano" themeColor="textSecondary">
                        Captured and filed — with no help from you.
                      </ThemedText>
                    </View>
                  </Block>
                  <Button
                    label="Done"
                    onPress={() => router.replace('/')}
                    style={styles.cta}
                  />
                </Animated.View>
              ) : listening ? (
                <View
                  accessibilityLiveRegion="polite"
                  accessibilityLabel="Waiting for a message from your bank">
                  <Block style={styles.listening}>
                    <PulseDot color={theme.primary} />
                    <ThemedText type="nano" themeColor="textSecondary" style={styles.noteText}>
                      Listening for a message…
                    </ThemedText>
                  </Block>
                </View>
              ) : timedOut ? (
                <>
                  <Block style={styles.note}>
                    <Icon name="alert" size={16} color={theme.warning} />
                    <ThemedText type="nano" themeColor="textSecondary" style={styles.noteText}>
                      Nothing arrived. The usual cause is the automation being set to ask before
                      running — turn off &ldquo;Ask Before Running&rdquo; in the Shortcuts app.
                    </ThemedText>
                  </Block>
                  <Button label="Try again" onPress={startTest} style={styles.cta} />
                </>
              ) : (
                <Button label="Start listening" onPress={startTest} style={styles.cta} />
              )}

              <Button
                label="Skip for now"
                variant="ghost"
                onPress={() => router.replace('/')}
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
  progressBar: { flex: 1, height: 3, borderRadius: 2 },
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
  error: { marginTop: Spacing.three },
  cta: { marginTop: Spacing.five },
  ctaSecondary: { marginTop: Spacing.two },
  mono: { flex: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  bankDot: { width: 10, height: 10, borderRadius: 5 },
  bankName: { flex: 1 },
});
