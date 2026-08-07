/**
 * Browser-only persistence adapter.
 *
 * Metro resolves `state-storage.native.ts` ahead of this file on iOS and
 * Android, where the ledger is held in SQLCipher. Keeping the web adapter free
 * of any expo-sqlite import is important: SQLite's web implementation needs a
 * WASM worker and cross-origin isolation, neither of which should be dragged
 * into the lightweight browser QA/demo build.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

type Pair = readonly [string, string | null];
type WritePair = readonly [string, string];

export interface StateStorage {
  getItem(key: string): Promise<string | null>;
  multiGet(keys: readonly string[]): Promise<readonly Pair[]>;
  multiSet(entries: readonly WritePair[]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
  destroy(prefix: string): Promise<void>;
}

export const stateStorage: StateStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  multiGet: (keys) => AsyncStorage.multiGet([...keys]),
  multiSet: (entries) => AsyncStorage.multiSet([...entries]),
  multiRemove: (keys) => AsyncStorage.multiRemove([...keys]),
  async destroy(prefix) {
    const keys = await AsyncStorage.getAllKeys();
    const owned = keys.filter((key) => key === prefix || key.startsWith(`${prefix}:`));
    if (owned.length > 0) await AsyncStorage.multiRemove(owned);
  },
};

/** Web already uses AsyncStorage, so there is no native legacy store to move. */
export async function migrateLegacyState(_prefix: string): Promise<boolean> {
  return false;
}
