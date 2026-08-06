/**
 * An in-memory keychain.
 *
 * It records the OPTIONS every write was made with, which is the point: the
 * expo-secure-store default (`WHEN_UNLOCKED`) makes every background sync fail
 * on a phone in a pocket, silently — no crash, no log, just a ledger that is
 * always stale. That is not something a simulator would show either, so it is
 * asserted here instead.
 */
export interface SecureStoreOptions {
  keychainService?: string;
  keychainAccessible?: number;
  requireAuthentication?: boolean;
}

/**
 * Same numeric values expo-secure-store exports; only identity matters here.
 *
 * All THREE classes the client can name must be declared, and they must stay
 * distinct. The relay client deliberately writes its two keychain items under
 * two different classes — the admin config under WHEN_UNLOCKED_THIS_DEVICE_ONLY
 * so a lost, locked phone cannot be made to give up the token that revokes
 * devices, and the background-sync subset under
 * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY so a wake can still read it from a
 * pocket. Modelling only one of them here does not weaken an assertion, it
 * breaks the build: `SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY` is a compile
 * error against a stub that omits it, and the relay pass of run.sh fails.
 */
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 2;
export const WHEN_UNLOCKED = 0;
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 4;

/**
 * The TYPE, not just the values. expo-secure-store exports both, and a client
 * function that takes an accessibility class as a PARAMETER — relay.ts's
 * stampRevoked does — names the type rather than a constant. Omitting it here
 * fails the nodenext relay pass with TS2694, which under `set -e` aborts the
 * whole run before a single suite executes: `npm test` then reports nothing at
 * all about the app. Kept as `number` deliberately, matching the three values
 * above; narrowing it to a union would reject a caller passing one through.
 */
export type KeychainAccessibilityConstant = number;

const items = new Map<string, string>();
const writes: { key: string; options?: SecureStoreOptions }[] = [];

export const __keychain = {
  items,
  writes,
  /** Set to simulate a locked device or a keychain that refuses to answer. */
  failReads: false,
  reset(): void {
    items.clear();
    writes.length = 0;
    __keychain.failReads = false;
  },
};

export async function getItemAsync(
  key: string,
  _options?: SecureStoreOptions,
): Promise<string | null> {
  if (__keychain.failReads) throw new Error('keychain: unavailable');
  return items.get(key) ?? null;
}

export async function setItemAsync(
  key: string,
  value: string,
  options?: SecureStoreOptions,
): Promise<void> {
  writes.push({ key, options });
  items.set(key, value);
}

export async function deleteItemAsync(key: string, _options?: SecureStoreOptions): Promise<void> {
  items.delete(key);
}
