/**
 * The native persistence contract.
 *
 * WHAT HAPPENED. Signed Android Releases v41 and v42 lost everything across a
 * force-stop. Tap Start with sample data, Home fills with the UAE demo ledger,
 * use the app for minutes, force-stop, relaunch the same APK: onboarding is
 * back and the ledger is gone. On disk, `wafra-private.db` sat at 4096 bytes
 * with a 12392-byte WAL — one page and exactly three WAL frames, which is the
 * `CREATE TABLE` from the very first open and nothing else, ever. The mtimes
 * never moved off creation. Not one write in the app's life had landed.
 *
 * WHY. `state-storage.native.ts` wrote through
 * `db.withExclusiveTransactionAsync`. That helper does not run on the database
 * you called it on. It calls `Transaction.createAsync(db)`, which opens a
 * SECOND native connection to the same path with `useNewConnection: true`,
 * configured with nothing but the fields of `SQLiteOpenOptions`.
 * `SQLiteOpenOptions` has no cipher key field — there is no way to give that
 * connection a key — and `PRAGMA key` is per-connection state. So on a
 * SQLCipher database the transaction connection is UNKEYED, and the first
 * statement it prepares cannot decrypt page 1.
 *
 * Reads never went near it: `getItem` and `multiGet` use the keyed handle, so
 * hydration worked perfectly and truthfully reported that nothing was stored.
 * `multiSet` and `multiRemove` were the only two callers of the exclusive
 * transaction, and they were every write the app had.
 *
 * CORROBORATION, which is the part that turns this from a good story into a
 * diagnosis. The release logcat's SQLCipher mlock storm (errno 12, ENOMEM
 * against RLIMIT_MEMLOCK) appears at SAMPLE DISPATCH — at write time. A
 * SQLCipher connection allocates and locks its secure memory when it is
 * CONSTRUCTED. A design with one connection makes that noise once, at open.
 * Seeing it at every write is the second connection being built, in the logs,
 * on the device. The mlock warnings are not the bug; they are the fingerprint
 * of it.
 *
 * WHAT THIS FILE PINS. Four things now, because the fix grew a recovery path:
 *
 *   1. Our side never uses the exclusive transaction again, and the write path
 *      keeps the properties that made it safe to stop using it — including the
 *      ones a grep for a function name cannot see: that `destroy` is actually
 *      serialised, and that a queued write acquires its database INSIDE the
 *      queue rather than capturing a handle someone is about to close.
 *   2. A failed hydration reaches a recovery screen and never reaches
 *      onboarding, retry cannot flicker through onboarding on its way, and an
 *      erase that succeeded is not reported as a failure.
 *   3. Diagnostics cannot leak a ledger row, a key or a merchant name — by
 *      construction, not by blocklist — and cannot report one error four
 *      times.
 *   4. The build actually compiles SQLCipher in.
 *
 * Only a signed Release build can prove the fix. This file proves the cause
 * and holds the shape of the fix in place between builds.
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const ROOT = path.join(__dirname, '../..');
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function readIfPresent(rel) {
  try {
    return read(rel);
  } catch {
    return null;
  }
}

/**
 * The same trap perf-config.test.js documents: the comment explaining why an
 * API is banned is longer than the code, so a plain grep matches the
 * explanation and reads as the ban being violated.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\/[^\n]*\n/g, '{\n')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * The body of the function or method whose header contains `header`, matched
 * by braces rather than by indentation.
 *
 * Several assertions below are about ORDER INSIDE ONE FUNCTION — "the database
 * is opened after the queue is entered", "the latch is cleared after the
 * destroy resolves". A file-wide regex cannot express those, and the version
 * of this file that tried was the reason a `destroy` that never called
 * `serialiseWrite` passed a test named "writes are serialised" for two
 * reviews: the name appeared elsewhere in the file, so the grep was satisfied.
 */
function bodyOf(source, header) {
  const start = source.indexOf(header);
  if (start === -1) return null;
  let i = source.indexOf('{', start);
  if (i === -1) return null;
  const open = i;
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** True when every needle appears, in the order given. */
function inOrder(body, ...needles) {
  let at = -1;
  for (const needle of needles) {
    const next = body.indexOf(needle, at + 1);
    if (next === -1) return false;
    at = next;
  }
  return true;
}

const storage = stripComments(read('src/lib/state-storage.native.ts'));

// ---------------------------------------------------------------------------
// 1. Our side.
// ---------------------------------------------------------------------------

ok('the encrypted write path never uses withExclusiveTransactionAsync',
  !/withExclusiveTransactionAsync/.test(storage),
  'it opens a second, unkeyed connection — every write through it fails to decrypt page 1 ' +
    'and the error was being swallowed two layers up. This is the v41/v42 data-loss bug');

/**
 * The narrower version of the same rule. `withExclusiveTransactionAsync` is not
 * the only way to end up on another connection, and `useNewConnection` is the
 * thing that actually breaks it — a new connection cannot be given the key.
 */
ok('the encrypted store never opens a second connection to the ledger',
  !/useNewConnection/.test(storage),
  'PRAGMA key is per-connection state and SQLiteOpenOptions cannot carry a key, so any ' +
    'second connection to this file is unkeyed by construction');

ok('writes take the write lock up front with BEGIN IMMEDIATE',
  /BEGIN IMMEDIATE/.test(storage),
  'withTransactionAsync stays on the keyed connection but expo documents it as interleavable ' +
    'with other async queries; a deferred BEGIN can lose the upgrade to a writer');

ok('every write transaction is committed and rolled back explicitly',
  /execAsync\('COMMIT'\)/.test(storage) && /execAsync\('ROLLBACK'\)/.test(storage),
  'BEGIN without both of these leaves the connection inside a transaction after a failure');

/**
 * A key that does not match the file is accepted silently by SQLCipher until
 * something decrypts page 1. Doing that deliberately at open is what makes a
 * key mismatch an attributable open failure instead of a mystery at first write.
 */
ok('opening the database verifies the key against page 1',
  /sqlite_master/.test(storage),
  'PRAGMA key never fails; only a read proves the key is right');

// ---------------------------------------------------------------------------
// 1a. Serialisation, asserted structurally.
//
// The previous version of this section checked `/serialiseWrite/.test(storage)`
// and passed while `destroy` — named in the comment above `serialiseWrite` as
// the specific reason the queue exists — never called it once.
// ---------------------------------------------------------------------------

const destroyBody = bodyOf(storage, 'async destroy(prefix)');
ok('destroy is itself serialised against the write queue',
  !!destroyBody && /serialiseWrite\(/.test(destroyBody),
  'the queue exists precisely because destroy and migrateLegacyState write outside ' +
    'StoreProvider’s chain. A destroy that skips it can close the handle out from under ' +
    'an in-flight multiSet, and a multiSet can reopen the file between destroy’s close and ' +
    'its unlink — recreating the database the user just erased');

ok('the WHOLE destroy is inside the queue, not just its first step',
  !!destroyBody &&
    inOrder(
      destroyBody,
      'serialiseWrite(',
      'databasePromise = null',
      'SecureStore.deleteItemAsync',
      'SQLite.deleteDatabaseAsync',
      'AsyncStorage',
    ),
  'close, key deletion, file deletion and the legacy sweep have to be indivisible with ' +
    'respect to other writes; serialising only the close leaves the same window open');

/** Key before file, so a failed unlink leaves ciphertext with no key anywhere. */
ok('destroy still deletes the key before the database file',
  !!destroyBody &&
    destroyBody.indexOf('SecureStore.deleteItemAsync') <
      destroyBody.indexOf('SQLite.deleteDatabaseAsync'),
  'erase has to fail closed: if the file cannot be removed, what is left must already be ' +
    'undecryptable');

for (const method of ['async multiSet(entries)', 'async multiRemove(keys)']) {
  const body = bodyOf(storage, method);
  ok(`${method.replace(/async |\(.*/g, '')}: the database is acquired INSIDE the queued task`,
    !!body &&
      body.indexOf('serialiseWrite(') !== -1 &&
      body.indexOf('serialiseWrite(') < body.indexOf('openEncryptedDatabase('),
    'resolving the handle before queueing captures a connection that a destroy sitting ahead ' +
      'in the queue is about to close, and that a poisoned rollback is about to drop. The ' +
      'task then writes through a dead handle. Asking for the database when the task RUNS is ' +
      'the whole difference');
}

// ---------------------------------------------------------------------------
// 1b. A ROLLBACK that fails poisons the connection.
//
// expo-sqlite's Android module caches open databases by path and hands the same
// NativeDatabase back — `findCachedDatabase { ... }?.let { it.addRef() }` in
// SQLiteModule.kt — so dropping our promise and reopening by name returns the
// SAME connection, still inside the transaction the failed ROLLBACK left open.
// Every later BEGIN IMMEDIATE on it fails, with an error describing none of the
// real cause. Only a close actually releases it.
// ---------------------------------------------------------------------------

const poisonBody = bodyOf(storage, 'async function poisonDatabase');
ok('a failed ROLLBACK drops the shared handle and closes it',
  !!poisonBody &&
    inOrder(poisonBody, 'databasePromise = null', 'closeAsync'),
  'dropping the promise alone is not enough: the native cache would hand the same poisoned ' +
    'connection back to the next open');

const writeTxnBody = bodyOf(storage, 'async function writeTransaction');
ok('the poison path is awaited from the ROLLBACK catch, before the original error is thrown',
  !!writeTxnBody &&
    inOrder(writeTxnBody, "execAsync('ROLLBACK')", 'await poisonDatabase(', 'throw error'),
  'awaited because this runs inside the write queue — finishing the close here is what ' +
    'guarantees the NEXT queued task cannot reopen the poisoned connection');

ok('the original error still wins attribution',
  !!writeTxnBody &&
    /catch \(rollbackError\)/.test(writeTxnBody) &&
    !/throw rollbackError/.test(writeTxnBody) &&
    /throw error/.test(writeTxnBody),
  'a ROLLBACK that also fails used to REPLACE the real cause, which is how the real cause ' +
    'stayed hidden. It must be recorded without being rethrown');

ok('the rollback problem is recorded exactly once',
  (storage.match(/recordStorageFailure\('rollback'/g) ?? []).length === 1,
  'once, in the poison path — not again on the way out, where it would displace the error ' +
    'that actually explains what the user lost');

// ---------------------------------------------------------------------------
// 2. Failures must not be silent, and must not be able to destroy data.
// ---------------------------------------------------------------------------

ok('the storage layer reports its failures',
  /recordStorageFailure/.test(storage),
  'persist() returns false and hydrate() presents onboarding; if neither end records anything, ' +
    'a total write failure is invisible — which is exactly how this shipped twice');

const store = stripComments(read('src/lib/store.tsx'));

/**
 * Load the pure hydration exports from store.tsx without mounting React
 * Native. The production functions themselves execute; only their platform
 * dependencies are replaced with deterministic test doubles. Transpiling at
 * test time means a focused `node db.test.js` never reads a stale build.
 *
 * `realModules` swaps named doubles back for the shipping modules out of
 * build/. Everything above this line wants the doubles — those assertions are
 * about the migration's own control flow and a real parser would make them
 * depend on the whole grammar. The pinned-merchant block at the bottom wants
 * the opposite: it is about what the REAL parser, the REAL heal and the REAL
 * override table do to each other across a launch, and every one of the three
 * doubles hides the defect it exists to catch.
 */
function loadHydrationExports(realModules = {}) {
  const ts = require('typescript');
  const execute = (rel, requireModule) => {
    const filename = path.join(ROOT, rel);
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filename,
    }).outputText;
    const loaded = { exports: {} };
    Function('require', 'module', 'exports', '__filename', '__dirname', output)(
      requireModule,
      loaded,
      loaded.exports,
      filename,
      path.dirname(filename),
    );
    return loaded.exports;
  };

  const dedupe = execute('src/lib/dedupe.ts', (id) => {
    throw new Error(`unexpected dedupe dependency ${id}`);
  });
  const parser = {
    PARSER_VERSION: 999,
    normalizeServiceName: (title) => title === 'Legacy service' ? 'Canonical service' : null,
    guessCategory: (title) => title === 'Unclassified merchant' ? 'dining' : 'other',
    parseSms: (raw) =>
      raw === 'now a statement'
        ? { kind: 'cardStatement' }
        : raw === 'now a bill'
          ? { kind: 'billDue' }
          : raw.startsWith('temporarily unsupported')
            ? null
            : { kind: 'transaction' },
  };
  const heal = {
    healPatch: (tx) => ({ id: tx.id, title: 'Reparsed merchant', category: 'dining', raw: null }),
    applyHealPatch: (tx, patch) => {
      const next = { ...tx, ...patch };
      if (patch.raw === null) delete next.raw;
      return next;
    },
  };
  const react = {
    createContext: () => ({}),
    useCallback: (fn) => fn,
    useContext: () => null,
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, () => {}],
  };
  const identityState = (state) => state;
  const modules = {
    'react/jsx-runtime': { jsx: () => ({}), jsxs: () => ({}), Fragment: Symbol('Fragment') },
    react,
    'react-native': {
      AppState: { addEventListener: () => ({ remove() {} }) },
      I18nManager: { isRTL: false, allowRTL() {}, forceRTL() {} },
      Platform: { OS: 'web' },
    },
    '@/lib/accounts': {
      markCardsDistinct: identityState,
      mergeDuplicateAccounts: identityState,
      mergeRenewedCard: identityState,
      repairCardPaymentAccounts: identityState,
    },
    '@/lib/format': { setMonthStartDay() {}, toISODate: () => '2026-08-03' },
    '@/lib/theme-preference': { setThemePreference() {} },
    '@/lib/i18n': { detectLanguage: () => 'en', setLanguage() {} },
    '@/lib/markets': { detectMarketId: () => 'AE', setActiveMarket() {} },
    '@/lib/seed': { generateSeedTransactions: () => [], SEED_ACCOUNTS: [], SEED_BUDGETS: [] },
    '@/lib/heal': heal,
    '@/lib/sms-parser': parser,
    '@/lib/ledger': { internalTransferIds: () => new Set() },
    '@/lib/cards': { mergeImportedCardDues: (_existing, incoming) => incoming },
    '@/lib/dedupe': dedupe,
    '@/lib/state-storage': { migrateLegacyState: async () => null, stateStorage: {} },
    '@/lib/storage-diagnostics': { recordStorageFailure: () => ({ category: 'unknown' }) },
    // The REAL predicate, not a stub. It is what decides which rows a merchant
    // rule rewrites, and stubbing it here would let the store's blast radius
    // drift from the count the categorise screen prints beside the tap — the
    // exact drift the shared predicate exists to prevent.
    '@/lib/uncategorised': require('./build/uncategorised'),
    './balances': {},
    ...realModules,
  };
  return execute('src/lib/store.tsx', (id) => {
    if (Object.hasOwn(modules, id)) return modules[id];
    throw new Error(`unexpected store dependency ${id}`);
  });
}

