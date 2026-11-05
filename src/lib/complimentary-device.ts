import { anchorGrant, clearGrantClock } from '@/lib/complimentary-clock';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { COMPLIMENTARY_LEASE_SECONDS, createComplimentaryDevice } from '@/lib/complimentary-access';

// Credentials can go only to this publisher-operated entitlement endpoint. A user-editable relay
// address, HTTP redirects, URL query strings, ledger accounts and telemetry are never used here.
const ACCESS_ENDPOINT = 'https://wafra-access.khanjer496.workers.dev/v1/access/complimentary';
const KEY = 'wafra.complimentary.credential.v1';
export const complimentaryDevice = createComplimentaryDevice({
  now: Date.now,
  anchor: anchorGrant, clearAnchor: clearGrantClock,
  read: () => Platform.OS === 'android' ? SecureStore.getItemAsync(KEY) : Promise.resolve(null),
  store: code => SecureStore.setItemAsync(KEY, code),
  remove: () => Platform.OS === 'android' ? SecureStore.deleteItemAsync(KEY) : Promise.resolve(),
  verify: async code => {
    if (Platform.OS !== 'android') return 'unavailable';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const { fetch } = await import('expo/fetch');
      const response = await fetch(ACCESS_ENDPOINT, {
        method: 'POST', headers: { Authorization: `Bearer ${code}`, Accept: 'application/json' },
        credentials: 'omit', redirect: 'error', signal: controller.signal,
      });
      if ([401, 403, 404].includes(response.status)) return 'denied';
      if (response.status !== 200 || response.url !== ACCESS_ENDPOINT) return 'unavailable';
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || !('entitlement' in result) || !('leaseSeconds' in result)) return 'unavailable';
      return result.entitlement === 'pro' && result.leaseSeconds === COMPLIMENTARY_LEASE_SECONDS ? 'granted' : 'unavailable';
    } catch { return 'unavailable'; }
    finally { clearTimeout(timeout); }
  },
});
