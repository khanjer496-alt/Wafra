/**
 * The shape of Wafra's encrypted database, and every conversion between a SQL
 * row and the domain objects in types.ts.
 *
 * Nothing here touches Expo, React Native, or the filesystem. That is
 * deliberate: the migration that moves a real user's ledger out of the old
 * AsyncStorage blob is the one piece of this feature that gets exactly one
 * chance to be correct on their device, so it has to be runnable — and
 * breakable — under plain Node in the test suite. db.ts is the thin runtime
 * shell that opens a database and executes what this file describes.
 */
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

// ── Tables ───────────────────────────────────────────────────────────────────

export const TABLES = {
  accounts: 'accounts',
  transactions: 'transactions',
  budgets: 'budgets',
  bills: 'bills',
  cardDues: 'card_dues',
  goals: 'goals',
  merchantOverrides: 'merchant_overrides',
  accountHints: 'account_hints',
  notSubscriptions: 'not_subscriptions',
  settings: 'settings',
  meta: 'meta',
} as const;

/**
 * Columns are snake_case while the domain stays camelCase, so a row and a
 * domain object can never be confused for one another by accident — passing an
 * `Account` where an `AccountRow` belongs is a type error rather than a silent
 * write of `undefined` into every column.
 *
 * Optional booleans (`archived`, `isTransfer`, `userEdited`, `autoDetected`)
 * are NOT NULL DEFAULT 0 rather than nullable. The app already treats absent
 * and false as the same thing (`!t.isTransfer` everywhere), and a two-valued
 * column lets analytics say `is_transfer = 0` instead of dragging a COALESCE
 * through every aggregate, which would defeat the indices below.
 */
export const DDL_ACCOUNTS = `
CREATE TABLE IF NOT EXISTS accounts (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL,
  opening_fils      INTEGER NOT NULL DEFAULT 0,
  color             TEXT NOT NULL,
  last4             TEXT,
  bank_name         TEXT,
  card_type         TEXT,
  snapshot_fils     INTEGER,
  snapshot_kind     TEXT,
  credit_limit_fils INTEGER,
  snapshot_ts       INTEGER,
  archived          INTEGER NOT NULL DEFAULT 0
)`;

export const DDL_TRANSACTIONS = `
CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT PRIMARY KEY NOT NULL,
  type        TEXT NOT NULL,
  amount_fils INTEGER NOT NULL,
  category    TEXT NOT NULL,
  account_id  TEXT NOT NULL,
  title       TEXT NOT NULL,
  note        TEXT,
  date        TEXT NOT NULL,
  source      TEXT,
  sms_key     TEXT,
  is_transfer INTEGER NOT NULL DEFAULT 0,
  user_edited INTEGER NOT NULL DEFAULT 0,
  raw         TEXT
)`;

export const DDL_BUDGETS = `
CREATE TABLE IF NOT EXISTS budgets (
  category   TEXT PRIMARY KEY NOT NULL,
  limit_fils INTEGER NOT NULL
)`;

/**
 * `paid_months` is a JSON array in one column instead of a child table. It is
 * a handful of YYYY-MM strings per bill, only ever read as a whole set when
 * the bill is rendered, and never joined or aggregated — a table would buy an
 * index nobody queries and cost a second round trip on every bill read.
 */
export const DDL_BILLS = `
CREATE TABLE IF NOT EXISTS bills (
  id            TEXT PRIMARY KEY NOT NULL,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL,
  amount_fils   INTEGER NOT NULL,
  due_day       INTEGER NOT NULL,
  account_id    TEXT,
  auto_detected INTEGER NOT NULL DEFAULT 0,
  paid_months   TEXT NOT NULL DEFAULT '[]'
)`;

export const DDL_CARD_DUES = `
CREATE TABLE IF NOT EXISTS card_dues (
  id             TEXT PRIMARY KEY NOT NULL,
  account_id     TEXT NOT NULL,
  total_due_fils INTEGER NOT NULL,
  min_due_fils   INTEGER NOT NULL,
  due_date       TEXT NOT NULL,
  paid_fils      INTEGER NOT NULL DEFAULT 0,
  settled_at     TEXT
)`;

export const DDL_GOALS = `
CREATE TABLE IF NOT EXISTS goals (
  id          TEXT PRIMARY KEY NOT NULL,
  title       TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  target_fils INTEGER NOT NULL,
  saved_fils  INTEGER NOT NULL DEFAULT 0
)`;

