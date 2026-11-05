import { useEffect, useState } from 'react';
import { usePrivacyGateCleared } from '@/components/lock-gate';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { registerConsentPresenter, type ConsentPrompt } from '@/lib/consent-prompt';

type OpenPrompt = { copy: ConsentPrompt; answer: (choice: boolean | null) => void };

/** The app-level sheet survives navigation after a Teach or Review item is saved. */
export function ConsentPromptHost() {
  return usePrivacyGateCleared() ? <UnlockedConsentPromptHost /> : null;
}

function UnlockedConsentPromptHost() {
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
  return (
    <ConfirmSheet
      visible
      {...open.copy}
      onClose={() => setOpen(current => current === open ? null : current)}
      onCancel={() => open.answer(false)}
      onConfirm={() => open.answer(true)}
    />
  );
}
