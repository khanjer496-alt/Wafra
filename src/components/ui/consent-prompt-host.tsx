import { useEffect, useState } from 'react';
import { usePrivacyGateCleared } from '@/components/lock-gate';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { SmsPermissionExplainer } from '@/components/onboarding/sms-explainer';
import { View } from 'react-native';
import { useLanguage } from '@/hooks/use-language';
import { useBand } from '@/hooks/use-band';
import { androidCaptureDisclosure } from '@/lib/android-capture-disclosure';
import { registerConsentPresenter, type ConsentPrompt } from '@/lib/consent-prompt';

type OpenPrompt = { copy: ConsentPrompt; answer: (choice: boolean | null) => void };

/** The app-level sheet survives navigation after a Teach or Review item is saved. */
export function ConsentPromptHost() {
  return usePrivacyGateCleared() ? <UnlockedConsentPromptHost /> : null;
}

function UnlockedConsentPromptHost() {
  const language = useLanguage();
  const palette = useBand('settings');
  const [open, setOpen] = useState<OpenPrompt | null>(null);
  useEffect(() => {
    let current: OpenPrompt | null = null;
    const unregister = registerConsentPresenter(copy => {
      if (current) return Promise.resolve(null);
      return new Promise<boolean | null>(resolve => {
        const entry: OpenPrompt = {
          copy,
          answer(choice) {
            if (current !== entry) return;
            current = null;
            resolve(choice);
          },
        };
        current = entry;
        setOpen(entry);
      });
    });
    return () => {
      unregister();
      current?.answer(null);
    };
  }, []);
  if (!open) return null;
  if (open.copy.androidCapture === 'sms-history') {
    const answer = (choice: boolean) => {
      open.answer(choice);
      setOpen(current => current === open ? null : current);
    };
    return <BottomSheet visible title={androidCaptureDisclosure('sms-history', language).question}
      onClose={() => answer(false)} testID="android-sms-permission-disclosure">
      <View style={{ backgroundColor: palette.band, padding: 24, borderRadius: 24 }}>
        <SmsPermissionExplainer language={language} palette={palette} disabled={false}
          onContinue={() => answer(true)} onNotNow={() => answer(false)} />
      </View>
    </BottomSheet>;
  }
  const copy = open.copy.androidCapture
    ? androidCaptureDisclosure(open.copy.androidCapture, language) : open.copy;
  return (
    <ConfirmSheet
      visible
      {...copy}
      onClose={() => setOpen(current => current === open ? null : current)}
      onCancel={() => open.answer(false)}
      onConfirm={() => open.answer(true)}
    />
  );
}
