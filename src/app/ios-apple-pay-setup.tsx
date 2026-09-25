import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { WafraLiveCaptureStatus } from '../../modules/wafra-live-capture';
import { SetupHeader, SetupShell } from '@/components/onboarding/setup-shell';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { getIosCaptureNativeModule, subscribeIosCaptureStatusRefresh } from '@/lib/capture';
import { detailsWords } from '@/lib/details-copy';
import { formatCaptureReceipt } from '@/lib/ios-capture-health';
import { dispatchIosMessageSetup, loadIosMessageSetupProgress, progressForSource, type IosMessageSetupProgress } from '@/lib/ios-message-onboarding';
import {
  iosApplePayCheckUrl, iosApplePayCopy, iosSupportsApplePayAutomation,
  isBundledApplePayShortcutUri, resolveApplePaySetupState,
} from '@/lib/ios-apple-pay-setup';
import { useStore } from '@/lib/store';

/** A numbered step. The number is the order, not a completion claim; `done` comes from the real gates. */
function Step({ index, title, body, done, theme, children }: {
  index: number; title: string; body: string; done: boolean; theme: ReturnType<typeof useTheme>; children: React.ReactNode;
}) {
  return <View style={[styles.step, { borderColor: theme.cardBorder }]}>
    <View style={styles.stepHead}>
      <View style={[styles.stepBadge, { backgroundColor: done ? theme.primary : theme.backgroundSelected }]}>
        <ThemedText type="smallBold" style={{ color: done ? theme.onPrimary : theme.text }}>{done ? '✓' : String(index)}</ThemedText>
      </View>
      <View style={styles.stepCopy}>
        <ThemedText type="subtitle">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{body}</ThemedText>
      </View>
    </View>
    {children}
  </View>;
}

