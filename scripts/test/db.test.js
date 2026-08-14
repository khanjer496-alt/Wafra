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
    guessCategory: (title, _type, overrides) =>
      overrides?.[title.trim().toLowerCase()] ??
      (title === 'Unclassified merchant'
        ? 'dining'
        : title === 'ATM withdrawal'
          ? 'cash-withdrawal'
          : 'other'),
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
    // `setActiveMarket` returns whether the pack was applied: it refuses a pack
    // denominated differently from money the ledger already holds. The stub
    // says yes, which is the empty-ledger answer these fixtures start from.
    '@/lib/markets': {
      detectMarketId: () => 'AE',
      setActiveMarket: () => true,
      setLedgerCurrency() {},
      marketCurrencyCode: (id) => (id === 'SA' ? 'SAR' : 'AED'),
    },
    '@/lib/seed': { generateSeedTransactions: () => [], SEED_ACCOUNTS: [], SEED_BUDGETS: [] },
    '@/lib/heal': heal,
    '@/lib/sms-parser': parser,
    '@/lib/ledger': { internalTransferIds: () => new Set() },
    '@/lib/cards': { mergeImportedCardDues: (_existing, incoming) => incoming },
    '@/lib/bills': require('./build/bills'),
    '@/lib/dedupe': dedupe,
    '@/lib/payment-flow': require('./build/payment-flow'),
    '@/lib/ledger-import': require('./build/ledger-import'),
    '@/lib/ledger-persistence': {
      createLedgerPersistence: () => ({ load: async () => null, save: async () => true }),
      LedgerResetError: class LedgerResetError extends Error {},
    },
    '@/lib/ledger-money': require('./build/ledger-money'),
    '@/lib/onboarding': {
      allOnboardingGoalTitles: () => [],
      buildDeferredOnboardingPlan: () => null,
      mergeDeferredOnboardingPlan: (budgets, goals) => ({ budgets, goals }),
    },
    '@/lib/alert-review-tray': require('./build/alert-review-tray'),
    '@/lib/review-promotion': require('./build/review-promotion'),
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
const ledgerPersistenceSource = stripComments(read('src/lib/ledger-persistence.ts'));

ok('a failed hydration latches writes off',
  /mode = 'blocked'/.test(ledgerPersistenceSource) &&
    /if \(mode !== 'ready'\) return Promise\.resolve\(false\)/.test(ledgerPersistenceSource),
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
      /const cleanupCaptureQueue = isRelayPlatform\(\)/.test(eraseBody) &&
      /notificationReader\.clearCaptured\(\)/.test(eraseBody) &&
      /clearAll\(cleanupCaptureQueue\)/.test(eraseBody) &&
      (recovery.match(/clearAll\(/g) ?? []).length === 1 &&
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
      'await persistence.load()',
      'setHydrationFailed(false)',
      "dispatch({ type: 'hydrate'",
    ),
  'clearing it on the way in would reopen writes for the duration of a retry that is about ' +
    'to fail — and the debounced save fires in that window');

ok('an empty database counts as a successful read',
  !!hydrateBody &&
    /let next: [^=]*= E2E_DEMO_LEDGER\s*\? demoState\(\)\s*:\s*\{ onboarded: false \}/.test(hydrateBody) &&
    (hydrateBody.match(/setHydrationFailed\(false\)/g) ?? []).length === 1,
  'a legitimately empty ledger and an unreadable one must not share a code path, but they ' +
    'must share the SUCCESS path — one `storageBlocked = false` reached by both, not a ' +
    'branch that leaves a genuinely new install latched off forever');

ok('the browser demo ledger is isolated to an explicit E2E export',
  /Platform\.OS === 'web'\s*&&\s*process\.env\.EXPO_PUBLIC_WAFRA_E2E_DEMO === '1'/.test(store) &&
    /EXPO_PUBLIC_WAFRA_E2E_DEMO=1 npx expo export/.test(
      fs.readFileSync(path.join(__dirname, '../e2e/run.sh'), 'utf8'),
    ),
  'production onboarding must never inherit the deterministic AED ledger used by browser tests');

const retryBody = bodyOf(store, 'const retryHydration = useCallback');
ok('the store exposes a retry that reruns hydration',
  !!retryBody && /await hydrate\(\)/.test(retryBody) && /retryHydration/.test(store),
  'the retry has to be the same read, not a second implementation of it');

