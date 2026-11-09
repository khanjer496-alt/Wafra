import { requestConsent, type ConsentPrompt } from '@/lib/consent-prompt';
import { t, type Lang } from '@/lib/i18n';
import { onboardingCopy } from '@/lib/onboarding-copy';

export type AndroidCaptureDisclosure = NonNullable<ConsentPrompt['androidCapture']>;

/** The host localizes this same disclosure for every Android entry point. */
export function androidCaptureDisclosure(kind: AndroidCaptureDisclosure, language: Lang): ConsentPrompt {
  const copy = onboardingCopy(language);
  return kind === 'sms-history' ? {
    androidCapture: kind,
    question: copy.smsExplainerTitle,
    body: [copy.smsExplainerBody, copy.smsExplainerSystemName, copy.smsExplainerNever].join('\n\n'),
    confirmLabel: copy.smsExplainerContinue,
    cancelLabel: copy.smsExplainerNotNow,
  } : {
    androidCapture: kind,
    question: t(kind === 'sms-live' ? 'instantSmsDisclosureTitle' : 'bankAppNotifsTitle', language),
    body: t(kind === 'sms-live' ? 'instantSmsDisclosureBody' : 'notifAccessFull', language),
    confirmLabel: t('enableAction', language),
    cancelLabel: t('cancel', language),
  };
}

/** No presenter, dismissal and decline all fail closed before any OS action. */
export async function withAndroidCaptureConsent(
  kind: AndroidCaptureDisclosure,
  action: () => Promise<boolean>,
): Promise<boolean> {
  if (await requestConsent(androidCaptureDisclosure(kind, 'en')) !== true) return false;
  return action();
}
