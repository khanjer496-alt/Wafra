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

const DATABASE_NAME = 'wafra-relay-inbox.db';
const KEY_NAME = 'wafra.relay.inbox.key.v1';
const TABLE = 'relay_inbox';
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
    const db = await database();
    await db.runAsync(
      `INSERT INTO ${TABLE} (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      value,
      Date.now(),
    );
  },
  async removeItem(key: string): Promise<void> {
    const db = await database();
    await db.runAsync(`DELETE FROM ${TABLE} WHERE key = ?`, key);
  },
  /**
   * Delete `key` only while it still holds exactly `expected` — the bytes the
   * caller read. See the web sibling for why an unconditional delete loses
   * transactions; this is the implementation that ships.
   *
   * The compare and the delete are ONE statement on purpose. A headless wake
   * and the UI share this JS runtime, so every `await` in a read-compare-write
   * is a point where `appendDurable()` can interleave, and the rows it wrote
   * and acknowledged would then be deleted by a comparison that had already
   * passed. SQLite evaluates the WHERE and the DELETE together, so there is no
   * such point here.
   *
   * Returns whether the delete happened; `false` means another writer moved
   * the value on and the caller must leave the queue for the next import.
   */
  async removeItemIfUnchanged(key: string, expected: string | null): Promise<boolean> {
    if (expected === null) return false;
    const db = await database();
    const result = await db.runAsync(
      `DELETE FROM ${TABLE} WHERE key = ? AND value = ?`,
      key,
      expected,
    );
    return result.changes > 0;
  },
};