/**
 * The three learned maps get real tables rather than a JSON blob in `settings`
 * because they grow without bound as the user corrects the parser: a household
 * with years of SMS history accumulates hundreds of merchant overrides, and
 * rewriting that whole blob to record one correction is the exact failure of
 * the AsyncStorage design this database replaces.
 */
export const DDL_MERCHANT_OVERRIDES = `
CREATE TABLE IF NOT EXISTS merchant_overrides (
  merchant TEXT PRIMARY KEY NOT NULL,
  category TEXT NOT NULL
)`;

export const DDL_ACCOUNT_HINTS = `
CREATE TABLE IF NOT EXISTS account_hints (
  last4      TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL
)`;

export const DDL_NOT_SUBSCRIPTIONS = `
CREATE TABLE IF NOT EXISTS not_subscriptions (
  merchant TEXT PRIMARY KEY NOT NULL
)`;

/** Scalar app settings, one row per key, JSON-encoded value. */
export const DDL_SETTINGS = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
)`;

/**
 * Bookkeeping the app writes about itself — whether the legacy blob has been
 * imported, and whether it is still being retained as a safety net. Kept apart
 * from `settings` so that clearing user settings can never lose the record
 * that a migration already ran and re-run it over a live ledger.
 */
export const DDL_META = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
)`;

/**
 * Every index here exists for a query the app runs constantly. Nothing is here
 * "just in case": each one is write cost on every import, and a 5,000-row SMS
 * scan pays it 5,000 times.
 */
export const DDL_INDICES = [
  // Period filtering. Every screen scopes to a month (or a custom range) with
  // a BETWEEN on date and reads it newest-first, so this is the index the
  // entire app leans on. Without it a month view is a full table scan.
  `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`,
  // Wallet balances and per-account history: sum or list one account, almost
  // always inside a date window. Leading column account_id makes the account
  // an equality seek and leaves date usable for the range and the ordering.
  `CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account_id, date)`,
  // Budgets and analytics: spend per category for a month. Same shape as
  // above — equality on category, range on date — and it is the query that
  // runs once per category on the budgets screen, so a scan per category is
  // seventeen full scans of the ledger.
  `CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions(category, date)`,
  // Rescan dedupe. auto-import checks every parsed message against the smsKey
  // fingerprints already stored; a full-history rescan does that thousands of
  // times in a row. Partial, because manual rows have no fingerprint and
  // indexing their NULLs would just enlarge the index for nothing.
  `CREATE INDEX IF NOT EXISTS idx_transactions_sms_key ON transactions(sms_key) WHERE sms_key IS NOT NULL`,
  // Card dues are always looked at per card, oldest statement first (payment
  // allocation in cards.ts walks them in that order).
  `CREATE INDEX IF NOT EXISTS idx_card_dues_account ON card_dues(account_id, due_date)`,
] as const;

// ── Migrations ───────────────────────────────────────────────────────────────

export interface Migration {
  /** Target `user_version` once every statement below has run. */
  version: number;
  statements: readonly string[];
}

/**
 * Ordered, append-only. A shipped migration is never edited — a device that
 * already ran it will not run it again, so an edit only changes what NEW
 * installs get, and the two populations silently diverge. Fix a mistake by
 * appending the correction as the next version.
 *
 * Every statement is written so that running it against a database that
 * already has the object is a no-op (IF NOT EXISTS), which makes a crash
 * part-way through a migration recoverable: the version is only bumped after
 * the whole list commits, so the next launch simply replays it.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      DDL_ACCOUNTS,
      DDL_TRANSACTIONS,
      DDL_BUDGETS,
      DDL_BILLS,
      DDL_CARD_DUES,
      DDL_GOALS,
      DDL_MERCHANT_OVERRIDES,
      DDL_ACCOUNT_HINTS,
      DDL_NOT_SUBSCRIPTIONS,
      DDL_SETTINGS,
      DDL_META,
      ...DDL_INDICES,
    ],
  },
];

/** The `user_version` a fully migrated database reports. */
export const SCHEMA_VERSION: number = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Thrown when the file on disk was written by a build newer than this one.
 * Running our older statements over their newer schema is how you corrupt a
 * ledger, so a downgrade refuses to open rather than guessing.
 */
export class SchemaTooNewError extends Error {
  constructor(readonly found: number) {
    super(`database schema v${found} is newer than this build understands (v${SCHEMA_VERSION})`);
    this.name = 'SchemaTooNewError';
  }
}