const hydration = loadHydrationExports();

ok('a failed hydration latches writes off',
  /storageBlocked\.current = true/.test(store) &&
    /if \(storageBlocked\.current\) return Promise\.resolve\(false\)/.test(store),
  'the state presented after a failed read was not read from disk. Saving it 700ms later is ' +
    'how an unreadable ledger becomes a destroyed one');

ok('a failed hydration is recorded, not just swallowed',
  /recordStorageFailure\('read'/.test(store),
  'the catch used to dispatch onboarded:false and nothing else');

ok('a failed save is recorded, not just swallowed',
  /recordStorageFailure\('write'/.test(store),
  'best-effort persistence still has to say when it made no effort at all');

/**
 * `storageFailure` must not be part of AppState. persist() writes every
 * AppState field except `hydrated`, so a failure flag living there would be
 * serialised into the record whose write just failed.
 */
const types = stripComments(readIfPresent('src/lib/types.ts') ?? '');
ok('the storage failure is not part of persisted AppState',
  !/storageFailure/.test(types),
  'it would be written into the very record that is failing to be written');

// ---------------------------------------------------------------------------
// 2a. The recovery surface.
//
// The old assertion here was `/storageFailure/.test(store)` under the name
// "the storage failure is exposed to the UI layer". It was true and it meant
// nothing: the store exposed the flag and NO SCREEN READ IT, so a device that
// could not read its ledger was still shown the welcome screen with "Start
// with sample data" on it.
// ---------------------------------------------------------------------------

const gateSrc = readIfPresent('src/components/onboarding-gate.tsx');
const recoverySrc = readIfPresent('src/components/storage-recovery.tsx');

if (!gateSrc || !recoverySrc) {
  ok('the recovery surface exists', false,
    `missing: ${!gateSrc ? 'src/components/onboarding-gate.tsx ' : ''}${
      !recoverySrc ? 'src/components/storage-recovery.tsx' : ''}`);
} else {
  const gate = stripComments(gateSrc);
  const recovery = stripComments(recoverySrc);

  ok('the onboarding gate consumes the storage failure',
    /storageFailure/.test(gate) && /hydrationFailed/.test(gate),
    'without reading it, the gate cannot tell a phone that has never run the app from one ' +
      'whose ledger it could not read — and it answers both with onboarding');

  ok('the gate hands the failure to a distinct recovery screen',
    /<StorageRecovery /.test(gate) &&
      /from '@\/components\/storage-recovery'/.test(gate),
    'the recovery state needs its own surface; reusing an onboarding step for it is how the ' +
      '"start over" button ends up on screen during a recoverable failure');

  ok('recovery is decided BEFORE the onboarding overlay is even computed',
    /showOverlay =\s*\n?\s*!showRecovery/.test(gate) &&
      gate.indexOf('if (showRecovery) return') < gate.indexOf('if (!showOverlay)'),
    'ordering is the guard. An early return placed after the overlay is built still lets a ' +
      'render of the welcome step through');

  /**
   * The recovery screen must be a dead end apart from retry and a confirmed
   * erase. Every identifier below is a route back into onboarding or into
   * writing something over the ledger we could not read.
   */
  const forbidden = [
    'loadDemoData',
    'setOnboarded',
    'startWithSample',
    'onboardPersonalizeCta',
    'buildOnboardingPlan',
    'importBatch',
  ].filter((name) => new RegExp(`\\b${name}\\b`).test(recovery));
  ok('the recovery screen offers no onboarding and no sample data',
    forbidden.length === 0,
    `found: ${forbidden.join(', ')} — every one of these writes over a ledger that is still ` +
      'on the device');

  ok('the recovery screen says the ledger was not changed',
    /storageRecoveryBody|storageRecoveryKeyBody/.test(recovery),
    'the single fact the user needs, and the one a generic error screen never gives them');

  ok('the recovery screen offers a real retry',
    /retryHydration/.test(recovery) && /storageRecoveryRetry/.test(recovery),
    '"force-stop and reopen" is not a recovery instruction to give someone whose ledger is ' +
      'on the line');

  /**
   * Reachability, not source order. The erase handler is defined near the top
   * of the component and the button that opens the confirmation is near the
   * bottom, so comparing their offsets proves nothing — what matters is that
   * `clearAll` has exactly one call site, that its only caller is rendered
   * inside the confirmation branch, and that the button on the FIRST screen
   * opens that branch instead of erasing.
   */
  const eraseBody = bodyOf(recovery, 'const onErase = async');
  const confirmBranchAt = recovery.indexOf('if (confirmingErase)');
  ok('erase is behind a separate destructive confirmation',
    !!eraseBody &&
      /clearAll\(\)/.test(eraseBody) &&
      (recovery.match(/clearAll\(\)/g) ?? []).length === 1 &&
      confirmBranchAt !== -1 &&
      confirmBranchAt < recovery.indexOf('onErase()') &&
      /storageRecoveryEraseCta[\s\S]{0,300}?setConfirmingErase\(true\)/.test(recovery) &&
      /storageRecoveryEraseTitle/.test(recovery) &&
      /storageRecoveryEraseConfirm/.test(recovery),
    'the only irreversible thing the app can do to itself must not be one tap away from a ' +
      'screen the user did not ask to be on');

  /**
   * Native error text must not reach the screen. The store hands over a
   * closed-vocabulary category; anything reading `.detail`, `.message` or
   * `.kind` here would be putting an arbitrary native string — possibly
   * carrying a merchant, an amount or the failing SQL — in front of the user
   * and into a screenshot.
   */
  ok('the recovery screen displays no native error detail',
    !/failure\.(detail|message|kind)/.test(recovery) &&
      !/storageFailure\.(detail|message|kind)/.test(recovery),
    'only `category`, which is a fixed vocabulary, may influence what is shown');
}

// ---------------------------------------------------------------------------
// 2b. Retry, and the erase latch.
// ---------------------------------------------------------------------------

const hydrateBody = bodyOf(store, 'const hydrate = useCallback');
ok('hydration clears the latch only AFTER a successful read',
  !!hydrateBody &&
    inOrder(
      hydrateBody,
      'await loadPersisted()',
      'storageBlocked.current = false',
      "dispatch({ type: 'hydrate'",
    ),
  'clearing it on the way in would reopen writes for the duration of a retry that is about ' +
    'to fail — and the debounced save fires in that window');

ok('an empty database counts as a successful read',
  !!hydrateBody &&
    /let next: [^=]*= \{ onboarded: false \}/.test(hydrateBody) &&
    (hydrateBody.match(/storageBlocked\.current = false/g) ?? []).length === 1,
  'a legitimately empty ledger and an unreadable one must not share a code path, but they ' +
    'must share the SUCCESS path — one `storageBlocked = false` reached by both, not a ' +
    'branch that leaves a genuinely new install latched off forever');

const retryBody = bodyOf(store, 'const retryHydration = useCallback');
ok('the store exposes a retry that reruns hydration',
  !!retryBody && /await hydrate\(\)/.test(retryBody) && /retryHydration/.test(store),
  'the retry has to be the same read, not a second implementation of it');

ok('retry does not unlatch or clear the failure on its own',
  !!retryBody &&
    !/storageBlocked\.current = false/.test(retryBody) &&
    !/setStorageFailure\(null\)/.test(retryBody) &&
    !/setHydrationFailed\(false\)/.test(retryBody),
  'clearing either one before the read resolves takes the recovery screen down and flickers ' +
    'onboarding into view mid-retry — with writes reopened while the outcome is unknown');

ok('an in-flight hydration can be superseded',
  /hydrationRun\.current !== run/.test(store) && /const run = \+\+hydrationRun\.current/.test(store),
  'a retry started while the first read is still running would otherwise let the older ' +
    'attempt dispatch its result last');

// ---------------------------------------------------------------------------
// 2c. Persisted-ledger migrations are lossless for authoritative user data.
// ---------------------------------------------------------------------------

const account = (id, extra = {}) => ({
  id,
  name: `Card •${id.slice(-4)}`,
  kind: 'card',
  openingFils: 0,
  color: '#000000',
  ...extra,
});
const due = (id, accountId, dueDate) => ({
  id,
  accountId,
  totalDueFils: 100000,
  minDueFils: 5000,
  dueDate,
  paidFils: 0,
});
const tx = (id, extra = {}) => ({
  id,
  type: 'expense',
  amountFils: 2500,
  category: 'other',
  accountId: 'card-0001',
  title: 'Ordinary merchant',
  date: '2026-08-01',
  source: 'sms',
  ...extra,
});

{
  const legacy = {
    accounts: [
      account('legacy-unknown', { cardType: undefined, snapshotFils: 500000, snapshotKind: 'balance' }),
      account('legacy-debit', { cardType: 'debit' }),
    ],
    cardDues: [
      due('old-unreplaced', 'legacy-unknown', '2025-01-01'),
      due('debit-due', 'legacy-debit', '2026-07-01'),
      due('orphan-due', 'missing-account', '2020-01-01'),
    ],
  };
  const migrated = hydration.migratePersistedState(legacy);
  const unknown = migrated.accounts.find((row) => row.id === 'legacy-unknown');
  const debit = migrated.accounts.find((row) => row.id === 'legacy-debit');
  ok('hydration preserves an unreplaced unsettled due older than 60 days',
    migrated.cardDues.some((row) => row.id === 'old-unreplaced'));
  ok('hydration preserves a due even when its legacy account cannot be repaired safely',
    migrated.cardDues.some((row) => row.id === 'orphan-due'));
  ok('a CardDue upgrades its legacy unknown account to credit and fixes snapshot semantics',
    unknown?.kind === 'card' &&
      unknown?.cardType === 'credit' &&
      unknown?.snapshotKind === 'limit' &&
      unknown?.snapshotFils === 500000);
  ok('a CardDue overrides a legacy debit fallback with authoritative credit evidence',
    debit?.kind === 'card' && debit?.cardType === 'credit');
}

{
  const backup = JSON.stringify({
    app: 'wafra',
    version: 1,
    data: {
      transactions: [],
      accounts: [
        account('backup-legacy', {
          cardType: 'debit',
          snapshotFils: 875000,
          snapshotKind: 'balance',
        }),
      ],
      cardDues: [due('backup-due', 'backup-legacy', '2025-03-01')],
    },
  });
  const restored = hydration.parseBackupForRestore(backup);
  const card = restored?.accounts?.find((row) => row.id === 'backup-legacy');
  ok('old backup restore applies the same due-authoritative migration as launch hydration',
    restored?.cardDues?.some((row) => row.id === 'backup-due') &&
      card?.kind === 'card' &&
      card?.cardType === 'credit' &&
      card?.snapshotKind === 'limit' &&
      card?.snapshotFils === 875000);
  ok('backup restore still rejects an invalid envelope',
    hydration.parseBackupForRestore(JSON.stringify({ app: 'not-wafra', data: { transactions: [] } })) === null);
}

{
  const edited = [
    tx('edited-pan', { title: '4782********4833 User title', userEdited: true }),
    tx('edited-large', { amountFils: 100_000_001, userEdited: true }),
    tx('edited-income', { type: 'income', category: 'dining', userEdited: true }),
    tx('edited-service', { title: 'Legacy service', userEdited: true }),
    tx('edited-category', { title: 'Unclassified merchant', userEdited: true }),
    tx('edited-raw', { title: 'My correction', raw: 'parser would replace this', userEdited: true }),
  ];
  const before = new Map(edited.map((row) => [row.id, JSON.stringify(row)]));
  const automatic = [
    tx('auto-pan', { title: '4782********4833 Machine title' }),
    tx('auto-large', { amountFils: 100_000_001 }),
    tx('auto-income', { type: 'income', category: 'dining' }),
    tx('auto-service', { title: 'Legacy service' }),
    tx('auto-category', { title: 'Unclassified merchant' }),
    tx('auto-raw', { raw: 'reparse me' }),
  ];
  const migrated = hydration.migratePersistedState({ transactions: [...edited, ...automatic] });
  const byId = new Map(migrated.transactions.map((row) => [row.id, row]));
  ok('automatic hydration transforms preserve every userEdited row byte-for-byte',
    edited.every((row) => JSON.stringify(byId.get(row.id)) === before.get(row.id)),
    'masked PAN repair, income refile, service normalization, recategorization and raw ' +
      'reparse must leave exact persisted objects intact; large amounts are authoritative too');
  ok('the same hydration migration still repairs unedited rows',
    byId.get('auto-pan')?.title === 'Card payment' &&
      byId.get('auto-large')?.amountFils === 100_000_001 &&
      byId.get('auto-income')?.category === 'business' &&
      byId.get('auto-service')?.title === 'Canonical service' &&
      byId.get('auto-category')?.category === 'dining' &&
      byId.get('auto-raw')?.title === 'Reparsed merchant' &&
      byId.get('auto-raw')?.raw === undefined);
}

{
  const propertyTransfer = tx('property-transfer', {
    type: 'income',
    title: 'Property completion transfer',
    category: 'business',
    amountFils: 250_000_000,
    isTransfer: true,
  });
  const before = JSON.stringify(propertyTransfer);
  const migrated = hydration.migratePersistedState({ transactions: [propertyTransfer] });
  ok('hydration retains a legitimate persisted SMS transfer above AED 1M',
    migrated.transactions.length === 1 &&
      migrated.transactions[0].amountFils === 250_000_000 &&
      JSON.stringify(migrated.transactions[0]) === before);

  const unsupported = tx('unsupported-old-row', {
    title: 'Legacy property payment',
    category: 'business',
    raw: 'temporarily unsupported',
  });
  const unsupportedBefore = JSON.stringify(unsupported);
  const reparsed = hydration.migratePersistedState({ transactions: [unsupported] });
  ok('a temporary parser miss retains the persisted transaction and its raw evidence',
    reparsed.transactions.length === 1 &&
      JSON.stringify(reparsed.transactions[0]) === unsupportedBefore);
}

{
  const business = tx('anonymous-business', {
    type: 'income', title: 'Incoming transfer', category: 'business',
  });
  const dining = tx('anonymous-dining', {
    type: 'income', title: 'Inward remittance', category: 'dining',
  });
  const withPayer = tx('named-business', {
    type: 'income',
    title: 'Incoming transfer',
    category: 'business',
    raw: 'temporarily unsupported File Ref 123B/O ACME LLCClient payment',
  });
  const edited = tx('edited-anonymous-income', {
    type: 'income',
    title: 'Incoming transfer',
    category: 'business',
    userEdited: true,
  });
  const manual = tx('manual-anonymous-income', {
    type: 'income', title: 'Incoming transfer', category: 'business', source: 'manual',
  });
  const editedBefore = JSON.stringify(edited);
  const migrated = hydration.migratePersistedState({
    transactions: [business, dining, withPayer, edited, manual],
  });
  const byId = new Map(migrated.transactions.map((row) => [row.id, row]));
  ok('anonymous structural SMS income is migrated from business and spending to Other',
    byId.get(business.id)?.category === 'other' && byId.get(dining.id)?.category === 'other');
  ok('raw payer evidence prevents anonymous-income recategorization',
    byId.get(withPayer.id)?.category === 'business' &&
      byId.get(withPayer.id)?.raw === withPayer.raw);
  ok('anonymous-income migration stays narrow and preserves user intent',
    JSON.stringify(byId.get(edited.id)) === editedBefore &&
      byId.get(manual.id)?.category === 'business');

  const backup = JSON.stringify({
    app: 'wafra', data: { transactions: [business], accounts: [], cardDues: [] },
  });
  ok('backup restore also refiles legacy anonymous business income to Other',
    hydration.parseBackupForRestore(backup)?.transactions?.[0]?.category === 'other');
}

{
  const stale = tx('stale-remittance', {
    type: 'income',
    title: 'Inward remittance',
    isTransfer: true,
  });
  const edited = tx('edited-remittance', {
    type: 'income',
    title: 'Inward remittance',
    isTransfer: true,
    userEdited: true,
  });
  const neighbours = [
    edited,
    tx('raw-remittance', {
      type: 'income', title: 'Inward remittance', isTransfer: true, raw: 'still parsable',
    }),
    tx('manual-remittance', {
      type: 'income', title: 'Inward remittance', isTransfer: true, source: 'manual',
    }),
    tx('incoming-transfer', {
      type: 'income', title: 'Incoming transfer', isTransfer: true,
    }),
  ];
  const editedBefore = JSON.stringify(edited);
  const migrated = hydration.migratePersistedState({ transactions: [stale, ...neighbours] });
  const byId = new Map(migrated.transactions.map((row) => [row.id, row]));
  ok('hydration clears only the stale rawless SMS inward-remittance transfer flag',
    byId.has(stale.id) && !('isTransfer' in byId.get(stale.id)) &&
      byId.get('raw-remittance')?.isTransfer === true &&
      byId.get('manual-remittance')?.isTransfer === true &&
      byId.get('incoming-transfer')?.isTransfer === true);
  ok('the inward-remittance migration keeps userEdited rows byte-for-byte',
    JSON.stringify(byId.get(edited.id)) === editedBefore);

  const backup = JSON.stringify({
    app: 'wafra',
    data: { transactions: [stale], accounts: [], cardDues: [] },
  });
  const restored = hydration.parseBackupForRestore(backup);
  ok('backup restore clears the same stale inward-remittance transfer flag',
    restored?.transactions?.length === 1 &&
      restored.transactions[0].id === stale.id &&
      !('isTransfer' in restored.transactions[0]));
}

{
  const statement = tx('legacy-statement', { raw: 'now a statement' });
  const bill = tx('legacy-bill', { raw: 'now a bill' });
  const state = {
    transactions: [statement, bill],
    cardDues: [],
    bills: [],
    lastScanTs: 1785582000000,
  };
  const migrated = hydration.migratePersistedState(state);
  ok('hydration retains a raw row newly recognized as a card statement until a due exists',
    migrated.transactions.some((row) => row.id === statement.id) &&
      migrated.cardDues.length === 0 &&
      migrated.lastScanTs === state.lastScanTs);
  ok('hydration retains a raw row newly recognized as a bill until a bill exists',
    migrated.transactions.some((row) => row.id === bill.id) &&
      migrated.bills.length === 0 &&
      migrated.lastScanTs === state.lastScanTs);
}

{
  const first = tx('coffee-one', {
    title: 'Same coffee',
    amountFils: 2200,
    ts: 1785582000000,
    smsKey: 's1785582000000-2200',
  });
  const second = tx('coffee-two', {
    title: 'Same coffee',
    amountFils: 2200,
    ts: 1785582600000,
    smsKey: 's1785582600000-2200',
  });
  const genuine = hydration.finalizeHydrationTransactions([first, second]);
  ok('hydration preserves two genuine same-day equal purchases',
    genuine.length === 2 && genuine.some((row) => row.id === first.id) &&
      genuine.some((row) => row.id === second.id));

  const edited = tx('edited-capture', {
    title: 'My coffee correction',
    note: 'keep exactly',
    userEdited: true,
    ts: 1785582000000,
    smsKey: 's1785582000000-2200',
  });
  const poorer = tx('poorer-capture', {
    title: 'Bank notification',
    viaPush: true,
    ts: 1785582001000,
    smsKey: edited.smsKey,
  });
  const before = JSON.stringify(edited);
  const reconciled = hydration.finalizeHydrationTransactions([poorer, edited]);
  ok('capture reconciliation preserves the userEdited winner byte-for-byte',
    reconciled.some((row) => row.id === edited.id && JSON.stringify(row) === before));
}

const persistedMigrationBody = bodyOf(store, 'export function migratePersistedState');
ok('the coarse pre-hydration day/amount/direction/title dedupe is gone',
  !!persistedMigrationBody &&
    !/const best = new Map/.test(persistedMigrationBody) &&
    !/importTs/.test(persistedMigrationBody) &&
    /finalizeHydrationTransactions/.test(store));

ok('hydration no longer ages out authoritative CardDue records',
  !!persistedMigrationBody &&
    !/60\s*\*\s*86400000/.test(persistedMigrationBody) &&
    !/cardDues\s*=\s*parsed\.cardDues\.filter/.test(persistedMigrationBody));

ok('hydration has no amount-only destructive transaction filter',
  !!persistedMigrationBody &&
    !/100_000_000/.test(persistedMigrationBody) &&
    !/amountFils\s*[<>]=?\s*\d+[\s\S]{0,120}?return \[\]/.test(persistedMigrationBody));

ok('a parser miss retains the old row instead of deleting it',
  !!persistedMigrationBody && /if \(!p\) return \[t\]/.test(persistedMigrationBody));

const restoreBackupBody = bodyOf(store, 'const restoreBackup = useCallback');
ok('backup restore migrates old state before dispatching it',
  !!restoreBackupBody &&
    inOrder(restoreBackupBody, 'parseBackupForRestore(json)', "dispatch({ type: 'restore'"));

const clearAllBody = bodyOf(store, 'const clearAll = useCallback');
ok('a successful erase clears the latch BEFORE writing the blank store',
  !!clearAllBody &&
    inOrder(
      clearAllBody,
      'await destroyOperation',
      'storageBlocked.current = false',
      'await persist(',
    ),
  'this is the bug: destroy really did erase everything, then persist() returned false ' +
    'because the latch was still set, and clearAll threw "Blank encrypted store could not be ' +
    'created". The user was left with no ledger AND an error saying the erase failed');

ok('the erase latches writes off BEFORE it dispatches the blank state',
  !!clearAllBody &&
    inOrder(
      clearAllBody,
      'storageBlocked.current = true',
      "dispatch({ type: 'clearAll' })",
      'await destroyOperation',
      'storageBlocked.current = false',
      'await persist(',
    ),
  'the dispatch makes the authoritative ref blank and arms a fresh 700ms save of it. Latching ' +
    'after the dispatch — or not at all — leaves that timer free to write blank over a ledger ' +
    'whose erase then failed');

ok('a failed erase leaves writes latched OFF',
  !!clearAllBody &&
    clearAllBody.indexOf('await destroyOperation') <
      clearAllBody.indexOf('storageBlocked.current = false') &&
    (clearAllBody.match(/storageBlocked\.current = false/g) ?? []).length === 1,
  'destroyOperation throws on failure, so the single unlatch must sit after the await — the ' +
    'ledger we failed to erase is still on disk, and the only state this session has left to ' +
    'offer it is blank');

ok('a failed blank write is still reported',
  !!clearAllBody && /if \(!written\) throw/.test(clearAllBody),
  '"erase and start over" that silently failed to create the new store would leave the app ' +
    'writing nowhere for the rest of the session');

ok('the pre-erase state is captured before the blank dispatch',
  !!clearAllBody &&
    inOrder(
      clearAllBody,
      'const previousState = authoritativeState.current',
      "dispatch({ type: 'clearAll' })",
    ),
  '`authoritativeState.current` becomes blank the instant the dispatch runs — capturing it ' +
    'after that point would capture blank, and there would be nothing left to restore on failure');

const catchStart = clearAllBody.indexOf('catch (error) {');
const catchEnd = clearAllBody.indexOf('throw error;', catchStart);
const catchBlock =
  catchStart !== -1 && catchEnd !== -1 ? clearAllBody.slice(catchStart, catchEnd) : '';

ok('a failed erase restores the previous state, surfaces recovery, and rethrows in that order',
  catchBlock !== '' &&
    inOrder(
      catchBlock,
      "dispatch({ type: 'restore', state: previousState })",
      "setStorageFailure(recordStorageFailure('destroy', error))",
      'setHydrationFailed(true)',
    ) &&
    catchEnd > catchStart,
  'each step matters on its own: no restore leaves the UI showing blank over a ledger that is ' +
    'still there; no storageFailure/hydrationFailed leaves the recovery screen down and the ' +
    'user editing over data that can never be saved; and the throw has to survive all of it so ' +
    'Settings still reports the failure');

ok('the catch block never reopens writes',
  catchBlock !== '' && !catchBlock.includes('storageBlocked.current = false'),
  'destroy can fail with the key or the database file only partially removed — reopening writes ' +
    'there is the exact bug the latch exists to prevent, so failure must not be the path that ' +
    'clears it');

// ---------------------------------------------------------------------------
// 2c. The erase-failure race — RUN, not read.
//
// The assertions above pin the shape of clearAll. This section pins its
// behaviour, because the failure it guards against is an interleaving and a
// source-order check can be satisfied by code that still loses the ledger.
//
// The interleaving, which is reachable today:
//
//   dispatch({type:'clearAll'})  the reducer runs synchronously, so the
//                               authoritative ref is blank the instant it
//                               returns, and the re-render arms a 700ms save
//                               that reads that ref AT FIRE TIME
//   destroy() rejects           `state-storage.native.ts` throws with the key
//                               AND the database file both retained — the two
//                               failures are coupled, since expo-sqlite will
//                               not delete an open database and SecureStore
//                               cannot delete a key while the Keystore is
//                               locked. The old ledger is still readable.
//   writeQueue recovers         the shared queue is deliberately
//                               non-rejecting, so it resolves anyway
//   timer fires                 persist(blank) chains onto that queue and
//                               commits over the surviving ledger, while
//                               Settings tells the user the erase failed
//
// So the real body of clearAll is lifted out of store.tsx and run against
// doubles, through exactly that sequence. On the old ordering (no latch, or a
// latch set after the dispatch) the blank write lands and these fail.
// ---------------------------------------------------------------------------

const asyncSuites = [];

/** The real `clearAll` body, compiled with its dependencies as parameters. */
function compileClearAll() {
  if (!clearAllBody) return null;
  try {
    return new Function(
      'saveTimer',
      'dispatch',
      'writeQueue',
      'stateStorage',
      'STORAGE_KEY',
      'persist',
      'storageBlocked',
      'prevChunkCount',
      'prevChunks',
      'prevTransactions',
      'setHydrationFailed',
      'setStorageFailure',
      'authoritativeState',
      'recordStorageFailure',
      `return (async () => {${clearAllBody}})();`,
    );
  } catch {
    return null;
  }
}

/**
 * @param destroyFails  the erase throws with key and database both retained
 * @param latchedBefore true when hydration already failed — erase from the
 *                      recovery screen rather than from Settings
 */
async function runErase({ destroyFails, latchedBefore }) {
  const clearAll = compileClearAll();
  if (!clearAll) return null;

  const calls = [];
  const dispatched = [];
  const OLD = [{ id: 'tx-1', amount: 100 }];
  const PREVIOUS_STATE = { hydrated: true, onboarded: true, transactions: OLD };
  const storageBlocked = { current: latchedBefore };
  const authoritativeState = {
    current: PREVIOUS_STATE,
  };
  const saveTimer = { current: null };
  const prevChunkCount = { current: 1 };
  const prevChunks = { current: ['[]'] };
  const prevTransactions = { current: OLD };
  const writeQueue = { current: Promise.resolve() };
  const armed = [];

  const stateStorage = {
    destroy: async () => {
      calls.push('destroy');
      if (destroyFails) throw new Error('key retained and database retained');
    },
    multiSet: async () => {
      calls.push('multiSet');
    },
  };

  // persist(), reduced to the two properties this contract is about: it
  // refuses while the latch is closed, and otherwise it chains a real device
  // write onto the same shared queue the erase uses.
  const persist = (snapshot) => {
    if (storageBlocked.current) {
      calls.push('refused');
      return Promise.resolve(false);
    }
    const op = writeQueue.current.then(() => stateStorage.multiSet(snapshot)).then(() => true);
    writeQueue.current = op.then(
      () => undefined,
      () => undefined,
    );
    return op;
  };

  // Every dispatch re-renders in the real app, which is what arms the 700ms
  // save — modelled here as a macrotask so it lands after every microtask
  // clearAll is made of, whichever action armed it.
  const dispatch = (action) => {
    dispatched.push(action);
    if (action.type === 'restore') {
      authoritativeState.current = action.state;
    } else {
      authoritativeState.current = { hydrated: true, onboarded: false, transactions: [] };
    }
    armed.push(setTimeout(() => void persist(authoritativeState.current), 0));
  };

  let hydrationFailed = false;
  let storageFailureRecorded = null;
  const setHydrationFailed = (value) => {
    hydrationFailed = value;
  };
  const setStorageFailure = (value) => {
    storageFailureRecorded = value;
  };
  // The real function's shape, reduced to what these assertions need: a
  // non-null record carrying the operation and the error that caused it.
  const recordStorageFailure = (op, error) => ({ op, message: error && error.message });

  let threw = false;
  try {
    await clearAll(
      saveTimer,
      dispatch,
      writeQueue,
      stateStorage,
      'wafra:state:v1',
      persist,
      storageBlocked,
      prevChunkCount,
      prevChunks,
      prevTransactions,
      setHydrationFailed,
      setStorageFailure,
      authoritativeState,
      recordStorageFailure,
    );
  } catch {
    threw = true;
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  armed.forEach(clearTimeout);
  return {
    calls,
    threw,
    blocked: storageBlocked.current,
    dispatched,
    hydrationFailed,
    storageFailureRecorded,
    finalState: authoritativeState.current,
  };
}

asyncSuites.push(
  (async () => {
    const compiled = !!compileClearAll();
    ok('the erase body can be run against doubles',
      compiled,
      'clearAll could not be lifted out of store.tsx — the behavioural assertions below did ' +
        'not run, so treat them as failed rather than passed');
    if (!compiled) return;

    const failedFromSettings = await runErase({ destroyFails: true, latchedBefore: false });
    ok('a failed erase never writes the blank state to storage',
      failedFromSettings.threw && !failedFromSettings.calls.includes('multiSet'),
      'destroy rejected with the ledger still on disk and readable, and the debounced save of ' +
        `the blank state committed anyway: ${JSON.stringify(failedFromSettings.calls)}. That is ` +
        'the erase failing in the UI and succeeding on disk');

    ok('a failed erase leaves the session latched, whatever it started as',
      failedFromSettings.blocked === true,
      'this erase started from Settings with writes open. After the failure the only state ' +
        'this session has is blank, so writes must stay refused for the rest of it');

    ok('the latch is closed before the blank state is ever dispatched',
      failedFromSettings.calls.includes('refused'),
      'the save armed by the blank dispatch must be refused, not merely late. If it was never ' +
        'refused the latch closed too late — or not at all');

    ok('every save armed while the erase is failing is refused, including the restore\'s own re-render',
      failedFromSettings.calls.filter((c) => c === 'refused').length === 2,
      'the blank dispatch arms one save and the restore dispatch arms another; both must be ' +
        `refused by the still-closed latch. Calls: ${JSON.stringify(failedFromSettings.calls)}`);

    ok('a failed erase restores what was visibly on screen before it started',
      failedFromSettings.dispatched.length === 2 &&
        failedFromSettings.dispatched[0].type === 'clearAll' &&
        failedFromSettings.dispatched[1].type === 'restore' &&
        failedFromSettings.dispatched[1].state.transactions === failedFromSettings.finalState.transactions &&
        failedFromSettings.finalState.onboarded === true,
      'the blank dispatch made the screen show nothing; a failed erase must dispatch a restore ' +
        'of the pre-erase state afterward so the user does not see their ledger vanish for an ' +
        `erase that may not have deleted anything. Dispatched: ${JSON.stringify(failedFromSettings.dispatched.map((a) => a.type))}`);

    ok('a failed erase surfaces recovery so the user cannot keep editing over it',
      failedFromSettings.hydrationFailed === true && !!failedFromSettings.storageFailureRecorded,
      'without hydrationFailed the recovery screen never appears, and without storageFailure ' +
        'there is nothing to show on it — either gap lets the user keep making edits that the ' +
        'closed latch can never save');

    const failedFromRecovery = await runErase({ destroyFails: true, latchedBefore: true });
    ok('a failed erase from the recovery screen still refuses writes',
      failedFromRecovery.threw &&
        failedFromRecovery.blocked === true &&
        !failedFromRecovery.calls.includes('multiSet'),
      'the ledger here was unreadable AND could not be erased; nothing derived from this ' +
        'session may replace it');

    ok('a failed erase from the recovery screen also restores state and stays surfaced',
      failedFromRecovery.dispatched.some((a) => a.type === 'restore') &&
        failedFromRecovery.hydrationFailed === true &&
        !!failedFromRecovery.storageFailureRecorded,
      'starting already latched must not skip the restore or the recovery surfacing — the user ' +
        'is in the same "screen shows blank, ledger may still be intact" situation either way');

    const succeeded = await runErase({ destroyFails: false, latchedBefore: true });
    ok('a successful erase unlatches and writes the blank store',
      succeeded !== null &&
        !succeeded.threw &&
        succeeded.blocked === false &&
        succeeded.calls.indexOf('multiSet') > succeeded.calls.indexOf('destroy'),
      'the latch may only be cleared by a destroy that actually succeeded — and it must be ' +
        'cleared, or the deliberate blank write is refused and Settings reports a failure for ' +
        `an erase that erased everything. Calls: ${JSON.stringify(succeeded?.calls)}`);

    ok('a successful erase never dispatches a restore and leaves recovery clear',
      succeeded !== null &&
        succeeded.dispatched.length === 1 &&
        succeeded.dispatched[0].type === 'clearAll' &&
        succeeded.hydrationFailed === false &&
        succeeded.storageFailureRecorded === null,
      'restoring the old state or leaving recovery flags set after a SUCCESSFUL erase would ' +
        `resurrect the just-cleared ledger or block the user for no reason. Dispatched: ` +
        `${JSON.stringify(succeeded?.dispatched.map((a) => a.type))}`);
  })(),
);

// ---------------------------------------------------------------------------
// 3. Diagnostics may never leak a key or a ledger row, and may never throw.
// ---------------------------------------------------------------------------

const diagSrc = readIfPresent('src/lib/storage-diagnostics.ts');
if (!diagSrc) {
  ok('storage diagnostics module exists', false, 'src/lib/storage-diagnostics.ts is missing');
} else {
  const diag = stripComments(diagSrc);

  ok('diagnostics record to the console as well as to a file',
    /console\.warn/.test(diag),
    'on a SIGNED Android build the app is not debuggable, so `adb run-as` cannot read the ' +
      'sandbox — logcat is the only channel that can be retrieved from the build that ' +
      'actually reproduces the bug');

  ok('the log tag is fixed and greppable',
    /LOG_TAG = 'wafra:storage'/.test(diag),
    'an on-device measurement plan needs a string to filter logcat on');

  /**
   * Dead exports are not free here. Every one of these returns records built
   * from failure data, so a support screen that "just displays them" is a new
   * disclosure path — and there is no such screen. If one is ever built, it
   * should be built against a deliberate API rather than whatever was left
   * lying around.
   */
  const exported = [...diag.matchAll(/export (?:function|const) ([A-Za-z0-9_]+)/g)].map(
    (m) => m[1],
  );
  const appSources = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && full !== path.join(ROOT, 'src/lib/storage-diagnostics.ts')) {
        appSources.push(fs.readFileSync(full, 'utf8'));
      }
    }
  })(path.join(ROOT, 'src'));
  const unused = exported.filter(
    (name) => !appSources.some((src) => new RegExp(`\\b${name}\\b`).test(src)),
  );
  ok('storage diagnostics exports nothing the app does not use',
    unused.length === 0,
    `unused: ${unused.join(', ')} — records assembled from failure data should not have ` +
      'readers that nothing calls');

  const MAX_DETAIL = Number((diagSrc.match(/const MAX_DETAIL = (\d+)/) ?? [])[1]);
  ok('MAX_DETAIL is a real number read from the module',
    Number.isInteger(MAX_DETAIL) && MAX_DETAIL > 0,
    'the bound assertion below is meaningless if this is NaN');

  /**
   * The redaction rules, exercised rather than grepped. `redact` is no longer
   * the privacy boundary — the allowlist below it is — but it is still the last
   * gate every console line passes through, and the PRAGMA case is the one way
   * this module could ever turn a storage bug into a key disclosure.
   */
  const redact = loadRedact(diagSrc);
  if (!redact) {
    ok('redact() is testable in isolation', false, 'could not extract redact() from the module');
  } else {
    const KEY = 'a'.repeat(64);

    ok('redact strips the key out of a failing PRAGMA',
      !redact(`Error executing PRAGMA key = "x'${KEY}'";`).includes(KEY),
      'the one way this module could turn a storage bug into a key disclosure');

    ok('redact strips a bare hex key',
      !redact(`near "${KEY}": syntax error`).includes(KEY),
      'the key reaches native as hex; it must not survive any framing');

    ok('redact strips quoted literals',
      !redact(`constraint failed: '{"amountFils":123456,"title":"Carrefour"}'`).includes(
        'Carrefour',
      ),
      'a bound parameter echoed back by native would be a ledger row in a log file');

    ok('redact still says which operation failed',
      /PRAGMA key/.test(redact(`Error executing PRAGMA key = "x'${KEY}'";`)),
      'a message redacted down to nothing is not a diagnostic. The statement name has to ' +
        'survive even though its argument must not');

    /**
     * The old form of this was `length < 400` against a cap of 240 — it passed
     * with the truncation removed entirely, and it passed with the cap raised
     * by half. Pinned to the constant instead: the cap plus the one ellipsis
     * character the truncation appends.
     */
    ok('redact truncates to exactly MAX_DETAIL plus the ellipsis',
      redact('x'.repeat(5000)).length === MAX_DETAIL + 1,
      `${redact('x'.repeat(5000)).length} chars for a cap of ${MAX_DETAIL}`);

    ok('redact does not throw on non-strings',
      safe(() => redact(undefined)) && safe(() => redact({ a: 1 })) && safe(() => redact(null)),
      'it runs inside catch blocks; throwing there would mask the failure it is reporting');
  }

  /**
   * The whole module is called from inside catch blocks around the user's
   * money. Every side-effecting path has to be individually guarded — a single
   * unguarded `file.write` would turn a recoverable storage failure into a
   * crash on the error path.
   */
  const bodies = diag.split(/export function |function /).slice(1);
  const effectful = bodies.filter((body) =>
    /console\.warn|diagnosticsFile\(\)|JSON\.parse|JSON\.stringify|ensureLoaded\(\)|scheduleFlush\(\)|flushNow\(\)/.test(
      body,
    ),
  );
  const unguarded = effectful
    .filter((body) => !/try\s*\{/.test(body))
    .map((body) => body.slice(0, body.indexOf('(')).trim());
  ok('every side-effecting diagnostics path is wrapped in try/catch',
    effectful.length > 0 && unguarded.length === 0,
    `unguarded: ${unguarded.join(', ')} (of ${effectful.length} effectful)`);

  ok('the diagnostics file write is throttled',
    /MIN_WRITE_INTERVAL_MS/.test(diag) && /lastWritten/.test(diag),
    'File.write is synchronous and runs on the JS thread. A failing device produces these in ' +
      'bursts — every debounced save, every retry — so rewriting the same twelve rows each ' +
      'time spends JS-thread time during the incident the user is trying to recover from');
}

