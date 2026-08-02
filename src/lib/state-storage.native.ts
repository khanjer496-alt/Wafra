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

import { recordStorageFailure } from '@/lib/storage-diagnostics';

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

/**
 * Every write runs on the ONE keyed connection, so they are serialised here.
 *
 * This used to be `withExclusiveTransactionAsync`, which does not do what it
 * looks like it does on an encrypted database — see `writeTransaction` below.
 * Exclusivity now comes from `BEGIN IMMEDIATE` plus this queue: SQLite has no
 * nested transactions, so two overlapping `multiSet` calls on one connection
 * would make the second `BEGIN` fail outright.
 *
 * StoreProvider already chains its own saves, but `destroy` and
 * `migrateLegacyState` write outside that queue, so the guarantee belongs here
 * rather than in the caller.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function serialiseWrite<T>(task: () => Promise<T>): Promise<T> {
  // Settled either way: one failed write must not wedge every later write.
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Discard the shared handle after a ROLLBACK that itself failed.
 *
 * A failed ROLLBACK leaves the connection INSIDE a transaction, so the next
 * `BEGIN IMMEDIATE` on it fails too and every later write fails with a second
 * error that has nothing to do with its own cause. Dropping `databasePromise`
 * is not enough on its own: expo-sqlite's Android module keeps a cache of open
 * databases keyed on path plus open options and hands back the SAME
 * `NativeDatabase` — `findCachedDatabase { ... }?.let { it.addRef() }` in
 * `SQLiteModule.kt` — so reopening by name would return the poisoned
 * connection with its transaction still open. Only a close actually releases
 * it; the refcount is 1 because this module opens the file exactly once.
 *
 * Awaited, not fired and forgotten: this runs inside the write queue, so
 * finishing the close here is what guarantees the next queued task opens a
 * genuinely new connection rather than racing the old one out of the cache.
 */
async function poisonDatabase(db: SQLiteDatabase, rollbackError: unknown): Promise<void> {
  databasePromise = null;
  // Recorded once, here. It is deliberately not rethrown — the caller's own
  // error is the one that explains what the user lost.
  recordStorageFailure('rollback', rollbackError);
  try {
    await db.closeAsync();
  } catch {
    // Nothing further to do: the handle is unreachable either way, and the
    // next open builds a new one.
  }
}

/**
 * Run `task` inside a write transaction on the keyed connection.
 *
 * DO NOT replace this with `db.withExclusiveTransactionAsync`. That helper
 * calls `Transaction.createAsync`, which opens a SECOND native connection to
 * the same file with `useNewConnection: true` and passes it only the values in
 * `SQLiteOpenOptions` — a type that has no field for a cipher key and no way
 * to carry one. `PRAGMA key` is connection state, so the transaction
 * connection is unkeyed, and on a SQLCipher file every statement it prepares
 * fails to decrypt page 1. That is not a hypothetical: it silently threw away
 * every write this app ever made on Android. `scripts/test/db.test.js` pins
 * both halves of it.
 *
 * `withTransactionAsync` stays on `this`, so it would be correct on the key,
 * but expo's own docs warn that it is not exclusive and can interleave with
 * other async queries. `BEGIN IMMEDIATE` takes the write lock up front.
 */
async function writeTransaction<T>(db: SQLiteDatabase, task: () => Promise<T>): Promise<T> {
  await db.execAsync('BEGIN IMMEDIATE');
  try {
    const result = await task();
    await db.execAsync('COMMIT');
    return result;
  } catch (error) {
    try {
      await db.execAsync('ROLLBACK');
    } catch (rollbackError) {
      // The original error is still the one thrown below. A ROLLBACK that also
      // fails used to replace it, which is how the real cause stayed hidden —
      // but it cannot simply be dropped either, because the connection it
      // leaves behind would break every write after this one.
      await poisonDatabase(db, rollbackError);
    }
    throw error;
  }
}

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

    // SQLCipher accepts ANY key without complaint; whether it is the right one
    // is only discovered when something actually decrypts page 1. Doing that
    // here, on purpose, is what turns "the key in SecureStore no longer matches
    // this file" into an error at open — attributable, and recorded below —
    // rather than an unexplained failure at the first write minutes later.
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master');

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
    recordStorageFailure('open', error);
    throw error;
  });

  return databasePromise;
}