/**
 * The migrations still owed by a database reporting `userVersion`, in the
 * order they must run. A fully migrated database returns an empty list, which
 * is what makes calling this on every launch cheap and idempotent.
 */
export function migrationsToApply(userVersion: number, list: readonly Migration[] = MIGRATIONS): Migration[] {
  const latest = list.length > 0 ? list[list.length - 1].version : 0;
  if (userVersion > latest) throw new SchemaTooNewError(userVersion);
  return list.filter((m) => m.version > userVersion).sort((a, b) => a.version - b.version);
}

// ── Row shapes ───────────────────────────────────────────────────────────────

/** SQLite has no boolean type; 0 and 1 are the only values we ever write. */
export type SqlBool = 0 | 1;

export interface AccountRow {
  id: string;
  name: string;
  kind: string;
  opening_fils: number;
  color: string;
  last4: string | null;
  bank_name: string | null;
  card_type: string | null;
  snapshot_fils: number | null;
  snapshot_kind: string | null;
  credit_limit_fils: number | null;
  snapshot_ts: number | null;
  archived: SqlBool;
}

export interface TransactionRow {
  id: string;
  type: string;
  amount_fils: number;
  category: string;
  account_id: string;
  title: string;
  note: string | null;
  date: string;
  source: string | null;
  sms_key: string | null;
  is_transfer: SqlBool;
  user_edited: SqlBool;
  raw: string | null;
}

export interface BudgetRow {
  category: string;
  limit_fils: number;
}

export interface BillRow {
  id: string;
  title: string;
  category: string;
  amount_fils: number;
  due_day: number;
  account_id: string | null;
  auto_detected: SqlBool;
  /** JSON array of YYYY-MM strings. */
  paid_months: string;
}

export interface CardDueRow {
  id: string;
  account_id: string;
  total_due_fils: number;
  min_due_fils: number;
  due_date: string;
  paid_fils: number;
  settled_at: string | null;
}

export interface GoalRow {
  id: string;
  title: string;
  emoji: string;
  target_fils: number;
  saved_fils: number;
}

export interface MerchantOverrideRow {
  merchant: string;
  category: string;
}

export interface AccountHintRow {
  last4: string;
  account_id: string;
}

export interface NotSubscriptionRow {
  merchant: string;
}

export interface SettingRow {
  key: string;
  value: string;
}

/** Everything a full database holds, as rows. The unit of import and restore. */
export interface DbRows {
  accounts: AccountRow[];
  transactions: TransactionRow[];
  budgets: BudgetRow[];
  bills: BillRow[];
  cardDues: CardDueRow[];
  goals: GoalRow[];
  merchantOverrides: MerchantOverrideRow[];
  accountHints: AccountHintRow[];
  notSubscriptions: NotSubscriptionRow[];
  settings: SettingRow[];
}

export function emptyRows(): DbRows {
  return {
    accounts: [],
    transactions: [],
    budgets: [],
    bills: [],
    cardDues: [],
    goals: [],
    merchantOverrides: [],
    accountHints: [],
    notSubscriptions: [],
    settings: [],
  };
}

// ── Coercion helpers ─────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Non-empty string, or null. Empty strings are treated as absent throughout. */
function optText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * Money is integer fils everywhere in this app. A blob written by an old build
 * — or hand-edited in a restored backup — can still carry 12.5 here, and a
 * REAL column would let float arithmetic back into the ledger, which is the
 * entire reason for the fils convention. Rounding at the boundary is the only
 * read that keeps every downstream sum exact.
 */
