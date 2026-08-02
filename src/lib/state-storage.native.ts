/**
 * Encrypted persistence for Wafra's local ledger.
 *
 * Native builds use one SQLCipher database whose key is generated on-device
 * and kept in SecureStore. Web remains an AsyncStorage-backed preview because
 * SQLCipher is not available there; web is a QA/demo surface, not a supported
 * place to keep a private financial ledger.
 *
 * The small key/value API is deliberate. StoreProvider already chunks large
 * ledgers and serialises writes, so moving the exact same persistence contract
 * to SQLCipher gives existing users an atomic migration without rewriting the
 * domain model or putting 5,000 rows back through React during hydration.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

type Pair = readonly [string, string | null];
type WritePair = readonly [string, string];

export interface StateStorage {
  getItem(key: string): Promise<string | null>;
  multiGet(keys: readonly string[]): Promise<readonly Pair[]>;
  multiSet(entries: readonly WritePair[]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
  /** Cryptographically erase this store and any pre-SQLCipher copy. */
  destroy(prefix: string): Promise<void>;
}

const DATABASE_NAME = 'wafra-private.db';
const KEY_NAME = 'wafra.database.key.v1';
const TABLE = 'wafra_state';

let databasePromise: Promise<SQLiteDatabase> | null = null;

function bytesToHex(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0');
  return value;
}

async function databaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing && /^[0-9a-f]{64}$/i.test(existing)) return existing;

  const key = bytesToHex(await Crypto.getRandomBytesAsync(32));
  await SecureStore.setItemAsync(KEY_NAME, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

async function openEncryptedDatabase(): Promise<SQLiteDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = (async () => {
    const key = await databaseKey();
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

    // The key is 32 random bytes represented as validated hex, so it cannot
    // terminate or alter this statement. SQLCipher must receive the key before
    // any other query touches the encrypted file.
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    await db.execAsync(`
      PRAGMA cipher_memory_security = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    return db;
  })().catch((error) => {
    // A failed open must be retryable after the user unlocks the device.
    databasePromise = null;
    throw error;
  });

  return databasePromise;
}

const encryptedStorage: StateStorage = {
  async getItem(key) {
    const db = await openEncryptedDatabase();
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM ${TABLE} WHERE key = ?`,
      key,
    );
    return row?.value ?? null;
  },

  async multiGet(keys) {
    const db = await openEncryptedDatabase();
    const statement = await db.prepareAsync(`SELECT value FROM ${TABLE} WHERE key = ?`);
    try {
      const rows: Pair[] = [];
      for (const key of keys) {
        const result = await statement.executeAsync<{ value: string }>(key);
        const row = await result.getFirstAsync();
        rows.push([key, row?.value ?? null]);
      }
      return rows;
    } finally {
      await statement.finalizeAsync();
    }
  },

  async multiSet(entries) {
    if (entries.length === 0) return;
    const db = await openEncryptedDatabase();
    await db.withExclusiveTransactionAsync(async (txn) => {
      const statement = await txn.prepareAsync(
        `INSERT INTO ${TABLE} (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      );
      try {
        const now = Date.now();
        for (const [key, value] of entries) {
          await statement.executeAsync(key, value, now);
        }
      } finally {
        await statement.finalizeAsync();
      }
    });
  },

  async multiRemove(keys) {
    if (keys.length === 0) return;
    const db = await openEncryptedDatabase();
    await db.withExclusiveTransactionAsync(async (txn) => {
      const statement = await txn.prepareAsync(`DELETE FROM ${TABLE} WHERE key = ?`);
      try {
        for (const key of keys) await statement.executeAsync(key);
      } finally {
        await statement.finalizeAsync();
      }
    });
  },

  async destroy(prefix) {
    // Stop using the live handle first. Deleting the key before the file makes
    // any file-removal failure fail closed: the remaining bytes are SQLCipher
    // ciphertext whose only key has already left the Keychain.
    const opening = databasePromise;
    databasePromise = null;
    let closeError: unknown = null;
    if (opening) {
      try {
        const db = await opening;
        await db.closeAsync();
      } catch (error) {
        closeError = error;
      }
    }
    let keyError: unknown = null;
    try {
      await SecureStore.deleteItemAsync(KEY_NAME);
    } catch (error) {
      keyError = error;
    }

    let databaseError: unknown = null;
    try {
      await SQLite.deleteDatabaseAsync(DATABASE_NAME);
    } catch (error) {
      databaseError = error;
    }

    // A very old pre-migration install may still have an AsyncStorage copy.
    // Wipe it in the same user action rather than assuming migration ran.
    const allKeys = await AsyncStorage.getAllKeys();
    const legacyKeys = allKeys.filter((key) => key === prefix || key.startsWith(`${prefix}:`));
    if (legacyKeys.length > 0) await AsyncStorage.multiRemove(legacyKeys);

    if (databaseError) throw databaseError;
    if (keyError) throw keyError;
    if (closeError) throw closeError;
  },
};

export const stateStorage: StateStorage = encryptedStorage;

/**
 * Move a pre-SQLCipher install into the encrypted database exactly once.
 *
 * Old values are removed only after the encrypted transaction succeeds. If
 * the process dies halfway through, the old copy remains and hydration retries
 * on the next launch instead of presenting an empty ledger.
 */
export async function migrateLegacyState(prefix: string): Promise<boolean> {
  const allKeys = await AsyncStorage.getAllKeys();
  const keys = allKeys.filter((key) => key === prefix || key.startsWith(`${prefix}:`));
  if (keys.length === 0) return false;

  const pairs = await AsyncStorage.multiGet(keys);
  const present = pairs.filter((pair): pair is [string, string] => pair[1] !== null);
  if (present.length === 0) return false;

  await encryptedStorage.multiSet(present);
  await AsyncStorage.multiRemove(keys);
  return true;
}
