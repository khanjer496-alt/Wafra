/**
 * The encrypted store.
 *
 * Everything the user has ever spent lives in one SQLite file protected by
 * SQLCipher, with a 256-bit key that exists only in the device keystore and is
 * never derived from anything the user types. The shape of that file — its
 * DDL, its migrations, and every row/domain conversion — is in db-schema.ts,
 * which is pure so the migration can be proven correct off-device. This file
 * is the part that cannot be: opening, keying, migrating, and the one-time
 * rescue of the ledger out of the old AsyncStorage blob.
 *
 * Three things here are load-bearing and easy to undo by accident:
 *
 *  1. `PRAGMA key` must be the first statement on the connection, and every
 *     connection needs it. That rules out `withExclusiveTransactionAsync`,
 *     which opens a second native connection behind your back (`useNewConnection:
 *     true`) that never gets keyed and fails with "file is not a database".
 *  2. The key is written to SecureStore BEFORE the database file is created.
 *     A crash in between then leaves an unused key and no file, which the next
 *     launch shrugs off. The other order leaves a file nothing can ever open.
 *  3. The legacy blob is not deleted on the launch that imports it. It is
 *     reclaimed a launch later, once the encrypted database has proven it
 *     opens and reads.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import {
  ALL_TABLES,
  emptyRows,
  META_LEGACY_IMPORTED,
  META_LEGACY_RETAINED,
  META_LEGACY_TX_CHUNKS,
  MIGRATIONS,
  TABLE_SOURCES,
  accountToRow,
  billToRow,
  budgetToRow,
  cardDueToRow,
  goalToRow,
  legacyStateToRows,
  migrationsToApply,
  rowToAccount,
  rowToBill,
  rowToBudget,
  rowToCardDue,
  rowToGoal,
  rowToTransaction,
  rowValues,
  rowsToSettings,
  rowsToState,
  settingsToRows,
  stateToRows,
  transactionToRow,
  upsertSql,
  type AccountHintRow,
  type AccountRow,
  type BillRow,
  type BudgetRow,
  type CardDueRow,
  type DbRows,
  type GoalRow,
  type LegacyDropCounts,
  type MerchantOverrideRow,
  type NotSubscriptionRow,
  type ScalarSettings,
  type SettingRow,
  type TableName,
  type TransactionRow,
} from '@/lib/db-schema';
import type {
  Account,
  AppState,
  Bill,
  Budget,
  CardDue,
  CategoryId,
  Goal,
  Transaction,
} from '@/lib/types';

export const DATABASE_NAME = 'wafra.db';

/** SecureStore keys accept alphanumerics, `.`, `-` and `_` only. */
const KEY_ALIAS = 'wafra.db.key';
const KEYCHAIN_SERVICE = 'wafra.db';

/**
 * AFTER_FIRST_UNLOCK, not WHEN_UNLOCKED: the SMS receiver can fire while the
 * screen is locked, and a key it cannot read means a dropped alert.
 * THIS_DEVICE_ONLY because the key must never ride an iCloud keychain backup
 * to a phone that has no matching database file — a key without its file is
 * indistinguishable from key loss, and would send a fresh install straight
 * into the unrecoverable path below.
 *
 * `requireAuthentication` is deliberately off. The app's own lock screen
 * (expo-local-authentication) guards the UI; gating the database key behind
 * biometrics would also gate every background import, and a fingerprint change
 * would invalidate the key and destroy the ledger outright.
 */
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: KEYCHAIN_SERVICE,
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** The legacy AsyncStorage keys, mirrored from store.tsx. */
const LEGACY_KEY = 'wafra/state/v1';
const legacyChunkKey = (i: number) => `${LEGACY_KEY}:tx:${i}`;

