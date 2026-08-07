/**
 * Why a storage failure has to leave a trace.
 *
 * Both ends of persistence used to swallow their errors. `persist` caught
 * everything and returned false; hydration caught everything and dispatched
 * `onboarded: false`. Between them, a database that could not be written was
 * indistinguishable from a phone that had never run the app — and the app then
 * offered onboarding, which on the next save would have written over the very
 * ledger it had failed to read.
 *
 * That is what this module exists to stop. Every failure is recorded twice:
 *
 *   - to logcat/Console with a fixed tag, because on a SIGNED Android build
 *     that is the ONLY channel that works. `adb run-as` needs a debuggable
 *     app and the sandbox is unreadable otherwise, so a file alone cannot be
 *     retrieved from the build that actually reproduces the bug;
 *   - to a small file in the documents directory, so the record survives a
 *     force-stop and a support screen can read it back on a device with no
 *     cable attached.
 *
 * Nothing in here may throw. It runs inside the catch blocks of the code that
 * keeps the user's money, and a diagnostics failure that masks a storage
 * failure would be worse than having no diagnostics at all.
 *
 * PRIVACY — and this is the part that got rewritten.
 *
 * The first version recorded `redact(error.message)`: an arbitrary native
 * string with a blocklist over it. A blocklist is the wrong shape for this.
 * The rules caught what we thought of — quoted literals, hex runs, the key
 * pragma — and nothing else, so an error carrying an UNQUOTED merchant name,
 * IBAN or amount ("insert failed for Carrefour Mall of the Emirates 123.45")
 * went to logcat and to disk verbatim. On a ledger of bank messages the
 * message body is the sensitive part; there is no rule set that can be trusted
 * to strip it, because we do not control what native puts in there.
 *
 * So nothing derived from the message text is recorded any more. A failure is
 * reduced to three closed-vocabulary facts — the error's constructor, its
 * error CODE when that code is an identifier-shaped token, and a CATEGORY
 * picked from the fixed list below — and the message itself is used only to
 * choose one of those categories and then dropped. `redact` survives as the
 * last gate on the way to the console: everything reaching it is already from
 * a closed set, so it is a no-op in practice, and it is what fails closed if
 * someone later widens the input.
 */

/** The persistence operation that failed. Never a value, never a key. */
export type StorageOp =
  | 'open'
  | 'read'
  | 'write'
  | 'remove'
  | 'destroy'
  | 'migrate'
  /** A ROLLBACK that itself failed, leaving the connection poisoned. */
  | 'rollback';

/**
 * What went wrong, in a fixed vocabulary.
 *
 * These are the distinctions that change what the app or the user should DO,
 * and they are the only thing the message text is allowed to influence.
 * Anything unrecognised is `unknown` — deliberately useless rather than
 * accidentally revealing.
 */
export type StorageCategory =
  /** The key in SecureStore does not open this file. Retrying cannot help. */
  | 'key-mismatch'
  /** Page-level damage. */
  | 'corrupt'
  /** Disk I/O, missing path, cannot open the file. */
  | 'io'
  /** Another writer holds the lock; a retry is reasonable. */
  | 'locked'
  /** Read-only filesystem or database. */
  | 'readonly'
  /** Out of disk, out of memory, mlock refused. */
  | 'resources'
  /** Missing table/column or a malformed statement — our bug, not the disk. */
  | 'schema'
  | 'unknown';

export interface StorageFailure {
  /** ISO timestamp, so a support report can be lined up against a logcat. */
  at: string;
  op: StorageOp;
  /** The error's constructor name — `SQLiteException`, `Error`, and so on. */
  kind: string;
  /** The native error code when it is a stable token, else null. */
  code: string | null;
  /** Closed-vocabulary classification. Never text taken from the error. */
  category: StorageCategory;
}

const FILE_NAME = 'wafra-storage-diagnostics.json';
/** Enough to show a pattern across a few launches, small enough to write. */
const MAX_RECORDS = 12;
const MAX_DETAIL = 240;
/** The file write is synchronous; this is the floor between two of them. */
const MIN_WRITE_INTERVAL_MS = 3000;
/**
 * Grep for this in `adb logcat`. Deliberately unique and stable.
 *
 * Not exported. It was, and nothing imported it — an export off this module is
 * a reader for failure records, so the ones nobody calls get removed rather
 * than left as a disclosure path waiting for someone to wire up.
 */
const LOG_TAG = 'wafra:storage';

/**
 * Strip anything that could be a secret or a ledger value.
 *
 * No longer the privacy boundary — the allowlist above is — but still the last
 * thing every console line passes through. The order matters: the key is hex,
 * so the hex rule alone would catch it, but the pragma rule runs first so a
 * redacted message still says WHICH statement failed.
 */
