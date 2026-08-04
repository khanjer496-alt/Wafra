import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { WafraMark } from '@/components/wafra-logo';
import { Colors, Fonts, ScreenPadding, Spacing } from '@/constants/theme';
import {
  buildImportPlan,
  isSmsScanningAvailable,
  requestSmsPermission,
  scanInbox,
} from '@/lib/auto-import';
import { requestNotificationPermission } from '@/lib/notifications';
import { isRelaySupported } from '@/lib/relay';
import { useStore } from '@/lib/store';

type Step = 'welcome' | 'scanning' | 'choose';

/** Onboarding is night mode regardless of the OS theme: the first screen sets
 *  the tone, and the mark is at its strongest on charcoal. */
const night = Colors.dark;

/**
 * THE PRIVACY CLAIM IS DIFFERENT ON IPHONE, AND IT HAS TO STILL BE TRUE.
 *
 * On Android "There is no server" is literally true: modules/sms-reader parses
 * the inbox on-device and the app opens no socket at all. On iPhone it is
 * false. Apple lets no app read Messages, so the only route is a Shortcuts
 * automation the user builds, which POSTs each bank alert to Wafra's relay.
 * Telling an iPhone user "there is no server" is a lie told on the exact screen
 * where trust is established, and it contradicts the product's own design.
 *
 * What replaces it is not a softer claim — it is a more specific one, and it is
 * the argument server/README.md actually makes. The message text is parsed and
 * DROPPED: there is no table for messages, no log line, nothing to dump. What
 * is stored is the parsed row, sealed with X25519 + AES-GCM to a key only this
 * iPhone holds, and deleted the moment the phone collects it. Typical retention
 * is the seconds between the text arriving and the app syncing.
 *
 * "Nothing to breach, nothing to sell" survives that translation intact. Only
 * "nothing to sync" does not, and that is precisely the part that is false.
 */
const ANDROID_POINTS: [IconName, string, string][] = [
  [
    'mail',
    'Reads SMS, files the spend',
    'Only messages from your bank are opened; the rest are never touched',
  ],
  ['calendar', 'Warns before the money leaves', 'Card dues, DEWA, rent, and quiet subscriptions'],
  ['lock', 'There is no server', 'Nothing to breach, nothing to sell, nothing to sync'],
];

const IOS_POINTS: [IconName, string, string][] = [
  [
    'mail',
    'Your bank texts file themselves',
    'A Shortcut you set up hands each alert straight to Wafra — you never type a transaction',
  ],
  ['calendar', 'Warns before the money leaves', 'Card dues, DEWA, rent, and quiet subscriptions'],
  [
    'lock',
    'Read, dropped, then sealed',
    'The message itself is never stored. The entry is locked to a key only this iPhone holds, and erased the second it lands.',
  ],
];

