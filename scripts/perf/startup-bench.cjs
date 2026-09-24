'use strict';
/**
 * Host benchmark for JS-thread work at launch and per ledger mutation.
 *
 * Run after `bash scripts/test/build.sh`:
 *   node scripts/perf/startup-bench.cjs [rows...]      (default 5000 20000)
 *
 * It executes the SHIPPING store.tsx (transpiled at run time) against the real
 * compiled parser/dedupe/accounts/transfer modules from scripts/test/build.
 * Only platform surfaces (React, React Native, storage, diagnostics) are
 * replaced. The ledger is synthetic: generated SMS-shaped rows with no real
 * messages or people. These are desktop Node (V8) timings, not Hermes or
 * device timings; use them for before/after ratios of the same source.
 */
const { performance } = require('node:perf_hooks');
const { loadStore, ledger, NOW } = require('./load-store.cjs');

// WAFRA_BENCH_STORE=<path> measures another revision of the store (absolute or
// repo-relative), e.g. a committed store.tsx written out to a temporary file.
// Keep that copy outside src/: it is not shipping source.
// Deterministic work counters accompany timings: the host may be shared.
const { store, reducer, takeCalls, build } = loadStore({
  storePath: process.env.WAFRA_BENCH_STORE,
  counted: {
    '@/lib/sms-parser': ['normalizeServiceName', 'guessCategory', 'parseSms'],
    '@/lib/transfer-reconciliation': ['normalizeTransferLinks', 'reconcileTransfers'],
  },
});
const markets = build('markets');

const timeIt = (fn, runs = 5) => {
  const samples = [];
  let result;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    result = fn();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return { ms: +samples[Math.floor(samples.length / 2)].toFixed(2), result };
};
const stripHydrated = ({ hydrated: _h, ...rest }) => rest;
const clone = (value) => JSON.parse(JSON.stringify(value));
const EMPTY = { hydrated: false, transactions: [], accounts: [] };

function hydrateOnce(persisted, reuse) {
  const parsed = clone(persisted);
  const t0 = performance.now();
  const migrated = store.migratePersistedState(parsed, { reuseCompletedReparse: reuse });
  const t1 = performance.now();
  const state = reducer({ ...EMPTY }, { type: 'hydrate', state: migrated });
  const t2 = performance.now();
  return { state, migrateMs: t1 - t0, reducerMs: t2 - t1 };
}

function run(count) {
  markets.setActiveMarket('AE');
  const base = ledger(count);
  const out = { rows: base.transactions.length };

  // The persisted form of a ledger this build has already fully repaired.
  const first = hydrateOnce(base, false);
  out.firstLaunchMigrateMs = +first.migrateMs.toFixed(1);
  out.firstLaunchReducerMs = +first.reducerMs.toFixed(1);
  const steadyPersisted = stripHydrated(first.state);

  const serial = timeIt(() => JSON.stringify(steadyPersisted.transactions), 3);
  out.stringifyTransactionsMs = serial.ms;
  out.ledgerBytes = serial.result.length;
  out.parseTransactionsMs = timeIt(() => JSON.parse(serial.result), 3).ms;

  const steady = [];
  let steadyState;
  for (let i = 0; i < 5; i += 1) {
    const r = hydrateOnce(steadyPersisted, true);
    steady.push(r);
    steadyState = r.state;
  }
  const med = (key) => +steady.map((r) => r[key]).sort((a, b) => a - b)[2].toFixed(2);
  out.steadyMigrateMs = med('migrateMs');
  out.steadyReducerMs = med('reducerMs');
  out.steadyPreservedRows = steadyState.transactions === undefined ? false : true;

  // The first launch of a new parser build on Android: every receipt is from
  // the previous grammar, and the app resumes the persisted ledger (not a
  // backup restore), so the saved-row reparse is deferred to durable history.
  const stale = { ...steadyPersisted, parserVersion: 1, hydrationReparseKey: JSON.stringify([2, 1, 'AE']),
    hydrationFinalizeVersion: 0 };
  const upgrade = [];
  takeCalls();
  hydrateOnce(stale, true);
  out.upgradeLaunchCalls = takeCalls();
  const upgradeRuns = process.env.WAFRA_BENCH_REPEAT_UPGRADE ? 30 : 3;
  for (let i = 0; i < upgradeRuns; i += 1) upgrade.push(hydrateOnce(stale, true));
  const umed = (key) => +upgrade.map((r) => r[key]).sort((a, b) => a - b)[1].toFixed(1);
  out.upgradeLaunchMigrateMs = umed('migrateMs');
  out.upgradeLaunchReducerMs = umed('reducerMs');

  const { transactions: _t, ...meta } = stripHydrated(steadyState);
  out.metaStringifyMs = timeIt(() => JSON.stringify(meta)).ms;

  // Typical foreground mutations on the hydrated ledger.
  const plain = steadyState.transactions.find((t) => !t.isTransfer && !t.transferEvidence && t.type === 'expense');
  out.editCategoryMs = timeIt(() => reducer(steadyState, {
    type: 'editTransaction', id: plain.id, patch: { category: 'dining' } })).ms;
  const once = (label, action) => {
    takeCalls();
    reducer(steadyState, action);
    out[label] = takeCalls();
  };
  once('addManualCalls', { type: 'addTransaction', transaction: { id: 'bench-new', type: 'expense', amountFils: 1234,
    category: 'dining', accountId: 'card-0', title: 'Bench', date: '2026-09-20', ts: NOW + 1, source: 'manual' } });
  once('deleteCalls', { type: 'deleteTransaction', id: plain.id });
  out.addManualMs = timeIt(() => reducer(steadyState, {
    type: 'addTransaction', transaction: { id: 'bench-new', type: 'expense', amountFils: 1234, category: 'dining',
      accountId: 'card-0', title: 'Bench', date: '2026-09-20', ts: NOW + 1, source: 'manual' } })).ms;
  out.deleteMs = timeIt(() => reducer(steadyState, { type: 'deleteTransaction', id: plain.id })).ms;
  out.liveCaptureImportMs = timeIt(() => reducer(steadyState, {
    type: 'importBatch', importMoney: steadyState.ledgerMoney,
    transactions: [{ type: 'expense', amountFils: 4321, category: 'dining', accountId: 'card-1', title: 'Talabat',
      date: '2026-09-20', ts: NOW + 5, source: 'sms', smsKey: `s${NOW + 5}-4321`,
      raw: 'Purchase of AED 43.21 with Credit Card ending 4801 at TALABAT, DUBAI.' }],
    newAccounts: [], newHints: {}, newDues: [], newBills: [], snapshots: {}, bankNames: {}, cardTypes: {}, lastScanTs: NOW + 5, updates: [] })).ms;
  out.setMonthStartMs = timeIt(() => reducer(steadyState, { type: 'setMonthStartDay', day: 1 })).ms;
  return out;
}

const counts = process.argv.slice(2).map(Number).filter(Boolean);
const results = (counts.length ? counts : [5000, 20000]).map(run);
console.log(JSON.stringify({ node: process.version, results }, null, 2));
