import React, { useRef, useState } from 'react';
import { Alert, Platform, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { sendAndroidTesterDiagnostic } from '@/lib/android-tester-diagnostics';
import { useStore } from '@/lib/store';

const COPY = {
  en: {
    button: 'Send test diagnostics',
    busy: 'Collecting diagnostics…',
    detail: 'Sends one privacy-safe report to Wafra Cloudflare with performance, parser/category, SMS import and bank-notification health. Raw SMS, names, card/account numbers and exact amounts are not uploaded.',
    sentTitle: 'Diagnostics sent',
    sentBody: (id: string) => `Report ID: ${id}\n\nKeep this ID so the report can be retrieved from Cloudflare.`,
    failedTitle: 'Could not send diagnostics',
    failedBody: 'The report stayed on this phone. Check your connection and try again.',
  },
  ar: {
    button: 'إرسال تشخيص الاختبار',
    busy: 'جارٍ جمع التشخيص…',
    detail: 'يرسل تقريراً واحداً آمناً للخصوصية إلى Cloudflare يتضمن الأداء والمحلل والتصنيفات واستيراد SMS وحالة إشعارات البنوك. لا يتم رفع نص الرسائل أو الأسماء أو أرقام البطاقات/الحسابات أو المبالغ الدقيقة.',
    sentTitle: 'تم إرسال التشخيص',
    sentBody: (id: string) => `معرّف التقرير: ${id}\n\nاحتفظ بهذا المعرّف لاسترجاع التقرير من Cloudflare.`,
    failedTitle: 'تعذر إرسال التشخيص',
    failedBody: 'بقي التقرير على هذا الهاتف. تحقق من الاتصال وحاول مرة أخرى.',
  },
} as const;

export function TesterDiagnosticsControl() {
  const { state, getStateSnapshot } = useStore();
  const language = state.language === 'ar' ? 'ar' : 'en';
  const copy = COPY[language];
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
