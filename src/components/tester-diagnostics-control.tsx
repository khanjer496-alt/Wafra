import React, { useRef, useState } from 'react';
import { Alert, Platform, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { sendAndroidTesterDiagnostic } from '@/lib/android-tester-diagnostics';
import { t, tf } from '@/lib/i18n';
import { useStore } from '@/lib/store';

export function TesterDiagnosticsControl() {
  const { state, getStateSnapshot } = useStore();
  const language = state.language === 'ar' ? 'ar' : 'en';
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  if (Platform.OS !== 'android') return null;

  const send = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const receipt = await sendAndroidTesterDiagnostic(getStateSnapshot());
      Alert.alert(t('testerDiagnosticsSentTitle', language),
        tf('testerDiagnosticsSentBody', { id: receipt.id }, language));
    } catch {
      Alert.alert(t('testerDiagnosticsFailedTitle', language),
        t('testerDiagnosticsFailedBody', language));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Button
        label={t(busy ? 'testerDiagnosticsCollecting' : 'testerDiagnosticsSend', language)}
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