function optFils(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function fils(value: unknown, fallback: number): number {
  return optFils(value) ?? fallback;
}

function optInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function sqlBool(value: unknown): SqlBool {
  return value === true || value === 1 ? 1 : 0;
}

/**
 * 0 becomes `undefined` rather than `false`. The domain types declare these
 * flags optional and the whole app reads them as `!t.isTransfer`, so carrying
 * an explicit `false` around would only create two spellings of the same state
 * — and two spellings is how `{...t, isTransfer: false}` ends up looking like
 * a real change to a memoized list.
 */
function optBool(value: SqlBool | number | null): true | undefined {
  return value === 1 ? true : undefined;
}

/**
 * Mirrors the CategoryId union. Written as a Record rather than an array so
 * that adding a category to types.ts without adding it here fails to compile
 * — a category that exists in the union but not in this guard would be
 * silently rewritten to 'other' on the way in from a backup.
 */
const CATEGORY_IDS: Record<CategoryId, true> = {
  groceries: true,
  dining: true,
  transport: true,
  utilities: true,
  telecom: true,
  rent: true,
  shopping: true,
  health: true,
  education: true,
  travel: true,
  entertainment: true,
  charity: true,
  government: true,
  loan: true,
  salary: true,
  business: true,
  other: true,
};

export function toCategoryId(value: unknown): CategoryId {
  return typeof value === 'string' && value in CATEGORY_IDS ? (value as CategoryId) : 'other';
}

function toAccountKind(value: unknown): Account['kind'] {
  return value === 'card' || value === 'cash' ? value : 'bank';
}

function toCardType(value: unknown): Account['cardType'] {
  return value === 'credit' || value === 'debit' ? value : undefined;
}

function toSnapshotKind(value: unknown): Account['snapshotKind'] {
  return value === 'balance' || value === 'limit' || value === 'outstanding' ? value : undefined;
}

function toTxType(value: unknown): Transaction['type'] {
  return value === 'income' ? 'income' : 'expense';
}

/**
 * Rows written before v2 of the app carry no `source` at all, and the domain
 * documents that absence as "manual". The column stays NULL for them instead
 * of being backfilled with 'manual': the re-parse and healing paths in
 * store.tsx and auto-import.ts key off `source === 'sms'`, and inventing a
 * value for rows nobody classified would make an untouchable claim about data
 * whose origin is genuinely unknown.
 */
function toSource(value: unknown): Transaction['source'] {
  return value === 'sms' || value === 'manual' ? value : undefined;
}

// ── Row ↔ domain mappers ─────────────────────────────────────────────────────

export function accountToRow(account: Account): AccountRow {
  return {
    id: account.id,
    name: account.name,
    kind: account.kind,
    opening_fils: fils(account.openingFils, 0),
    color: account.color,
    last4: optText(account.last4),
    bank_name: optText(account.bankName),
    card_type: optText(account.cardType),
    snapshot_fils: optFils(account.snapshotFils),
    snapshot_kind: optText(account.snapshotKind),
    credit_limit_fils: optFils(account.creditLimitFils),
    snapshot_ts: optInt(account.snapshotTs),
    archived: sqlBool(account.archived),
  };
}

export function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    kind: toAccountKind(row.kind),
    openingFils: row.opening_fils,
    color: row.color,
    last4: row.last4 ?? undefined,
    bankName: row.bank_name ?? undefined,
    cardType: toCardType(row.card_type),
    snapshotFils: row.snapshot_fils ?? undefined,
    snapshotKind: toSnapshotKind(row.snapshot_kind),
    creditLimitFils: row.credit_limit_fils ?? undefined,
    snapshotTs: row.snapshot_ts ?? undefined,
    archived: optBool(row.archived),
  };
}

export function transactionToRow(tx: Transaction): TransactionRow {
  return {
    id: tx.id,
    type: tx.type,
    amount_fils: fils(tx.amountFils, 0),
    category: tx.category,
    account_id: tx.accountId,
    title: tx.title,
    note: optText(tx.note),
    date: tx.date,
    source: optText(tx.source),
    sms_key: optText(tx.smsKey),
    is_transfer: sqlBool(tx.isTransfer),
    user_edited: sqlBool(tx.userEdited),
    raw: optText(tx.raw),
  };
}

export function rowToTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    type: toTxType(row.type),
    amountFils: row.amount_fils,
    category: toCategoryId(row.category),
    accountId: row.account_id,
    title: row.title,
    note: row.note ?? undefined,
    date: row.date,
    source: toSource(row.source),
    smsKey: row.sms_key ?? undefined,
    isTransfer: optBool(row.is_transfer),
    userEdited: optBool(row.user_edited),
    raw: row.raw ?? undefined,
  };
}

export function budgetToRow(budget: Budget): BudgetRow {
  return { category: budget.category, limit_fils: fils(budget.limitFils, 0) };
}

export function rowToBudget(row: BudgetRow): Budget {
  return { category: toCategoryId(row.category), limitFils: row.limit_fils };
}

export function billToRow(bill: Bill): BillRow {
  return {
    id: bill.id,
    title: bill.title,
    category: bill.category,
    amount_fils: fils(bill.amountFils, 0),
    due_day: optInt(bill.dueDay) ?? 1,
    account_id: optText(bill.accountId),
    auto_detected: sqlBool(bill.autoDetected),
    paid_months: JSON.stringify(bill.paidMonths ?? []),
  };
}

