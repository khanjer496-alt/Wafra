import AsyncStorage from '@react-native-async-storage/async-storage';

/** Web is a QA surface; native resolution swaps in the encrypted SQLCipher inbox. */
export const backgroundRelayStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};

/** Namespace every key this module owns, so the erase below can find them all. */
const PREFIX = 'wafra/background-relay/';

/**
 * The web half of "Erase all data" must clear the staged inbox too.
 *
 * There is no key to destroy here — that is precisely why web is a QA surface
 * and not a supported place to keep a ledger — so the erase is the removal of
 * the rows themselves. Matched by prefix rather than by the one key
 * `background-relay.ts` happens to use today, so a second staged key added
 * later is erased by this without anyone having to remember to add it.
 */
export async function destroyBackgroundRelayInbox(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const staged = keys.filter((key) => key.startsWith(PREFIX));
  if (staged.length > 0) await AsyncStorage.multiRemove(staged);
}
