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

import { recordStorageFailure, type StorageOp } from '@/lib/storage-diagnostics';
import { withLogoCacheErase } from '@/lib/logo-cache-lifecycle';

type Pair = readonly [string, string | null];
type WritePair = readonly [string, string];

export interface StateStorage {
  getItem(key: string): Promise<string | null>;
  multiGet(keys: readonly string[]): Promise<readonly Pair[]>;
  multiSet(entries: readonly WritePair[]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
  /** Run one logically consistent snapshot read without interleaving encrypted writes. */
  withSnapshotRead?<T>(task: () => Promise<T>): Promise<T>;
  /** Cryptographically erase this store and any pre-SQLCipher copy. */
  destroy(prefix: string): Promise<void>;
}

const DATABASE_NAME = 'wafra-private.db';
const KEY_NAME = 'wafra.database.key.v1';
const TABLE = 'wafra_state';
// A large ledger can have dozens of 400-row chunks. Sending every changed
// chunk through a separate `statement.executeAsync` call made a full repair or
// layout conversion pay one JS/native round-trip per chunk. On the 14.8k-row
// Android diagnostic that path lined up with 12-15 second foreground stalls.
// Keep each SQLite statement comfortably below bind-variable limits while
// collapsing the common 30-40 chunk save to two native calls.
const MULTISET_ROWS_PER_STATEMENT = 32;

let databasePromise: Promise<SQLiteDatabase> | null = null;
/**
 * A failed native handle must finish closing before any caller is allowed to
 * open the same path again. expo-sqlite caches handles by path on Android, so
 * clearing `databasePromise` first creates a small but real window where a
 * retry can be handed the exact half-open/poisoned connection we are closing.
 */
let databaseRecoveryPromise: Promise<void> | null = null;

async function closeDatabaseForRecovery(db: SQLiteDatabase): Promise<void> {
  try {
    await db.closeAsync();
  } catch (error) {
    // Closing is itself source-free. Record it, but never replace the error
    // that caused recovery or turn cleanup into another crash.
    recordStorageFailure('connection-close', error);
  }
}

function trackDatabaseRecovery(recovery: Promise<void>): Promise<void> {
  const tracked = recovery.finally(() => {
    if (databaseRecoveryPromise === tracked) databaseRecoveryPromise = null;
  });
  databaseRecoveryPromise = tracked;
  return tracked;
}

function beginDatabaseRecovery(db: SQLiteDatabase): Promise<void> {
  return trackDatabaseRecovery(closeDatabaseForRecovery(db));
}

async function waitForDatabaseRecovery(): Promise<void> {
  // A second recovery can be installed while an earlier waiter is suspended.
  // Loop until the path is genuinely free rather than awaiting one snapshot.
  while (databaseRecoveryPromise) await databaseRecoveryPromise;
}

/**
 * Retire a connection that failed after it had already opened successfully.
 *
 * The tester incident was recorded as `op: read`, not `op: open`: the keyed
 * connection existed, then a native read returned ERR_UNEXPECTED. Leaving the
 * resolved `databasePromise` in place made Try again use that exact connection
 * again. This installs the same close barrier synchronously from the promise,
 * then clears the public handle only after the barrier is visible to callers.
 */
async function recoverSharedDatabaseAfterFailure(): Promise<void> {
  const opening = databasePromise;
  if (!opening) {
    await waitForDatabaseRecovery();
    return;
  }

  const recovery = trackDatabaseRecovery(opening.then(
    (db) => closeDatabaseForRecovery(db),
    // A rejected open owns its own cleanup in openEncryptedDatabase's catch.
    () => undefined,
  ));
  // The recovery barrier is visible before the public handle is cleared, so a
  // retry can never observe both values as null and race into openDatabaseAsync.
  databasePromise = null;
  await recovery;
}

/**
 * Every ledger mutation and snapshot read runs on the ONE keyed connection, so
 * they are serialised here.
 *
 * This used to be `withExclusiveTransactionAsync`, which does not do what it
 * looks like it does on an encrypted database — see `writeTransaction` below.
 * Exclusivity now comes from `BEGIN IMMEDIATE` plus this queue: SQLite has no
 * nested transactions, so two overlapping `multiSet` calls on one connection
 * would make the second `BEGIN` fail outright.
 *
 * StoreProvider already chains its own saves, but the background-capture and
 * foreground StoreProvider persistence owners can overlap. Reads must join the
 * same queue too: expo-sqlite uses one native connection, and an async read that
 * lands inside another owner's BEGIN IMMEDIATE transaction can observe a split
 * snapshot or fail with an uncoded native exception.
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
  // Recorded once, here. It is deliberately not rethrown — the caller's own
  // error is the one that explains what the user lost.
  recordStorageFailure('rollback', rollbackError);
  // Install the recovery barrier BEFORE dropping the public handle. A read or
  // retry arriving on the next JS turn then waits for closeAsync instead of
  // reopening the same cached NativeDatabase while it is still poisoned.
  const recovery = beginDatabaseRecovery(db);
  databasePromise = null;
  await recovery;
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
  await waitForDatabaseRecovery();
  if (databasePromise) return databasePromise;

  let opened: SQLiteDatabase | null = null;
  let failureStage: StorageOp = 'secure-key';
  databasePromise = (async () => {
    const key = await databaseKey();
    failureStage = 'sqlite-open';
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    opened = db;

    // The key is 32 random bytes represented as validated hex, so it cannot
    // terminate or alter this statement. SQLCipher must receive the key before
    // any other query touches the encrypted file.
    failureStage = 'cipher-key';
    await db.execAsync(`PRAGMA key = "x'${key}'";`);

    // SQLCipher accepts ANY key without complaint; whether it is the right one
    // is only discovered when something actually decrypts page 1. Doing that
    // here, on purpose, is what turns "the key in SecureStore no longer matches
    // this file" into an error at open — attributable, and recorded below —
    // rather than an unexplained failure at the first write minutes later.
    failureStage = 'cipher-validation';
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master');

    failureStage = 'schema-init';
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
  })().catch(async (error) => {
    // Keep the exact closed-vocabulary stage: ERR_UNEXPECTED by itself told us
    // nothing about whether SecureStore, native open, SQLCipher validation, or
    // schema bootstrap failed on the tester's phone.
    recordStorageFailure(failureStage, error);

    // `openDatabaseAsync` can succeed and a later step can fail. On Android,
    // expo-sqlite caches that NativeDatabase by path, so merely forgetting our
    // promise lets Try again reacquire the same half-open handle. Register the
    // barrier before clearing the promise, close it, and only then reject the
    // original attempt. Callers arriving during cleanup wait at the top of this
    // function and can only create a genuinely fresh connection afterwards.
    if (opened) {
      const recovery = beginDatabaseRecovery(opened);
      databasePromise = null;
      await recovery;
    } else {
      databasePromise = null;
    }
    throw error;
  });

  return databasePromise;
}

const encryptedStorage: StateStorage = {
  withSnapshotRead: (task) => serialiseWrite(task),
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
      recordStorageFailure('state-read', error);
      await recoverSharedDatabaseAfterFailure();
      throw error;
    }
  },

  async multiGet(keys) {
    if (keys.length === 0) return [];
    try {
      const db = await openEncryptedDatabase();
      // Hydration asks for every transaction chunk at once. The previous
      // implementation reused one prepared statement but still executed one
      // native SQLite round-trip per chunk, so launch time grew linearly with
      // ledger history (25 chunks meant 25 bridged queries before React could
      // leave "Loading your ledger"). Read the requested chunk set in one
      // query, then restore the caller's exact key ordering in JS.
      const placeholders = keys.map(() => '?').join(', ');
      const found = await db.getAllAsync<{ key: string; value: string }>(
        `SELECT key, value FROM ${TABLE} WHERE key IN (${placeholders})`,
        [...keys],
      );
      const byKey = new Map(found.map((row) => [row.key, row.value] as const));
      return keys.map((key): Pair => [key, byKey.get(key) ?? null]);
    } catch (error) {
      recordStorageFailure('state-batch-read', error);
      await recoverSharedDatabaseAfterFailure();
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
          const now = Date.now();
          for (let start = 0; start < entries.length; start += MULTISET_ROWS_PER_STATEMENT) {
            const batch = entries.slice(start, start + MULTISET_ROWS_PER_STATEMENT);
            const values = batch.map(() => '(?, ?, ?)').join(', ');
            const params: (string | number)[] = [];
            for (const [key, value] of batch) params.push(key, value, now);
            await db.runAsync(
              `INSERT INTO ${TABLE} (key, value, updated_at)
               VALUES ${values}
               ON CONFLICT(key) DO UPDATE SET
                 value = excluded.value,
                 updated_at = excluded.updated_at`,
              ...params,
            );
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
    return serialiseWrite(() => withLogoCacheErase(async () => {
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
    }));
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