const encryptedStorage: StateStorage = {
  // Reads rethrow rather than returning null. A read that FAILED and a key
  // that is genuinely absent are different facts, and the caller turns the
  // second one into "this phone has never run the app" — so collapsing them
  // here is what would let a broken database present itself as a first run.
  async getItem(key) {
    try {
      const db = await openEncryptedDatabase();
      const row = await db.getFirstAsync<{ value: string }>(
        `SELECT value FROM ${TABLE} WHERE key = ?`,
        key,
      );
      return row?.value ?? null;
    } catch (error) {
      recordStorageFailure('read', error);
      throw error;
    }
  },

  async multiGet(keys) {
    try {
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
    } catch (error) {
      recordStorageFailure('read', error);
      throw error;
    }
  },

  async multiSet(entries) {
    if (entries.length === 0) return;
    try {
      await serialiseWrite(async () => {
        // Acquired INSIDE the queued task, not before it.
        //
        // Resolving the handle first and then queueing captured a connection
        // that a `destroy` sitting ahead of us in the queue was about to close
        // — and a poisoned rollback likewise drops the shared handle while a
        // write is queued behind it. Both left this task writing through a
        // connection that no longer existed. Asking for the database at the
        // moment the task actually runs means it either reuses the live handle
        // or opens a fresh one, and never uses a dead one.
        const db = await openEncryptedDatabase();
        return writeTransaction(db, async () => {
          const statement = await db.prepareAsync(
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
      });
    } catch (error) {
      recordStorageFailure('write', error);
      throw error;
    }
  },

  async multiRemove(keys) {
    if (keys.length === 0) return;
    try {
      await serialiseWrite(async () => {
        // Inside the task for the same reason as `multiSet` above.
        const db = await openEncryptedDatabase();
        return writeTransaction(db, async () => {
          const statement = await db.prepareAsync(`DELETE FROM ${TABLE} WHERE key = ?`);
          try {
            for (const key of keys) await statement.executeAsync(key);
          } finally {
            await statement.finalizeAsync();
          }
        });
      });
    } catch (error) {
      recordStorageFailure('remove', error);
      throw error;
    }
  },

  /**
   * Cryptographic erase, and the ONE operation that must own the queue whole.
   *
   * The comment above `serialiseWrite` has always claimed `destroy` was
   * serialised with the writes. It was not — it never called it. So a
   * `multiSet` could sit between the close and the file deletion and reopen
   * the database, recreating the file this call had just removed and leaving
   * an erased ledger with a live handle over it. Wrapping the WHOLE body,
   * rather than each step, is the point: close, key deletion, file deletion
   * and the legacy sweep have to be indivisible with respect to other writes.
   */
  async destroy(prefix) {
    return serialiseWrite(async () => {
      // Stop using the live handle first. Deleting the key before the file
      // makes any file-removal failure fail closed: the remaining bytes are
      // SQLCipher ciphertext whose only key has already left the Keychain.
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

      const failure = databaseError ?? keyError ?? closeError;
      if (failure) {
        // "Erase everything" reporting it worked when it did not is its own
        // privacy bug, so this one is recorded too.
        recordStorageFailure('destroy', failure);
        throw failure;
      }
    });
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
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const keys = allKeys.filter((key) => key === prefix || key.startsWith(`${prefix}:`));
    if (keys.length === 0) return false;

    const pairs = await AsyncStorage.multiGet(keys);
    const present = pairs.filter((pair): pair is [string, string] => pair[1] !== null);
    if (present.length === 0) return false;

    await encryptedStorage.multiSet(present);
    await AsyncStorage.multiRemove(keys);
    return true;
  } catch (error) {
    // The AsyncStorage copy is still intact — `multiRemove` is deliberately
    // after the encrypted write, so a throw here leaves the old data where it
    // was and the next launch tries again. Recorded rather than swallowed,
    // because a migration that keeps failing looks exactly like a user who has
    // no legacy data at all.
    recordStorageFailure('migrate', error);
    throw error;
  }
}
