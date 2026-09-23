import React, { useRef, useState } from 'react';
import { Alert, Platform, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { sendAndroidTesterDiagnostic, type TesterDiagnosticProgress } from '@/lib/android-tester-diagnostics';
import { t, tf } from '@/lib/i18n';
import { useStore } from '@/lib/store';

export function TesterDiagnosticsControl() {
  const { state, getStateSnapshot } = useStore();
  const language = state.language === 'ar' ? 'ar' : 'en';
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<TesterDiagnosticProgress | null>(null);
  const running = useRef(false);

  if (Platform.OS !== 'android') return null;

  const send = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setProgress(null);
    try {
      const receipt = await sendAndroidTesterDiagnostic(getStateSnapshot(), setProgress);
      Alert.alert(t('testerDiagnosticsSentTitle', language),
        tf('testerDiagnosticsSentBody', { id: receipt.id }, language));
    } catch {
      Alert.alert(t('testerDiagnosticsFailedTitle', language),
        t('testerDiagnosticsFailedBody', language));
    } finally {
      running.current = false;
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Button
        label={!busy ? t('testerDiagnosticsSend', language)
          : progress?.stage === 'sending' ? t('testerDiagnosticsSending', language)
            : progress?.stage === 'checking'
              ? tf('testerDiagnosticsChecked', { count: progress.checked }, language)
              : t('testerDiagnosticsCollecting', language)}
        icon="upload"
        variant="outline"
        disabled={busy}
        onPress={() => void send()}
      />
      <ThemedText type="meta" themeColor="textSecondary">
        {t('testerDiagnosticsDetail', language)}
      </ThemedText>
    </View>
  );
}
