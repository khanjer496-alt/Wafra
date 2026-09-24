import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { WafraLiveCaptureStatus } from '../../modules/wafra-live-capture';
import { SetupHeader, SetupShell } from '@/components/onboarding/setup-shell';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { getIosCaptureNativeModule, subscribeIosCaptureStatusRefresh } from '@/lib/capture';
import { REVIEW_ALERT_CAP, isIosNotificationReview } from '@/lib/alert-review-tray';
import { formatCaptureReceipt, isCaptureTimestamp } from '@/lib/ios-capture-health';
import { iosSupportsNotificationAutomation, resolveIosNotificationReadiness } from '@/lib/ios-capture-setup';
import { dispatchIosMessageSetup, loadIosMessageSetupProgress, progressForSource } from '@/lib/ios-message-onboarding';
import { IOS_NOTIFICATION_SETUP_TEXT, iosNotificationCopy, iosNotificationCheckUrl } from '@/lib/ios-notification-copy';
import { useStore } from '@/lib/store';

export default function IosNotificationSetup() {
  const language = useLanguage();
  const w = iosNotificationCopy(language);
  const router = useRouter();
  const params = useLocalSearchParams<{ fromOnboarding?: string; shortcutResult?: string }>();
  const { state, setCaptureOptOut, getStateGeneration } = useStore();
  const onboarding = params.fromOnboarding === '1' || (state.hydrated === true && !state.onboarded);
  const theme = useTheme(onboarding ? 'dark' : undefined);
  const supported = Platform.OS === 'ios' && iosSupportsNotificationAutomation(Platform.Version);
  const [status, setStatus] = useState<WafraLiveCaptureStatus | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bundled, setBundled] = useState(false);
  const [manual, setManual] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  const epoch = useRef(0);
  const operation = useRef(false);
  const generation = getStateGeneration();

  const refresh = useCallback(async () => {
    if (operation.current) return;
    const sequence = ++epoch.current, ledger = getStateGeneration();
    const current = () => alive.current && sequence === epoch.current && ledger === getStateGeneration();
    if (!supported) return;
    try {
      const native = getIosCaptureNativeModule();
      if (!native || native.notificationCaptureSupported !== true) {
        if (current()) { setAvailable(false); setStatus(null); }
        return;
      }
      const [next, progress] = await Promise.all([native.getCaptureStatus(), loadIosMessageSetupProgress()]);
      if (current()) {
        setAvailable(true); setStatus(next); setError(null);
        setBundled(typeof native.getNotificationShortcutURL === 'function');
        setConfirmed(progressForSource(progress, 'notification').futureAutomationConfirmed);
      }
    } catch { if (current()) { setStatus(null); setAvailable(false); setError(w.error); } }
    finally { if (current()) setLoading(false); }
  }, [getStateGeneration, supported, w.error]);

  useEffect(() => {
    alive.current = true; void refresh();
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
    try { await action(current); } catch { if (current()) setError(w.error); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  };
  const enable = () => void run(async current => {
    const native = getIosCaptureNativeModule();
    if (!native || native.notificationCaptureSupported !== true) { if (current()) setError(w.update); return; }
    const before = await native.getCaptureStatus();
    if (!current()) return;
    if (!before.entitled) { setError(w.inactive); return; }
    await setCaptureOptOut(false);
    if (!current()) return;
    await native.setCaptureEnabled(true);
    if (!current()) return;
    const next = await native.getCaptureStatus();
    if (current()) { setStatus(next); setAvailable(true); }
  });
  const confirm = () => void run(async current => {
    const native = getIosCaptureNativeModule();
    if (!native || native.notificationCaptureSupported !== true) return;
    const next = await native.getCaptureStatus();
    if (!current()) return;
    setStatus(next);
    if (resolveIosNotificationReadiness(next) === 'not-added') { setError(w.waitingCheck); return; }
    // Only a confirmed automation switches the recorded source; the previous
    // source's progress is parked, not erased.
    await dispatchIosMessageSetup({ type: 'future-automation-confirmed', source: 'notification', at: Date.now() });
    if (current()) { setConfirmed(true); back(); }
  });
  const open = () => void run(async current => {
    try { await Linking.openURL('shortcuts://'); }
    catch { if (current()) setError(w.missing); }
  });
  const copy = () => void run(async current => {
    await Clipboard.setStringAsync(IOS_NOTIFICATION_SETUP_TEXT);
    if (current()) setCopied(true);
  });
  const install = () => void run(async current => {
    const native = getIosCaptureNativeModule();
    if (!native?.getNotificationShortcutURL || !await Sharing.isAvailableAsync()) { if (current()) setError(w.missing); return; }
    const uri = await native.getNotificationShortcutURL();
    if (!current()) return;
    // The native API returns one fixed bundled asset, never a queue file.
    if (!uri.startsWith('file:') || !uri.endsWith('.shortcut')) throw new Error('invalid_shortcut_asset');
    await Sharing.shareAsync(uri);
  });
  const runCheck = () => void run(async current => {
    router.setParams({ shortcutResult: undefined });
    try { await Linking.openURL(iosNotificationCheckUrl(onboarding)); }
    catch { if (current()) setError(w.missing); }
  });
  const back = () => router.dismissTo({ pathname: '/ios-setup', params: {
    section: 'future', notificationReturn: String(Date.now()), ...(onboarding ? { fromOnboarding: '1' } : {}),
  } });
  const checked = status !== null && resolveIosNotificationReadiness(status) !== 'not-added';
  const received = status !== null && isCaptureTimestamp(status.firstNotificationReceivedAt);

  return <SetupShell onboarding={onboarding}>
    <Stack.Screen options={{ gestureEnabled: !busy }} />
    <SafeAreaView style={{ flex: 1, backgroundColor: onboarding ? 'transparent' : theme.background }} edges={['top', 'bottom']}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ width: '100%', maxWidth: MaxContentWidth,
        alignSelf: 'center', padding: ScreenPadding, gap: Spacing.three }}>
        <SetupHeader onboarding={onboarding} title={w.title} subtitle={w.subtitle}
          back={{ label: w.back, onPress: back, disabled: busy }} />
        {!supported ? <ThemedText>{w.unsupported}</ThemedText> : !available ? <ThemedText>{loading ? w.checking : error ?? w.update}</ThemedText> : <>
          <ThemedText>{w.intro}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{w.noBankQuestion}</ThemedText>
          {(state.reviewTray?.pending.filter(isIosNotificationReview).length ?? 0) >= REVIEW_ALERT_CAP && <>
            <ThemedText accessibilityRole="alert">{onboarding ? w.reviewFullOnboarding : w.reviewFull}</ThemedText>
            {!onboarding && <Button label={w.reviewAction} onPress={() => router.push('/review-alerts')} disabled={busy} wrapLabel />}
          </>}
          {!status?.enabled && <Button label={w.enable} onPress={enable} disabled={busy} wrapLabel />}
          {status?.enabled && !status.entitled && <ThemedText accessibilityRole="alert">{w.inactive}</ThemedText>}
          {status?.enabled && status.entitled && <>
            {bundled && !manual ? <>
              <View style={{ gap: Spacing.two }}>
                {[w.bundle1, w.bundle2, w.bundle3].map(step => <ThemedText key={step} type="small">{step}</ThemedText>)}
              </View>
              <Button label={w.install} onPress={install} disabled={busy} wrapLabel />
              <Button label={w.runCheck} variant="outline" onPress={runCheck} disabled={busy} wrapLabel />
              <Button label={w.manual} variant="ghost" onPress={() => setManual(true)} disabled={busy} wrapLabel />
            </> : <>
              <View style={{ gap: Spacing.two }}>
                {[w.step1, w.step2, w.step3, w.step4, w.step5].map(step => <ThemedText key={step} type="small">{step}</ThemedText>)}
              </View>
              <Button label={copied ? w.copied : w.copy} variant="outline" onPress={copy} disabled={busy} wrapLabel />
            </>}
            <Button label={w.open} onPress={open} disabled={busy} wrapLabel />
            <View accessibilityLiveRegion="polite" style={{ gap: Spacing.two }}>
              <ThemedText type="small">{checked ? w.checked : bundled && !manual ? w.waitingBundleCheck : w.waitingCheck}</ThemedText>
              <ThemedText type="small">{received ? w.received : w.waitingNotification}</ThemedText>
              {received && <ThemedText type="meta" themeColor="textSecondary">{w.last}: {formatCaptureReceipt(status.lastNotificationReceivedAt ?? null, language)}</ThemedText>}
              {confirmed && <ThemedText type="small">{w.confirmed}</ThemedText>}
            </View>
            <Button label={w.confirm} onPress={confirm} disabled={busy || !checked} wrapLabel />
          </>}
          {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
          {params.shortcutResult === 'error' && <ThemedText accessibilityRole="alert">{w.checkFailed}</ThemedText>}
          <ThemedText type="meta" themeColor="textSecondary">{w.privacy}</ThemedText>
        </>}
        {supported && <Button label={w.refresh} variant="ghost" onPress={() => void refresh()} disabled={busy} wrapLabel />}
      </ScrollView>
    </SafeAreaView>
  </SetupShell>;
}