export function rowToBill(row: BillRow): Bill {
  return {
    id: row.id,
    title: row.title,
    category: toCategoryId(row.category),
    amountFils: row.amount_fils,
    dueDay: row.due_day,
    accountId: row.account_id ?? undefined,
    autoDetected: optBool(row.auto_detected),
    paidMonths: parsePaidMonths(row.paid_months),
  };
}

/**
 * A malformed `paid_months` yields an empty list rather than throwing. The
 * worst case is a bill showing as unpaid for a month the user already settled,
 * which they can fix in a tap; an exception here would take the whole bills
 * screen down instead.
 */
function parsePaidMonths(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return asArray(parsed).filter((m): m is string => typeof m === 'string');
  } catch {
    return [];
  }
}

export function cardDueToRow(due: CardDue): CardDueRow {
  return {
    id: due.id,
    account_id: due.accountId,
    total_due_fils: fils(due.totalDueFils, 0),
    min_due_fils: fils(due.minDueFils, 0),
    due_date: due.dueDate,
    paid_fils: fils(due.paidFils, 0),
    settled_at: optText(due.settledAt),
  };
}

export function rowToCardDue(row: CardDueRow): CardDue {
  return {
    id: row.id,
    accountId: row.account_id,
    totalDueFils: row.total_due_fils,
    minDueFils: row.min_due_fils,
    dueDate: row.due_date,
    paidFils: row.paid_fils,
    settledAt: row.settled_at ?? undefined,
  };
}

export function goalToRow(goal: Goal): GoalRow {
  return {
    id: goal.id,
    title: goal.title,
    emoji: goal.emoji,
    target_fils: fils(goal.targetFils, 0),
    saved_fils: fils(goal.savedFils, 0),
  };
}

export function rowToGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    targetFils: row.target_fils,
    savedFils: row.saved_fils,
  };
}

// ── Scalar settings ──────────────────────────────────────────────────────────

/**
 * The parts of AppState that are single values rather than collections.
 * `hydrated` is excluded on purpose — it describes the store's own lifecycle,
 * not anything about the user, and persisting it would let a killed launch
 * come back claiming it had finished loading.
 */
export type ScalarSettings = Pick<
  AppState,
  | 'lastScanTs'
  | 'onboarded'
  | 'userName'
  | 'appLock'
  | 'monthStartDay'
  | 'pro'
  | 'trialStartTs'
  | 'marketId'
  | 'language'
>;

/** Matches EMPTY_STATE in store.tsx; a missing row reads as the default. */
export const DEFAULT_SETTINGS: ScalarSettings = {
  lastScanTs: 0,
  onboarded: false,
  userName: 'there',
  appLock: false,
  monthStartDay: 1,
  pro: false,
  trialStartTs: 0,
  marketId: '',
  language: '',
};

export const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof ScalarSettings)[];

/**
 * Values are JSON-encoded rather than stringified, so a userName of "0" comes
 * back as the string "0" and not the number zero, and an empty marketId stays
 * distinguishable from a missing row (which is what triggers locale
 * auto-detection on first launch).
 */
export function settingsToRows(settings: Partial<ScalarSettings>): SettingRow[] {
  const rows: SettingRow[] = [];
  for (const key of SETTINGS_KEYS) {
    const value = settings[key];
    if (value === undefined) continue;
    rows.push({ key, value: JSON.stringify(value) });
  }
  return rows;
}

export function rowsToSettings(rows: readonly SettingRow[]): ScalarSettings {
  const out: ScalarSettings = { ...DEFAULT_SETTINGS };
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  for (const key of SETTINGS_KEYS) {
    const raw = byKey.get(key);
    if (raw === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A corrupt row falls back to the default instead of taking hydration
      // down. Losing one setting is recoverable; failing to open is not.
      continue;
    }
    const fallback = DEFAULT_SETTINGS[key];
    if (typeof fallback === 'boolean') {
      (out[key] as boolean) = parsed === true;
    } else if (typeof fallback === 'number') {
      (out[key] as number) = typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
    } else {
      (out[key] as string) = typeof parsed === 'string' ? parsed : fallback;
    }
  }
  return out;
}

// ── Legacy AsyncStorage blob → rows ──────────────────────────────────────────

/** Per-collection count of entries the conversion refused to carry over. */
export interface LegacyDropCounts {
  accounts: number;
  transactions: number;
  budgets: number;
  bills: number;
  cardDues: number;
  goals: number;
}

export interface LegacyConversion {
  rows: DbRows;
  dropped: LegacyDropCounts;
}

