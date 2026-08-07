import AsyncStorage from '@react-native-async-storage/async-storage';

/** Web is a QA surface; native resolution swaps in the encrypted SQLCipher inbox. */
export const backgroundRelayStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
  /**
   * Delete `key` only while it still holds exactly `expected` — the bytes the
   * caller read. The staging queue has two writers and they do not take turns:
   * a foreground import reads the staged rows, hands the user a review screen,
   * and commits minutes later, while a push wake can append new rows and
   * acknowledge them server-side inside that gap. An unconditional delete of
   * the key threw those rows away on the phone AFTER the relay had already
   * dropped them, which is the one way a transaction is lost outright rather
   * than merely re-synced.
   *
   * Returns whether the delete happened. `false` means the value moved on and
   * the caller owns nothing here any more: leave it, and let the next import
   * re-read it. A re-read costs a duplicate sync, which buildImportPlan()
   * fingerprints away; a wrong delete costs the transaction.
   *
   * `expected === null` means the caller read an empty queue, so it owns
   * nothing and nothing is deleted.
   *
   * AsyncStorage has no conditional write, so this is a read-compare-delete
   * with a window in it. The native SQLCipher sibling closes that window with
   * a single statement, and the native one is what ships; web has no
   * background wakes to race with at all.
   */
  async removeItemIfUnchanged(key: string, expected: string | null): Promise<boolean> {
    if (expected === null) return false;
    if ((await AsyncStorage.getItem(key)) !== expected) return false;
    await AsyncStorage.removeItem(key);
    return true;
  },
};