export function redact(input: unknown): string {
  let text = typeof input === 'string' ? input : String(input);
  text = text
    // The one statement that carries the database key.
    .replace(/PRAGMA\s+key\s*=\s*\S+/gi, 'PRAGMA key = [redacted]')
    // Raw key material in any other shape: x'..' blobs and long hex runs.
    .replace(/x'[0-9a-f]*'/gi, "x'[redacted]'")
    .replace(/\b[0-9a-f]{16,}\b/gi, '[redacted-hex]')
    // Quoted literals are where a serialised ledger row would appear if a
    // native error ever echoed a bound parameter back at us.
    .replace(/'[^']*'/g, "'[redacted]'")
    .replace(/"[^"]*"/g, '"[redacted]"');
  if (text.length > MAX_DETAIL) text = `${text.slice(0, MAX_DETAIL)}…`;
  return text;
}

/**
 * Class names are attacker-free in practice — they come from the native
 * module, not from data — but they are still interpolated into a log line, so
 * they are shape-checked rather than trusted. Anything unexpected collapses to
 * `Error` instead of being passed through.
 */
const KIND_SHAPE = /^[A-Za-z][A-Za-z0-9_$]{0,63}$/;

function errorKind(error: unknown): string {
  if (error && typeof error === 'object') {
    const shaped = error as { name?: unknown; constructor?: { name?: unknown } };
    const name = typeof shaped.name === 'string' ? shaped.name : undefined;
    const ctor = typeof shaped.constructor?.name === 'string' ? shaped.constructor.name : undefined;
    const candidate = name ?? ctor;
    if (candidate && KIND_SHAPE.test(candidate)) return candidate;
    return 'Error';
  }
  return typeof error;
}

/**
 * Error codes worth keeping, and only in the shapes real codes come in.
 *
 * `SQLITE_*` from SQLite/SQLCipher, `E*` from errno, `ERR_*` from Node/Expo,
 * and a bare SQLite result number. Nothing here has a space in it, so a
 * merchant name or an IBAN — which is letters AND digits from the first
 * character — cannot satisfy any branch. The bare-number branch is capped at
 * five digits because that is what a result code is; an amount in fils that
 * happened to land in `error.code` would be five digits too, which is why the
 * cap is the point rather than an oversight: five digits with no currency,
 * date or account beside them identify nothing.
 */
const CODE_SHAPE = /^(SQLITE_[A-Z_]{2,30}|E[A-Z]{2,15}|ERR_[A-Z0-9_]{2,30}|[0-9]{1,5})$/;

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const raw = (error as { code?: unknown }).code;
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : null;
  if (!text) return null;
  return CODE_SHAPE.test(text) ? text : null;
}

/**
 * The code is a better answer than the message, so it is asked first.
 *
 * A result code is stable across SQLite versions, locales and whatever the
 * driver decides to prepend; the message is none of those things. Only codes
 * that name ONE condition are mapped — `SQLITE_ERROR` means "something went
 * wrong" and is left to the message.
 */
const CODE_CATEGORIES: Readonly<Record<string, StorageCategory>> = {
  SQLITE_NOTADB: 'key-mismatch',
  SQLITE_CORRUPT: 'corrupt',
  SQLITE_IOERR: 'io',
  SQLITE_CANTOPEN: 'io',
  SQLITE_BUSY: 'locked',
  SQLITE_LOCKED: 'locked',
  SQLITE_READONLY: 'readonly',
  SQLITE_FULL: 'resources',
  SQLITE_NOMEM: 'resources',
  ENOMEM: 'resources',
  ENOSPC: 'resources',
};

/**
 * The fallback, and the ONLY use the error message is put to. It does not
 * survive the call.
 *
 * Each entry answers a question the app or the user actually acts on, which is
 * why `key-mismatch` is first: it is the one failure where the recovery screen
 * must not promise that retrying will help.
 */
const CATEGORIES: readonly (readonly [RegExp, StorageCategory])[] = [
  [/file is (not a database|encrypted)|not a database/i, 'key-mismatch'],
  [/malformed|corrupt|not a valid database/i, 'corrupt'],
  [/disk i\/?o error|unable to open database|no such file|cannot open/i, 'io'],
  [/database is locked|database table is locked|busy|SQLITE_BUSY/i, 'locked'],
  [/readonly|read-only|attempt to write a readonly/i, 'readonly'],
  [/disk (is )?full|out of memory|ENOMEM|cannot allocate|mlock/i, 'resources'],
  [/no such table|no such column|syntax error|no such collation/i, 'schema'],
];

function errorCategory(error: unknown, code: string | null): StorageCategory {
  if (code && CODE_CATEGORIES[code]) return CODE_CATEGORIES[code];
  let text: string;
  try {
    text =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error);
  } catch {
    return 'unknown';
  }
  for (const [pattern, category] of CATEGORIES) {
    if (pattern.test(text)) return category;
  }
  return 'unknown';
}