/**
 * Turns the decoded `wafra/state/v1` blob into the exact rows to insert.
 *
 * The input is typed `unknown` because that is the honest type: it is JSON
 * that has been on a phone across an arbitrary number of app versions, and it
 * may be a partial state, a state from a build that predates half these
 * fields, or the `data` payload of a backup file the user restored. Every
 * field is therefore coerced rather than trusted.
 *
 * Rows that cannot be given a primary key are dropped and counted instead of
 * throwing, and duplicate ids collapse to the first occurrence. The alternative
 * — letting one malformed transaction abort the INSERT — would fail the whole
 * migration and take the user's ledger with it, which is the single outcome
 * this function exists to prevent.
 */
export function legacyStateToRows(blob: unknown): LegacyConversion {
  const rows = emptyRows();
  const dropped: LegacyDropCounts = {
    accounts: 0,
    transactions: 0,
    budgets: 0,
    bills: 0,
    cardDues: 0,
    goals: 0,
  };
  const state = asRecord(blob);
  if (!state) return { rows, dropped };

  const seenAccounts = new Set<string>();
  for (const entry of asArray(state.accounts)) {
    const a = asRecord(entry);
    const id = a ? optText(a.id) : null;
    if (!a || !id || seenAccounts.has(id)) {
      dropped.accounts += 1;
      continue;
    }
    seenAccounts.add(id);
    rows.accounts.push({
      id,
      name: text(a.name, 'Account'),
      kind: toAccountKind(a.kind),
      opening_fils: fils(a.openingFils, 0),
      // A colourless account renders as a transparent chip; the neutral used
      // by the seed accounts is a better guess than nothing.
      color: text(a.color, '#8E8E93'),
      last4: optText(a.last4),
      bank_name: optText(a.bankName),
      card_type: toCardType(a.cardType) ?? null,
      snapshot_fils: optFils(a.snapshotFils),
      snapshot_kind: toSnapshotKind(a.snapshotKind) ?? null,
      credit_limit_fils: optFils(a.creditLimitFils),
      snapshot_ts: optInt(a.snapshotTs),
      archived: sqlBool(a.archived),
    });
  }

  const seenTx = new Set<string>();
  for (const entry of asArray(state.transactions)) {
    const t = asRecord(entry);
    const id = t ? optText(t.id) : null;
    const amount = t ? optFils(t.amountFils) : null;
    const date = t ? optText(t.date) : null;
    // id, amount and date are the three fields with no defensible default: a
    // row without them cannot be keyed, cannot be summed, and cannot be placed
    // in a month, so it is not a transaction at all.
    if (!t || !id || amount === null || !date || seenTx.has(id)) {
      dropped.transactions += 1;
      continue;
    }
    seenTx.add(id);
    rows.transactions.push({
      id,
      type: toTxType(t.type),
      amount_fils: amount,
      category: toCategoryId(t.category),
      account_id: text(t.accountId, ''),
      title: text(t.title, 'Transaction'),
      note: optText(t.note),
      date,
      source: toSource(t.source) ?? null,
      sms_key: optText(t.smsKey),
      is_transfer: sqlBool(t.isTransfer),
      user_edited: sqlBool(t.userEdited),
      raw: optText(t.raw),
    });
  }

  const seenBudgets = new Set<string>();
  for (const entry of asArray(state.budgets)) {
    const b = asRecord(entry);
    const limit = b ? optFils(b.limitFils) : null;
    // The category IS the key here, so an unrecognised one cannot fall back to
    // 'other' — that would merge two budgets and quietly change the limit the
    // user set. Drop it instead.
    const category = b && typeof b.category === 'string' && b.category in CATEGORY_IDS ? b.category : null;
    if (!category || limit === null || seenBudgets.has(category)) {
      dropped.budgets += 1;
      continue;
    }
    seenBudgets.add(category);
    rows.budgets.push({ category, limit_fils: limit });
  }

  const seenBills = new Set<string>();
  for (const entry of asArray(state.bills)) {
    const b = asRecord(entry);
    const id = b ? optText(b.id) : null;
    if (!b || !id || seenBills.has(id)) {
      dropped.bills += 1;
      continue;
    }
    seenBills.add(id);
    const dueDay = optInt(b.dueDay) ?? 1;
    rows.bills.push({
      id,
      title: text(b.title, 'Bill'),
      category: toCategoryId(b.category),
      amount_fils: fils(b.amountFils, 0),
      // Clamped because bills.ts indexes into a month by this number and a
      // dueDay of 0 or 40 would place the bill outside the month entirely.
      due_day: Math.min(31, Math.max(1, dueDay)),
      account_id: optText(b.accountId),
      auto_detected: sqlBool(b.autoDetected),
      paid_months: JSON.stringify(parsePaidMonthsInput(b.paidMonths)),
    });
  }

  const seenDues = new Set<string>();
  for (const entry of asArray(state.cardDues)) {
    const d = asRecord(entry);
    const id = d ? optText(d.id) : null;
    const dueDate = d ? optText(d.dueDate) : null;
    if (!d || !id || !dueDate || seenDues.has(id)) {
      dropped.cardDues += 1;
      continue;
    }
    seenDues.add(id);
    const total = fils(d.totalDueFils, 0);
    rows.cardDues.push({
      id,
      account_id: text(d.accountId, ''),
      total_due_fils: total,
      // Banks that never quoted a minimum were given 5% at import time; keep
      // that rule here so a due missing the field still shows a sane minimum.
      min_due_fils: optFils(d.minDueFils) ?? Math.round(total * 0.05),
      due_date: dueDate,
      paid_fils: fils(d.paidFils, 0),
      settled_at: optText(d.settledAt),
    });
  }

  const seenGoals = new Set<string>();
  for (const entry of asArray(state.goals)) {
    const g = asRecord(entry);
    const id = g ? optText(g.id) : null;
    if (!g || !id || seenGoals.has(id)) {
      dropped.goals += 1;
      continue;
    }
    seenGoals.add(id);
    rows.goals.push({
      id,
      title: text(g.title, 'Goal'),
      emoji: text(g.emoji, 'target'),
      target_fils: fils(g.targetFils, 0),
      saved_fils: fils(g.savedFils, 0),
    });
  }

  const overrides = asRecord(state.merchantOverrides);
  if (overrides) {
    for (const [merchant, category] of Object.entries(overrides)) {
      const key = merchant.trim().toLowerCase();
      if (!key || typeof category !== 'string' || !(category in CATEGORY_IDS)) continue;
      rows.merchantOverrides.push({ merchant: key, category });
    }
  }

  const hints = asRecord(state.accountHints);
  if (hints) {
    for (const [last4, accountId] of Object.entries(hints)) {
      const id = optText(accountId);
      if (!last4 || !id) continue;
      rows.accountHints.push({ last4, account_id: id });
    }
  }

  const seenNotSubs = new Set<string>();
  for (const entry of asArray(state.notSubscriptions)) {
    const merchant = optText(entry)?.trim().toLowerCase();
    if (!merchant || seenNotSubs.has(merchant)) continue;
    seenNotSubs.add(merchant);
    rows.notSubscriptions.push({ merchant });
  }

  rows.settings = settingsToRows({
    lastScanTs: optInt(state.lastScanTs) ?? undefined,
    // Builds that predate onboarding stored data with no flag at all. Anyone
    // who already has a blob has clearly used the app, so they are onboarded —
    // the same rule store.tsx applies today when it hydrates.
    onboarded: typeof state.onboarded === 'boolean' ? state.onboarded : true,
    userName: optText(state.userName) ?? undefined,
    appLock: typeof state.appLock === 'boolean' ? state.appLock : undefined,
    monthStartDay: optInt(state.monthStartDay) ?? undefined,
    pro: typeof state.pro === 'boolean' ? state.pro : undefined,
    trialStartTs: optInt(state.trialStartTs) ?? undefined,
    marketId: optText(state.marketId) ?? undefined,
    language: optText(state.language) ?? undefined,
  });

  return { rows, dropped };
}