ok('retry does not unlatch or clear the failure on its own',
  !!retryBody &&
    retryBody.indexOf('await persistence.reset') < retryBody.indexOf('setStorageFailure(null)') &&
    retryBody.indexOf('await persistence.reset') < retryBody.indexOf('setHydrationFailed(false)'),
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
  ok('backup restore rejects unknown future envelope versions',
    hydration.parseBackupForRestore(JSON.stringify({
      app: 'wafra', version: 2, data: { transactions: [] },
    })) === null);
  const globalLedger = hydration.parseBackupForRestore(JSON.stringify({
      app: 'wafra',
      version: 1,
      data: {
        marketId: 'AE',
        ledgerMoney: { schemaVersion: 2, currency: 'KWD', exponent: 3 },
        transactions: [tx('mixed-money', { amountFils: 500 })],
      },
    }));
  ok('backup restore preserves an explicit global ledger currency independently of the launch parser pack',
    globalLedger?.ledgerMoney?.currency === 'KWD' &&
      globalLedger?.ledgerMoney?.exponent === 3 &&
      globalLedger?.transactions?.length === 1);
}

{
  const edited = [
    tx('edited-pan', { title: '4782********4833 User title', userEdited: true }),
    tx('edited-large', { amountFils: 100_000_001, userEdited: true }),
    tx('edited-income', { type: 'income', category: 'dining', userEdited: true }),
    tx('edited-service', { title: 'Legacy service', userEdited: true }),
    tx('edited-category', { title: 'Unclassified merchant', userEdited: true }),
    tx('edited-atm', { title: 'ATM withdrawal', category: 'other', userEdited: true }),
    tx('edited-raw', { title: 'My correction', raw: 'parser would replace this', userEdited: true }),
  ];
  const before = new Map(edited.map((row) => [row.id, JSON.stringify(row)]));
  const automatic = [
    tx('auto-pan', { title: '4782********4833 Machine title' }),
    tx('auto-large', { amountFils: 100_000_001 }),
    tx('auto-income', { type: 'income', category: 'dining' }),
    tx('auto-service', { title: 'Legacy service' }),
    tx('auto-category', { title: 'Unclassified merchant' }),
    tx('auto-atm', { title: 'ATM withdrawal', category: 'shopping' }),
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
      byId.get('auto-atm')?.category === 'cash-withdrawal' &&
      byId.get('auto-raw')?.title === 'Reparsed merchant' &&
      byId.get('auto-raw')?.raw === undefined);
}

