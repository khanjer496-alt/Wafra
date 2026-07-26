import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WafraLogo } from '@/components/wafra-logo';
import { Icon } from '@/components/ui/icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';
import {
  buildImportPlan,
  isSmsScanningAvailable,
  requestSmsPermission,
  scanInbox,
} from '@/lib/auto-import';
import { requestNotificationPermission } from '@/lib/notifications';
import { useStore } from '@/lib/store';

type Step = 'welcome' | 'permissions' | 'scanning' | 'choose';

/**
 * First-run flow: welcome → permissions → full-history scan (or sample data).
 * Rendered as an opaque overlay ABOVE the app (never unmounting the router's
 * Stack — swapping the navigator out corrupts expo-router's route state).
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const { state, importBatch, setOnboarded, loadDemoData } = useStore();
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

  const finish = () => setOnboarded();

  if (!showOverlay) return <>{children}</>;

  return (
    <View style={styles.container}>
      <View style={styles.hidden}>{children}</View>
      <ThemedView style={[StyleSheet.absoluteFillObject, styles.root]}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {step === 'welcome' && (
          <Animated.View entering={FadeIn.duration(400)} style={styles.body}>
            <View style={styles.hero}>
              <WafraLogo markSize={64} />
              <ThemedText type="heading" style={styles.center}>
                Know where it goes. Watch it grow.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                Your money in AED, tracked automatically. Everything stays on this phone.
              </ThemedText>
            </View>
            <View style={styles.points}>
              {(
                [
                  ['mail', 'Reads bank SMS to log spending, cards, and salary by itself'],
                  ['calendar', 'Tracks bills, credit card dues, and subscriptions with reminders'],
                  ['chart', 'Explains where your money goes in plain language'],
                ] as [import('@/components/ui/icon').IconName, string][]
              ).map(([icon, text]) => (
                <View key={text} style={styles.pointRow}>
                  <View style={[styles.pointIcon, { backgroundColor: `${theme.primary}1a` }]}>
                    <Icon name={icon} size={17} color={theme.primary} strokeWidth={1.8} />
                  </View>
                  <ThemedText type="small" style={styles.pointText}>
                    {text}
                  </ThemedText>
                </View>
              ))}
            </View>
            <Pressable
              onPress={() => setStep(isSmsScanningAvailable() ? 'permissions' : 'choose')}
              style={[styles.cta, { backgroundColor: theme.primary }]}>
              <ThemedText type="smallBold" style={{ color: theme.onPrimary, fontSize: 16 }}>
                {t('getStarted')}
              </ThemedText>
            </Pressable>
          </Animated.View>
        )}

        {step === 'permissions' && (
          <Animated.View entering={FadeInDown.duration(350)} style={styles.body}>
            <View style={styles.hero}>
              <View style={[styles.bigIcon, { backgroundColor: `${theme.primary}1a` }]}>
                <Icon name="lock" size={30} color={theme.primary} strokeWidth={1.7} />
              </View>
              <ThemedText type="subtitle" style={styles.center}>
                Two permissions, zero cloud
              </ThemedText>
              <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
                SMS access lets Wafra read bank alerts and build your full transaction history.
                Notifications remind you before bills and card payments are due. Nothing ever
                leaves your phone: there is no server.
              </ThemedText>
            </View>
            <View style={styles.stack}>
              <Pressable onPress={startScan} style={[styles.cta, { backgroundColor: theme.primary }]}>
                <ThemedText type="smallBold" style={{ color: theme.onPrimary, fontSize: 16 }}>
                  Allow and scan my inbox
                </ThemedText>
              </Pressable>
              <Pressable onPress={() => setStep('choose')} style={styles.ghostBtn}>
                <ThemedText type="small" themeColor="textSecondary">
                  Skip for now
                </ThemedText>
              </Pressable>
            </View>
          </Animated.View>
        )}

        {step === 'scanning' && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.body}>
            <View style={styles.hero}>
              <View style={[styles.bigIcon, { backgroundColor: `${theme.primary}1a` }]}>
                <Icon name={result ? 'check' : 'repeat'} size={30} color={theme.primary} strokeWidth={1.7} />
              </View>
              <ThemedText type="subtitle" style={styles.center}>
                {result ? 'All set' : 'Reading your history'}
              </ThemedText>
              <ThemedText type="default" themeColor="textSecondary" style={styles.center} tabular>
                {result
                  ? `${result.tx} transactions imported${result.accounts > 0 ? ` · ${result.accounts} cards discovered` : ''}`
                  : `${progress.scanned} messages scanned · ${progress.found} matches`}
              </ThemedText>
            </View>
            {result && (
              <Pressable onPress={finish} style={[styles.cta, { backgroundColor: theme.primary }]}>
                <Icon name="check" size={18} color={theme.onPrimary} strokeWidth={2.6} />
                <ThemedText type="smallBold" style={{ color: theme.onPrimary, fontSize: 16 }}>
                  Open Wafra
                </ThemedText>
              </Pressable>
            )}
          </Animated.View>
        )}

        {step === 'choose' && (
          <Animated.View entering={FadeInDown.duration(350)} style={styles.body}>
            <View style={styles.hero}>
              <View style={[styles.bigIcon, { backgroundColor: `${theme.primary}1a` }]}>
                <Icon name="target" size={30} color={theme.primary} strokeWidth={1.7} />
              </View>
              <ThemedText type="subtitle" style={styles.center}>
                How do you want to start?
              </ThemedText>
              <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
                {Platform.OS === 'web'
                  ? 'SMS scanning works on the Android app. Pick a starting point:'
                  : 'You can scan your inbox later from Wallet.'}
              </ThemedText>
            </View>
            <View style={styles.stack}>
              <Pressable
                onPress={() => {
                  loadDemoData();
                }}
                style={[styles.cta, { backgroundColor: theme.primary }]}>
                <ThemedText type="smallBold" style={{ color: theme.onPrimary, fontSize: 16 }}>
                  {t('exploreSample')}
                </ThemedText>
              </Pressable>
              <Pressable onPress={finish} style={styles.ghostBtn}>
                <ThemedText type="small" themeColor="textSecondary">
                  Start empty
                </ThemedText>
              </Pressable>
            </View>
          </Animated.View>
        )}
      </SafeAreaView>
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
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
  },
  body: {
    flex: 1,
    padding: Spacing.four,
    justifyContent: 'space-between',
    paddingBottom: Spacing.five,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  bigIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    textAlign: 'center',
  },
  points: {
    gap: Spacing.three,
    paddingVertical: Spacing.four,
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  pointIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointText: {
    flex: 1,
  },
  stack: {
    gap: Spacing.two,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.md + 2,
    paddingVertical: Spacing.three + 2,
  },
  ghostBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.two + 2,
  },
});
