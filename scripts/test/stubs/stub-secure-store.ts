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

/** Same numeric value expo-secure-store exports; only identity matters here. */
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 2;
export const WHEN_UNLOCKED = 0;

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