// ---------------------------------------------------------------------------
// 3a. Diagnostics, actually executed.
//
// Everything above this line is a grep. These run the real module, because the
// property that matters — "an arbitrary native string cannot reach the record"
// — is not visible in the source. The old test asserted that `redact` removed
// QUOTED text, and a native error carrying an UNQUOTED merchant name, IBAN or
// amount sailed through it into logcat and onto disk.
// ---------------------------------------------------------------------------

const diagBuild = path.join(__dirname, 'build/storage-diagnostics.js');
if (!fs.existsSync(diagBuild)) {
  console.log('- storage-diagnostics not transpiled, skipping the executed diagnostics checks');
} else {
  const diagnostics = require(diagBuild);
  const warn = console.warn;
  const logged = [];
  console.warn = (line) => logged.push(String(line));
  try {
    /**
     * A native error of the worst realistic shape: no quotes anywhere, and a
     * merchant, an amount, an IBAN and a key all sitting in plain text. Every
     * one of these is in the message because expo-sqlite errors echo the
     * failing statement, and the ledger's values are what that statement binds.
     */
    const nasty = new Error(
      'insert failed for Carrefour Mall of the Emirates 1234.56 AED ' +
        'AE070331234567890123456 pragma key = x' + 'a'.repeat(64),
    );
    nasty.code = 'SQLITE_CORRUPT';
    const record = diagnostics.recordStorageFailure('write', nasty);
    const serialised = JSON.stringify(record) + '\n' + logged.join('\n');

    const leaks = [
      'Carrefour',
      'Emirates',
      '1234.56',
      'AE070331234567890123456',
      'a'.repeat(64),
    ].filter((needle) => serialised.includes(needle));
    ok('no part of an arbitrary native message reaches the record or the log',
      leaks.length === 0,
      `leaked: ${leaks.join(', ')} — this is why the message is classified and DROPPED ` +
        'rather than filtered. A blocklist only removes what someone thought of');

    ok('the record keeps a stable error code',
      record.code === 'SQLITE_CORRUPT',
      `code was ${JSON.stringify(record.code)} — an identifier-shaped code is what makes two ` +
        'reports comparable; without it every failure looks alike');

    ok('the record classifies the failure',
      record.category === 'corrupt',
      `category was ${JSON.stringify(record.category)}`);

    ok('the record keeps the error constructor',
      record.kind === 'Error',
      `kind was ${JSON.stringify(record.kind)}`);

    /**
     * The distinction the recovery screen depends on: a key that no longer
     * opens the file cannot be retried into working, and the screen must not
     * imply otherwise.
     */
    const mismatch = diagnostics.recordStorageFailure(
      'open',
      new Error('file is not a database'),
    );
    ok('a key mismatch is classified as one',
      mismatch.category === 'key-mismatch',
      `category was ${JSON.stringify(mismatch.category)} — the recovery screen chooses its ` +
        'copy from this, and offering "try again" for a lost key is a lie');

    /** An unrecognised message must degrade to useless, not to revealing. */
    const unknown = diagnostics.recordStorageFailure(
      'read',
      new Error('Talabat payout 500.00 to IBAN AE999999999999999999999'),
    );
    ok('an unrecognised message classifies as unknown and carries nothing',
      unknown.category === 'unknown' &&
        !JSON.stringify(unknown).includes('Talabat') &&
        !JSON.stringify(unknown).includes('500.00') &&
        unknown.code === null,
      JSON.stringify(unknown));

    /** A merchant name is not an error code, however single-word it is. */
    const fakeCode = new Error('boom');
    fakeCode.code = 'Carrefour Mall';
    ok('a code that is not code-shaped is dropped',
      diagnostics.recordStorageFailure('write', fakeCode).code === null,
      'error.code is only kept in the shapes real codes come in — SQLITE_*, errno, ERR_*, ' +
        'or a bare result number');

    /**
     * One throw, four frames that each want to report it: openEncryptedDatabase
     * records `open`, multiSet records `write`, persist records `write` again,
     * and a durability caller records it once more. That filled the twelve-slot
     * ring buffer four times as fast and wrote the file on each one.
     */
    const shared = new Error('disk I/O error');
    const inner = diagnostics.recordStorageFailure('open', shared);
    logged.length = 0;
    const outerA = diagnostics.recordStorageFailure('write', shared);
    const outerB = diagnostics.recordStorageFailure('read', shared);
    ok('the same error object is recorded once, keeping the innermost operation',
      outerA === inner && outerB === inner && inner.op === 'open',
      `ops seen: ${inner.op}/${outerA.op}/${outerB.op} — the innermost frame is the one that ` +
        'knows the failure happened at open rather than merely somewhere under write');

    ok('a deduplicated report does no further logging',
      logged.length === 0,
      `${logged.length} extra console lines for an error already recorded`);
  } finally {
    console.warn = warn;
  }
}