{
  const pinnedAtm = tx('pinned-atm', {
    title: 'ATM withdrawal',
    category: 'other',
  });
  const migrated = hydration.migratePersistedState({
    transactions: [pinnedAtm],
    merchantOverrides: { 'atm withdrawal': 'shopping' },
  });
  ok('an explicit ATM merchant rule outranks the automatic cash category',
    migrated.transactions[0]?.category === 'shopping');
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
  // A raw-bearing row used to be left alone here, on the reasoning that it
  // could reparse its way out. It could not: healing only ever ADDS the
  // transfer flag and never clears it, so those rows stayed stranded and their
  // income never counted. The parser no longer flags a remittance at all — the
  // ledger pairs it or keeps it as income — so every SMS row of this shape is
  // released. What must still be protected is unchanged: a row the user edited,
  // a manual entry, and a differently-titled "Incoming transfer".
  ok('hydration clears the stale SMS inward-remittance transfer flag, raw or not',
    byId.has(stale.id) && !('isTransfer' in byId.get(stale.id)) &&
      !('isTransfer' in byId.get('raw-remittance')) &&
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

  const funding = tx('liv-funding', {
    title: 'Outgoing transfer',
    amountFils: 1216800,
    isTransfer: true,
    paymentFlowSide: 'funding',
    ts: Date.parse('2026-08-01T14:25:32Z'),
    smsKey: 's1785594332000-1216800',
  });
  const receipt = tx('fishbasket-receipt', {
    title: 'Fishbasket',
    amountFils: 1216800,
    paymentFlowSide: 'receipt',
    ts: Date.parse('2026-08-01T14:27:27Z'),
    smsKey: 's1785594447000-1216800',
  });
  const linkedPayment = hydration.finalizeHydrationTransactions([funding, receipt]);
  ok('hydration collapses a retained funding alert into its named bill receipt',
    linkedPayment.length === 1 && linkedPayment[0].id === receipt.id);
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

const { ledgerStateHasMoney } = require('./build/ledger-money');
ok('account-only ledgers pin their accounting currency',
  ledgerStateHasMoney({ accounts: [{ openingFils: 1 }] }) &&
    ledgerStateHasMoney({ accounts: [{ snapshotFils: 1 }] }) &&
    ledgerStateHasMoney({ accounts: [{ creditLimitFils: 1 }] }),
  'an opening balance, bank snapshot, or card limit must not be relabelled from AED to SAR');

const clearAllBody = bodyOf(store, 'const clearAll = useCallback');
ok('StoreProvider starts reset before it exposes the blank state',
  !!clearAllBody &&
    inOrder(
      clearAllBody,
      'hydrationRun.current += 1',
      'const resetOperation = persistence.reset(() => ({',
      "dispatch({ type: 'clearAll' })",
      'await resetOperation',
    ),
  'reset closes the module latch synchronously; dispatching first recreates the erase race');

ok('StoreProvider restores visible state only when erase itself failed',
  !!clearAllBody &&
    /resetError\?\.stage === 'initialize'/.test(clearAllBody) &&
    clearAllBody.indexOf("resetError?.stage === 'initialize'") <
      clearAllBody.indexOf("dispatch({ type: 'restore', state: previousState })") &&
    /recordStorageFailure\('destroy', original\)/.test(clearAllBody) &&
    /setHydrationFailed\(true\)/.test(clearAllBody),
  'an initialize failure follows a successful cryptographic erase, so restoring old data would lie');

const initializeFailureBody = clearAllBody?.slice(
  clearAllBody.indexOf("if (resetError?.stage === 'initialize')"),
  clearAllBody.indexOf("dispatch({ type: 'restore', state: previousState })"),
);
ok('post-erase initialization failure blocks the app and preserves its stage for truthful recovery',
  !!initializeFailureBody &&
    /setHydrationFailed\(true\)/.test(initializeFailureBody) &&
    /setStorageRecoveryState\(cleanupError \? 'erased-cleanup' : 'erased-initialize'\)/.test(initializeFailureBody) &&
    /throw new ClearAllError\(cleanupError \? 'cleanup' : 'initialize'/.test(initializeFailureBody) &&
    !/dispatch\(\{ type: 'restore'/.test(initializeFailureBody),
  'after cryptographic erase, ordinary editing must stay unavailable until storage reopens');

function loadLedgerPersistenceExports() {
  const ts = require('typescript');
  const filename = path.join(ROOT, 'src/lib/ledger-persistence.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    (id) => { throw new Error(`unexpected ledger-persistence dependency ${id}`); },
    loaded,
    loaded.exports,
    filename,
    path.dirname(filename),
  );
  return loaded.exports;
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const calls = [];
  const control = {
    readError: null,
    failSetCount: 0,
    destroyError: null,
    destroyGate: null,
    setGate: null,
  };
  const adapter = {
    async getItem(key) {
      calls.push({ op: 'get', key });
      if (control.readError) throw control.readError;
      return data.get(key) ?? null;
    },
    async multiGet(keys) {
      calls.push({ op: 'multiGet', keys: [...keys] });
      if (control.readError) throw control.readError;
      return keys.map((key) => [key, data.get(key) ?? null]);
    },
    async multiSet(entries) {
      const copied = entries.map(([key, value]) => [key, value]);
      calls.push({ op: 'set', entries: copied });
      const gate = control.setGate;
      control.setGate = null;
      if (gate) await gate;
      if (control.failSetCount > 0) {
        control.failSetCount -= 1;
        throw new Error('injected write failure');
      }
      for (const [key, value] of entries) data.set(key, value);
    },
    async multiRemove(keys) {
      calls.push({ op: 'remove', keys: [...keys] });
      for (const key of keys) data.delete(key);
    },
    async destroy(prefix) {
      calls.push({ op: 'destroy', prefix });
      if (control.destroyError) throw control.destroyError;
      if (control.destroyGate) await control.destroyGate;
      for (const key of [...data.keys()]) {
        if (key === prefix || key.startsWith(`${prefix}:`)) data.delete(key);
      }
    },
  };
  return { adapter, calls, control, data };
}

const ledgerModule = loadLedgerPersistenceExports();
const LEDGER_KEY = 'wafra/state/v1';
const testChunkTransactions = (transactions) => {
  const chunks = [];
  for (let end = transactions.length; end > 0; end -= 2) {
    chunks.push(JSON.stringify(transactions.slice(Math.max(0, end - 2), end)));
  }
  return chunks;
};
const createPersistence = (memory, migrateLegacyState = async () => false) =>
  ledgerModule.createLedgerPersistence({
    prefix: LEDGER_KEY,
    chunkSize: 2,
    currentChunkOrder: 'oldest-first',
    chunkTransactions: testChunkTransactions,
    storage: memory.adapter,
    migrateLegacyState,
  });
const snapshot = (name, transactions = []) => ({
  hydrated: true,
  onboarded: true,
  userName: name,
  transactions,
});

const asyncSuites = [];
asyncSuites.push((async () => {
  {
    const memory = memoryStorage();
    const persistence = createPersistence(memory);
    memory.control.readError = new Error('injected read failure');
    let loadFailed = false;
    try { await persistence.load(); } catch { loadFailed = true; }
    const setsBefore = memory.calls.filter((call) => call.op === 'set').length;
    const blocked = await persistence.save(snapshot('must-not-write'));
    ok('a failed load blocks every save without touching storage',
      loadFailed && blocked === false &&
        memory.calls.filter((call) => call.op === 'set').length === setsBefore);

    memory.control.readError = null;
    const empty = await persistence.load();
    const reopened = await persistence.save(snapshot('recovered'));
    ok('a successful retry distinguishes empty storage and reopens writes',
      empty === null && reopened === true &&
        JSON.parse(memory.data.get(LEDGER_KEY)).userName === 'recovered');
  }

  {
    const memory = memoryStorage();
    const persistence = createPersistence(memory);
    await persistence.load();
    persistence.block();
    ok('an explicit recovery block synchronously refuses every later save',
      await persistence.save(snapshot('must-not-write')) === false &&
        !memory.data.has(LEDGER_KEY));
  }

  {
    const memory = memoryStorage();
    let releaseFirst;
    let releaseSecond;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
    let reads = 0;
    memory.adapter.getItem = async () => {
      reads += 1;
      if (reads === 1) {
        await firstGate;
        return null;
      }
      await secondGate;
      throw new Error('newer load failed');
    };
    const persistence = createPersistence(memory);
    const firstLoad = persistence.load();
    const secondLoad = persistence.load();
    releaseFirst();
    await firstLoad;
    const unsafeSave = persistence.save(snapshot('unsafe'));
    releaseSecond();
    try { await secondLoad; } catch {}
    ok('an older successful load cannot admit a save ahead of a newer failing load',
      await unsafeSave === false &&
        memory.calls.filter((call) => call.op === 'set').length === 0);
  }

  {
    const memory = memoryStorage();
    const events = [];
    const originalGet = memory.adapter.getItem;
    memory.adapter.getItem = async (key) => {
      events.push('get');
      return originalGet(key);
    };
    const persistence = createPersistence(memory, async () => {
      events.push('migrate');
      memory.data.set(LEDGER_KEY, JSON.stringify({ onboarded: true, transactions: [] }));
      return true;
    });
    await persistence.load();
    ok('load owns legacy migration and re-reads only after it succeeds',
      events.join(',') === 'get,migrate,get', events.join(','));
  }

  {
    const memory = memoryStorage();
    const persistence = createPersistence(memory);
    await persistence.load();
    let releaseDestroy;
    memory.control.destroyGate = new Promise((resolve) => { releaseDestroy = resolve; });
    let latest = snapshot('blank');
    let revision = 0;
    const reset = persistence.reset(() => ({ snapshot: latest, revision }));
    latest = snapshot('captured-during-erase', [{ id: 'fresh' }]);
    revision += 1;
    releaseDestroy();
    await reset;
    ok('reset persists activity that lands while encrypted destruction is pending',
      JSON.parse(memory.data.get(LEDGER_KEY)).userName === 'captured-during-erase' &&
        JSON.parse(memory.data.get(`${LEDGER_KEY}:tx:0`))[0].id === 'fresh');
  }

  {
    const memory = memoryStorage();
    const persistence = createPersistence(memory);
    await persistence.load();
    let releaseInitialize;
    memory.control.setGate = new Promise((resolve) => { releaseInitialize = resolve; });
    let latest = snapshot('before-initialize');
    let revision = 0;
    const reset = persistence.reset(() => ({ snapshot: latest, revision }));
    await Promise.resolve();
    await Promise.resolve();
    latest = snapshot('during-initialize', [{ id: 'fresh-during-write' }]);
    revision += 1;
    releaseInitialize();
    await reset;
    ok('reset reconciles activity that lands while blank initialization is pending',
      JSON.parse(memory.data.get(LEDGER_KEY)).userName === 'during-initialize' &&
        JSON.parse(memory.data.get(`${LEDGER_KEY}:tx:0`))[0].id === 'fresh-during-write');
  }

  {
    const memory = memoryStorage();
    let releaseLoad;
    const loadGate = new Promise((resolve) => { releaseLoad = resolve; });
    const originalGet = memory.adapter.getItem;
    memory.adapter.getItem = async (key) => {
      await loadGate;
      return originalGet(key);
    };
    const persistence = createPersistence(memory);
    const staleLoad = persistence.load();
    const blank = snapshot('blank');
    const reset = persistence.reset(() => ({ snapshot: blank, revision: 0 }));
    releaseLoad();
    await staleLoad;
    const refused = await persistence.save(snapshot('resurrected'));
    await reset;
    ok('an older load cannot reopen writes after reset has claimed the lifecycle',
      refused === false && JSON.parse(memory.data.get(LEDGER_KEY)).userName === 'blank');
  }

  {
    const memory = memoryStorage();
    const persistence = createPersistence(memory);
    await persistence.load();
    let releaseDestroy;
    memory.control.destroyGate = new Promise((resolve) => { releaseDestroy = resolve; });
    const blank = snapshot('blank');
    const reset = persistence.reset(() => ({ snapshot: blank, revision: 0 }));
    const reload = persistence.load();
    releaseDestroy();
    await reset;
    const between = await persistence.save(snapshot('too-early'));
    await reload;
    const after = await persistence.save(snapshot('after-reload'));
    ok('a load requested during reset remains the only operation that can reopen writes',
      between === false && after === true &&
        JSON.parse(memory.data.get(LEDGER_KEY)).userName === 'after-reload');
  }

  {
    const newer = [{ id: 'new-1' }, { id: 'new-2' }];
    const older = [{ id: 'old-1' }, { id: 'old-2' }];
    const current = memoryStorage({
      [LEDGER_KEY]: JSON.stringify({ txChunks: 2, txChunkOrder: 'oldest-first' }),
      [`${LEDGER_KEY}:tx:0`]: JSON.stringify(older),
      [`${LEDGER_KEY}:tx:1`]: JSON.stringify(newer),
    });
    const legacy = memoryStorage({
      [LEDGER_KEY]: JSON.stringify({ txChunks: 2 }),
      [`${LEDGER_KEY}:tx:0`]: JSON.stringify(newer),
      [`${LEDGER_KEY}:tx:1`]: JSON.stringify(older),
    });
    const currentLoaded = await createPersistence(current).load();
    const legacyLoaded = await createPersistence(legacy).load();
    ok('both chunk layouts reassemble byte-compatibly into newest-first rows',
      currentLoaded.transactions.map((row) => row.id).join(',') === 'new-1,new-2,old-1,old-2' &&
        legacyLoaded.transactions.map((row) => row.id).join(',') === 'new-1,new-2,old-1,old-2');
  }

  {
    const memory = memoryStorage();
    const persistence = createPersistence(memory);
    await persistence.load();
    let release;
    memory.control.setGate = new Promise((resolve) => { release = resolve; });
    const first = persistence.save(snapshot('first', [{ id: 'a' }]));
    const second = persistence.save(snapshot('second', [{ id: 'b' }, { id: 'a' }]));
    release();
    await Promise.all([first, second]);
    ok('serialized saves leave the latest snapshot and matching chunk count on disk',
      JSON.parse(memory.data.get(LEDGER_KEY)).userName === 'second' &&
        JSON.parse(memory.data.get(LEDGER_KEY)).txChunks === 1 &&
        memory.calls.filter((call) => call.op === 'set').length === 2);
  }

  {
    const rows = [{ id: 'n1' }, { id: 'n2' }, { id: 'o1' }, { id: 'o2' }];
    const chunks = testChunkTransactions(rows);
    const memory = memoryStorage({
      [LEDGER_KEY]: JSON.stringify({ txChunks: 2, txChunkOrder: 'oldest-first' }),
      [`${LEDGER_KEY}:tx:0`]: chunks[0],
      [`${LEDGER_KEY}:tx:1`]: chunks[1],
    });
    const persistence = createPersistence(memory);
    await persistence.load();
    const edited = snapshot('edited', [{ ...rows[0], changed: true }, ...rows.slice(1)]);
    memory.control.failSetCount = 1;
    try { await persistence.save(edited); } catch {}
    await persistence.save(edited);
    const sets = memory.calls.filter((call) => call.op === 'set');
    ok('a failed save invalidates the diff cache so retry rewrites every chunk',
      sets.at(-1).entries.length === 3,
      `${sets.at(-1).entries.length} entries in retry`);
  }

  {
    const memory = memoryStorage();
    const persistence = createPersistence(memory);
    await persistence.load();
    await persistence.save(snapshot('old', [{ id: 'old' }]));
    memory.control.destroyError = new Error('injected destroy failure');
    const blank = snapshot('blank');
    const reset = persistence.reset(() => ({ snapshot: blank, revision: 0 }));
    const during = await persistence.save(snapshot('must-not-land'));
    let resetError = null;
    try { await reset; } catch (error) { resetError = error; }
    const after = await persistence.save(snapshot('also-blocked'));
    ok('a failed destroy blocks saves before, during, and after the failed reset',
      during === false && after === false &&
        resetError instanceof ledgerModule.LedgerResetError &&
        resetError.stage === 'destroy' &&
        JSON.parse(memory.data.get(LEDGER_KEY)).userName === 'old');
  }

  {
    const memory = memoryStorage();
    const persistence = createPersistence(memory);
    await persistence.load();
    let release;
    memory.control.setGate = new Promise((resolve) => { release = resolve; });
    const oldSave = persistence.save(snapshot('queued-old', [{ id: 'old' }]));
    const blank = snapshot('blank');
    const reset = persistence.reset(() => ({ snapshot: blank, revision: 0 }));
    const refused = await persistence.save(snapshot('resurrected', [{ id: 'old' }]));
    release();
    const [oldWritten] = await Promise.all([oldSave, reset]);
    const operations = memory.calls.filter((call) => call.op === 'set' || call.op === 'destroy');
    ok('reset supersedes queued saves, refuses resurrection, then writes blank after destroy',
      oldWritten === false && refused === false &&
        operations.map((call) => call.op).join(',') === 'destroy,set' &&
        JSON.parse(memory.data.get(LEDGER_KEY)).userName === 'blank');
  }

  {
    const memory = memoryStorage();
    const persistence = createPersistence(memory);
    await persistence.load();
    memory.control.failSetCount = 1;
    let resetError = null;
    const blank = snapshot('blank');
    try {
      await persistence.reset(() => ({ snapshot: blank, revision: 0 }));
    } catch (error) { resetError = error; }
    const blocked = await persistence.save(snapshot('must-stay-blocked'));
    await persistence.load();
    const retry = await persistence.save(snapshot('blank-retry'));
    ok('a blank initialization failure is distinct, blocks writes, and remains reload-retryable',
      resetError instanceof ledgerModule.LedgerResetError &&
        resetError.stage === 'initialize' && blocked === false && retry === true &&
        JSON.parse(memory.data.get(LEDGER_KEY)).userName === 'blank-retry');
  }
})());

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
  // The invocation, not the word. This was `indexOf('assembleRelease')`, which
  // takes the first occurrence ANYWHERE — so a comment further up the file
  // that merely named the step moved `gradleAt` above the guard and failed
  // this assertion, reporting a plaintext-ledger risk that did not exist. A
  // security check that cries wolf at prose is one people learn to re-run
  // until it passes. The property is unchanged: the guard must sit between
  // prebuild and the command that actually builds.
  // The release workflow may select a build variant inside a guarded run
  // block. Match the executable command itself, whether it is the whole `run:`
  // value or a line inside `run: |`; prose never starts with `./gradlew`.
  const gradleAt = workflow.search(/^\s*(?:run:\s*)?\.\/gradlew\s+assembleRelease\b/m);

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
    // The real pack module, with only the device-locale probe pinned. Naming
    // its exports one at a time here meant every export the hydration path
    // later reached for — the ledger-currency pin among them — arrived as
    // `undefined` at call time rather than as a missing-stub failure.
    '@/lib/markets': { ...require('./build/markets'), detectMarketId: () => 'AE' },
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
