import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import type { WafraLiveCaptureStatus } from '../../modules/wafra-live-capture';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { EButton } from '@/components/ui/band/e-button';
import { SetupStep, SetupResult } from '@/components/ios-message-setup/setup-step';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useBand } from '@/hooks/use-band';
import { iosSetupBandCopy } from '@/lib/ios-setup-band-copy';
import { getIosCaptureNativeModule, subscribeIosCaptureStatusRefresh } from '@/lib/capture';
import { REVIEW_ALERT_CAP, isCurrencyConflictReview, isIosNotificationReview } from '@/lib/alert-review-tray';
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
  const band = useBand('flow');
  const design = iosSetupBandCopy(language);
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

  return <View testID={onboarding ? 'onboarding-setup-shell' : 'settings-setup-shell'} style={{ flex: 1 }}>
  <BandScaffold band="flow" testID="ios-notification-setup"
    nav={{ back: () => { if (!busy) back(); }, backDisabled: busy }}
    bandContent={<View style={styles.bandContent}>
      <ThemedText accessibilityRole="header" style={[styles.bandTitle, { color: band.onBand }]}>{w.title}</ThemedText>
      <ThemedText type="small" style={{ color: band.onBandSecondary }}>{w.subtitle}</ThemedText>
      {supported && available && received && <View style={[styles.receipt, { backgroundColor: band.tile }]}>
        <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{w.last}</ThemedText>
        <ThemedText type="smallBold" style={{ color: band.onBand }}>
          {formatCaptureReceipt(status?.lastNotificationReceivedAt ?? null, language)}
        </ThemedText>
      </View>}
    </View>}
    scrollProps={{ showsVerticalScrollIndicator: false }}>
    <Stack.Screen options={{ headerShown: false, gestureEnabled: !busy }} />
    <View style={styles.sheet}>
      {!supported ? <SetupResult palette={band} tone="info" title={w.unsupported} /> : !available ?
        <ThemedText accessibilityLiveRegion="polite" style={{ color: band.text }}>{loading ? w.checking : error ?? w.update}</ThemedText> : <>
        <ThemedText style={{ color: band.text }}>{w.intro}</ThemedText>
        <ThemedText type="small" style={{ color: band.textSecondary }}>{w.noBankQuestion}</ThemedText>
        {(state.reviewTray?.pending.filter((item) => isIosNotificationReview(item) && !isCurrencyConflictReview(item)).length ?? 0) >= REVIEW_ALERT_CAP && <>
          <ThemedText accessibilityRole="alert" style={{ color: band.statusNear }}>{onboarding ? w.reviewFullOnboarding : w.reviewFull}</ThemedText>
          {!onboarding && <EButton palette={band} label={w.reviewAction} onPress={() => router.push('/review-alerts')} disabled={busy} />}
        </>}
        {!status?.enabled && <EButton palette={band} label={w.enable} onPress={enable} disabled={busy} />}
        {status?.enabled && !status.entitled && <ThemedText accessibilityRole="alert" style={{ color: band.statusOver }}>{w.inactive}</ThemedText>}
        {status?.enabled && status.entitled && <>
          <SetupStep palette={band} testID="notification-shortcut-step" badge="1" title={design.shortcut}
            result={{ tone: checked ? 'pass' : 'info', title: checked ? w.checked : bundled && !manual ? w.waitingBundleCheck : w.waitingCheck }}>
            {bundled && !manual ? <>
              <ThemedText type="small" style={{ color: band.text }}>{w.bundle1}</ThemedText>
              <EButton palette={band} label={w.install} onPress={install} disabled={busy} />
              <ThemedText type="small" style={{ color: band.text }}>{w.bundle2}</ThemedText>
              <EButton palette={band} label={w.runCheck} variant="secondary" onPress={runCheck} disabled={busy} />
              <EButton palette={band} label={w.manual} variant="quiet" onPress={() => setManual(true)} disabled={busy} />
            </> : <>
              {[w.step1, w.step2].map(step => <ThemedText key={step} type="small" style={{ color: band.text }}>{step}</ThemedText>)}
              <EButton palette={band} label={copied ? w.copied : w.copy} variant="secondary" onPress={copy} disabled={busy} />
            </>}
          </SetupStep>
          <SetupStep palette={band} testID="notification-automation-step" badge="2" title={design.automation}>
            {(bundled && !manual ? [w.bundle3] : [w.step3, w.step4, w.step5]).map(step =>
              <ThemedText key={step} type="small" style={{ color: band.text }}>{step}</ThemedText>)}
            <EButton palette={band} label={w.open} variant="secondary" onPress={open} disabled={busy} />
            {confirmed && <ThemedText type="small" style={{ color: band.statusOk }}>{w.confirmed}</ThemedText>}
            <EButton palette={band} label={w.confirm} onPress={confirm} disabled={busy || !checked} />
          </SetupStep>
          <View testID="notification-delivery" accessibilityLiveRegion="polite" style={[styles.delivery, { borderColor: band.rule }]}>
            <ThemedText type="smallBold" accessibilityRole="header" style={{ color: band.text }}>{design.delivery}</ThemedText>
            <ThemedText type="small" style={{ color: band.textSecondary }}>{received ? w.received : w.waitingNotification}</ThemedText>
          </View>
        </>}
        {params.shortcutResult === 'error' && <ThemedText accessibilityRole="alert" style={{ color: band.statusOver }}>{w.checkFailed}</ThemedText>}
        {error && <ThemedText accessibilityRole="alert" style={{ color: band.statusOver }}>{error}</ThemedText>}
        <ThemedText type="meta" style={{ color: band.textSecondary }}>{w.privacy}</ThemedText>
      </>}
      {supported && <EButton palette={band} label={w.refresh} variant="quiet" onPress={() => void refresh()} disabled={busy} />}
    </View>
  </BandScaffold>
  </View>;
}

const styles = StyleSheet.create({
  bandContent: { gap: 12, paddingTop: 4, paddingBottom: 8 },
  bandTitle: { fontFamily: Fonts.sansSemi, fontSize: 36, lineHeight: 42, letterSpacing: -1.2 },
  receipt: { padding: 14, borderRadius: 16, gap: 4, alignSelf: 'stretch' },
  sheet: { gap: 14 },
  delivery: { paddingVertical: 14, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
