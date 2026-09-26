import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import type { WafraLiveCaptureStatus } from '../../modules/wafra-live-capture';
import { ThemedText } from '@/components/themed-text';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { EButton } from '@/components/ui/band/e-button';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { getIosCaptureNativeModule, subscribeIosCaptureStatusRefresh } from '@/lib/capture';
import { captureBandCopy } from '@/lib/capture-band-copy';
import { detailsWords } from '@/lib/details-copy';
import { formatCaptureReceipt } from '@/lib/ios-capture-health';
import { dispatchIosMessageSetup, loadIosMessageSetupProgress, progressForSource, type IosMessageSetupProgress } from '@/lib/ios-message-onboarding';
import {
  iosApplePayCheckUrl, iosApplePayCopy, iosSupportsApplePayAutomation,
  isBundledApplePayShortcutUri, resolveApplePaySetupState,
} from '@/lib/ios-apple-pay-setup';
import { useStore } from '@/lib/store';

/**
 * A numbered step on the sheet. The number is the order, not a completion
 * claim: the badge fills (with a tick) only when `done`, which comes from the
 * real gates.
 */
function Step({ index, title, body, done, palette, spoken, children, last = false }: {
  index: number; title: string; body: string; done: boolean; palette: BandPalette; spoken: string;
  children: React.ReactNode; last?: boolean;
}) {
  return <View style={[styles.step, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.rule }]}>
    <View style={styles.stepHead}>
      <View accessible accessibilityRole="text" accessibilityLabel={spoken}
        style={[styles.stepBadge, done ? { backgroundColor: palette.fill, borderColor: palette.fill } : { borderColor: palette.text }]}>
        <ThemedText type="smallBold" style={[styles.stepNumber, { color: done ? palette.onFill : palette.text }]}>{done ? '\u2713' : String(index)}</ThemedText>
      </View>
      <View style={styles.stepCopy}>
        <ThemedText type="smallBold" accessibilityRole="header" style={[styles.stepTitle, { color: palette.text }]}>{title}</ThemedText>
        <ThemedText type="meta" style={{ color: palette.textSecondary }}>{body}</ThemedText>
      </View>
    </View>
    {children}
  </View>;
}