function parsePaidMonthsInput(value: unknown): string[] {
  if (typeof value === 'string') return parsePaidMonths(value);
  return asArray(value).filter((m): m is string => typeof m === 'string');
}

// ── Rows → AppState ──────────────────────────────────────────────────────────

/**
 * Rebuilds the shape the store still hands to screens. This is the whole
 * ledger in memory, which is exactly what the database exists to stop doing —
 * it stays here as the bridge that lets the store move over in one step, with
 * the paged reads in db.ts taking over screen by screen afterwards.
 */
export function rowsToState(rows: DbRows): Omit<AppState, 'hydrated'> {
  return {
    ...rowsToSettings(rows.settings),
    accounts: rows.accounts.map(rowToAccount),
    transactions: rows.transactions.map(rowToTransaction),
    budgets: rows.budgets.map(rowToBudget),
    bills: rows.bills.map(rowToBill),
    cardDues: rows.cardDues.map(rowToCardDue),
    goals: rows.goals.map(rowToGoal),
    merchantOverrides: Object.fromEntries(
      rows.merchantOverrides.map((r) => [r.merchant, toCategoryId(r.category)]),
    ),
    accountHints: Object.fromEntries(rows.accountHints.map((r) => [r.last4, r.account_id])),
    notSubscriptions: rows.notSubscriptions.map((r) => r.merchant),
  };
}

