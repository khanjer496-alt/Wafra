'use strict';
/**
 * Load the SHIPPING src/lib/store.tsx outside React Native for host
 * benchmarks and regression tests, plus a synthetic large-ledger generator.
 *
 * The store is transpiled at run time and wired to the real compiled modules
 * in scripts/test/build (parser, dedupe, accounts, transfer reconciliation,
 * import). Only platform surfaces are replaced. Requires
 * `bash scripts/test/build.sh` to have run. Fixtures contain no real messages
 * or people.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '../..');
const BUILD = path.join(ROOT, 'scripts/test/build');

function execute(rel, requireModule, append = '') {
  const filename = path.resolve(ROOT, rel);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8') + append, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  Function('require', 'module', 'exports', output)(requireModule, loaded, loaded.exports);
  return loaded.exports;
}

/**
 * @param {{ storePath?: string, counted?: Record<string, string[]> }} [options]
 *   `counted` wraps named exports of `@/lib/*` modules with call counters.
 */
function loadStore({ storePath = 'src/lib/store.tsx', counted = {} } = {}) {
  if (!fs.existsSync(path.join(BUILD, 'sms-parser.js'))) {
    throw new Error('Run `bash scripts/test/build.sh` first.');
  }
  const stubs = {
    react: {
      createContext: () => ({}), useCallback: (fn) => fn, useContext: () => null, useEffect() {},
      useMemo: (fn) => fn(), useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}],
    },
    'react/jsx-runtime': { jsx: () => ({}), jsxs: () => ({}), Fragment: Symbol('Fragment') },
    'expo-localization': {
      useLocales: () => [{ languageCode: 'en' }],
      getLocales: () => [{ languageCode: 'en', regionCode: 'AE' }],
    },
    'react-native': {
      AppState: { addEventListener: () => ({ remove() {} }) },
      I18nManager: { isRTL: false, allowRTL() {}, forceRTL() {} },
      Platform: { OS: 'android' },
    },
    '@/lib/share-text': { cleanupGeneratedExports: async () => {} },
    '@/lib/theme-preference': { getThemePreference: () => 'system', setThemePreference() {} },
    '@/lib/ledger-persistence': {
      createLedgerPersistence: () => ({ load: async () => null, save: async () => true }),
      LedgerResetError: class LedgerResetError extends Error {},
    },
    '@/lib/launch-performance': { markLaunchPhase() {} },
    '@/lib/state-storage': { migrateLegacyState: async () => null, stateStorage: {} },
    '@/lib/storage-diagnostics': { recordStorageFailure: () => ({ category: 'unknown' }) },
    '@/lib/android-live-background': { waitForAndroidBackgroundCaptureIdle: async () => {} },
    './balances': {},
  };
  const calls = {};
  for (const [id, names] of Object.entries(counted)) {
    const real = require(path.join(BUILD, id.slice(6)));
    const wrapped = { ...real };
    for (const name of names) {
      calls[name] = 0;
      wrapped[name] = (...args) => { calls[name] += 1; return real[name](...args); };
    }
    stubs[id] = wrapped;
  }
  const takeCalls = () => {
    const snapshot = { ...calls };
    for (const name of Object.keys(calls)) calls[name] = 0;
    return snapshot;
  };
  const resolve = (id) => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    if (id.startsWith('@/lib/')) return require(path.join(BUILD, id.slice(6)));
    if (id.startsWith('./')) return require(path.join(BUILD, id.slice(2)));
    throw new Error(`unexpected dependency ${id}`);
  };
  // `reducer` is module-private; expose it for measurement and tests only.
  const store = execute(storePath, resolve, '\nexport const __benchReducer = reducer;\n');
  return { store, reducer: store.__benchReducer, takeCalls, build: (name) => require(path.join(BUILD, name)) };
}

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 20, 12);
const MERCHANTS = ['CARREFOUR', 'LULU HYPERMARKET', 'TALABAT', 'CAREEM', 'NOON.COM', 'AMAZON.AE',
  'STARBUCKS', 'ENOC', 'ADNOC', 'DEWA', 'ETISALAT', 'IKEA', 'SPINNEYS', 'DELIVEROO', 'UBER', 'NETFLIX.COM'];

