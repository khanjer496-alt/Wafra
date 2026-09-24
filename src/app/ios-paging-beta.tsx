import AsyncStorage from '@react-native-async-storage/async-storage';
import WafraLiveCapture from '../../modules/wafra-live-capture';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { SetupShell, SetupHeader } from '@/components/onboarding/setup-shell';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useStore } from '@/lib/store';
import { beginIosHistoryHandoffForOrigin, iosHistoryReturnOriginFromParam,
  iosHistorySetupStorageCoordinator, iosSupportsMessageHistory } from '@/lib/ios-history-setup';
import { dispatchIosMessageSetup, loadIosMessageSetupProgress } from '@/lib/ios-message-onboarding';
import { beginIosStatementHandoff } from '@/lib/ios-statement-handoff';
import { BUNDLED_HISTORY_INSTALL_KEY, PAGED_HISTORY_BLOCK_KEY, historyPageKey, isHistoryPageBlocked, PAGED_HISTORY_INSTALL_KEY, PAGED_HISTORY_INSTALL_URL, pagedHistoryCopy, pagedHistoryEnabled,
  pagedHistoryRunUrl, parsePagedHistoryProgress, type PagedHistoryProgress } from '@/lib/ios-paged-setup';

const nativeModule = async () => (await import('../../modules/wafra-message-history')).default;
function PagedHistoryScreen() {
  const language = useLanguage(); const w = pagedHistoryCopy[language === 'ar' ? 'ar' : 'en'];
  const router = useRouter(); const params = useLocalSearchParams<{ origin?: string; blocked?: string; reason?: string }>();
  const origin = iosHistoryReturnOriginFromParam(params.origin) ?? 'ios-setup';
  const blockedOnReturn = params.blocked === '1';
  const pageFailure = blockedOnReturn && params.reason === 'page-validation';
  const bundled = typeof WafraLiveCapture?.getHistoryShortcutURL === 'function';
  const installKey = bundled ? BUNDLED_HISTORY_INSTALL_KEY : PAGED_HISTORY_INSTALL_KEY;
  const [pageBlocked, setPageBlocked] = useState(false);
  const consumedPageFailure = useRef(false);
  const { state, getStateGeneration } = useStore();
  const [restoredOnboarding, setRestoredOnboarding] = useState(false);
  const onboarding = origin === 'onboarding' || restoredOnboarding ||
    (state.hydrated === true && state.onboarded === false);
  const theme = useTheme(onboarding ? 'dark' : undefined);
  const [progress, setProgress] = useState<PagedHistoryProgress | null>(null);
  const [installed, setInstalled] = useState(false); const [adding, setAdding] = useState(false);
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Status could not be read (corrupt staging, invalid native status). The
  // only safe recovery is erasing the temporary import; Start stays disabled.
  const [unreadable, setUnreadable] = useState(false); const [confirmErase, setConfirmErase] = useState(false);
  const statusFailures = useRef(0);
  const alive = useRef(true); const sequence = useRef(0); const operation = useRef(false);
  const generation = getStateGeneration();
  const refresh = useCallback(async () => {
    if (operation.current) return;
    const seq = ++sequence.current; const ledger = getStateGeneration();
    const current = () => alive.current && seq === sequence.current && ledger === getStateGeneration();
    let erasable = false; let statusFailed = false;
    try {
      const native = await nativeModule();
      if (!native?.getPagedStatus || !native.discardSession) throw new Error('missing_paged_receiver');
      erasable = typeof native.discardPagedHistory === 'function';
      // Only a failure of the native status itself (or its validation) points
      // at the staged data; app-storage errors never offer to erase it.
      const status = native.getPagedStatus().then(raw => parsePagedHistoryProgress(raw))
        .catch((cause: unknown) => { statusFailed = true; throw cause; });
      const [next, confirmed, setup, storedBlock] = await Promise.all([status, AsyncStorage.getItem(installKey), loadIosMessageSetupProgress(), AsyncStorage.getItem(PAGED_HISTORY_BLOCK_KEY)]);
      if (!current()) return;
      statusFailures.current = 0;
      const changed = next?.sourceChanged === true;
      let blocked = !changed && isHistoryPageBlocked(storedBlock, next);
      if (!pageFailure) consumedPageFailure.current = false;
      if (!changed && pageFailure && !consumedPageFailure.current && historyPageKey(next)) {
        await AsyncStorage.setItem(PAGED_HISTORY_BLOCK_KEY, historyPageKey(next)!);
        if (!current()) return;
        consumedPageFailure.current = true; blocked = true;
      }
      setPageBlocked(blocked); setRestoredOnboarding(setup.returnToOnboarding); setProgress(next);
      setInstalled(confirmed === 'true'); setReady(true); setUnreadable(false);
      setError(changed ? w.sourceChanged : blocked ? w.pageBlocked : next?.status === 'complete' ? null : blockedOnReturn ? next ? w.paused : w.notStarted : null);
    } catch {
      if (!current()) return;
      // A single failure can be transient (store busy, clock change): offer
      // Refresh first, and Erase only when the status stays unreadable.
      statusFailures.current = statusFailed ? statusFailures.current + 1 : 0;
      const offerErase = erasable && statusFailures.current >= 2;
      setProgress(null); setReady(false); setPageBlocked(false); setUnreadable(offerErase);
      setError(offerErase ? w.unreadable : w.error);
    }
  }, [blockedOnReturn, pageFailure, installKey, getStateGeneration, w.error, w.paused, w.notStarted, w.pageBlocked, w.sourceChanged, w.unreadable]);
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
    const ledger = getStateGeneration();
    const current = () => alive.current && ledger === getStateGeneration();
    // The signed HTTPS download opens in Safari even when iOS cannot probe
    // the Shortcuts scheme. Probe only when actually running the Shortcut.
    if (bundled) {
      const url = await WafraLiveCapture!.getHistoryShortcutURL!();
      const sharing = await import('expo-sharing');
      if (!url.startsWith('file:') || !url.endsWith('.shortcut') || !await sharing.isAvailableAsync()) throw new Error('history_shortcut_unavailable');
      if (!current()) return;
      await sharing.shareAsync(url, { UTI: 'com.apple.shortcut' });
    } else {
      if (!PAGED_HISTORY_INSTALL_URL) { setError(w.missing); return; }
      await Linking.openURL(PAGED_HISTORY_INSTALL_URL);
    }
    if (current()) setAdding(true);
  });
  const start = (retryPage = false, retryChanged = false) => void run(async () => {
    const ledger = getStateGeneration();
    const stillCurrent = () => alive.current && ledger === getStateGeneration();
    if (!await Linking.canOpenURL('shortcuts://')) { setError(w.missing); return; }
    const native = await nativeModule();
    if (!native?.getPagedStatus) throw new Error('missing_paged_receiver');
    // Re-read the native journal immediately before handoff. Never restart from
    // an old render's cursor or overwrite an existing completed-source marker.
    const latest = parsePagedHistoryProgress(await native.getPagedStatus());
    if (!stillCurrent()) return;
    // Resuming a session whose oldest Message is gone fails again unless the
    // mismatch was transient; that retry must be an explicit owner choice.
    if (latest?.sourceChanged && !retryChanged) { setProgress(latest); setError(w.sourceChanged); return; }
    const blocked = isHistoryPageBlocked(await AsyncStorage.getItem(PAGED_HISTORY_BLOCK_KEY), latest);
    if (!stillCurrent()) return;
    if (blocked && !retryPage) { setPageBlocked(true); setError(w.pageBlocked); return; }
    if (blockedOnReturn) router.setParams({ blocked: undefined, reason: undefined });
    if (!installed) { await AsyncStorage.setItem(installKey, 'true'); setInstalled(true); }
    const setup = await loadIosMessageSetupProgress();
    if (!stillCurrent()) return;
    const returnOrigin = setup.returnToOnboarding ? 'onboarding' : origin;
    await iosHistorySetupStorageCoordinator.run(() => beginIosHistoryHandoffForOrigin(returnOrigin,
      Math.floor(latest?.createdAtMs ?? Date.now())));
    await dispatchIosMessageSetup({ type: 'history-status-changed', status: 'in-progress' });
    if (!stillCurrent()) return;
    if (latest?.status === 'complete') router.push({ pathname: '/import-sms', params: { history: latest.sessionId } });
    else await Linking.openURL(pagedHistoryRunUrl(bundled));
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
      if (alive.current) { setProgress(null); setError(null); }
    });
  };
  const erase = () => {
    setConfirmErase(false);
    let erased = false;
    void run(async () => {
      const native = await nativeModule();
      if (!native?.discardPagedHistory) throw new Error('missing_paged_receiver');
      await native.discardPagedHistory();
      erased = true; statusFailures.current = 0;
    }).then(() => { if (erased) void refresh(); });
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
  const sourceChanged = progress?.sourceChanged === true;
  const label = progress?.status === 'complete' ? w.review
    : !canRunShortcut ? w.install : adding && !installed ? w.installed
      : progress ? w.resume : w.start;
  return <SetupShell onboarding={onboarding}><SafeAreaView style={{ flex: 1, backgroundColor: onboarding ? 'transparent' : theme.background }}>
    <Stack.Screen options={{ title: w.title, gestureEnabled: !busy }} />
    <ScrollView contentContainerStyle={{ width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', padding: ScreenPadding, gap: Spacing.four }}>
      <SetupHeader onboarding={onboarding} title={w.title} subtitle={w.intro} back={{ label: w.back, onPress: leave, disabled: busy }} />
      <View testID="paged-history-setup" style={{ gap: Spacing.three }}>
        <ThemedText>{w.privacy}</ThemedText>
        {!installed && progress?.status !== 'complete' && <ThemedText type="small" themeColor="textSecondary">{bundled ? w.bundleHelp : w.installHelp}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">{w.runningHelp}</ThemedText>
        {progress && <View testID="paged-history-progress" accessibilityLiveRegion="polite" style={{ gap: Spacing.two }}>
          <ThemedText type="heading">{progress.checked.toLocaleString()} · {w.counts}</ThemedText>
          <ThemedText>{progress.accepted.toLocaleString()} {w.accepted} · {progress.skipped.toLocaleString()} {w.skipped}</ThemedText>
          {!sourceChanged && <ThemedText>{progress.status === 'complete' ? w.completed : pageBlocked ? w.pageBlocked : w.pending}</ThemedText>}
        </View>}
        {error && !pageBlocked && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
        {sourceChanged && <Button label={w.startOver} disabled={busy} onPress={() => setConfirmDiscard(true)} wrapLabel />}
        {sourceChanged && canRunShortcut && <Button label={w.retryChanged} variant="outline" disabled={busy || !ready} onPress={() => start(false, true)} wrapLabel />}
        {unreadable && <Button label={w.erase} disabled={busy} onPress={() => setConfirmErase(true)} wrapLabel />}
        {!pageBlocked && !sourceChanged && !unreadable && <Button label={label} disabled={busy || !ready} onPress={canRunShortcut || progress?.status === 'complete' ? () => start() : install} wrapLabel />}
        {pageBlocked && <View testID="history-page-recovery" style={{ gap: Spacing.two }}>
          <ThemedText type="small">{w.retryHelp}</ThemedText>
          {!installed && <Button label={w.install} onPress={install} disabled={busy || !ready} wrapLabel />}
          {(installed || adding) && <Button label={w.retryPage} variant="outline" onPress={() => start(true)} disabled={busy || !ready} wrapLabel />}
        </View>}
        {progress?.status !== 'complete' && <View style={{ gap: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary">{w.statementHelp}</ThemedText>
          <Button label={w.statement} variant="outline" disabled={busy}
            onPress={() => router.push({ pathname: '/statement-import', params: onboarding
              ? { fromOnboarding: '1', statementSession: beginIosStatementHandoff() } : {} })} wrapLabel />
        </View>}
        {(blockedOnReturn || pageBlocked) && <Button label={w.back} variant="ghost" disabled={busy} onPress={leave} wrapLabel />}
        <Button label={w.refresh} variant="outline" disabled={busy} onPress={() => { void refresh(); }} wrapLabel />
        {(installed || adding || progress) && <Button label={w.again} variant="ghost" disabled={busy} onPress={install} wrapLabel />}
        {progress && !sourceChanged && <Button label={w.remove} variant="ghost" disabled={busy} onPress={() => setConfirmDiscard(true)} wrapLabel />}
        <ThemedText type="meta" themeColor="textSecondary">{w.beta}</ThemedText>
      </View>
    </ScrollView>
    <ConfirmSheet visible={confirmDiscard} onClose={() => setConfirmDiscard(false)} question={w.discardTitle}
      body={sourceChanged ? w.startOverBody : w.discardBody} confirmLabel={sourceChanged ? w.startOver : w.confirm} onConfirm={discard} />
    <ConfirmSheet visible={confirmErase} onClose={() => setConfirmErase(false)} question={w.eraseTitle}
      body={w.eraseBody} confirmLabel={w.erase} onConfirm={erase} />
  </SafeAreaView></SetupShell>;
}
export default function IosPagingBeta() {
  return Platform.OS === 'ios' && iosSupportsMessageHistory(Platform.Version) && pagedHistoryEnabled(typeof WafraLiveCapture?.getHistoryShortcutURL === 'function')
    ? <PagedHistoryScreen /> : <Redirect href="/ios-setup" />;
}
