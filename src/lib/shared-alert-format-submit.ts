import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { fetch as expoFetch } from 'expo/fetch';
import { DEFAULT_RELAY_URL, getRelayConfig, installNativeRandomValuesBridge } from '@/lib/relay';
import { createSharingIdentity } from '@/lib/shared-alert-format-identity';
import { sharesAlertFormats } from '@/lib/shared-alert-format-share';
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

/**
 * Fire-and-forget upload of one value-free shape. Uses the capture pairing when
 * the phone has one, otherwise the dedicated sharing credential (paired once,
 * on first use). Consent and Private Mode are re-checked here so nothing pairs
 * or sends when sharing is off. Never throws, never logs.
 */
export async function submitShapeAnonymously(
  shape: SharedAlertShape,
  consent: { shareAlertFormats?: boolean; privateMode?: boolean },
): Promise<void> {
  try {
    if (!sharesAlertFormats(consent)) return;
    const cfg = (await getRelayConfig().catch(() => null)) ?? (await identity.ensure());
    if (cfg) await submitSharedAlertShape(cfg, shape);
  } catch { /* silent by design */ }
}