export default function IosApplePaySetup() {
  const language = useLanguage();
  const w = iosApplePayCopy(language);
  const d = detailsWords(language).applePay;
  const router = useRouter();
  const params = useLocalSearchParams<{ fromOnboarding?: string; shortcutResult?: string }>();
  const { state, setCaptureOptOut, getStateGeneration } = useStore();
  const onboarding = params.fromOnboarding === '1' || (state.hydrated === true && !state.onboarded);
  const theme = useTheme(onboarding ? 'dark' : undefined);
  const supported = Platform.OS === 'ios' && iosSupportsApplePayAutomation(Platform.Version);
  const [status, setStatus] = useState<WafraLiveCaptureStatus | null>(null);
  const [progress, setProgress] = useState<IosMessageSetupProgress | null>(null);
  const [available, setAvailable] = useState(false);
  const [bundled, setBundled] = useState(false);
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const epoch = useRef(0);
  const operation = useRef(false);
  const generation = getStateGeneration();
  // Apple Pay's own saved progress; another source's finished setup is untouched here.
  const flow = resolveApplePaySetupState(status, progress ? progressForSource(progress, 'apple-pay') : {});

  const refresh = useCallback(async () => {
    if (operation.current || !supported) return;
    const sequence = ++epoch.current;
    const ledger = getStateGeneration();
    const current = () => alive.current && sequence === epoch.current && ledger === getStateGeneration();
    try {
      const native = getIosCaptureNativeModule();
      if (!native || native.applePayCaptureSupported !== true) {
        if (current()) { setAvailable(false); setStatus(null); }
        return;
      }
      const [next, saved] = await Promise.all([native.getCaptureStatus(), loadIosMessageSetupProgress()]);
      if (current()) {
        setStatus(next); setProgress(saved); setAvailable(true);
        setBundled(typeof native.getApplePayShortcutURL === 'function');
      }
    } catch {
      if (current()) { setStatus(null); setAvailable(false); setError(w.error); }
    } finally { if (current()) setLoading(false); }
  }, [getStateGeneration, supported, w.error]);

  useEffect(() => {
    alive.current = true;
    setStatus(null); setProgress(null); setAvailable(false); setLoading(true);
    void refresh();
    const sequence = epoch;
    const listener = AppState.addEventListener('change', value => {
      if (value === 'active') void refresh(); else sequence.current++;
    });
    const unsubscribe = subscribeIosCaptureStatusRefresh(() => { void refresh(); });
    return () => { alive.current = false; sequence.current++; listener.remove(); unsubscribe(); };
  }, [refresh, generation]);

  const run = async (action: (current: () => boolean) => Promise<void>) => {
    if (operation.current || !supported) return;
    operation.current = true; epoch.current++; setBusy(true); setError(null);
    const ledger = getStateGeneration();
    const current = () => alive.current && ledger === getStateGeneration();
    try { await action(current); }
    catch { if (current()) setError(w.error); }
    finally {
      operation.current = false;
      if (alive.current) {
        setBusy(false);
        // Recover a refresh skipped during a sheet/Shortcuts return or data reset.
        void refresh();
      }
    }
  };
  const enable = () => void run(async current => {
    const native = getIosCaptureNativeModule();
    if (!native || native.applePayCaptureSupported !== true) { if (current()) setError(w.update); return; }
    const before = await native.getCaptureStatus();
    if (!current()) return;
    if (!before.entitled) { setError(w.inactive); return; }
    await setCaptureOptOut(false);
    if (!current()) return;
    await native.setCaptureEnabled(true);
  });
  const install = () => void run(async current => {
    const native = getIosCaptureNativeModule();
    if (!native?.getApplePayShortcutURL || native.applePayCaptureSupported !== true || !await Sharing.isAvailableAsync()) {
      if (current()) setError(w.missing);
      return;
    }
    if (!current()) return;
    const uri = await native.getApplePayShortcutURL();
    if (!current()) return;
    if (!isBundledApplePayShortcutUri(uri)) throw new Error('invalid_apple_pay_asset');
    await dispatchIosMessageSetup({ type: 'future-shortcut-install-started', source: 'apple-pay' });
    if (!current()) return;
    await Sharing.shareAsync(uri, { UTI: 'com.apple.shortcut' });
  });
  const confirmInstalled = () => void run(async () => {
    await dispatchIosMessageSetup({ type: 'future-shortcut-confirmed', source: 'apple-pay' });
  });
  const open = () => void run(async current => {
    try { await Linking.openURL('shortcuts://'); }
    catch { if (current()) setError(w.missing); }
  });
  const runCheck = () => void run(async current => {
    router.setParams({ shortcutResult: undefined });
    try { await Linking.openURL(iosApplePayCheckUrl(onboarding)); }
    catch { if (current()) setError(w.missing); }
  });
  const back = () => router.dismissTo({ pathname: '/ios-setup', params: {
    section: 'future', applePayReturn: String(Date.now()), ...(onboarding ? { fromOnboarding: '1' } : {}),
  } });
  const confirmAutomation = () => void run(async current => {
    const native = getIosCaptureNativeModule();
    if (!native || native.applePayCaptureSupported !== true) return;
    const [next, saved] = await Promise.all([native.getCaptureStatus(), loadIosMessageSetupProgress()]);
    if (!current()) return;
    setStatus(next); setProgress(saved);
    if (!resolveApplePaySetupState(next, progressForSource(saved, 'apple-pay')).canConfirm) { setError(w.confirmNeeded); return; }
    // Only now does Apple Pay become the recorded source; message progress is parked.
    await dispatchIosMessageSetup({ type: 'future-automation-confirmed', source: 'apple-pay', at: Date.now() });
    if (current()) back();
  });

  return <SetupShell onboarding={onboarding}>
    <Stack.Screen options={{ gestureEnabled: !busy }} />
    <SafeAreaView style={{ flex: 1, backgroundColor: onboarding ? 'transparent' : theme.background }} edges={['top', 'bottom']}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ width: '100%', maxWidth: MaxContentWidth,
        alignSelf: 'center', padding: ScreenPadding, gap: Spacing.three }}>
        <SetupHeader onboarding={onboarding} title={w.title} subtitle={w.subtitle}
          back={{ label: w.back, onPress: back, disabled: busy }} />
        {!supported ? <ThemedText>{w.unsupported}</ThemedText> : !available ?
          <ThemedText accessibilityLiveRegion="polite">{loading ? w.checking : error ?? w.update}</ThemedText> : <>
          <ThemedText>{w.intro}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{w.scope}</ThemedText>
          {!status?.enabled && <Button label={w.enable} onPress={enable} disabled={busy} wrapLabel />}
          {status?.enabled && !status.entitled && <ThemedText accessibilityRole="alert">{w.inactive}</ThemedText>}
          {/* Marked as an example: no card identity is captured, and a real
              purchase goes to Review for the person to add. */}
          <View testID="apple-pay-example" accessible accessibilityLabel={d.exampleA11y}
            style={[styles.example, { borderColor: theme.cardBorder }]}>
            <ThemedText type="meta" themeColor="textSecondary">{d.example}</ThemedText>
            <View style={styles.exampleRow}>
              <View style={[styles.exampleTile, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold">{d.exampleMerchant.slice(0, 1)}</ThemedText>
              </View>
              <ThemedText type="smallBold" style={styles.stepCopy}>{d.exampleMerchant}</ThemedText>
              <ThemedText type="meta" themeColor="textSecondary">{d.exampleDestination}</ThemedText>
            </View>
          </View>
          {flow.active && <>
            <Step index={1} title={d.step1} body={d.step1Body} done={flow.installed && flow.checked} theme={theme}>
              <View testID="apple-pay-step-install" style={{ gap: Spacing.two }}>
                {bundled && !manual ? <>
                  <ThemedText type="small">{w.addHelp}</ThemedText>
                  <Button label={w.add} onPress={install} disabled={busy} wrapLabel />
                  <Button label={w.manual} variant="ghost" onPress={() => setManual(true)} disabled={busy} wrapLabel />
                </> : w.manualHelp.map(step => <ThemedText key={step} type="small">{step}</ThemedText>)}
                <ThemedText type="small" accessibilityLiveRegion="polite">{flow.installed ? w.installed : w.notInstalled}</ThemedText>
                <Button label={w.installedButton} variant="outline" onPress={confirmInstalled} disabled={busy || flow.installed} wrapLabel />
              </View>
              <View testID="apple-pay-step-check" style={{ gap: Spacing.two }}>
                <ThemedText type="small">{w.checkHelp}</ThemedText>
                {bundled && !manual && <Button label={w.runCheck} onPress={runCheck} disabled={busy || !flow.installed} wrapLabel />}
                <ThemedText type="small" accessibilityLiveRegion="polite">{flow.checked ? w.checked : w.waitingCheck}</ThemedText>
                {params.shortcutResult === 'error' && <ThemedText accessibilityRole="alert">{w.failed}</ThemedText>}
              </View>
            </Step>
            <Step index={2} title={d.step2} body={d.step2Body} done={flow.confirmed} theme={theme}>
              <View testID="apple-pay-step-automation" style={{ gap: Spacing.two }}>
                {(!manual && bundled) && w.automationSteps.map(step => <ThemedText key={step} type="small">{step}</ThemedText>)}
                <Button label={w.open} variant="outline" onPress={open} disabled={busy} wrapLabel />
                {flow.confirmed && <ThemedText type="small">{w.confirmed}</ThemedText>}
                <Button label={w.confirm} onPress={confirmAutomation} disabled={busy || !flow.canConfirm} wrapLabel />
              </View>
            </Step>
            <ThemedText type="meta" themeColor="textSecondary">{d.duplicate}</ThemedText>
          </>}
          <View accessibilityLiveRegion="polite" style={{ gap: Spacing.two }}>
            <ThemedText type="subtitle">{w.actualTitle}</ThemedText>
            <ThemedText type="small">{flow.received ? w.received : w.waiting}</ThemedText>
            {flow.incomplete && <ThemedText accessibilityRole="alert">{w.incomplete}</ThemedText>}
            {flow.pending > 0 && <ThemedText type="small">{w.pending}: {flow.pending}</ThemedText>}
            {flow.received && <ThemedText type="meta" themeColor="textSecondary">{w.last}: {formatCaptureReceipt(status?.lastApplePayReceivedAt ?? null, language)}</ThemedText>}
            {onboarding ? <ThemedText type="small" themeColor="textSecondary">{w.reviewOnboarding}</ThemedText> :
              <Button label={w.review} variant="outline" onPress={() => router.push('/review-alerts')} disabled={busy} wrapLabel />}
          </View>
          {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
          <ThemedText type="meta" themeColor="textSecondary">{w.privacy}</ThemedText>
        </>}
        {supported && <Button label={w.refresh} variant="ghost" onPress={() => { setError(null); void refresh(); }} disabled={busy} wrapLabel />}
      </ScrollView>
    </SafeAreaView>
  </SetupShell>;
}

const styles = StyleSheet.create({
  example: { gap: 8, padding: 12, borderWidth: 1, borderRadius: 12, borderStyle: 'dashed' },
  exampleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  exampleTile: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  step: { gap: 12, padding: 14, borderWidth: 1, borderRadius: 14 },
  stepHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepCopy: { flex: 1, minWidth: 0, gap: 2 },
});
