'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { performance } = require('node:perf_hooks');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const read = name => fs.readFileSync(path.join(root, 'src/lib', name), 'utf8');
const core = require('../build/transfer-reconciliation');
const markets = require('../build/markets');
markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
const money = { schemaVersion: 2, currency: 'AED', exponent: 2 };
const NOW = Date.UTC(2026, 8, 19, 12);
function evaluate(source, environment = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  Function('module', 'exports', ...Object.keys(environment), output)(module, module.exports, ...Object.values(environment));
  return module.exports;
}
function harness() {
  const calls = { normalize: 0, reconcile: 0 };
  const counted = { ...core,
    normalizeTransferLinks(...args) { calls.normalize++; return core.normalizeTransferLinks(...args); },
    reconcileTransfers(...args) { calls.reconcile++; return core.reconcileTransfers(...args); },
  };
  // The subject executes from checked-in source. All financial dependencies
  // are the real standard test-build modules; no money/accounting doubles.
  const imports = evaluate(read('ledger-import.ts'), { require(id) {
    assert.ok(id.startsWith('@/lib/'));
    return id === '@/lib/transfer-reconciliation' ? counted : require('../build/' + id.slice(6));
  } });
  const store = ts.createSourceFile('store.tsx', read('store.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['reducer', 'reduceState', 'actionMayChangeTransferLinks', 'transactionNeedsTransferNormalization'];
  const functions = names.map(name => {
    const node = store.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, `shipping ${name} must exist`); return node.getText(store);
  }).join('\n');
  const { reducer } = evaluate(functions + '\nexports.reducer = reducer;', {
    ...counted, ...imports,
    // UI preference and currency side effects do not participate in matching.
    captureMarketContext: () => () => {}, getMonthStartDay: () => 1,
    getThemePreference: () => 'light', getLanguage: () => 'en',
    applyMonthStartDay() {}, applyThemePreference() {}, setLanguage() {},
    syncLedgerCurrency: state => state, markLaunchPhase() {},
    historyImportIncomplete: require('../build/history-import').historyImportIncomplete,
  });
  return { reducer, apply: imports.applyMaterializedImportBatch, calls };
}
const account = i => ({ id: `acc-${i}`, name: `Bank ${i}`, kind: 'bank', openingFils: 0,
  bankName: 'FAB', last4: String(i).padStart(4, '0'), snapshotTs: NOW, snapshotFils: 100_000, snapshotKind: 'balance' });
const row = (i, patch = {}) => ({ id: `tx-${i}`, accountId: 'acc-0', type: 'expense', title: `Shop ${i}`,
  category: 'shopping', amountFils: 1000 + i, date: '2026-09-19', ts: NOW - i * 1000,
  source: 'sms', smsKey: `synthetic-${i}`, ...patch });
const state = (count = 1) => ({ hydrated: true, onboarded: true, marketId: 'AE', ledgerMoney: money,
  accounts: Array.from({ length: 44 }, (_, i) => account(i)), transactions: Array.from({ length: count }, (_, i) => row(i)),
  bills: [], cardDues: [], budgets: [], goals: [], accountHints: {}, merchantOverrides: {}, notSubscriptions: [],
  lastScanTs: NOW, parserVersion: 1, privateMode: true, hydrationFinalizeVersion: 1,
  transferNormalizationVersion: core.TRANSFER_NORMALIZATION_VERSION, transferInternalIds: [],
  historyImport: { status: 'running', scanned: 10, found: 1, cursor: { beforeDateMs: NOW, beforeId: 10 }, startedAt: NOW, updatedAt: NOW },
});
const batch = (patch = {}) => ({ type: 'importBatch', importMoney: money, transactions: [], newAccounts: [],
  newHints: {}, newDues: [], newBills: [], snapshots: {}, bankNames: {}, cardTypes: {}, updates: [],
  parserRereadComplete: false, lastScanTs: NOW, historyImport: { ...state(0).historyImport, scanned: 20 }, ...patch });
const complete = patch => batch({ historyImport: { ...state(0).historyImport, status: 'complete', cursor: null }, parserRereadComplete: true, ...patch });
const assertReceipt = result => {
  const normalized = core.normalizeTransferLinks(result.transactions, result.accounts);
  assert.deepEqual(result.transactions, normalized);
  assert.deepEqual(new Set(result.transferInternalIds), core.reconciliationInternalIds(core.reconcileTransfers(normalized, result.accounts)));
  assert.equal(result.transferNormalizationVersion, core.TRANSFER_NORMALIZATION_VERSION);
};

test('six stale snapshot checkpoints preserve collection identity and perform no full-ledger normalization', () => {
  const h = harness(); const base = state(14_776); let current = base;
  const start = performance.now();
  for (let i = 0; i < 6; i++) {
    current = h.reducer(current, batch({ snapshots: { 'acc-0': { fils: 999, kind: 'balance', ts: NOW - 1 - i } } }));
  }
  console.log(JSON.stringify({ scenario: '6 stale snapshot pages / 14776 rows / 44 accounts', ms: +(performance.now() - start).toFixed(2), ...h.calls }));
  for (const key of ['accounts', 'transactions', 'cardDues', 'bills']) assert.ok(current[key] === base[key], `${key} must retain identity`);
  assert.deepEqual(h.calls, { normalize: 0, reconcile: 0 });
  assert.equal(current.transferNormalizationVersion, undefined);
});

test('running pages persist new account/snapshot/transaction/healing facts while retaining provisional receipt', () => {
  const h = harness(); const base = state(); const receipt = base.transferInternalIds;
  const actual = h.reducer(base, batch({ newAccounts: [account(44)],
    snapshots: { 'acc-0': { fils: 234_500, kind: 'balance', ts: NOW + 1 } },
    transactions: [row(100, { accountId: 'acc-44' })], updates: [{ id: 'tx-0', title: 'Corrected shop' }] }));
  assert.equal(actual.accounts.length, 45); assert.equal(actual.accounts[0].snapshotFils, 234_500);
  assert.equal(actual.transactions.find(t => t.id === 'tx-0').title, 'Corrected shop');
  assert.equal(actual.transactions.length, 2); assert.equal(actual.transferInternalIds, receipt);
  assert.equal(actual.transferNormalizationVersion, undefined);
  assert.deepEqual(h.calls, { normalize: 0, reconcile: 0 });
});

test('empty and stale final pages run canonical reconciliation exactly once', () => {
  for (const extra of [{}, { snapshots: { 'acc-0': { fils: 10, kind: 'balance', ts: NOW - 1 } } }]) {
    const h = harness(); let base = state();
    const own = row(0, { title: 'Outgoing transfer', isTransfer: true });
    base.transactions = core.applyTransferDecision([own], base.accounts, { ids: [own.id], ownership: 'own', now: NOW,
      expectedFingerprints: { [own.id]: core.transferFingerprint(own) } });
    base.transferNormalizationVersion = undefined;
    const result = h.reducer(base, complete(extra));
    assertReceipt(result); assert.ok(result.transferInternalIds.includes(own.id));
    assert.equal(result.historyImport.status, 'complete');
    assert.deepEqual(h.calls, { normalize: 1, reconcile: 1 });
  }
});

test('finalization cannot take the live-capture fast path even if an intervening manual edit stamped a receipt', () => {
  const h = harness(); const base = state();
  h.reducer(base, complete({ snapshots: { 'acc-0': { fils: 10, kind: 'balance', ts: NOW - 1 } } }));
  assert.deepEqual(h.calls, { normalize: 1, reconcile: 1 });
});

test('a real manual account edit still normalizes immediately during active history', () => {
  const h = harness(); const base = state();
  const result = h.reducer(base, { type: 'editAccount', id: 'acc-0', patch: { bankName: 'ADCB' } });
  assert.equal(result.accounts[0].bankName, 'ADCB'); assertReceipt(result);
  assert.deepEqual(h.calls, { normalize: 1, reconcile: 1 });
});

test('metadata-only running pages preserve facts and final receipts survive a process resume', () => {
  const h = harness(); const base = state();
  const cursorOnly = h.reducer(base, batch());
  for (const key of ['accounts', 'transactions', 'cardDues', 'bills']) assert.equal(cursorOnly[key], base[key]);
  assert.deepEqual(h.calls, { normalize: 0, reconcile: 0 });
  const first = h.reducer(cursorOnly, batch({ snapshots: { 'acc-0': { fils: 80_000, kind: 'balance', ts: NOW + 1 } } }));
  const restored = JSON.parse(JSON.stringify(first)); restored.historyImport.status = 'paused';
  const resumed = harness().reducer(restored, batch({ updates: [{ id: 'tx-0', title: 'Corrected shop' }] }));
  const final = harness().reducer(resumed, complete());
  const uninterrupted = h.reducer(h.reducer(first, batch({ updates: [{ id: 'tx-0', title: 'Corrected shop' }] })), complete());
  assert.deepEqual(final, uninterrupted); assertReceipt(final);
});
