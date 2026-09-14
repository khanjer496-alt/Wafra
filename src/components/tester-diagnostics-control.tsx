import React, { useRef, useState } from 'react';
import { Alert, Platform, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { sendAndroidTesterDiagnostic } from '@/lib/android-tester-diagnostics';
import { useStore } from '@/lib/store';
import { TESTER_DIAGNOSTICS_COPY } from '@/lib/tester-diagnostics-copy';

export function TesterDiagnosticsControl() {
  const { state, getStateSnapshot } = useStore();
  const language = state.language === 'ar' ? 'ar' : 'en';
  const copy = TESTER_DIAGNOSTICS_COPY[language];
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  if (Platform.OS !== 'android') return null;

  const send = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const receipt = await sendAndroidTesterDiagnostic(getStateSnapshot());
      Alert.alert(copy.sentTitle, copy.sentBody(receipt.id));
    } catch {
      Alert.alert(copy.failedTitle, copy.failedBody);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Button
        label={busy ? copy.busy : copy.button}
        icon="upload"
        variant="outline"
        disabled={busy}
        onPress={() => void send()}
      />
      <ThemedText type="meta" themeColor="textSecondary">
        {copy.detail}
      </ThemedText>
    </View>
  );
}