/**
 * First run: read the inbox, or start with sample data.
 *
 * Rendered as an opaque overlay ABOVE the app rather than instead of it —
 * swapping the navigator out corrupts expo-router's route state.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { state, importBatch, setOnboarded, loadDemoData } = useStore();
  const router = useRouter();
  const [step, setStep] = useState<Step>('welcome');
  const [progress, setProgress] = useState({ scanned: 0, found: 0 });
  const [result, setResult] = useState<{ tx: number; accounts: number } | null>(null);

  const showOverlay = state.hydrated && !state.onboarded;

  const startScan = async () => {
    const granted = await requestSmsPermission();
    await requestNotificationPermission();
    if (!granted) {
      setStep('choose');
      return;
    }
    setStep('scanning');
    try {
      const { parsed, newestTs } = await scanInbox(0, {}, (scanned, found) =>
        setProgress({ scanned, found }),
      );
      const plan = buildImportPlan(parsed, state, newestTs);
      importBatch(plan.batch);
      setResult({ tx: plan.txCount, accounts: plan.newAccountCount });
    } catch {
      setResult({ tx: 0, accounts: 0 });
    }
  };

  /**
   * iPhone takes a different road out of this screen. The Android path is a
   * permission dialog and a scan; the iPhone path is a Shortcut the user builds
   * in Apple's app, which is a whole product surface of its own. Dropping an
   * iPhone user into "Read my inbox" — a screen that on iOS cannot read an
   * inbox — was the single most misleading step in the app.
   *
   * The overlay is dismissed BEFORE the push. The navigator underneath is
   * already mounted (it renders hidden behind this screen), so the setup route
   * is there waiting; leaving the overlay up would just cover it.
   */
  const startIosSetup = () => {
    setOnboarded();
    router.push('/iphone-setup');
  };

  const points = isRelaySupported() ? IOS_POINTS : ANDROID_POINTS;

  if (!showOverlay) return <>{children}</>;

  return (
    <View style={styles.container}>
      <View style={styles.hidden}>{children}</View>
      <View style={[StyleSheet.absoluteFillObject, styles.root]}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {step === 'welcome' && (
            <Animated.View entering={FadeIn.duration(400)} style={styles.body}>
              <View style={styles.top}>
                <WafraMark size={44} color={night.primary} />
                <ThemedText style={styles.headline}>
                  Your bank already texts you. Wafra reads it.
                </ThemedText>
                <ThemedText style={styles.sub}>
                  {isRelaySupported()
                    ? 'Every ENBD, FAB, and du alert becomes a filed transaction. In AED, with no account to create.'
                    : 'Every ENBD, FAB, and du alert becomes a filed transaction. On device, in AED, with no account to create.'}
                </ThemedText>
              </View>

              <View style={styles.points}>
                {points.map(([icon, title, detail], i) => (
                  <View
                    key={title}
                    style={[styles.point, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth }]}>
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
                  label={
                    isSmsScanningAvailable()
                      ? 'Read my inbox'
                      : isRelaySupported()
                        ? 'Set up automatic tracking'
                        : 'Continue'
                  }
                  onPress={() => {
                    if (isSmsScanningAvailable()) return startScan();
                    if (isRelaySupported()) return startIosSetup();
                    setStep('choose');
                  }}
                  labelColor={night.onPrimary}
                  style={{ backgroundColor: night.primary }}
                />
                <Button
                  variant="ghost"
                  label="Start with sample data"
                  onPress={loadDemoData}
                  labelColor={night.text}
                  style={styles.ghost}
                />
              </View>
            </Animated.View>
          )}

          {step === 'scanning' && (
            <Animated.View entering={FadeIn.duration(300)} style={styles.body}>
              <View style={styles.top}>
                <WafraMark size={44} color={night.primary} />
                <ThemedText style={styles.headline}>
                  {result ? 'Your history is in.' : 'Reading your inbox.'}
                </ThemedText>
                <ThemedText style={styles.sub}>
                  {result
                    ? `${result.tx} entr${result.tx === 1 ? 'y' : 'ies'} filed${result.accounts > 0 ? ` · ${result.accounts} card${result.accounts === 1 ? '' : 's'} found` : ''}. Nothing left the phone.`
                    : `${progress.scanned} messages read · ${progress.found} matched.`}
                </ThemedText>
              </View>

              {result && (
                <View style={styles.actions}>
                  <Button
                    label="Open Wafra"
                    onPress={setOnboarded}
                    labelColor={night.onPrimary}
                    style={{ backgroundColor: night.primary }}
                  />
                </View>
              )}
            </Animated.View>
          )}

          {step === 'choose' && (
            <Animated.View entering={FadeInDown.duration(350)} style={styles.body}>
              <View style={styles.top}>
                <WafraMark size={44} color={night.primary} />
                <ThemedText style={styles.headline}>Start somewhere.</ThemedText>
                <ThemedText style={styles.sub}>
                  {Platform.OS === 'web'
                    ? 'Reading SMS works in the Android app. Pick a starting point:'
                    : isRelaySupported()
                      ? 'You can set up automatic tracking later from Wallet.'
                      : 'You can read your inbox later from Wallet.'}
                </ThemedText>
              </View>
              <View style={styles.actions}>
                <Button
                  label="Start with sample data"
                  onPress={loadDemoData}
                  labelColor={night.onPrimary}
                  style={{ backgroundColor: night.primary }}
                />
                <Button
                  variant="ghost"
                  label="Start empty"
                  onPress={setOnboarded}
                  labelColor={night.text}
                  style={styles.ghost}
                />
              </View>
            </Animated.View>
          )}
        </SafeAreaView>
      </View>
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
    backgroundColor: night.background,
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
  },
  body: {
    flex: 1,
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.four,
    // Left-aligned, not centred: this reads as a statement, not a poster.
    alignItems: 'stretch',
    justifyContent: 'space-between',
  },
  top: {
    paddingTop: Spacing.six,
    gap: Spacing.three,
  },
  headline: {
    fontFamily: Fonts.sansSemi,
    fontSize: 32,
    lineHeight: 37,
    letterSpacing: -1.12,
    color: night.text,
    maxWidth: 320,
  },
  sub: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: night.textSecondary,
  },
  points: {
    paddingVertical: Spacing.four,
  },
  point: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 2,
    paddingVertical: Spacing.three,
    borderTopColor: night.cardBorder,
  },
  pointIcon: {
    width: 30,
    alignItems: 'center',
  },
  pointText: {
    flex: 1,
    gap: 2,
  },
  pointTitle: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14.5,
    lineHeight: 19,
    color: night.text,
  },
  pointDetail: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    color: night.textTertiary,
  },
  actions: {
    gap: Spacing.two + 2,
  },
  ghost: {
    borderWidth: 1,
    borderColor: night.cardBorderStrong,
  },
});
