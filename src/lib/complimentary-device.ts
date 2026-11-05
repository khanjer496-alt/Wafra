import { anchorGrant, clearGrantClock } from '@/lib/complimentary-clock';
import * as SecureStore from 'expo-secure-store';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { createComplimentaryDevice } from '@/lib/complimentary-access';

const transport = requireOptionalNativeModule<{ verify(code: string): Promise<string> }>('WafraGrantTransport');
const KEY = 'wafra.complimentary.credential.v1';
export const complimentaryDevice = createComplimentaryDevice({
  now: Date.now,
  anchor: anchorGrant, clearAnchor: clearGrantClock,
  read: () => Platform.OS === 'android' ? SecureStore.getItemAsync(KEY) : Promise.resolve(null),
  store: code => SecureStore.setItemAsync(KEY, code),
  remove: () => Platform.OS === 'android' ? SecureStore.deleteItemAsync(KEY) : Promise.resolve(),
  verify: async code => {
    if (Platform.OS !== 'android' || !transport) return 'unavailable';
    const result = await transport.verify(code);
    return result === 'granted' || result === 'denied' ? result : 'unavailable';
  },
});