/**
 * Pull `redact` out of the TypeScript source without a compiler. It is a pure
 * string function with no imports, so the body transpiles to itself once the
 * type annotations are gone.
 */
function loadRedact(source) {
  const start = source.indexOf('export function redact');
  if (start === -1) return null;
  let depth = 0;
  let i = source.indexOf('{', start);
  const open = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = source.slice(open + 1, i);
  // The body reads module-level caps (MAX_DETAIL). Carry the plain-literal
  // constants in with it rather than duplicating their values here, so a change
  // to the cap is exercised instead of quietly diverging from what is tested.
  const consts = [...source.matchAll(/^(?:export )?const ([A-Z_]+) = ([^;\n]+);$/gm)]
    .map(([, name, expr]) => `const ${name} = ${expr};`)
    .join('\n');
  try {
    return new Function('input', `${consts}\n${body}`.replace(/:\s*string(?=[;\s=)])/g, ''));
  } catch {
    return null;
  }
}

function safe(fn) {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 4. The upstream behaviour the diagnosis rests on.
//    Skipped rather than failed when node_modules is absent, matching
//    perf-config.test.js, so the suite still runs on a bare checkout.
// ---------------------------------------------------------------------------

const sqliteDb = readIfPresent('node_modules/expo-sqlite/build/SQLiteDatabase.js');
const sqliteOpts = readIfPresent('node_modules/expo-sqlite/build/NativeDatabase.d.ts');

if (!sqliteDb || !sqliteOpts) {
  console.log('- expo-sqlite not installed, skipping the upstream checks');
} else {
  /**
   * The mechanism. If this stops being true, the ban above is no longer
   * load-bearing and the comment explaining it is wrong.
   */
  ok('withExclusiveTransactionAsync still runs on a separate connection',
    /Transaction\.createAsync\(this\)/.test(sqliteDb) &&
      /useNewConnection:\s*true/.test(sqliteDb),
    'the entire diagnosis is that this helper does not run on the database you called it on');

  ok('the transaction connection is still built from SQLiteOpenOptions alone',
    /new ExpoSQLite\.NativeDatabase\(db\.databasePath, flattenOpenOptions\(options\)\)/.test(
      sqliteDb,
    ),
    'if it ever inherits connection state, an unkeyed transaction connection stops being ' +
      'inevitable and this should be re-measured rather than re-read');

  /**
   * The reason the second connection CANNOT be fixed by passing an option:
   * there is no option to pass. The day expo-sqlite adds one, this fails and
   * the right answer changes from "never use that helper" to "give it the key".
   *
   * The pattern used to be `/\bkey\?|cipher|password|passphrase/i`, which only
   * matched an OPTIONAL `key?` — the exact day expo added a REQUIRED `key:`
   * field, the check would have kept passing and the workaround would have
   * stayed in place for no reason. Matched as a property declaration now.
   */
  const optionsBlock = sqliteOpts.slice(
    sqliteOpts.indexOf('interface SQLiteOpenOptions'),
    sqliteOpts.indexOf('type FlattenedOpenOptions'),
  );
  ok('SQLiteOpenOptions still has no way to carry a cipher key',
    optionsBlock.length > 0 &&
      !/\bkey\s*\??\s*:/i.test(optionsBlock) &&
      !/\b(cipher|password|passphrase)\s*\??\s*:/i.test(optionsBlock),
    'if expo-sqlite gained a key option, the workaround in state-storage.native.ts is no ' +
      'longer the only fix and this file’s reasoning needs revisiting');

  /**
   * The alternative we DID move to. It has to stay on `this`.
   */
  const withTxn = sqliteDb.slice(
    sqliteDb.indexOf('async withTransactionAsync'),
    sqliteDb.indexOf('async withExclusiveTransactionAsync'),
  );
  ok('withTransactionAsync still runs on the calling connection',
    withTxn.length > 0 &&
      /this\.execAsync\('BEGIN'\)/.test(withTxn) &&
      !/createAsync/.test(withTxn),
    'this is the contrast that proves the exclusive variant is the odd one out');
}

const sqliteModule = readIfPresent(
  'node_modules/expo-sqlite/android/src/main/java/expo/modules/sqlite/SQLiteModule.kt',
);
if (!sqliteModule) {
  console.log('- expo-sqlite Android sources not installed, skipping the connection-cache check');
} else {
  /**
   * Why a poisoned connection has to be CLOSED and not merely forgotten. If
   * this cache ever goes away, dropping `databasePromise` would be sufficient
   * on its own and `poisonDatabase` is doing unnecessary work — but while it is
   * here, reopening by name returns the same connection with the failed
   * ROLLBACK's transaction still open.
   */
  ok('expo-sqlite still hands back a cached connection for the same path',
    /findCachedDatabase \{/.test(sqliteModule) && /it\.addRef\(\)/.test(sqliteModule),
    'if this changed, poisonDatabase’s close is no longer load-bearing and the comment ' +
      'explaining it is wrong');
}

// ---------------------------------------------------------------------------
// 5. SQLCipher has to actually be compiled in.
//
// `PRAGMA key` on a plain SQLite build is an UNRECOGNISED pragma, and SQLite
// ignores unrecognised pragmas WITHOUT ERROR. A build without SQLCipher writes
// the ledger in plaintext while every test above still passes and nothing at
// runtime says a word.
//
// This is checked in two places and NEITHER of them is the local `android/`
// directory. That directory is gitignored and regenerated: whatever is in it
// on someone's laptop says nothing about what the release build produces, and
// treating it as authoritative would be a test that passes because of a stale
// artefact. The release workflow runs `expo prebuild`, so the generated
// gradle.properties only exists inside that run — which is where the guard has
// to live.
//
// Independently confirmed on the artefact itself: the signed v43 APK was
// unpacked and `libexpo-sqlite.so` contains `sqlcipher` and `exsqlite3_key`
// symbols. That is the ground truth these two config checks stand in for
// between builds.
// ---------------------------------------------------------------------------

const appJson = readIfPresent('app.json');
if (!appJson) {
  console.log('- app.json not readable, skipping the SQLCipher build-config check');
} else {
  const config = JSON.parse(appJson);
  const plugins = config.expo?.plugins ?? [];
  const sqlitePlugin = plugins.find((p) => Array.isArray(p) && p[0] === 'expo-sqlite');
  ok('expo-sqlite is configured with useSQLCipher',
    !!sqlitePlugin && sqlitePlugin[1]?.useSQLCipher === true,
    'without it expo.sqlite.useSQLCipher is never written to gradle.properties, SQLITE_HAS_CODEC ' +
      'is not defined, and PRAGMA key is silently ignored — leaving the ledger in plaintext ' +
      'with nothing anywhere reporting a problem');
}

const workflow = readIfPresent('.github/workflows/build-apk.yml');
if (!workflow) {
  ok('the release workflow exists', false, '.github/workflows/build-apk.yml is missing');
} else {
  const prebuildAt = workflow.indexOf('expo prebuild');
  const guardAt = workflow.search(/expo\\?\.sqlite\\?\.useSQLCipher=true/);
  const gradleAt = workflow.indexOf('assembleRelease');

  ok('the release workflow verifies SQLCipher after prebuild',
    guardAt !== -1,
    'app.json says what we asked for; only the generated gradle.properties says what we got. ' +
      'Nothing else in this repo can tell the difference');

  ok('the guard runs after prebuild and before Gradle',
    prebuildAt !== -1 && guardAt > prebuildAt && gradleAt !== -1 && guardAt < gradleAt,
    'after prebuild because that is when the file first exists; before Gradle so a plaintext ' +
      'APK is never built at all, rather than built and then discovered');

  ok('the guard fails the build rather than warning',
    /::error::[^\n]*useSQLCipher|::error::[^\n]*SQLCipher/.test(workflow) &&
      /useSQLCipher[\s\S]{0,400}?exit 1/.test(workflow),
    'a warning in a 15-minute build log is not a guard');
}

/* ── a pinned category survives the release that renames its merchant ────
 *
 * WHAT HAPPENED. `setMerchantOverride` used to stamp `userEdited` on every row
 * a merchant rule touched. That was laundering — hundreds of rows the user
 * never opened counted as hand-corrected — and c79a2d6 rightly stopped it. But
 * `userEdited` was also the thing that kept `healPatch` off those rows
 * (heal.ts returns null on it), and nothing replaced it.
 *
 * The trigger is already in this repo. a2838e4 added five `SERVICE_NAMES`
 * entries — Shein, Dr. Vranjes, Foot Locker, M.H. Alshaya — which is to say it
 * changed the title the parser produces for messages ALREADY on users' phones.
 * The retitle in `migratePersistedState` renames the row, the rule stays keyed
 * on the spelling the row no longer carries, and three things break at once:
 * the pin stops reaching the row and heal overwrites the user's category with
 * the parser's; `raw` is dropped as "readable now", which is the only path any
 * later release has back to an already-imported row; and `parserCoverage`
 * moves the row out of `decided` and into `categorised`, crediting the user's
 * own answer to the parser — the exact laundering c79a2d6 removed, arriving
 * through the back door.
 *
 * The blast radius is the opposite of harmless. heal's deliberate-category
 * branch requires `p.categoryGuess !== prior.category`, so it fires ONLY where
 * the new parser is confidently different from what the user pinned — which is
 * exactly why the user pinned it. It hits the highest-value pins.
 *
 * Nothing here is stubbed: the real parser renames the row, the real heal
 * decides what to do with it, and the real coverage function scores it.
 */
{
  const real = loadHydrationExports({
    '@/lib/sms-parser': require('./build/sms-parser'),
    '@/lib/heal': require('./build/heal'),
    '@/lib/ledger': require('./build/ledger'),
    '@/lib/markets': {
      detectMarketId: () => 'AE',
      setActiveMarket: require('./build/markets').setActiveMarket,
    },
  });
  const { parserCoverage } = require('./build/accuracy');
  const { normalizeServiceName } = require('./build/sms-parser');

  const SHEIN_SMS =
    'Purchase of AED 123.00 with card ending 1234 at WWW.SHEIN.COM on 01/07/2026';

  // The premise, asserted rather than assumed: this release renames the row.
  // If a future edit drops the Shein rule this block would pass vacuously.
  ok('the parser renames this merchant, which is what puts the pin at risk',
    normalizeServiceName('Www.shein.com') === 'Shein',
    String(normalizeServiceName('Www.shein.com')));

  const onDisk = () => ({
    transactions: [
      // The pinned row. `groceries` is the user's answer; the parser reads
      // this merchant as `shopping`, which is what makes heal's deliberate
      // branch fire. No `userEdited` — c79a2d6 stopped setting it, and this
      // fix must not put it back.
      {
        id: 'pinned', type: 'expense', amountFils: 12300, category: 'groceries',
        accountId: 'main', title: 'Www.shein.com', date: '2026-07-01',
        source: 'sms', raw: SHEIN_SMS,
      },
      // A row nobody pinned, carried alongside so this cannot pass by turning
      // heal off.
      {
        id: 'unpinned', type: 'expense', amountFils: 4500, category: 'other',
        accountId: 'main', title: 'Card purchase', date: '2026-07-02',
        source: 'sms',
        raw: 'Purchase of AED 45.00 with card ending 1234 at CARREFOUR, DUBAI on 02/07/2026',
      },
    ],
    merchantOverrides: { 'www.shein.com': 'groceries' },
    marketId: 'AE',
  });

  const before = onDisk();
  const coverageBefore = parserCoverage(before);
  const after = real.migratePersistedState(onDisk());
  const pinned = after.transactions.find((t) => t.id === 'pinned');
  const unpinned = after.transactions.find((t) => t.id === 'unpinned');
  const coverageAfter = parserCoverage(after);

  ok('the row still takes the parser\'s better name',
    pinned.title === 'Shein', pinned.title);
  ok('but the category the user pinned survives the rename',
    pinned.category === 'groceries', pinned.category);
  ok('and the pin is not laundered back into a hand edit',
    pinned.userEdited === undefined, String(pinned.userEdited));
  ok('the raw message survives, so a later release can still reach this row',
    pinned.raw === SHEIN_SMS, String(pinned.raw));

  // The rule follows the merchant. This is the half a per-row marker cannot
  // do: without it every FUTURE message from this shop arrives titled "Shein",
  // misses a rule keyed on "www.shein.com", and the screen's promise — "future
  // imports from {merchant} will use this category" — quietly stops holding.
  ok('the merchant rule is re-keyed onto the name the parser now produces',
    after.merchantOverrides.shein === 'groceries',
    JSON.stringify(after.merchantOverrides));
  ok('and the old key is kept, so a rescan of an old spelling still matches',
    after.merchantOverrides['www.shein.com'] === 'groceries',
    JSON.stringify(after.merchantOverrides));

  // Symptom (b): the same laundering c79a2d6 was written to remove.
  ok('the user\'s answer is not re-credited to the parser',
    coverageAfter.decided === coverageBefore.decided &&
      coverageAfter.categoryMeasured === coverageBefore.categoryMeasured,
    JSON.stringify({ before: coverageBefore, after: coverageAfter }));

  // Heal is still doing its job on everything else.
  ok('an unpinned row is still healed by the same pass',
    unpinned.title === 'Carrefour' && unpinned.category === 'groceries',
    JSON.stringify({ title: unpinned.title, category: unpinned.category }));
  ok('and its raw IS dropped, because the parser really did learn that one',
    unpinned.raw === undefined, String(unpinned.raw));

  // Re-keying is idempotent and never overwrites an answer the user gave under
  // the canonical name themselves.
  const twice = real.migratePersistedState(real.migratePersistedState(onDisk()));
  ok('running the migration twice changes nothing further',
    twice.merchantOverrides.shein === 'groceries' &&
      twice.transactions.find((t) => t.id === 'pinned').category === 'groceries',
    JSON.stringify(twice.merchantOverrides));

  const bothKeys = onDisk();
  bothKeys.merchantOverrides = { 'www.shein.com': 'groceries', shein: 'shopping' };
  const kept = real.migratePersistedState(bothKeys);
  ok('an existing answer under the canonical key is not overwritten',
    kept.merchantOverrides.shein === 'shopping',
    JSON.stringify(kept.merchantOverrides));

  // A rule the LEDGER gives no evidence for is left where it is. SERVICE_NAMES
  // matches on substrings — that is how one shop stops arriving under six
  // spellings — so a hand-typed "Claudes Diner" canonicalises to Claude. Doing
  // that to a row is what already happens and the user is looking at the row;
  // doing it to a RULE would silently file their Claude subscription under
  // whatever they pinned a diner as.
  const handTyped = onDisk();
  handTyped.transactions = [{
    id: 'typed', type: 'expense', amountFils: 6000, category: 'dining',
    accountId: 'main', title: 'Claudes Diner', date: '2026-07-03',
    source: 'sms', userEdited: true, titleEdited: true,
  }];
  handTyped.merchantOverrides = { 'claudes diner': 'dining' };
  const notMoved = real.migratePersistedState(handTyped);
  ok('a rule the parser never produced a title for is not re-keyed',
    notMoved.merchantOverrides.claude === undefined,
    JSON.stringify(notMoved.merchantOverrides));

  // ...but a parser-owned row under the same name IS evidence, so the rule
  // moves. This is the case the whole block exists for and it must not be shut
  // off by the guard above.
  const evidenced = onDisk();
  evidenced.transactions = [{
    id: 'parsed', type: 'expense', amountFils: 6000, category: 'dining',
    accountId: 'main', title: 'Claudes Diner', date: '2026-07-03', source: 'sms',
  }];
  evidenced.merchantOverrides = { 'claudes diner': 'dining' };
  const moved = real.migratePersistedState(evidenced);
  ok('...but a rule the parser DID title a row with is re-keyed',
    moved.merchantOverrides.claude === 'dining',
    JSON.stringify(moved.merchantOverrides));

  /* ── the guard has to be evidence about THE KEY ──────────────────────────
   *
   * The two fixtures above only ever exercise one half of it: in both, the
   * canonical name appears nowhere in the ledger, so the rule was refused or
   * allowed purely on whether a row carried the OLD key. Every case below
   * carries a genuine, parser-owned row under the CANONICAL name for a reason
   * that has nothing to do with the pin — which is not a coincidence, it is
   * the normal state of any ledger that contains that merchant.
   *
   * The rule admitted exactly that. `!parserTitles.has(key) &&
   * !parserTitles.has(canonicalKey)` refused only when NEITHER was present, so
   * a real Claude subscription row was licence enough to move a pin the user
   * had typed on a diner. The subscription was then silently re-filed,
   * `isCandidate` dropped it as "already asked", every future charge took the
   * pin, and `parserCoverage` reported the user had answered for a merchant
   * they never named — the laundering c79a2d6 removed, through a new door.
   */
  const withUnrelatedCanonicalRow = (pinRow) => {
    const s = onDisk();
    s.transactions = [
      pinRow,
      // Entirely unrelated: the Anthropic subscription, read by the parser,
      // never touched by the user, filed correctly as software.
      {
        id: 'sub', type: 'expense', amountFils: 7300, category: 'software',
        accountId: 'main', title: 'Claude', date: '2026-07-05', source: 'sms',
        raw: 'Purchase of AED 73.00 with card ending 1234 at ANTHROPIC on 05/07/2026',
      },
    ];
    s.merchantOverrides = { 'claudes diner': 'dining' };
    return s;
  };

  for (const [label, pinRow] of [
    // The name is the user's: they retitled the row by hand.
    ['a row the user retitled by hand', {
      id: 'diner', type: 'expense', amountFils: 6000, category: 'dining',
      accountId: 'main', title: 'Claudes Diner', date: '2026-07-03',
      source: 'sms', userEdited: true, titleEdited: true,
    }],
    // `titleEdited` is a new field, so a row retitled before it existed
    // carries only `userEdited`. The guard cannot lean on `titleEdited`.
    ['a row retitled before titleEdited existed', {
      id: 'diner', type: 'expense', amountFils: 6000, category: 'dining',
      accountId: 'main', title: 'Claudes Diner', date: '2026-07-03',
      source: 'sms', userEdited: true,
    }],
    // Not an SMS row at all — typed into the app by hand.
    ['a hand-entered row', {
      id: 'diner', type: 'expense', amountFils: 6000, category: 'dining',
      accountId: 'main', title: 'Claudes Diner', date: '2026-07-03', source: 'manual',
    }],
  ]) {
    const out = real.migratePersistedState(withUnrelatedCanonicalRow(pinRow));
    const sub = out.transactions.find((t) => t.id === 'sub');
    ok(`an unrelated row under the canonical name is not evidence about the key (${label})`,
      out.merchantOverrides.claude === undefined,
      JSON.stringify(out.merchantOverrides));
    ok(`...so the subscription keeps the category the parser gave it (${label})`,
      sub.category === 'software', sub.category);
  }

  // And the case neither fixture above could reach at all: the pinned key has
  // NO rows left — the user deleted them, or an erase rebuilt the ledger from
  // the SMS store — while a real Claude row sits alongside. There is nothing
  // here connecting the two strings but a substring of SERVICE_NAMES.
  const orphanKey = withUnrelatedCanonicalRow(null);
  orphanKey.transactions = orphanKey.transactions.filter((t) => t !== null);
  const orphaned = real.migratePersistedState(orphanKey);
  ok('a key with no rows left is not re-keyed onto a merchant that happens to be there',
    orphaned.merchantOverrides.claude === undefined,
    JSON.stringify(orphaned.merchantOverrides));

  /* ── the ONE thing that links an old key to a name already renamed ───────
   *
   * When an earlier launch already did the retitle, no row carries the old key
   * any more and tier 1 is blind. The retained `raw` is the only surviving
   * link: the old spelling is the descriptor the message actually carried, so
   * a row now titled "Shein" whose raw still says WWW.SHEIN.COM connects the
   * two. Co-presence does not.
   */
  const alreadyRenamed = (raw) => ({
    marketId: 'AE',
    merchantOverrides: { 'www.shein.com': 'groceries' },
    transactions: [{
      id: 'r', type: 'expense', amountFils: 12300, category: 'groceries',
      accountId: 'main', title: 'Shein', date: '2026-07-01', source: 'sms',
      ...(raw ? { raw } : {}),
    }],
  });
  const linked = real.migratePersistedState(alreadyRenamed(SHEIN_SMS));
  ok('a retained raw message carrying the old spelling IS the link, so the rule moves',
    linked.merchantOverrides.shein === 'groceries',
    JSON.stringify(linked.merchantOverrides));

  // The honest half. Where the retitle already happened AND the raw is gone —
  // never kept on iOS, or stripped by the same heal pass that refiled the row —
  // the link is destroyed and nothing here can reconstruct it. Refusing costs
  // the user a rule that stops reaching future rows; guessing costs them a rule
  // they never set, applied silently and forever. Refusing is the lesser one,
  // and it is a refusal, not a repair — do not describe it as one.
  const unlinked = real.migratePersistedState(alreadyRenamed(null));
  ok('without that link the rule is left where it is, not guessed onto the new name',
    unlinked.merchantOverrides.shein === undefined &&
      unlinked.merchantOverrides['www.shein.com'] === 'groceries',
    JSON.stringify(unlinked.merchantOverrides));

  /* ── two spellings, one shop, two answers ────────────────────────────────
   *
   * "One shop pinned under six spellings" is the PREMISE of this whole block,
   * so two keys canonicalising onto one name is expected input. Iterating
   * `Object.entries` and taking the first writer let JSON key order decide it
   * — which is the order they were first pinned, so the OLDER answer won and
   * the newer one was dropped. There is no timestamp on an override, and a
   * row's `date` is when the shop was visited rather than when the user
   * answered, so nothing here can order two answers. It must not pick.
   */
  const twoSpellings = (overrides) => ({
    marketId: 'AE',
    merchantOverrides: overrides,
    transactions: [
      { id: 'a', type: 'expense', amountFils: 100, category: 'groceries', accountId: 'main',
        title: 'Www.shein.com', date: '2026-06-01', source: 'sms' },
      { id: 'b', type: 'expense', amountFils: 100, category: 'shopping', accountId: 'main',
        title: 'Shein Wholesale', date: '2026-07-01', source: 'sms' },
    ],
  });
  for (const order of [
    { 'www.shein.com': 'groceries', 'shein wholesale': 'shopping' },
    { 'shein wholesale': 'shopping', 'www.shein.com': 'groceries' },
  ]) {
    const out = real.migratePersistedState(twoSpellings(order));
    ok('two spellings disagreeing does not silently promote whichever was stored first',
      out.merchantOverrides.shein === undefined, JSON.stringify(out.merchantOverrides));
    ok('...and both old keys go on working, so no answer is lost',
      out.merchantOverrides['www.shein.com'] === 'groceries' &&
        out.merchantOverrides['shein wholesale'] === 'shopping',
      JSON.stringify(out.merchantOverrides));
  }

  // Agreement is not a conflict: there is only one answer to move.
  const agree = real.migratePersistedState(
    twoSpellings({ 'www.shein.com': 'shopping', 'shein wholesale': 'shopping' }),
  );
  ok('two spellings that agree still move the answer they share',
    agree.merchantOverrides.shein === 'shopping', JSON.stringify(agree.merchantOverrides));

  // A competing key with nothing left behind it has not been RULED OUT, it is
  // one nothing is known about. Dropping it from the vote for lack of evidence
  // hands the canonical name to whichever key still has rows — which is the
  // same "older answer wins" defect, wearing a smaller coat.
  const oneSideDeleted = twoSpellings({
    'www.shein.com': 'groceries', 'shein wholesale': 'shopping',
  });
  oneSideDeleted.transactions = oneSideDeleted.transactions.filter((t) => t.id === 'a');
  const partial = real.migratePersistedState(oneSideDeleted);
  ok('a competing answer whose rows are gone still blocks the other from taking the name',
    partial.merchantOverrides.shein === undefined,
    JSON.stringify(partial.merchantOverrides));

  // And the same when the competitor is a name the user typed. It gets no
  // evidence — the refusal above sees to that — but it still votes, because a
  // refusal costs one question and an invented rule costs every future charge.
  const typedCompetitor = {
    marketId: 'AE',
    merchantOverrides: { 'claudes diner': 'dining', 'anthropic claude': 'software' },
    transactions: [
      { id: 'diner', type: 'expense', amountFils: 6000, category: 'dining', accountId: 'main',
        title: 'Claudes Diner', date: '2026-07-03', source: 'sms', userEdited: true,
        titleEdited: true },
      { id: 'sub', type: 'expense', amountFils: 7300, category: 'software', accountId: 'main',
        title: 'Anthropic Claude', date: '2026-07-05', source: 'sms' },
    ],
  };
  const contested = real.migratePersistedState(typedCompetitor);
  ok('a hand-typed name competing for the same canonical key blocks the move too',
    contested.merchantOverrides.claude === undefined,
    JSON.stringify(contested.merchantOverrides));
}

/* ── an income pin is not an answer about an expense row ───────────────────
 *
 * `overrideFitsDirection` reached `categoryOf` and `applyMerchantOverride` and
 * stopped there. `parserCoverage` keyed `decided` on the pin's bare PRESENCE,
 * so an income pin — reachable by correcting a credit and tapping Remember —
 * moved that merchant's EXPENSE rows out of `categoryMeasured`, reporting "the
 * user already answered for this" about rows the rule can never touch. Those
 * rows are simultaneously struck off the categorise list by the same bare
 * check in `isCandidate`, so they are never asked about either: uncounted and
 * unaskable at once.
 */
{
  const { parserCoverage } = require('./build/accuracy');
  const { uncategorisedMerchants } = require('./build/uncategorised');

  const ledger = {
    accounts: [{ id: 'm', name: 'Main', kind: 'account' }],
    transactions: [
      { id: '1', type: 'expense', amountFils: 5000, category: 'other', accountId: 'm',
        title: 'Acme', date: '2026-07-01', source: 'sms' },
      { id: '2', type: 'expense', amountFils: 7000, category: 'other', accountId: 'm',
        title: 'Acme', date: '2026-07-02', source: 'sms' },
    ],
  };
  const withPin = (merchantOverrides) => ({ ...ledger, merchantOverrides });

  const income = parserCoverage(withPin({ acme: 'salary' }));
  ok('an income pin does not count a merchant\'s expense rows as answered',
    income.decided === 0 && income.categoryMeasured === 2,
    JSON.stringify(income));
  ok('...and those rows are still asked about on the categorise screen',
    uncategorisedMerchants(withPin({ acme: 'salary' })).merchants.some((m) => m.key === 'acme'),
    JSON.stringify(uncategorisedMerchants(withPin({ acme: 'salary' })).merchants.map((m) => m.key)));

  // The pin that CAN reach them still does both things, so this is a direction
  // check and not a way of ignoring merchantOverrides.
  const expense = parserCoverage(withPin({ acme: 'shopping' }));
  ok('an expense pin on expense rows is still the user\'s answer',
    expense.decided === 2 && expense.categoryMeasured === 0,
    JSON.stringify(expense));
  ok('...and stops the screen asking again',
    uncategorisedMerchants(withPin({ acme: 'shopping' })).merchants.length === 0,
    JSON.stringify(uncategorisedMerchants(withPin({ acme: 'shopping' })).merchants));
}

// The erase-race contract in 2c is behavioural, so it settles after this file
// finishes executing. Counting before it lands would report a green run that
// never ran it.
Promise.all(asyncSuites).then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