let recent: StorageFailure[] = [];
let loaded = false;
let lastWriteAt = 0;
let pendingWrite: ReturnType<typeof setTimeout> | null = null;
let lastWritten = '';

/**
 * One error object, one record.
 *
 * The same throw crosses up to four frames that each want to report it —
 * `openEncryptedDatabase` records `open`, `multiSet` records `write`,
 * `persist` records `write` again, and a caller awaiting durability records it
 * once more. That produced four rows describing one event, filled the ring
 * buffer four times as fast, and wrote the diagnostics file on each one.
 *
 * Keyed on the error object itself, so the INNERMOST frame wins: it is the one
 * that knows the failure actually happened at `open` rather than merely
 * somewhere under `write`. Outer frames get the inner record handed back and
 * do no I/O at all. A WeakMap so a retained error cannot leak.
 */
const seen = new WeakMap<object, StorageFailure>();

/**
 * expo-file-system is imported lazily and defensively.
 *
 * On web `Paths.document` has no meaning, and during an early-boot failure the
 * native module may not be ready. Neither case should cost us the console
 * record, which is the one that matters on a signed build.
 */
function diagnosticsFile(): { textSync(): string; write(content: string): void; exists: boolean } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    return new File(Paths.document, FILE_NAME) as unknown as ReturnType<typeof diagnosticsFile>;
  } catch {
    return null;
  }
}

function loadFromDisk(): StorageFailure[] {
  const file = diagnosticsFile();
  if (!file) return [];
  try {
    if (!file.exists) return [];
    const parsed: unknown = JSON.parse(file.textSync());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is StorageFailure =>
        !!entry && typeof entry === 'object' && typeof (entry as StorageFailure).op === 'string',
    );
  } catch {
    return [];
  }
}

function ensureLoaded(): void {
  if (loaded) return;
  // Latched before the read, not after: a read that throws must not be retried
  // on every subsequent failure, and it must not leave `recent` unset.
  loaded = true;
  try {
    recent = loadFromDisk();
  } catch {
    recent = [];
  }
}

/**
 * Write the ring buffer out, at most once every {@link MIN_WRITE_INTERVAL_MS}.
 *
 * `File.write` is SYNCHRONOUS, so it lands on the JS thread — and the path
 * that calls it is a storage failure, which on a broken device arrives in
 * bursts (every debounced save, every retry). Rewriting the same twelve rows
 * on each one is JS-thread time spent during the exact incident the user is
 * trying to recover from. A payload identical to the last one written is
 * skipped outright; anything else is either written now or left to one trailing
 * timer, so no record is dropped and no burst can rewrite the file more than
 * three times a second.
 */
function scheduleFlush(): void {
  try {
    const payload = JSON.stringify(recent);
    if (payload === lastWritten) return;
    const now = Date.now();
    const wait = MIN_WRITE_INTERVAL_MS - (now - lastWriteAt);
    if (wait > 0) {
      if (!pendingWrite) pendingWrite = setTimeout(flushNow, wait);
      return;
    }
    flushNow();
  } catch {
    /* the console record already carries this failure */
  }
}

function flushNow(): void {
  if (pendingWrite) {
    clearTimeout(pendingWrite);
    pendingWrite = null;
  }
  try {
    const payload = JSON.stringify(recent);
    if (payload === lastWritten) return;
    lastWriteAt = Date.now();
    diagnosticsFile()?.write(payload);
    lastWritten = payload;
  } catch {
    /* the console record already carries this failure */
  }
}

/**
 * Record a persistence failure. Returns the record so a caller can surface it
 * without a second round trip. NEVER throws.
 *
 * Called with an error already recorded by an inner frame, it returns that
 * frame's record unchanged and does nothing else.
 */
export function recordStorageFailure(op: StorageOp, error: unknown): StorageFailure {
  if (error && typeof error === 'object') {
    const already = seen.get(error);
    if (already) return already;
  }

  const code = errorCode(error);
  const failure: StorageFailure = {
    at: new Date().toISOString(),
    op,
    kind: errorKind(error),
    code,
    category: errorCategory(error, code),
  };
  if (error && typeof error === 'object') {
    try {
      seen.set(error, failure);
    } catch {
      /* a frozen or revoked object is not worth a crash in a catch block */
    }
  }

  try {
    ensureLoaded();
    recent = [...recent, failure].slice(-MAX_RECORDS);
  } catch {
    recent = [failure];
  }
  // The console first: it is the channel that survives a signed build, and it
  // must not be lost if the file write below fails. Every field is already
  // from a closed set; `redact` is the gate that keeps it that way.
  try {
    console.warn(
      redact(
        `[${LOG_TAG}] ${failure.op} failed: ${failure.kind}` +
          `${failure.code ? ` (${failure.code})` : ''} — ${failure.category}`,
      ),
    );
  } catch {
    /* a console that throws is not worth a crash in a catch block */
  }
  scheduleFlush();
  return failure;
}
