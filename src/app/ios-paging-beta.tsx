import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OnboardingAtmosphere, WafraTile } from '@/components/onboarding/alive-scenes';
import { ThemedText } from '@/components/themed-text';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Colors, Fonts, MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { tf } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import { beginIosHistoryHandoffForOrigin, iosHistoryReturnOriginFromParam,
  iosHistorySetupStorageCoordinator, iosSupportsMessageHistory } from '@/lib/ios-history-setup';
import { dispatchIosMessageSetup, loadIosMessageSetupProgress } from '@/lib/ios-message-onboarding';
import { PAGED_HISTORY_INSTALL_KEY, PAGED_HISTORY_INSTALL_URL, pagedHistoryCopy, pagedHistoryEnabled,
  pagedHistoryRunUrl, parsePagedHistoryProgress, type PagedHistoryProgress } from '@/lib/ios-paged-setup';

const nativeModule = async () => (await import('../../modules/wafra-message-history')).default;
const onboardingNight = Colors.dark;
function PagedHistoryScreen() {
  const theme = useTheme(); const language = useLanguage(); const w = pagedHistoryCopy[language === 'ar' ? 'ar' : 'en'];
  const router = useRouter(); const params = useLocalSearchParams<{ origin?: string; blocked?: string }>();
  const origin = iosHistoryReturnOriginFromParam(params.origin) ?? 'ios-setup';
  const blockedOnReturn = params.blocked === '1';
  const { state, getStateGeneration } = useStore();
  const largeText = useLargeTextLayout();
  const onboardingSurface = origin === 'onboarding' || state.onboarded === false;
  const [progress, setProgress] = useState<PagedHistoryProgress | null>(null);
  const [installed, setInstalled] = useState(false); const [adding, setAdding] = useState(false);
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [confirmDiscard, setConfirmDiscard] = useState(false);
  const alive = useRef(true); const sequence = useRef(0); const operation = useRef(false);
  const generation = getStateGeneration();
  const refresh = useCallback(async () => {
    if (operation.current) return;
    const seq = ++sequence.current; const ledger = getStateGeneration();
    const current = () => alive.current && seq === sequence.current && ledger === getStateGeneration();
    try {
      const native = await nativeModule();
      if (!native?.getPagedStatus || !native.discardSession) throw new Error('missing_paged_receiver');
      const [raw, confirmed] = await Promise.all([native.getPagedStatus(), AsyncStorage.getItem(PAGED_HISTORY_INSTALL_KEY)]);
      const next = parsePagedHistoryProgress(raw);
      if (current()) { setProgress(next); setInstalled(confirmed === 'true'); setReady(true); setError(blockedOnReturn ? w.paused : null); }
    } catch { if (current()) { setProgress(null); setReady(false); setError(w.error); } }
  }, [blockedOnReturn, getStateGeneration, w.error, w.paused]);
  useEffect(() => {
    const epoch = sequence;
    alive.current = true; void refresh();
    const sub = AppState.addEventListener('change', value => {
      if (value === 'active') void refresh(); else sequence.current++;
    });
    return () => { alive.current = false; epoch.current++; sub.remove(); };
  }, [refresh, generation]);

  const run = async (fn: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; sequence.current++; setBusy(true); setError(null);
    try { await fn(); } catch { if (alive.current) setError(w.failed); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  };
  const install = () => void run(async () => {
    if (!await Linking.canOpenURL('shortcuts://')) { setError(w.missing); return; }
    if (!PAGED_HISTORY_INSTALL_URL) { setError(w.missing); return; }
    await Linking.openURL(PAGED_HISTORY_INSTALL_URL);
    if (alive.current) setAdding(true);
  });
  const start = () => void run(async () => {
    if (blockedOnReturn) router.setParams({ blocked: undefined });
    const ledger = getStateGeneration();
    const stillCurrent = () => alive.current && ledger === getStateGeneration();
    if (!await Linking.canOpenURL('shortcuts://')) { setError(w.missing); return; }
    const native = await nativeModule();
    if (!native?.getPagedStatus) throw new Error('missing_paged_receiver');
    // Re-read the native journal immediately before handoff. Never restart from
    // an old render's cursor or overwrite an existing completed-source marker.
    const latest = parsePagedHistoryProgress(await native.getPagedStatus());
    if (!stillCurrent()) return;
    if (!installed) { await AsyncStorage.setItem(PAGED_HISTORY_INSTALL_KEY, 'true'); setInstalled(true); }
    const setup = await loadIosMessageSetupProgress();
    if (!stillCurrent()) return;
    const returnOrigin = setup.returnToOnboarding ? 'onboarding' : origin;
    await iosHistorySetupStorageCoordinator.run(() => beginIosHistoryHandoffForOrigin(returnOrigin,
      Math.floor(latest?.createdAtMs ?? Date.now())));
    await dispatchIosMessageSetup({ type: 'history-status-changed', status: 'in-progress' });
    if (!stillCurrent()) return;
    if (latest?.status === 'complete') router.push({ pathname: '/import-sms', params: { history: latest.sessionId } });
    else await Linking.openURL(pagedHistoryRunUrl());
  });
  const discard = () => {
    setConfirmDiscard(false);
    void run(async () => {
      const ledger = getStateGeneration();
      const native = await nativeModule();
      const latest = parsePagedHistoryProgress(await native.getPagedStatus!());
      // The confirmation applies to exactly the session shown to the owner.
      if (!alive.current || ledger !== getStateGeneration() || !latest || latest.sessionId !== progress?.sessionId) throw new Error('history_session_changed');
      await native.discardSession(latest.sessionId);
      if (alive.current) setProgress(null);
    });
  };
  const leave = () => void run(async () => {
    const setup = await loadIosMessageSetupProgress();
    const destination = { pathname: '/ios-setup', params: { section: 'history', ...(origin === 'onboarding' || setup.returnToOnboarding ? { fromOnboarding: '1' } : {}) } } as const;
    // This screen sits above the setup route it came from. Replacing would
    // mount a second setup screen under it; dismiss to the existing one and
    // only replace on a cold deep-link launch with nothing beneath.
    if (router.canGoBack()) router.dismissTo(destination);
    else router.replace(destination);
  });
  const canRunShortcut = installed || adding;
  const label = progress?.status === 'complete' ? w.review
    : !canRunShortcut ? w.install : adding && !installed ? w.installed
      : progress ? w.resume : w.start;
  if (onboardingSurface) {
    return <View testID="ios-onboarding-paged-history" style={styles.onboardingRoot}>
      <StatusBar style="light" />
      <Stack.Screen options={{ title: w.title, gestureEnabled: false }} />
      <OnboardingAtmosphere />
      <SafeAreaView style={styles.onboardingSafe} edges={['top', 'bottom']}>
        <View style={styles.onboardingTopbar}>
          <Pressable accessibilityRole="button" accessibilityLabel={w.back}
            accessibilityState={{ disabled: busy }} disabled={busy} hitSlop={10}
            onPress={leave} style={({ pressed }) => [styles.onboardingBack, { opacity: pressed ? 0.6 : 1 }]}>
            <Icon name="chevron-left" size={18} color={onboardingNight.textSecondary} />
            <ThemedText style={styles.onboardingBackText}>{w.back}</ThemedText>
          </Pressable>
          <ThemedText style={styles.onboardingStepLabel}>{tf('onboardStepOf', { step: 2, total: 2 })}</ThemedText>
        </View>
        <ScrollView style={styles.onboardingScroll} scrollEnabled={largeText}
          contentContainerStyle={[styles.onboardingContent, largeText ? styles.onboardingContentLargeText : undefined]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.onboardingHero}>
            <WafraTile size={52} />
            <ThemedText style={styles.onboardingTitle} accessibilityRole="header">{w.title}</ThemedText>
            <ThemedText style={styles.onboardingBody}>{w.intro}</ThemedText>
          </View>
          <View style={styles.onboardingFacts}>
            <View style={styles.onboardingFactRow}>
              <Icon name="lock" size={17} color={onboardingNight.primary} />
              <ThemedText style={styles.onboardingFactText}>{w.privacy}</ThemedText>
            </View>
            {!installed && progress?.status !== 'complete' && <View style={styles.onboardingFactRow}>
              <Icon name="bolt" size={17} color={onboardingNight.primary} />
              <ThemedText style={styles.onboardingFactText}>{w.installHelp}</ThemedText>
            </View>}
            <View style={styles.onboardingFactRow}>
              <Icon name="phone" size={17} color={onboardingNight.primary} />
              <ThemedText style={styles.onboardingFactText}>{w.runningHelp}</ThemedText>
            </View>
          </View>
          {progress && <View testID="ios-onboarding-paged-progress" accessibilityLiveRegion="polite"
            style={styles.onboardingProgress}>
            <ThemedText style={styles.onboardingProgressCount} tabular>
              {progress.checked.toLocaleString()} · {w.counts}
            </ThemedText>
            <ThemedText style={styles.onboardingBodySecondary}>
              {progress.accepted.toLocaleString()} {w.accepted} · {progress.skipped.toLocaleString()} {w.skipped}
            </ThemedText>
            <ThemedText style={styles.onboardingBodySecondary}>
              {progress.status === 'complete' ? w.completed : w.pending}
            </ThemedText>
          </View>}
          {error && <View style={styles.onboardingNotice} accessibilityLiveRegion="polite">
            <Icon name="alert" size={18} color={onboardingNight.warning} />
            <ThemedText accessibilityRole="alert" style={styles.onboardingNoticeText}>{error}</ThemedText>
          </View>}
        </ScrollView>
        <View style={[styles.onboardingFooter, largeText ? styles.onboardingFooterLargeText : undefined]}>
          <Button label={label} disabled={busy || !ready}
            onPress={canRunShortcut || progress?.status === 'complete' ? start : install}
            labelColor={onboardingNight.onPrimary} style={styles.onboardingPrimaryButton} wrapLabel />
          <View style={styles.onboardingSecondaryRow}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => { void refresh(); }}
              style={({ pressed }) => [styles.onboardingTextAction, { opacity: pressed ? 0.6 : 1 }]}>
              <ThemedText style={styles.onboardingTextActionLabel}>{w.refresh}</ThemedText>
            </Pressable>
            {(installed || adding || progress) && <Pressable accessibilityRole="button" disabled={busy} onPress={install}
              style={({ pressed }) => [styles.onboardingTextAction, { opacity: pressed ? 0.6 : 1 }]}>
              <ThemedText style={styles.onboardingTextActionLabel}>{w.again}</ThemedText>
            </Pressable>}
            {progress && <Pressable accessibilityRole="button" disabled={busy} onPress={() => setConfirmDiscard(true)}
              style={({ pressed }) => [styles.onboardingTextAction, { opacity: pressed ? 0.6 : 1 }]}>
              <ThemedText style={styles.onboardingTextActionLabel}>{w.remove}</ThemedText>
            </Pressable>}
          </View>
          {blockedOnReturn && <Pressable accessibilityRole="button" disabled={busy} onPress={leave}
            style={({ pressed }) => [styles.onboardingTextAction, { opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText style={styles.onboardingTextActionLabel}>{w.back}</ThemedText>
          </Pressable>}
        </View>
        <ConfirmSheet visible={confirmDiscard} onClose={() => setConfirmDiscard(false)} question={w.discardTitle}
          body={w.discardBody} confirmLabel={w.confirm} onConfirm={discard} />
      </SafeAreaView>
    </View>;
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
    <Stack.Screen options={{ title: w.title, gestureEnabled: !busy }} />
    <ScrollView contentContainerStyle={{ width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: ScreenPadding, gap: Spacing.four }}>
      <ScreenHeader mode="inline" title={w.title} subtitle={w.intro} back={{ label: w.back, onPress: leave, disabled: busy }} />
      <View testID="paged-history-setup" style={{ gap: Spacing.three }}>
        <ThemedText>{w.privacy}</ThemedText>
        {!installed && progress?.status !== 'complete' && <ThemedText type="small" themeColor="textSecondary">{w.installHelp}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">{w.runningHelp}</ThemedText>
        {progress && <View testID="paged-history-progress" accessibilityLiveRegion="polite" style={{ gap: Spacing.two }}>
          <ThemedText type="heading">{progress.checked.toLocaleString()} · {w.counts}</ThemedText>
          <ThemedText>{progress.accepted.toLocaleString()} {w.accepted} · {progress.skipped.toLocaleString()} {w.skipped}</ThemedText>
          <ThemedText>{progress.status === 'complete' ? w.completed : w.pending}</ThemedText>
        </View>}
        {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
        <Button label={label} disabled={busy || !ready} onPress={canRunShortcut || progress?.status === 'complete' ? start : install} wrapLabel />
        {blockedOnReturn && <Button label={w.back} variant="ghost" disabled={busy} onPress={leave} wrapLabel />}
        <Button label={w.refresh} variant="outline" disabled={busy} onPress={() => { void refresh(); }} wrapLabel />
        {(installed || adding || progress) && <Button label={w.again} variant="ghost" disabled={busy} onPress={install} wrapLabel />}
        {progress && <Button label={w.remove} variant="ghost" disabled={busy} onPress={() => setConfirmDiscard(true)} wrapLabel />}
        <ThemedText type="meta" themeColor="textSecondary">{w.beta}</ThemedText>
      </View>
    </ScrollView>
    <ConfirmSheet visible={confirmDiscard} onClose={() => setConfirmDiscard(false)} question={w.discardTitle}
      body={w.discardBody} confirmLabel={w.confirm} onConfirm={discard} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  onboardingRoot: { flex: 1, backgroundColor: onboardingNight.background },
  onboardingSafe: { flex: 1 },
  onboardingTopbar: {
    width: '100%', maxWidth: 560, alignSelf: 'center', minHeight: 52,
    paddingHorizontal: ScreenPadding, paddingTop: Spacing.one,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  onboardingBack: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  onboardingBackText: { color: onboardingNight.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12 },
  onboardingStepLabel: { color: onboardingNight.textTertiary, fontFamily: Fonts.monoMedium, fontSize: 11 },
  onboardingScroll: { flex: 1 },
  onboardingContent: {
    width: '100%', maxWidth: 560, alignSelf: 'center', flexGrow: 1, justifyContent: 'center',
    paddingHorizontal: ScreenPadding, paddingVertical: Spacing.two, gap: 16,
  },
  onboardingContentLargeText: { justifyContent: 'flex-start', paddingTop: Spacing.four },
  onboardingHero: { gap: Spacing.two, alignItems: 'flex-start' },
  onboardingTitle: {
    color: onboardingNight.text, fontFamily: Fonts.sansSemi, fontSize: 27, lineHeight: 33,
    letterSpacing: -0.7, maxWidth: 460,
  },
  onboardingBody: { color: onboardingNight.textSecondary, fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20 },
  onboardingBodySecondary: { color: onboardingNight.textTertiary, fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18 },
  onboardingFacts: {
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: onboardingNight.cardBorderStrong,
  },
  onboardingFactRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  onboardingFactText: { flex: 1, color: onboardingNight.textSecondary, fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17 },
  onboardingProgress: {
    gap: Spacing.one, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: onboardingNight.cardBorderStrong,
  },
  onboardingProgressCount: { color: onboardingNight.text, fontFamily: Fonts.monoSemi, fontSize: 21, lineHeight: 27 },
  onboardingNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: onboardingNight.expenseSoftBorder,
  },
  onboardingNoticeText: { flex: 1, color: onboardingNight.textSecondary, fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17 },
  onboardingFooter: {
    width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: ScreenPadding,
    paddingTop: Spacing.two, paddingBottom: Spacing.two, gap: Spacing.one,
  },
  onboardingFooterLargeText: { paddingBottom: Spacing.three },
  onboardingPrimaryButton: { backgroundColor: onboardingNight.primary },
  onboardingSecondaryRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: Spacing.one },
  onboardingTextAction: { minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.two },
  onboardingTextActionLabel: { color: onboardingNight.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
export default function IosPagingBeta() {
  return Platform.OS === 'ios' && iosSupportsMessageHistory(Platform.Version) && pagedHistoryEnabled()
    ? <PagedHistoryScreen /> : <Redirect href="/ios-setup" />;
}