/** The inverse: a live AppState as rows, for backup restore and demo data. */
export function stateToRows(state: Partial<Omit<AppState, 'hydrated'>>): DbRows {
  return legacyStateToRows(state).rows;
}

// ── Statement builders ───────────────────────────────────────────────────────

/**
 * Column order is fixed per table and shared by the INSERT text and the value
 * arrays, so a column added to one without the other is a length mismatch at
 * the first insert rather than a silently shifted row.
 */
const COLUMNS = {
  accounts: [
    'id', 'name', 'kind', 'opening_fils', 'color', 'last4', 'bank_name', 'card_type',
    'snapshot_fils', 'snapshot_kind', 'credit_limit_fils', 'snapshot_ts', 'archived',
  ],
  transactions: [
    'id', 'type', 'amount_fils', 'category', 'account_id', 'title', 'note', 'date',
    'source', 'sms_key', 'is_transfer', 'user_edited', 'raw',
  ],
  budgets: ['category', 'limit_fils'],
  bills: [
    'id', 'title', 'category', 'amount_fils', 'due_day', 'account_id', 'auto_detected', 'paid_months',
  ],
  card_dues: [
    'id', 'account_id', 'total_due_fils', 'min_due_fils', 'due_date', 'paid_fils', 'settled_at',
  ],
  goals: ['id', 'title', 'emoji', 'target_fils', 'saved_fils'],
  merchant_overrides: ['merchant', 'category'],
  account_hints: ['last4', 'account_id'],
  not_subscriptions: ['merchant'],
  settings: ['key', 'value'],
  meta: ['key', 'value'],
} as const;

export type TableName = keyof typeof COLUMNS;

/** `INSERT OR REPLACE INTO x (a, b) VALUES (?, ?)` for a table. */
export function upsertSql(table: TableName): string {
  const cols = COLUMNS[table];
  return `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
}

/**
 * The row's values in the same order `upsertSql` names its columns. Typed as
 * `object` rather than `Record<string, unknown>` so the row interfaces above
 * can be passed straight in — an interface without an index signature is not
 * assignable to a Record, and widening every row type to satisfy that would
 * throw away the column-name checking those interfaces exist for.
 */
export function rowValues(table: TableName, row: object): (string | number | null)[] {
  const source = row as Record<string, unknown>;
  return COLUMNS[table].map((col) => {
    const value = source[col];
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' || typeof value === 'number') return value;
    return value === true ? 1 : 0;
  });
}

/** Order matters only for readability; there are no foreign keys to satisfy. */
export const ALL_TABLES: readonly TableName[] = [
  'transactions',
  'card_dues',
  'accounts',
  'budgets',
  'bills',
  'goals',
  'merchant_overrides',
  'account_hints',
  'not_subscriptions',
  'settings',
];

/** Which collection of `DbRows` fills which table, for a generic bulk insert. */
export const TABLE_SOURCES: readonly { table: TableName; key: keyof DbRows }[] = [
  { table: 'accounts', key: 'accounts' },
  { table: 'transactions', key: 'transactions' },
  { table: 'budgets', key: 'budgets' },
  { table: 'bills', key: 'bills' },
  { table: 'card_dues', key: 'cardDues' },
  { table: 'goals', key: 'goals' },
  { table: 'merchant_overrides', key: 'merchantOverrides' },
  { table: 'account_hints', key: 'accountHints' },
  { table: 'not_subscriptions', key: 'notSubscriptions' },
  { table: 'settings', key: 'settings' },
];

// ── Meta keys ────────────────────────────────────────────────────────────────

export const META_LEGACY_IMPORTED = 'legacy_import_v1';
/** '1' while the old AsyncStorage blob is still being kept as a safety net. */
export const META_LEGACY_RETAINED = 'legacy_blob_retained';
/** How many `:tx:N` chunk keys the legacy blob spread its transactions over. */
export const META_LEGACY_TX_CHUNKS = 'legacy_tx_chunks';