/**
 * The database exists but its key does not, or no longer opens it.
 *
 * There is no way back from this by design: SQLCipher without the key is
 * random bytes, and if the app could recover from a missing key then so could
 * anyone holding the phone. The deliberate choice is that this is NOT handled
 * silently. Wiping the file and starting fresh would delete years of a user's
 * finances without them ever being told it happened, so the error propagates
 * and the UI has to say what is lost and get consent before calling
 * `resetEncryptedDatabase()`.
 *
 * In practice this is survivable more often than it sounds: the old
 * AsyncStorage blob is retained past the migration launch, and an Android SMS
 * rescan rebuilds most of an imported ledger from the inbox.
 */
export class DatabaseKeyLostError extends Error {
  constructor(readonly reason: 'missing-key' | 'key-mismatch') {
    super(
      reason === 'missing-key'
        ? 'the database encryption key is no longer in the keystore'
        : 'the stored key does not open the database file',
    );
    this.name = 'DatabaseKeyLostError';
  }
}

export interface DbStatus {
  /** False only on web, which has no SQLCipher build and no SecureStore. */
  encrypted: boolean;
  /** True on the single launch that moved the legacy blob into SQL. */
  importedLegacy: boolean;
  /** Entries the legacy conversion refused to carry over, when it ran. */
  dropped?: LegacyDropCounts;
}

let handle: SQLite.SQLiteDatabase | null = null;
let encrypted = false;

function requireDb(): SQLite.SQLiteDatabase {
  if (!handle) throw new Error('database not initialised — call initDatabase() first');
  return handle;
}

export function isDatabaseReady(): boolean {
  return handle !== null;
}

// ── Key management ───────────────────────────────────────────────────────────

const KEY_HEX = /^[0-9a-f]{64}$/;

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * A raw 256-bit key, hex-encoded. SQLCipher accepts `x'<64 hex chars>'` as a
 * literal key and skips its PBKDF2 pass entirely, which is right here: the
 * bytes already carry full entropy, so a key derivation function would only
 * add a fixed cost to every cold start while making the key no harder to
 * guess. Passphrase mode exists for keys people can remember; this one is
 * never seen by a human.
 */
async function generateKeyHex(): Promise<string> {
  return toHex(await Crypto.getRandomBytesAsync(32));
}

/**
 * `execAsync` does not escape anything, so the key is spliced into SQL text.
 * That is safe only because the value is checked to be exactly 64 hex
 * characters first — a key that failed this check would be an injection point
 * straight into the pragma. Anything unexpected in the keystore is treated as
 * key loss rather than something to repair.
 */
async function applyKey(database: SQLite.SQLiteDatabase, keyHex: string): Promise<void> {
  if (!KEY_HEX.test(keyHex)) throw new DatabaseKeyLostError('missing-key');
  await database.execAsync(`PRAGMA key = "x'${keyHex}'"`);
}

// ── Opening ──────────────────────────────────────────────────────────────────

/**
 * Reading `sqlite_master` is how a wrong key announces itself: SQLCipher
 * cannot decrypt the page holding the schema and the query throws. There is no
 * pragma that answers "is this key correct", so the check has to be a real
 * read, and it has to happen before migrations touch anything.
 */
async function keyOpensDatabase(database: SQLite.SQLiteDatabase): Promise<boolean> {
  try {
    await database.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM sqlite_master');
    return true;
  } catch {
    return false;
  }
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  // Web has no SQLCipher build and no SecureStore, so the preview build runs
  // on a plain database. Refusing to open would break `expo start --web` for
  // everyone, and quietly reporting it as encrypted would be a lie the
  // Settings screen then repeats to the user — hence `DbStatus.encrypted`.
  if (Platform.OS === 'web') {
    encrypted = false;
    return SQLite.openDatabaseAsync(DATABASE_NAME);
  }

  const stored = await SecureStore.getItemAsync(KEY_ALIAS, KEY_OPTIONS);
  const keyHex = stored ?? (await generateKeyHex());
  const isFreshKey = stored === null;
  if (isFreshKey) {
    // Persist before the file exists. See the note at the top of the file:
    // this ordering is what makes a crash during first launch harmless.
    await SecureStore.setItemAsync(KEY_ALIAS, keyHex, KEY_OPTIONS);
  }

  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await applyKey(database, keyHex);
  if (!(await keyOpensDatabase(database))) {
    await database.closeAsync().catch(() => undefined);
    if (isFreshKey) {
      // A key we just minted cannot open a file that already existed, so the
      // real key is gone. Drop the new one rather than leaving a key in the
      // keystore that is known not to work — the next launch should reach the
      // same conclusion from the same evidence, not from a bad key we left.
      await SecureStore.deleteItemAsync(KEY_ALIAS, KEY_OPTIONS).catch(() => undefined);
      throw new DatabaseKeyLostError('missing-key');
    }
    throw new DatabaseKeyLostError('key-mismatch');
  }
  encrypted = true;
  return database;
}