/** Synthetic mixed ledger: card purchases, salaries, evidenced transfer pairs. */
function ledger(count) {
  const accounts = [];
  for (let i = 0; i < 8; i += 1) {
    accounts.push({ id: `card-${i}`, name: `Card ${i}`, kind: 'card', cardType: 'credit', bankName: 'ENBD',
      last4: String(4800 + i), openingFils: 0, snapshotFils: 1_000_000, snapshotKind: 'limit', snapshotTs: NOW });
  }
  for (let i = 0; i < 6; i += 1) {
    accounts.push({ id: `bank-${i}`, name: `Account ${i}`, kind: 'bank', bankName: 'ENBD',
      last4: String(1100 + i), openingFils: 0, snapshotFils: 5_000_000, snapshotKind: 'balance', snapshotTs: NOW });
  }
  const transactions = [];
  for (let i = 0; i < count; i += 1) {
    const at = NOW - Math.floor(i / 12) * DAY - (i % 12) * 3_600_000;
    const date = new Date(at).toISOString().slice(0, 10);
    const amountFils = 500 + ((i * 7919) % 90_000);
    const amount = (amountFils / 100).toFixed(2);
    if (i % 50 === 0) {
      // A reciprocal own-account transfer pair with bank evidence.
      const reference = `REF${String(i).padStart(8, '0')}`;
      const evidence = { version: 1, currency: 'AED', attribution: 'source', reference };
      transactions.push({ id: `tx-${i}-out`, type: 'expense', amountFils, category: 'other', accountId: 'bank-0',
        title: 'Outgoing transfer', date, ts: at, source: 'sms', smsKey: `s${at}-${amountFils}`,
        isTransfer: true, transferEvidence: evidence,
        captureInstrument: { last4: '1100', kind: 'account', bankIdentity: 'ENBD' } });
      transactions.push({ id: `tx-${i}-in`, type: 'income', amountFils, category: 'other', accountId: 'bank-1',
        title: 'Incoming transfer', date, ts: at + 60_000, source: 'sms', smsKey: `s${at + 60_000}-${amountFils}`,
        transferEvidence: evidence, captureInstrument: { last4: '1101', kind: 'account', bankIdentity: 'ENBD' } });
      continue;
    }
    if (i % 97 === 0) {
      transactions.push({ id: `tx-${i}`, type: 'income', amountFils: 1_500_000, category: 'salary', accountId: 'bank-0',
        title: 'Salary', date, ts: at, source: 'sms', smsKey: `s${at}-1500000`,
        raw: `Salary of AED 15,000.00 has been credited to your account XXX1100 on ${date}.` });
      continue;
    }
    const merchant = MERCHANTS[i % MERCHANTS.length];
    const card = i % 8;
    transactions.push({
      id: `tx-${i}`, type: 'expense', amountFils, category: 'other', accountId: `card-${card}`,
      title: merchant.charAt(0) + merchant.slice(1).toLowerCase(), date, ts: at, source: i % 9 === 0 ? 'manual' : 'sms',
      smsKey: `s${at}-${amountFils}`,
      ...(i % 9 === 0 ? {} : {
        raw: `Purchase of AED ${amount} with Credit Card ending ${4800 + card} at ${merchant}, DUBAI. Avl Cr. Limit AED 14,671.30`,
      }),
      ...(i % 211 === 0 ? { userEdited: true, category: 'shopping' } : {}),
    });
  }
  transactions.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  const cardDues = accounts.filter((a) => a.kind === 'card').map((a, i) => ({
    id: `due-${i}`, accountId: a.id, dueDate: '2026-10-05', totalFils: 250_000 + i, minFils: 12_500,
    statementDate: '2026-09-10',
  }));
  const merchantOverrides = {};
  for (let i = 0; i < 40; i += 1) merchantOverrides[`merchant ${i}`] = 'shopping';
  return {
    onboarded: true, language: 'en', languagePreference: 'en', marketId: 'AE', country: 'AE',
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
    transactions, accounts, cardDues, budgets: [], bills: [], goals: [], notSubscriptions: [],
    merchantOverrides, accountHints: {}, knownBanks: ['ENBD'], monthStartDay: 1, parserVersion: 999,
    historyImport: { status: 'complete', scanned: count, found: count, cursor: null, startedAt: NOW - DAY, updatedAt: NOW - DAY },
    reviewTray: { pending: [], tombstones: [], templateRules: [] },
    lastScanTs: NOW,
  };
}

module.exports = { loadStore, ledger, NOW, DAY };
