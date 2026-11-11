'use strict';
/*
 * Independent retention probe. Author: xAI Grok 4.7.
 * Written against Wafra head 954d238530506016ed9d8322b597d87cd9036254.
 * This file is not a local execution result. Hosted execution is separate.
 *
 * One scenario, 59 distinct exact card-payment reviews (explicit positive
 * fils, no amount alternatives). The bank parser is a boundary: it returns
 * these prepared reviews. Native chunk reads and relay acknowledgement are
 * boundaries too. Stage, store, acknowledgement, cursor, and session use the
 * current source modules.
 *
 * Expected accounting:
 * - All 59 require retention and are not ordinary money-movement postings.
 * - First and last confirmed posting plans return unsupported-event.
 * - A failed save rejects settlement. That is not durable success.
 * - The retry save admits 0 because the failed dispatch already held the
 *   first 50 in memory. Receipts: 50 pending (items 0..49) and 9 deferred
 *   (items 50..58). Pending clocks and fils match the inputs.
 * - Giving item 58 the id of item 0 is refused. Pending stays 50.
 * - While those 9 are deferred, iOS session load throws review-capacity and
 *   discards 0 times. Pending stays 50.
 * - A history page that asks to pause does not move a prior checkpoint:
 *   cursor { beforeDateMs: 1700000000000, beforeId: 4400 }, scanned 120,
 *   found 80. Status paused, error review-capacity.
 * - Supplemental acknowledgement includes kept-review and safe-row.
 *   It excludes held-0..held-8 and probe.
 * - Dismiss items 0..8, then stage all 59 again: admitted 9. Pending keys
 *   are items 9..58. Items 0..8 are resolved. Survivor clocks and fils
 *   are unchanged.
 * - The same iOS session then loads, verification passes, and discard runs
 *   once.
 *
 * Command, from any directory, after the hosted checkout is this head:
 * WAFRA_ROOT="<checkout>" NODE_OPTIONS=--max-old-space-size=256 \
 *   /opt/homebrew/opt/node@22/bin/node --test --test-concurrency=1 \
 *   --test-timeout=15000 \
 *   /Users/naserkhanjar/OpenBot/Shared/launch-review/reviewer-pr176-independent-retention.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const vm = require('node:vm');

// vm.runInNewContext values use that realm's Array and Object prototypes.
// strict deepEqual rejects those against outer literals even when every
// scalar matches. Copy into this realm before comparing. Expectations stay.
function asOuter(value) {
  if (Array.isArray(value)) return Array.from(value, asOuter);
  if (value && typeof value === 'object') {
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = asOuter(value[key]);
    return copy;
  }
  return value;
}

const root = process.env.WAFRA_ROOT;
assert.ok(root && fs.existsSync(path.join(root, 'src/lib/store.tsx')), 'WAFRA_ROOT must be the Wafra checkout');
module.paths.unshift(path.join(root, 'node_modules'));
const ts = require('typescript');

const cache = new Map();
function evaluate(text, filename, bindings = {}, dependencies = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(text, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(output, {
    module, exports: module.exports, require: name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (!name.startsWith('@/')) return require(name);
      return new Proxy({}, { get: (_, key) => source(name.slice(2))[key] });
    },
    console, Date, Promise, Set, Map, setTimeout, clearTimeout, ...bindings,
  }, { filename });
  return module.exports;
}
function source(name) {
  if (cache.has(name)) return cache.get(name);
  const base = path.join(root, 'src', name);
  const filename = ['.ts', '.tsx'].map(ext => base + ext).find(fs.existsSync);
  assert.ok(filename, `source module ${name}`);
  const value = evaluate(fs.readFileSync(filename, 'utf8'), filename);
  cache.set(name, value);
  return value;
}

const tray = source('lib/alert-review-tray');
const identity = source('lib/capture-source-identity');
const now = Date.now();
const PRIOR_CURSOR = { beforeDateMs: 1700000000000, beforeId: 4400 };
const missing = () => ({ value: null, alternatives: [], evidence: 'missing', spans: [], issues: [] });
const field = value => ({ ...missing(), value, evidence: 'explicit' });
function payment(i) {
  return tray.prepareUniversalReviewAlert({
    ...tray.appleMessageReviewIdentity((i + 1).toString(16).padStart(64, '0')),
    observedAt: now - 1000 + i,
    channel: 'shortcut',
    event: {
      version: 1, decision: 'review', family: 'card-payment', status: 'posted', direction: 'credit',
      amount: field({ currency: 'AED', exponent: 2, minorUnits: String(50000 + i) }),
      statementTotal: missing(), minimumDue: missing(), balance: missing(), creditLimit: missing(),
      merchant: missing(), transactionDate: missing(), dueDate: missing(), statementDate: missing(),
      instrument: field({ kind: 'card', last4: '1234' }), observations: [], issues: [],
    },
  });
}
function keyOf(item) {
  return identity.canonicalCaptureSourceKey(item.sourceKey, item.observedAt);
}
function storeHarness() {
  const storeText = fs.readFileSync(path.join(root, 'src/lib/store.tsx'), 'utf8');
  const storeAst = ts.createSourceFile('store.tsx', storeText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let stageNode;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(storeAst) === 'stageReviewAlerts') stageNode = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(storeAst);
  const reduceNode = storeAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reduceState');
  assert.ok(stageNode && reduceNode);
  const reduceState = evaluate(`${reduceNode.getText(storeAst)}\nexports.reduce = reduceState;`, 'reducer.ts').reduce;
  const authoritativeState = { current: { hydrated: true, transactions: [], trustedNotificationPackages: [], reviewTray: tray.emptyAlertReviewTray(), privateMode: false, captureOptOut: false, lastScanTs: 0, marketId: 'AE' } };
  const stateGeneration = { current: 0 };
  let write = async () => true;
  const bindings = {
    ...tray, authoritativeState, stateGeneration, saveTimer: { current: null },
    reviewQualificationMap: () => new Map(),
    reconcileReviewSourceBindings: source('lib/review-source-bindings').reconcileReviewSourceBindings,
    ensureDurable: async () => { if (!await write(authoritativeState.current)) throw new Error('write failed'); },
    persist: state => write(state), persistedQualificationIds: () => [],
    dispatch: action => (authoritativeState.current = reduceState(authoritativeState.current, action)),
  };
  const stage = evaluate(`exports.stage = ${stageNode.getText(storeAst)};`, 'stage.ts', bindings).stage;
  return {
    stage,
    get state() { return authoritativeState.current; },
    get generation() { return stateGeneration.current; },
    update(patch) { authoritativeState.current = { ...authoritativeState.current, ...patch }; },
    setWrite(fn) { write = fn; },
    dismiss(item) {
      authoritativeState.current = {
        ...authoritativeState.current,
        reviewTray: tray.resolveReviewAlert(authoritativeState.current.reviewTray, item.id, 'dismissed', now),
      };
    },
  };
}

test('59 exact repayments survive a failed save, hold an existing cursor and session, then fill only the nine opened slots', { timeout: 15000 }, async () => {
  const items = Array.from({ length: 59 }, (_, i) => payment(i));
  assert.equal(new Set(items.map(keyOf)).size, 59);
  const clocks = items.map(item => ({ expiresAt: item.expiresAt, minorUnits: item.event.amount.value.minorUnits }));
  for (const item of items) {
    assert.equal(tray.requiresReviewRetention(item), true);
    assert.equal(tray.isMoneyMovementReview(item), false);
  }
  const importer = source('lib/universal-import');
  for (const [item, direction] of [[items[0], 'debit'], [items[58], 'credit']]) {
    const plan = importer.planConfirmedUniversalImport({ hydrated: true }, item.event, { confirmed: true, postingStatus: 'posted', direction });
    assert.equal(plan.reason, 'unsupported-event');
  }

  const store = storeHarness();
  store.setWrite(async () => false);
  await assert.rejects(tray.settleReviewStage(items, store.stage(items)), /Encrypted review-tray write failed/);
  store.setWrite(async () => true);
  const retry = store.stage(items);
  assert.equal(retry.admitted, 0);
  const firstReceipts = await tray.settleReviewStage(items, retry);
  assert.deepEqual(asOuter(firstReceipts.map(entry => entry.outcome)), [...Array(50).fill('pending'), ...Array(9).fill('deferred')]);
  for (let i = 0; i < 50; i += 1) {
    const saved = store.state.reviewTray.pending.find(entry => keyOf(entry) === keyOf(items[i]));
    assert.ok(saved);
    assert.equal(saved.expiresAt, clocks[i].expiresAt);
    assert.equal(saved.event.amount.value.minorUnits, clocks[i].minorUnits);
  }

  const collided = { ...items[58], id: items[0].id };
  const refused = store.stage([collided]);
  assert.equal(refused.admitted, 0);
  assert.equal((await tray.settleReviewStage([collided], refused))[0].outcome, 'refused');
  assert.equal(store.state.reviewTray.pending.length, 50);

  const ios = loadIos(items, store);
  await assert.rejects(ios.load(), error => error.code === 'review-capacity');
  assert.equal(ios.discards, 0);
  assert.equal(store.state.reviewTray.pending.length, 50);

  const history = source('lib/history-import');
  let checkpoint = {
    status: 'paused', cursor: { ...PRIOR_CURSOR }, scanned: 120, found: 80,
    startedAt: now, updatedAt: now, error: null,
  };
  const held = await history.createHistoryImportCoordinator({
    getProgress: () => checkpoint,
    getGeneration: () => 0,
    shouldContinue: () => true,
    now: () => now,
    scanPage: async () => ({ scanned: 59, found: 59, complete: false, nextCursor: { beforeDateMs: 1690000000000, beforeId: 1 } }),
    commitPage: async () => ({ paused: 'review-capacity' }),
    persistProgress: async next => { checkpoint = next; },
  }).run();
  assert.equal(held.status, 'paused');
  assert.equal(held.error, 'review-capacity');
  assert.deepEqual(asOuter(held.cursor), PRIOR_CURSOR);
  assert.equal(held.scanned, 120);
  assert.equal(held.found, 80);

  const acked = await acknowledgeSupplemental(store, items);
  assert.deepEqual(asOuter(acked.filter(id => id.startsWith('held-'))), []);
  assert.equal(acked.includes('probe'), false);
  assert.ok(acked.includes('kept-review'));
  assert.ok(acked.includes('safe-row'));
  assert.equal(store.state.reviewTray.pending.length, 50);

  for (let i = 0; i < 9; i += 1) store.dismiss(items[i]);
  assert.equal(store.state.reviewTray.pending.length, 41);
  const opened = store.stage(items);
  assert.equal(opened.admitted, 9);
  const openedReceipts = await tray.settleReviewStage(items, opened);
  assert.deepEqual(asOuter(openedReceipts.slice(0, 9).map(entry => entry.outcome)), Array(9).fill('resolved'));
  assert.deepEqual(asOuter(openedReceipts.slice(9).map(entry => entry.outcome)), Array(50).fill('pending'));
  const pendingKeys = new Set(store.state.reviewTray.pending.map(keyOf));
  assert.equal(pendingKeys.size, 50);
  for (let i = 9; i < 59; i += 1) assert.ok(pendingKeys.has(keyOf(items[i])));
  for (let i = 9; i < 50; i += 1) {
    const saved = store.state.reviewTray.pending.find(entry => keyOf(entry) === keyOf(items[i]));
    assert.equal(saved.expiresAt, clocks[i].expiresAt);
    assert.equal(saved.event.amount.value.minorUnits, clocks[i].minorUnits);
  }

  const loaded = await ios.load();
  assert.equal(ios.discards, 0);
  await loaded.verifyReviewRetention();
  assert.equal(ios.discards, 0);
  await ios.discard();
  assert.equal(ios.discards, 1);
});

function loadIos(items, store) {
  let discards = 0;
  const records = items.map((item, i) => JSON.stringify({
    id: (i + 1).toString(16).padStart(64, '0'),
    receivedAt: new Date(item.observedAt).toISOString(),
    text: 'Independent retention probe',
    sender: 'FIXTURE',
  }));
  const ios = evaluate(fs.readFileSync(path.join(root, 'src/lib/ios-history-import.ts'), 'utf8'), 'ios-history-import.ts', {}, {
    '@/lib/alert-review-tray': tray,
    '@/lib/country': { activeCountryDateOrder: () => 'dmy', getActiveCountry: () => 'AE' },
    '@/lib/markets': { detectLaunchMarketFromAlert: () => null, detectLaunchMarketFromSender: () => null },
    '@/lib/historical-import': {
      MAX_HISTORICAL_RECORDS: 10000,
      parseHistoricalMessageRecords: rows => ({
        parsed: [], declined: [], ignoredCount: 0, duplicateCount: 0, invalidCount: 0,
        reviewCandidates: rows.map(row => items[parseInt(JSON.parse(row).id, 16) - 1]),
      }),
    },
    '@/lib/launch-alert-parser': { createLaunchAlertSession: () => ({}) },
    '@/lib/ai-alert-reader': { createAiAlertReviewSession: () => ({ read: async () => null }) },
    '@/lib/private-alert-format-runtime': { createPrivateAlertFormatSession: () => ({ read: async () => null }) },
    '@/lib/private-alert-format-review': { canEnrichPrivateFormatReview: () => false },
  });
  const native = {
    purgeExpired: async () => 0,
    getCompletedSession: async () => ({
      chunkIndices: [0, 1], found: 59, attempted: 59, accepted: 59, skipped: 0,
    }),
    readChunk: async (_, chunk) => records.slice(chunk * 50, chunk * 50 + 50),
    discardSession: async () => { discards += 1; },
  };
  return {
    get discards() { return discards; },
    load: () => ios.loadIosHistorySession({
      sessionId: 'reviewer_retention_probe', native, overrides: {}, now: new Date(now), stageReviews: store.stage,
    }),
    discard: () => ios.discardIosHistorySession(native, 'reviewer_retention_probe'),
  };
}

async function acknowledgeSupplemental(store, items) {
  const queuedReviews = [items[49], ...items.slice(50)];
  const ids = ['kept-review', ...items.slice(50).map((_, i) => `held-${i}`), 'safe-row', 'probe'];
  const reviewIds = ids.slice(0, 10);
  const reviewSourceKeysById = new Map(queuedReviews.map((item, i) => [reviewIds[i], item.sourceKey]));
  const acked = [];
  const emptyPlan = () => ({ txCount: 0, dueCount: 0, healedCount: 0, newAccountCount: 0, batch: { newBills: [] } });
  const executor = evaluate(fs.readFileSync(path.join(root, 'src/lib/capture-executor.ts'), 'utf8'), 'capture-executor.ts', {}, {
    '@/lib/alert-review-tray': tray,
    '@/lib/auto-import': { buildImportPlan: emptyPlan },
    '@/lib/capture': { collectNewMessages: async () => { throw new Error('explicit relay only'); } },
    '@/lib/relay': {},
    '@/lib/statement-import-flow': { StatementFilingError: class extends Error {} },
    '@/lib/runtime-performance': { recordRuntimeOperation() {} },
    '@/lib/capture-trace': { captureTrace() {}, captureTraceEnabled: () => false },
  }).createCaptureExecutor({
    ledger: {
      getState: () => store.state,
      getStateGeneration: () => store.generation,
      stageReviewAlerts: store.stage,
      ensureDurable: async () => {},
    },
    dependencies: {
      getRelay: async () => ({ market: 'AE', deviceId: 'reviewer-probe', automationGeneration: 1, verifiedAt: now }),
      sync: async () => ({
        parsed: [], reviewCandidates: queuedReviews, ids, reviewIds, testIds: ['probe'], testReceived: 0,
        reviewSourceKeysById,
      }),
      planRows: emptyPlan,
      acknowledge: async (_, acknowledged) => { acked.push(...acknowledged); },
      markVerified: async current => current,
      recordAutomationProof: async () => {},
    },
  });
  const outcome = await executor.execute('supplemental');
  assert.equal(outcome.kind, 'up-to-date');
  return acked;
}
