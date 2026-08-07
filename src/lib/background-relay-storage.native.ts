/**
 * A tiny encrypted inbox that remains available to an iOS background wake
 * after the user has unlocked once since boot. The main ledger deliberately
 * remains WHEN_UNLOCKED; only already-parsed, device-sealed relay rows are
 * staged here and folded into the main SQLCipher ledger on foreground.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import { recordStorageFailure } from '@/lib/storage-diagnostics';

const DATABASE_NAME = 'wafra-relay-inbox.db';
const KEY_NAME = 'wafra.relay.inbox.key.v1';
const TABLE = 'relay_inbox';
let databasePromise: Promise<SQLiteDatabase> | null = null;

/**
 * Writes and the erase run one at a time, for the same reason
 * `state-storage.native.ts` serialises its own.
 *
 * This inbox is written from a HEADLESS wake and erased from the UI process,
 * and on iOS those are the same process: a silent push can land while the user
 * is on the Settings screen. Without this queue an `appendDurable` could sit
 * between `destroy`'s close and its unlink, reopen the database, and recreate
 * the inbox the user just erased — with rows the relay had already been told
 * the device was holding.
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
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return key;
}

async function database(): Promise<SQLiteDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = (async () => {
    const key = await databaseKey();
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    await db.execAsync(`
      PRAGMA cipher_memory_security = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    return db;
  })().catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

export const backgroundRelayStorage = {
  async getItem(key: string): Promise<string | null> {
    const db = await database();
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM ${TABLE} WHERE key = ?`,
      key,
    );
    return row?.value ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    return serialiseWrite(async () => {
      // Acquired INSIDE the queued task, never before it — a `destroy` sitting
      // ahead of us in the queue is about to close the handle this would
      // otherwise have captured.
      const db = await database();
      await db.runAsync(
        `INSERT INTO ${TABLE} (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        key,
        value,
        Date.now(),
      );
    });
  },
  async removeItem(key: string): Promise<void> {
    return serialiseWrite(async () => {
      const db = await database();
      await db.runAsync(`DELETE FROM ${TABLE} WHERE key = ?`, key);
    });
  },
};

/**
 * Erase the staged inbox: its SQLCipher file and the Keychain key that opens
 * it. This is half of "Erase all data", and until it existed the other half was
 * a lie.
 *
 * `clearAll` destroyed `wafra-private.db` and nothing else, so a silent push
 * that had already staged parsed rows here — and told the relay the device was
 * holding them, so the server deleted its copy — left those transactions on the
 * phone after the user asked for everything to be erased. `capture.ts` folds
 * staged rows into the ledger on the next foreground import whether or not a
 * relay is still configured, so they came BACK, into a ledger the app had just
 * promised was blank. The published privacy policy says this queue is deleted.
 *
 * Shaped exactly like `state-storage.native.ts`'s `destroy`, deliberately:
 *
 *   - the whole body is inside the write queue, so no concurrent wake can
 *     reopen the file between the close and the unlink;
 *   - the KEY goes before the FILE, so a failed unlink fails closed — what is
 *     left on disk, including any `-wal` sidecar, is SQLCipher ciphertext whose
 *     only key has already left the Keychain;
 *   - every step is attempted even after an earlier one failed, and the first
 *     failure is recorded and rethrown, so a caller can never report a
 *     successful erase over a partial one.
 *
 * The one difference is the unkeyed open before the delete.
 * `SQLite.deleteDatabaseAsync` throws `DatabaseNotFoundException` when the file
 * does not exist, and this inbox is only ever created by an actual relay
 * delivery — so on Android, and on an iPhone whose Shortcut has never fired,
 * "there was nothing to erase" would otherwise be indistinguishable from "the
 * erase failed" and every erase on those devices would report failure. Opening
 * the path unkeyed creates the file when it is missing (expo-sqlite runs no SQL
 * at open, so this touches no cipher state) and puts both cases on one code
 * path. Closing it again is what releases it from expo-sqlite's connection
 * cache, which refuses to delete an open database.
 */
export async function destroyBackgroundRelayInbox(): Promise<void> {
  return serialiseWrite(async () => {
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
      const handle = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await handle.closeAsync();
      await SQLite.deleteDatabaseAsync(DATABASE_NAME);
    } catch (error) {
      databaseError = error;
    }

    const failure = databaseError ?? keyError ?? closeError;
    if (failure) {
      recordStorageFailure('destroy', failure);
      throw failure;
    }
  });
}
