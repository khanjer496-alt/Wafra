import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { ScreenHeader } from '@/components/ui/screen-header';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useStore } from '@/lib/store';
import { beginIosHistoryHandoffForOrigin, iosHistoryReturnOriginFromParam,
  iosHistorySetupStorageCoordinator, iosSupportsMessageHistory } from '@/lib/ios-history-setup';
import { dispatchIosMessageSetup, loadIosMessageSetupProgress } from '@/lib/ios-message-onboarding';
import { PAGED_HISTORY_INSTALL_KEY, PAGED_HISTORY_INSTALL_URL, pagedHistoryCopy, pagedHistoryEnabled,
  pagedHistoryRunUrl, parsePagedHistoryProgress, type PagedHistoryProgress } from '@/lib/ios-paged-setup';

const nativeModule = async () => (await import('../../modules/wafra-message-history')).default;
function PagedHistoryScreen() {
  const theme = useTheme(); const language = useLanguage(); const w = pagedHistoryCopy[language === 'ar' ? 'ar' : 'en'];
  const router = useRouter(); const params = useLocalSearchParams<{ origin?: string }>();
  const origin = iosHistoryReturnOriginFromParam(params.origin) ?? 'ios-setup';
  const { getStateGeneration } = useStore();
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
      if (current()) { setProgress(next); setInstalled(confirmed === 'true'); setReady(true); setError(null); }
    } catch { if (current()) { setProgress(null); setReady(false); setError(w.error); } }
  }, [getStateGeneration, w.error]);
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
    router.replace({ pathname: '/ios-setup', params: { section: 'history', ...(origin === 'onboarding' || setup.returnToOnboarding ? { fromOnboarding: '1' } : {}) } });
  });
  const label = progress?.status === 'complete' ? w.review : progress ? w.resume : installed ? w.start : adding ? w.installed : w.install;
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
    <Stack.Screen options={{ title: w.title, gestureEnabled: !busy }} />
    <ScrollView contentContainerStyle={{ width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: ScreenPadding, gap: Spacing.four }}>
      <ScreenHeader mode="inline" title={w.title} subtitle={w.intro} back={{ label: w.back, onPress: leave, disabled: busy }} />
      <View testID="paged-history-setup" style={{ gap: Spacing.three }}>
        <ThemedText>{w.privacy}</ThemedText>
        {!installed && !progress && <ThemedText type="small" themeColor="textSecondary">{w.installHelp}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">{w.runningHelp}</ThemedText>
        {progress && <View testID="paged-history-progress" accessibilityLiveRegion="polite" style={{ gap: Spacing.two }}>
          <ThemedText type="heading">{progress.checked.toLocaleString()} · {w.counts}</ThemedText>
          <ThemedText>{progress.accepted.toLocaleString()} {w.accepted} · {progress.skipped.toLocaleString()} {w.skipped}</ThemedText>
          <ThemedText>{progress.status === 'complete' ? w.completed : w.pending}</ThemedText>
        </View>}
        {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
        <Button label={label} disabled={busy || !ready} onPress={installed || adding || progress ? start : install} wrapLabel />
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
export default function IosPagingBeta() {
  return Platform.OS === 'ios' && iosSupportsMessageHistory(Platform.Version) && pagedHistoryEnabled()
    ? <PagedHistoryScreen /> : <Redirect href="/ios-setup" />;
}