export default function IosApplePaySetup() {
  const language = useLanguage();
  const w = iosApplePayCopy(language);
  const d = detailsWords(language).applePay;
  const words = captureBandCopy(language);
  const band = useBand('home');
  const largeText = useLargeTextLayout();
  const router = useRouter();
  const params = useLocalSearchParams<{ fromOnboarding?: string; shortcutResult?: string }>();
  const { state, setCaptureOptOut, getStateGeneration } = useStore();
  const onboarding = params.fromOnboarding === '1' || (state.hydrated === true && !state.onboarded);
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

  const ready = supported && available;
  const muted = { color: band.textSecondary };
  const bandContent = <View style={styles.bandBlock}>
    <ThemedText accessibilityRole="header" style={[styles.bandTitle, { color: band.onBand }]}>{w.title}</ThemedText>
    {ready ? <ThemedText type="default" style={{ color: band.onBandSecondary }}>{w.intro}</ThemedText> : null}
    {/* Marked as an example: no card identity is captured, and a real
        purchase goes to Review for the person to add. */}
    {ready ? <View testID="apple-pay-example" accessible accessibilityLabel={d.exampleA11y}
      style={[styles.example, largeText && styles.exampleStacked, { backgroundColor: band.tile }]}>
      <View style={[styles.exampleBadge, { borderColor: band.onBandSecondary }]}>
        <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{d.example}</ThemedText>
      </View>
      <View style={styles.exampleRow}>
        <View style={[styles.exampleTile, { backgroundColor: band.bandRule }]}>
          <ThemedText type="smallBold" style={{ color: band.onBand }}>{d.exampleMerchant.slice(0, 1)}</ThemedText>
        </View>
        <View style={styles.stepCopy}>
          <ThemedText type="smallBold" style={{ color: band.onBand }}>{d.exampleMerchant}</ThemedText>
          <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{d.exampleDestination}</ThemedText>
        </View>
      </View>
    </View> : null}
  </View>;

  return <BandScaffold band="home" testID="apple-pay-setup"
    nav={{ back: () => { if (!busy) back(); } }}
    bandContent={bandContent}
    scrollProps={{ showsVerticalScrollIndicator: false }}>
    <Stack.Screen options={{ gestureEnabled: !busy }} />
    <View style={styles.sheet}>
      {!supported ? <ThemedText style={{ color: band.text }}>{w.unsupported}</ThemedText> : !available ?
        <ThemedText accessibilityLiveRegion="polite" style={{ color: band.text }}>{loading ? w.checking : error ?? w.update}</ThemedText> : <>
        {!status?.enabled && <EButton testID="apple-pay-enable" palette={band} label={w.enable} onPress={enable} disabled={busy} />}
        {status?.enabled && !status.entitled && <ThemedText accessibilityRole="alert" style={{ color: band.statusOver }}>{w.inactive}</ThemedText>}
        {flow.active && <>
          <Step index={1} title={d.step1} body={d.step1Body} done={flow.installed && flow.checked} palette={band}
            spoken={words.step(1, flow.installed && flow.checked)}>
            <View testID="apple-pay-step-install" style={styles.stepBody}>
              {bundled && !manual ? <>
                <ThemedText type="small" style={{ color: band.text }}>{w.addHelp}</ThemedText>
                <EButton palette={band} label={w.add} onPress={install} disabled={busy} />
                <EButton palette={band} variant="quiet" label={w.manual} onPress={() => setManual(true)} disabled={busy} />
              </> : w.manualHelp.map(step => <ThemedText key={step} type="small" style={{ color: band.text }}>{step}</ThemedText>)}
              <ThemedText type="small" accessibilityLiveRegion="polite"
                style={{ color: flow.installed ? band.statusOk : band.textSecondary }}>{flow.installed ? w.installed : w.notInstalled}</ThemedText>
              <EButton palette={band} variant="secondary" label={w.installedButton} onPress={confirmInstalled} disabled={busy || flow.installed} />
            </View>
            <View testID="apple-pay-step-check" style={styles.stepBody}>
              <ThemedText type="small" style={{ color: band.text }}>{w.checkHelp}</ThemedText>
              {bundled && !manual && <EButton palette={band} label={w.runCheck} onPress={runCheck} disabled={busy || !flow.installed} />}
              <ThemedText type="small" accessibilityLiveRegion="polite"
                style={{ color: flow.checked ? band.statusOk : band.textSecondary }}>{flow.checked ? w.checked : w.waitingCheck}</ThemedText>
              {params.shortcutResult === 'error' && <ThemedText accessibilityRole="alert" style={{ color: band.statusOver }}>{w.failed}</ThemedText>}
            </View>
          </Step>
          <Step index={2} title={d.step2} body={d.step2Body} done={flow.confirmed} palette={band}
            spoken={words.step(2, flow.confirmed)} last>
            <View testID="apple-pay-step-automation" style={styles.stepBody}>
              {(!manual && bundled) && w.automationSteps.map(step => <ThemedText key={step} type="small" style={{ color: band.text }}>{step}</ThemedText>)}
              <EButton palette={band} variant="secondary" label={w.open} onPress={open} disabled={busy} />
              {flow.confirmed && <ThemedText type="small" style={{ color: band.statusOk }}>{w.confirmed}</ThemedText>}
              <EButton testID="apple-pay-confirm" palette={band} label={w.confirm} onPress={confirmAutomation} disabled={busy || !flow.canConfirm} />
            </View>
          </Step>
          <ThemedText type="meta" style={muted}>{d.duplicate}</ThemedText>
        </>}
        <View testID="apple-pay-delivery" accessibilityLiveRegion="polite" style={styles.delivery}>
          <ThemedText type="smallBold" accessibilityRole="header" style={[styles.stepTitle, { color: band.text }]}>{w.actualTitle}</ThemedText>
          <ThemedText type="small" style={{ color: band.text }}>{flow.received ? w.received : w.waiting}</ThemedText>
          {flow.incomplete && <ThemedText accessibilityRole="alert" style={{ color: band.statusOver }}>{w.incomplete}</ThemedText>}
          {flow.pending > 0 && <ThemedText type="small" style={{ color: band.text }}>{w.pending}: {flow.pending}</ThemedText>}
          {flow.received && <ThemedText type="meta" style={muted}>{w.last}: {formatCaptureReceipt(status?.lastApplePayReceivedAt ?? null, language)}</ThemedText>}
          {onboarding ? <ThemedText type="small" style={muted}>{w.reviewOnboarding}</ThemedText> :
            <EButton palette={band} variant="secondary" label={w.review} onPress={() => router.push('/review-alerts')} disabled={busy} />}
        </View>
        {error && <ThemedText accessibilityRole="alert" style={{ color: band.statusOver }}>{error}</ThemedText>}
        <ThemedText type="meta" style={muted}>{w.scope}</ThemedText>
        <ThemedText type="meta" style={muted}>{w.privacy}</ThemedText>
        <ThemedText type="meta" style={muted}>{w.subtitle}</ThemedText>
      </>}
      {supported && <EButton palette={band} variant="quiet" label={w.refresh} onPress={() => { setError(null); void refresh(); }} disabled={busy} />}
    </View>
  </BandScaffold>;
}

const styles = StyleSheet.create({
  bandBlock: { gap: 12, paddingTop: 4, paddingBottom: 8 },
  bandTitle: { fontFamily: Fonts.sansSemi, fontSize: 36, lineHeight: 42, letterSpacing: -1.2 },
  example: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20 },
  exampleStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  exampleBadge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  exampleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  exampleTile: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sheet: { gap: 14 },
  step: { gap: 14, paddingVertical: 14 },
  stepHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  stepBadge: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stepNumber: { fontSize: 17, lineHeight: 22 },
  stepTitle: { fontSize: 16, lineHeight: 22 },
  stepCopy: { flex: 1, minWidth: 0, gap: 2 },
  stepBody: { gap: 10 },
  delivery: { gap: 8, paddingTop: 6 },
});
