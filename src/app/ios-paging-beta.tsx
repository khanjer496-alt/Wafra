import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, View } from 'react-native';
import { Redirect, Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/hooks/use-language';
import { iosPagingBetaCopy } from '@/lib/ios-paging-beta-copy';

interface Progress {
  sessionId: string;
  status: 'continue' | 'complete';
  checked: number;
  accepted: number;
  skipped: number;
}

function HistoryBetaScreen() {
  const theme = useTheme();
  const language = useLanguage();
  const words = iosPagingBetaCopy(language);
  const router = useRouter();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [discardVisible, setDiscardVisible] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const native = (await import('../../modules/wafra-message-history')).default;
      if (!native.getPagedStatus) throw new Error('missing-native');
      const raw = await native.getPagedStatus();
      if (!raw) { setProgress(null); setMessage(''); return; }
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || !('sessionId' in value) ||
          typeof value.sessionId !== 'string' || !/^PAGED-[A-F0-9-]{36}$/.test(value.sessionId) ||
          !('status' in value) || !['continue', 'complete'].includes(String(value.status)) ||
          !['checked', 'accepted', 'skipped'].every(key =>
            key in value && Number.isSafeInteger(value[key as keyof typeof value]) &&
            Number(value[key as keyof typeof value]) >= 0)) throw new Error('invalid-status');
      setProgress(value as Progress); setMessage('');
    } catch {
      setProgress(null);
      setMessage(words.unavailable);
    }
  }, [words.unavailable]);
  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => subscription.remove();
  }, [refresh]);
  const run = async () => {
    setBusy(true);
    try { await Linking.openURL(`shortcuts://run-shortcut?name=${encodeURIComponent(words.shortcutName)}`); }
    catch { setMessage(words.shortcutMissing); }
    finally { setBusy(false); }
  };
  const discard = async () => {
    setBusy(true);
    try {
      const native = (await import('../../modules/wafra-message-history')).default;
      if (!native.discardPagedHistory) throw new Error('missing-native');
      await native.discardPagedHistory();
      await refresh();
    } catch {
      setMessage(words.cleanupFailed);
    } finally {
      setBusy(false);
    }
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
    <Stack.Screen options={{ title: words.screenTitle }} />
    <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
      <ThemedText type="title">{words.title}</ThemedText>
      <ThemedText>{words.intro}</ThemedText>
      <ThemedText>{words.storage}</ThemedText>
      {progress && <View style={{ gap: 8 }}>
        <ThemedText>{words.staged(progress.checked.toLocaleString())}</ThemedText>
        <ThemedText>{words.readable(progress.accepted.toLocaleString(), progress.skipped.toLocaleString())}</ThemedText>
        <ThemedText>{progress.status === 'complete' ? words.complete : words.continue}</ThemedText>
      </View>}
      {!!message && <ThemedText>{message}</ThemedText>}
      {progress?.status === 'complete'
        ? <Button label={words.review} onPress={() => router.push({ pathname: '/import-sms', params: { history: progress.sessionId } })} />
        : <Button label={progress ? words.resume : words.start} disabled={busy} onPress={() => { void run(); }} />}
      <Button label={words.refresh} variant="outline" disabled={busy} onPress={() => { void refresh(); }} />
      {progress && <Button label={words.discard} variant="ghost" disabled={busy} onPress={() => setDiscardVisible(true)} />}
      <ConfirmSheet
        visible={discardVisible}
        onClose={() => setDiscardVisible(false)}
        title={words.discard}
        question={words.discardQuestion}
        body={words.discardBody}
        confirmLabel={words.discardConfirm}
        destructive
        onConfirm={() => { void discard(); }}
      />
      <ThemedText>{words.requirement}</ThemedText>
    </ScrollView>
  </SafeAreaView>;
}

export default function IosPagingBeta() {
  if (Platform.OS !== 'ios' || process.env.EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA !== '1') return <Redirect href="/" />;
  return <HistoryBetaScreen />;
}
