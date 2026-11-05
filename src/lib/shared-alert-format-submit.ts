import { requestConsent } from '@/lib/consent-prompt';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { fetch as expoFetch } from 'expo/fetch';
import { DEFAULT_RELAY_URL, getRelayConfig, installNativeRandomValuesBridge } from '@/lib/relay';
import { createSharingIdentity } from '@/lib/shared-alert-format-identity';
import { sharesAlertFormats, mayPrepareSharedFormat, formatSharingChoicePending, type FormatSharingChoice } from '@/lib/shared-alert-format-share';
import { submitSharedAlertShape } from '@/lib/shared-alert-format-sync';
import type { SharedAlertShape } from '@/lib/shared-alert-formats';

const identity = createSharingIdentity({
  baseUrl: DEFAULT_RELAY_URL,
  readSecret: (key) => SecureStore.getItemAsync(key),
  writeSecret: (key, value) => SecureStore.setItemAsync(key, value,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  removeSecret: (key) => SecureStore.deleteItemAsync(key),
  transport: (url, init) => expoFetch(url, init as never) as unknown as Promise<Response>,
  entropy: () => Crypto.getRandomValues(new Uint8Array(32)),
  prepare: installNativeRandomValuesBridge,
  now: Date.now,
});

export const eraseSharingCredential = (): Promise<void> => identity.erase();

type SharingState = FormatSharingChoice & { language?: string };

let prompting = false;
/** A save is already local and durable before this optional contribution is offered. */
export async function submitShapeAnonymously(
  shape: SharedAlertShape,
  current: () => SharingState | null,
  setChoice: (enabled: boolean) => Promise<void>,
): Promise<void> {
  const allowed = () => { const state = current(); return !!state && !formatSharingChoicePending() && sharesAlertFormats(state); };
  try {
    const initial = current();
    if (!initial || !mayPrepareSharedFormat(initial)) return;
    if (!sharesAlertFormats(initial)) {
      if (prompting) return;
      prompting = true;
      try {
        const ar = initial.language === 'ar';
        const choice = await requestConsent({
          question: ar ? 'هل تريد مشاركة صياغة البنك؟' : 'Share bank wording?',
          body: ar
            ? 'تم الحفظ على جهازك. إذا وافقت، سيرسل وفرة صياغة التنبيهات المؤهلة التي تعلّمها أو تؤكدها لاحقًا إلى خادمه لمساعدة مستخدمين آخرين. تتضمن الصيغة رمز مرسل البنك والعملة واتجاه الدفعة. تُزال المبالغ والتواريخ وأرقام البطاقات وتُفحص الأسماء. يمكنك إيقاف المشاركة في الإعدادات.'
            : 'Your entry is saved on this phone. If you turn sharing on, Wafra sends this bank’s wording and future eligible formats you teach or confirm to its relay to help other users. Each format includes the bank sender code, currency and payment direction. Amounts, dates and card digits are removed and names are screened. You can turn sharing off in Settings.',
          cancelLabel: ar ? 'إبقاء الصياغة خاصة' : 'Keep private',
          confirmLabel: ar ? 'مشاركة صياغة البنك' : 'Share bank wording',
        });
        if (choice === null) return;
        const latest = current();
        if (!latest || !mayPrepareSharedFormat(latest) || latest.shareAlertFormatsV1 !== undefined) return;
        await setChoice(choice);
        if (!choice) return;
      } finally { prompting = false; }
    }
    if (!allowed()) return;
    const capture = await getRelayConfig().catch(() => null);
    if (!allowed()) return;
    const cfg = capture ?? await identity.ensure(allowed);
    if (!cfg || !allowed()) return;
    await submitSharedAlertShape(cfg, shape, {
      fetch: (url, init) => {
        if (!allowed()) return Promise.reject(new Error('Contribution disabled'));
        return expoFetch(url, init as never) as unknown as Promise<Response>;
      },
    });
  } catch { /* A network or storage failure must never undo a local save. */ }
}