/**
 * Deletes the encrypted file and its key, then rebuilds from scratch. The only
 * exit from `DatabaseKeyLostError`, and it destroys data — call it after the
 * user has been told what is going and has agreed, never automatically.
 *
 * If the legacy blob is still on disk (key loss shortly after upgrading), the
 * fresh database re-imports it, because the import is driven by a meta row
 * that dies with the old file.
 */
export async function resetEncryptedDatabase(): Promise<DbStatus> {
  if (handle) {
    await handle.closeAsync().catch(() => undefined);
    handle = null;
  }
  await SQLite.deleteDatabaseAsync(DATABASE_NAME).catch(() => undefined);
  if (Platform.OS !== 'web') {
    await SecureStore.deleteItemAsync(KEY_ALIAS, KEY_OPTIONS).catch(() => undefined);
  }
  return initDatabase();
}

// ── Migrations ───────────────────────────────────────────────────────────────

async function migrate(database: SQLite.SQLiteDatabase): Promise<void> {
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const pending = migrationsToApply(row?.user_version ?? 0, MIGRATIONS);
  for (const migration of pending) {
    // One transaction per migration, with the version bump inside it.
    // `user_version` lives in the database header and is transactional, so a
    // process killed mid-migration rolls back to its old version and the next
    // launch replays the whole step instead of resuming half-way.
    await database.withTransactionAsync(async () => {
      for (const statement of migration.statements) {
        await database.execAsync(statement);
      }
      await database.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

export async function initDatabase(): Promise<DbStatus> {
  if (handle) return { encrypted, importedLegacy: false };
  const database = await openDatabase();
  // WAL keeps a long import from blocking the reads the UI is doing at the
  // same time. `synchronous = NORMAL` is the pairing WAL is designed around:
  // a hard power cut can cost the last committed transaction, but cannot
  // corrupt the file, and FULL would fsync on every single row of a 5,000-row
  // SMS import for a durability window measured in milliseconds.
  await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  await migrate(database);
  handle = database;

  const imported = await importLegacyBlob(database);
  if (!imported.ran) await reclaimLegacyBlob(database);

  return { encrypted, importedLegacy: imported.ran, dropped: imported.dropped };
}

export async function closeDatabase(): Promise<void> {
  if (!handle) return;
  const database = handle;
  handle = null;
  await database.closeAsync().catch(() => undefined);
}

// ── Legacy import ────────────────────────────────────────────────────────────

async function getMeta(database: SQLite.SQLiteDatabase, key: string): Promise<string | null> {
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

async function setMeta(database: SQLite.SQLiteDatabase, key: string, value: string): Promise<void> {
  await database.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
}

/**
 * Reassembles the blob store.tsx writes today. Transactions were split across
 * `:tx:N` keys because Android caps a single AsyncStorage row at ~2MB and a
 * full SMS history blew past it; a device that upgraded mid-history can have
 * either layout, so both are read.
 */
async function readLegacyBlob(): Promise<{ state: Record<string, unknown>; chunks: number } | null> {
  const raw = await AsyncStorage.getItem(LEGACY_KEY);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unparseable meta means the ledger is already unreadable by the old code
    // path too. Nothing to rescue, and no reason to keep retrying every launch.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const state = parsed as Record<string, unknown>;
  if (Array.isArray(state.transactions)) return { state, chunks: 0 };

  const chunks = Number(state.txChunks) || 0;
  const transactions: unknown[] = [];
  if (chunks > 0) {
    const pairs = await AsyncStorage.multiGet(
      Array.from({ length: chunks }, (_, i) => legacyChunkKey(i)),
    );
    for (const [, value] of pairs) {
      if (!value) continue;
      try {
        const rows: unknown = JSON.parse(value);
        if (Array.isArray(rows)) transactions.push(...rows);
      } catch {
        // A single corrupt chunk costs those ~400 rows, not the whole import.
      }
    }
  }
  state.transactions = transactions;
  return { state, chunks };
}

async function importLegacyBlob(
  database: SQLite.SQLiteDatabase,
): Promise<{ ran: boolean; dropped?: LegacyDropCounts }> {
  if ((await getMeta(database, META_LEGACY_IMPORTED)) === '1') return { ran: false };

  const legacy = await readLegacyBlob();
  if (!legacy) {
    // Fresh install (or nothing salvageable). Record it so the AsyncStorage
    // read never happens again — it is otherwise a disk hit on every launch
    // for the entire life of the app.
    await setMeta(database, META_LEGACY_IMPORTED, '1');
    await setMeta(database, META_LEGACY_RETAINED, '0');
    return { ran: false };
  }

  const { rows, dropped } = legacyStateToRows(legacy.state);
  // Rows and the "already imported" flag commit together. If they did not, a
  // crash after the insert would re-run the import on the next launch and
  // double every transaction — the ids would collide and REPLACE, but any row
  // the user had since deleted would come back from the dead.
  await database.withTransactionAsync(async () => {
    await insertRows(database, rows);
    await setMeta(database, META_LEGACY_IMPORTED, '1');
    await setMeta(database, META_LEGACY_RETAINED, '1');
    await setMeta(database, META_LEGACY_TX_CHUNKS, String(legacy.chunks));
  });
  return { ran: true, dropped };
}

/**
 * Frees the old AsyncStorage keys — but only on a launch AFTER the one that
 * imported them. Deleting the blob in the same breath as writing the rows
 * means a crash in between, or a first read that turns out to fail, leaves the
 * user with neither copy. Costing a few megabytes for one extra launch is the
 * cheapest insurance in the app.
 */
async function reclaimLegacyBlob(database: SQLite.SQLiteDatabase): Promise<void> {
  if ((await getMeta(database, META_LEGACY_RETAINED)) !== '1') return;
  const chunks = Number(await getMeta(database, META_LEGACY_TX_CHUNKS)) || 0;
  const keys = [LEGACY_KEY, ...Array.from({ length: chunks }, (_, i) => legacyChunkKey(i))];
  try {
    await AsyncStorage.multiRemove(keys);
  } catch {
    // The flag stays at '1', so the next launch tries again. A blob that never
    // goes away is wasted space, never lost data.
    return;
  }
  await setMeta(database, META_LEGACY_RETAINED, '0');
}

// ── Bulk insert ──────────────────────────────────────────────────────────────

/**
 * One prepared statement per table, re-executed per row. Preparing inside the
 * loop instead would re-plan the same INSERT five thousand times during the
 * migration of a real inbox, which is most of the cost of the import.
 *
 * The caller owns the transaction — every path that inserts rows in bulk is
 * one that must not land half-written.
 */
async function insertRows(database: SQLite.SQLiteDatabase, rows: DbRows): Promise<void> {
  for (const { table, key } of TABLE_SOURCES) {
    const list: object[] = rows[key];
    if (list.length === 0) continue;
    const statement = await database.prepareAsync(upsertSql(table));
    try {
      for (const row of list) {
        await statement.executeAsync(rowValues(table, row));
      }
    } finally {
      await statement.finalizeAsync();
    }
  }
}

// ── Write serialisation ──────────────────────────────────────────────────────

/**
 * SQLite has no nested transactions, and `withTransactionAsync` runs a bare
 * BEGIN on the shared connection. Two writes that overlap — an SMS import
 * landing while the user saves a budget — would make the second one throw
 * "cannot start a transaction within a transaction", so writes queue.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function write<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(async () => {
    const database = requireDb();
    let result!: T;
    await database.withTransactionAsync(async () => {
      result = await task();
    });
    return result;
  });
  // The queue tracks completion, not success: one failed write must not wedge
  // every write after it.
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Read/modify/write for a single row. Patching by rebuilding the whole row
 * costs one extra SELECT and buys not having to hand-maintain a
 * domain-field → column map (and its `undefined` handling) for six entities.
 * The merge is `{...current, ...patch}`, matching what the store's reducer
 * does today, so a patch key explicitly set to undefined clears the field.
 */
async function patchRow<D extends object, R extends object>(
  table: TableName,
  idColumn: string,
  id: string,
  toDomain: (row: R) => D,
  toRow: (value: D) => R,
  patch: Partial<D>,
): Promise<boolean> {
  const database = requireDb();
  const row = await database.getFirstAsync<R>(
    `SELECT * FROM ${table} WHERE ${idColumn} = ?`,
    [id],
  );
  if (!row) return false;
  const next = toRow({ ...toDomain(row), ...patch } as D);
  await database.runAsync(upsertSql(table), rowValues(table, next));
  return true;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export interface TxFilter {
  /** Inclusive ISO date lower bound. */
  from?: string;
  /** Inclusive ISO date upper bound. */
  to?: string;
  accountId?: string;
  category?: CategoryId;
  /** Card payments and own-account moves. Excluded from spending analytics. */
  includeTransfers?: boolean;
  limit?: number;
  offset?: number;
}

function whereClause(filter: TxFilter): { sql: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.from) {
    clauses.push('date >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push('date <= ?');
    params.push(filter.to);
  }
  if (filter.accountId) {
    clauses.push('account_id = ?');
    params.push(filter.accountId);
  }
  if (filter.category) {
    clauses.push('category = ?');
    params.push(filter.category);
  }
  if (filter.includeTransfers === false) clauses.push('is_transfer = 0');
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

export interface CategoryTotal {
  category: CategoryId;
  expenseFils: number;
  incomeFils: number;
}

export interface AccountTotal {
  accountId: string;
  /** Income minus expense on this account; add the account's opening balance. */
  netFils: number;
}

export const db = {
  /**
   * The whole ledger as the store's current AppState shape. This is the bridge
   * that lets store.tsx switch substrate in one move; the filtered reads below
   * are what replace it screen by screen, and are the reason the indices exist.
   */
  async loadState(): Promise<Omit<AppState, 'hydrated'>> {
    const database = requireDb();
    const rows: DbRows = emptyRows();
    rows.accounts = await database.getAllAsync<AccountRow>('SELECT * FROM accounts');
    rows.transactions = await database.getAllAsync<TransactionRow>(
      'SELECT * FROM transactions ORDER BY date DESC, id DESC',
    );
    rows.budgets = await database.getAllAsync<BudgetRow>('SELECT * FROM budgets');
    rows.bills = await database.getAllAsync<BillRow>('SELECT * FROM bills');
    rows.cardDues = await database.getAllAsync<CardDueRow>('SELECT * FROM card_dues');
    rows.goals = await database.getAllAsync<GoalRow>('SELECT * FROM goals');
    rows.merchantOverrides =
      await database.getAllAsync<MerchantOverrideRow>('SELECT * FROM merchant_overrides');
    rows.accountHints = await database.getAllAsync<AccountHintRow>('SELECT * FROM account_hints');
    rows.notSubscriptions =
      await database.getAllAsync<NotSubscriptionRow>('SELECT * FROM not_subscriptions');
    rows.settings = await database.getAllAsync<SettingRow>('SELECT * FROM settings');
    return rowsToState(rows);
  },

  async listTransactions(filter: TxFilter = {}): Promise<Transaction[]> {
    const database = requireDb();
    const { sql, params } = whereClause(filter);
    // id breaks the tie so paging is stable: several rows a day share a date,
    // and an unordered tail means page 2 can repeat or skip a transaction.
    let query = `SELECT * FROM transactions${sql} ORDER BY date DESC, id DESC`;
    const bound: (string | number)[] = [...params];
    if (filter.limit !== undefined) {
      query += ' LIMIT ?';
      bound.push(filter.limit);
      if (filter.offset !== undefined) {
        query += ' OFFSET ?';
        bound.push(filter.offset);
      }
    }
    const rows = await database.getAllAsync<TransactionRow>(query, bound);
    return rows.map(rowToTransaction);
  },

  async countTransactions(filter: TxFilter = {}): Promise<number> {
    const database = requireDb();
    const { sql, params } = whereClause(filter);
    const row = await database.getFirstAsync<{ n: number }>(
      `SELECT count(*) AS n FROM transactions${sql}`,
      params,
    );
    return row?.n ?? 0;
  },

  async getTransaction(id: string): Promise<Transaction | null> {
    const row = await requireDb().getFirstAsync<TransactionRow>(
      'SELECT * FROM transactions WHERE id = ?',
      [id],
    );
    return row ? rowToTransaction(row) : null;
  },

  /**
   * Spend and income per category over a range, summed in SQL. The budgets
   * screen asks this once per category and analytics asks it per month; doing
   * it in JS means shipping the whole ledger across the bridge to add numbers
   * SQLite can add without leaving the storage engine.
   */
  async sumByCategory(from: string, to: string): Promise<CategoryTotal[]> {
    const rows = await requireDb().getAllAsync<{
      category: string;
      expense_fils: number;
      income_fils: number;
    }>(
      `SELECT category,
              COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_fils END), 0) AS expense_fils,
              COALESCE(SUM(CASE WHEN type = 'income'  THEN amount_fils END), 0) AS income_fils
         FROM transactions
        WHERE date >= ? AND date <= ? AND is_transfer = 0
        GROUP BY category`,
      [from, to],
    );
    return rows.map((r) => ({
      category: r.category as CategoryId,
      expenseFils: r.expense_fils,
      incomeFils: r.income_fils,
    }));
  },

  /** Net movement per account. Opening balances are added by balances.ts. */
  async accountTotals(): Promise<AccountTotal[]> {
    const rows = await requireDb().getAllAsync<{ account_id: string; net_fils: number }>(
      `SELECT account_id,
              COALESCE(SUM(CASE WHEN type = 'income' THEN amount_fils ELSE -amount_fils END), 0) AS net_fils
         FROM transactions
        GROUP BY account_id`,
    );
    return rows.map((r) => ({ accountId: r.account_id, netFils: r.net_fils }));
  },

  /**
   * Every SMS fingerprint already stored. A rescan tests thousands of parsed
   * messages against this; reading the one indexed column is a fraction of the
   * cost of materialising every transaction just to look at `smsKey`.
   */
  async smsKeys(): Promise<Set<string>> {
    const rows = await requireDb().getAllAsync<{ sms_key: string }>(
      'SELECT sms_key FROM transactions WHERE sms_key IS NOT NULL',
    );
    return new Set(rows.map((r) => r.sms_key));
  },

  async listAccounts(): Promise<Account[]> {
    const rows = await requireDb().getAllAsync<AccountRow>('SELECT * FROM accounts');
    return rows.map(rowToAccount);
  },

  async listBudgets(): Promise<Budget[]> {
    const rows = await requireDb().getAllAsync<BudgetRow>('SELECT * FROM budgets');
    return rows.map(rowToBudget);
  },

  async listBills(): Promise<Bill[]> {
    const rows = await requireDb().getAllAsync<BillRow>('SELECT * FROM bills');
    return rows.map(rowToBill);
  },

  async listCardDues(): Promise<CardDue[]> {
    const rows = await requireDb().getAllAsync<CardDueRow>(
      'SELECT * FROM card_dues ORDER BY due_date',
    );
    return rows.map(rowToCardDue);
  },

  async listGoals(): Promise<Goal[]> {
    const rows = await requireDb().getAllAsync<GoalRow>('SELECT * FROM goals');
    return rows.map(rowToGoal);
  },

  async getSettings(): Promise<ScalarSettings> {
    const rows = await requireDb().getAllAsync<SettingRow>('SELECT * FROM settings');
    return rowsToSettings(rows);
  },

  // ── Writes ─────────────────────────────────────────────────────────────────

  insertTransaction(tx: Transaction): Promise<void> {
    return write(async () => {
      await requireDb().runAsync(
        upsertSql('transactions'),
        rowValues('transactions', transactionToRow(tx)),
      );
    });
  },

  /** The import path. One transaction, one prepared statement, one commit. */
  insertTransactions(list: readonly Transaction[]): Promise<void> {
    if (list.length === 0) return Promise.resolve();
    return write(async () => {
      const rows = emptyRows();
      rows.transactions = list.map(transactionToRow);
      await insertRows(requireDb(), rows);
    });
  },

  updateTransaction(id: string, patch: Partial<Omit<Transaction, 'id'>>): Promise<boolean> {
    return write(() =>
      patchRow<Transaction, TransactionRow>(
        'transactions',
        'id',
        id,
        rowToTransaction,
        transactionToRow,
        patch,
      ),
    );
  },

  deleteTransaction(id: string): Promise<void> {
    return write(async () => {
      await requireDb().runAsync('DELETE FROM transactions WHERE id = ?', [id]);
    });
  },

  deleteTransactions(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return Promise.resolve();
    return write(async () => {
      const database = requireDb();
      // Chunked because SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 999 on
      // older Android builds, and an undo of a full-history import can hand us
      // thousands of ids at once.
      for (let i = 0; i < ids.length; i += 500) {
        const slice = ids.slice(i, i + 500);
        await database.runAsync(
          `DELETE FROM transactions WHERE id IN (${slice.map(() => '?').join(', ')})`,
          [...slice],
        );
      }
    });
  },

  upsertAccount(account: Account): Promise<void> {
    return write(async () => {
      await requireDb().runAsync(upsertSql('accounts'), rowValues('accounts', accountToRow(account)));
    });
  },

  updateAccount(id: string, patch: Partial<Omit<Account, 'id'>>): Promise<boolean> {
    return write(() =>
      patchRow<Account, AccountRow>('accounts', 'id', id, rowToAccount, accountToRow, patch),
    );
  },

  /**
   * Deleting an account takes its transactions, statement dues and card hints
   * with it, exactly as the store's reducer does today.
   *
   * The cascade is written out rather than declared as ON DELETE CASCADE
   * because the schema has no foreign keys at all, and that is on purpose: a
   * legacy blob can hold transactions whose accountId is `''` (rows recorded
   * before any account existed) or points at an account deleted by an older
   * build. A foreign key would abort the one-time import on the first such row
   * and take the entire ledger with it — a constraint that protects the
   * database by destroying the data is not a trade worth making here.
   */
  deleteAccount(id: string): Promise<void> {
    return write(async () => {
      const database = requireDb();
      await database.runAsync('DELETE FROM transactions WHERE account_id = ?', [id]);
      await database.runAsync('DELETE FROM card_dues WHERE account_id = ?', [id]);
      await database.runAsync('DELETE FROM account_hints WHERE account_id = ?', [id]);
      await database.runAsync('DELETE FROM accounts WHERE id = ?', [id]);
    });
  },

  upsertBudget(budget: Budget): Promise<void> {
    return write(async () => {
      await requireDb().runAsync(upsertSql('budgets'), rowValues('budgets', budgetToRow(budget)));
    });
  },

  deleteBudget(category: CategoryId): Promise<void> {
    return write(async () => {
      await requireDb().runAsync('DELETE FROM budgets WHERE category = ?', [category]);
    });
  },

  upsertBill(bill: Bill): Promise<void> {
    return write(async () => {
      await requireDb().runAsync(upsertSql('bills'), rowValues('bills', billToRow(bill)));
    });
  },

  updateBill(id: string, patch: Partial<Omit<Bill, 'id'>>): Promise<boolean> {
    return write(() => patchRow<Bill, BillRow>('bills', 'id', id, rowToBill, billToRow, patch));
  },

  deleteBill(id: string): Promise<void> {
    return write(async () => {
      await requireDb().runAsync('DELETE FROM bills WHERE id = ?', [id]);
    });
  },

  upsertCardDue(due: CardDue): Promise<void> {
    return write(async () => {
      await requireDb().runAsync(upsertSql('card_dues'), rowValues('card_dues', cardDueToRow(due)));
    });
  },

  updateCardDue(id: string, patch: Partial<Omit<CardDue, 'id'>>): Promise<boolean> {
    return write(() =>
      patchRow<CardDue, CardDueRow>('card_dues', 'id', id, rowToCardDue, cardDueToRow, patch),
    );
  },

  deleteCardDue(id: string): Promise<void> {
    return write(async () => {
      await requireDb().runAsync('DELETE FROM card_dues WHERE id = ?', [id]);
    });
  },

  upsertGoal(goal: Goal): Promise<void> {
    return write(async () => {
      await requireDb().runAsync(upsertSql('goals'), rowValues('goals', goalToRow(goal)));
    });
  },

  updateGoal(id: string, patch: Partial<Omit<Goal, 'id'>>): Promise<boolean> {
    return write(() => patchRow<Goal, GoalRow>('goals', 'id', id, rowToGoal, goalToRow, patch));
  },

  deleteGoal(id: string): Promise<void> {
    return write(async () => {
      await requireDb().runAsync('DELETE FROM goals WHERE id = ?', [id]);
    });
  },

  setMerchantOverride(merchant: string, category: CategoryId): Promise<void> {
    return write(async () => {
      await requireDb().runAsync(upsertSql('merchant_overrides'), [
        merchant.trim().toLowerCase(),
        category,
      ]);
    });
  },

  setAccountHint(last4: string, accountId: string): Promise<void> {
    return write(async () => {
      await requireDb().runAsync(upsertSql('account_hints'), [last4, accountId]);
    });
  },

  setNotSubscription(merchant: string, dismissed: boolean): Promise<void> {
    return write(async () => {
      const key = merchant.trim().toLowerCase();
      const database = requireDb();
      if (dismissed) await database.runAsync(upsertSql('not_subscriptions'), [key]);
      else await database.runAsync('DELETE FROM not_subscriptions WHERE merchant = ?', [key]);
    });
  },

  /** Writes only the keys present; anything omitted keeps its stored value. */
  saveSettings(patch: Partial<ScalarSettings>): Promise<void> {
    const rows = settingsToRows(patch);
    if (rows.length === 0) return Promise.resolve();
    return write(async () => {
      const database = requireDb();
      for (const row of rows) {
        await database.runAsync(upsertSql('settings'), [row.key, row.value]);
      }
    });
  },

  /**
   * Backup restore and demo data: the new state replaces the old one whole.
   * The wipe and the refill share a transaction, so a failure part-way leaves
   * the previous ledger intact rather than an empty app.
   */
  replaceAll(state: Partial<Omit<AppState, 'hydrated'>>): Promise<void> {
    const rows = stateToRows(state);
    return write(async () => {
      const database = requireDb();
      for (const table of ALL_TABLES) await database.execAsync(`DELETE FROM ${table}`);
      await insertRows(database, rows);
    });
  },

  /** Erase everything the user owns. `meta` survives: the legacy import must
   *  not be re-run over a database the user just asked to be emptied. */
  clearAll(): Promise<void> {
    return write(async () => {
      const database = requireDb();
      for (const table of ALL_TABLES) await database.execAsync(`DELETE FROM ${table}`);
    });
  },
};

export type Repository = typeof db;
