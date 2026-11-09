'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const cache = new Map();
function evaluate(text, filename, bindings = {}, dependencies = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(text, { fileName: filename, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, require: name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (!name.startsWith('@/')) return require(name);
    // Dependencies are lazy so unused parser/native imports never execute.
    return new Proxy({}, { get: (_, key) => source(name.slice(2))[key] });
  }, console, Date, Promise, Set, Map, setTimeout, clearTimeout, ...bindings }, { filename });
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
const now = Date.now();
const missing = () => ({ value: null, alternatives: [], evidence: 'missing', spans: [], issues: [] });
const field = value => ({ ...missing(), value, evidence: 'explicit' });
function payment(i) {
  return tray.prepareUniversalReviewAlert({ ...tray.appleMessageReviewIdentity((i + 1).toString(16).padStart(64, '0')), observedAt: now - 1000 + i,
    channel: 'shortcut', event: { version: 1, decision: 'review', family: 'card-payment', status: 'posted',
      direction: 'credit', amount: field({ currency: 'AED', exponent: 2, minorUnits: String(50000 + i) }),
      statementTotal: missing(), minimumDue: missing(), balance: missing(), creditLimit: missing(),
      merchant: missing(), transactionDate: missing(), dueDate: missing(), statementDate: missing(),
      instrument: field({ kind: 'card', last4: '1234' }), observations: [], issues: [] } });
}
test('59 distinct exact-money repayments stage 50 and defer 9 without losing acknowledged payloads', () => {
  const items = Array.from({ length: 59 }, (_, i) => payment(i));
  assert.ok(items.every(Boolean));
  const batch = tray.admitPreparedReviewAlerts(tray.emptyAlertReviewTray(), items, now);
  assert.equal(batch.state.pending.length, 50);
  assert.equal(batch.outcomes.filter(value => value === 'admitted').length, 50,
    'admitted must mean a retained payload, never the 59 provisional inserts');
  assert.equal(batch.outcomes.filter(value => value === 'deferred').length, 9);
  assert.equal(batch.state.tombstones.length, 0);
  for (let i = 0; i < 50; i++) assert.equal(batch.state.pending[i].sourceKey, items[i].sourceKey);
});

// Extract the shipped action and reducer rather than maintaining a staging double.
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
const reduceState = evaluate(reduceNode.getText(storeAst) + '\nexports.reduce = reduceState;', 'reducer.ts').reduce;
function storeHarness(occupied = []) {
  const authoritativeState = { current: { hydrated: true, transactions: [], trustedNotificationPackages: [],
    reviewTray: tray.admitPreparedReviewAlerts(tray.emptyAlertReviewTray(), occupied, now).state } };
  const stateGeneration = { current: 0 };
  let write = async () => true;
  const callbacks = { ...tray, authoritativeState, stateGeneration, saveTimer: { current: null },
    reviewQualificationMap: () => new Map(),
    reconcileReviewSourceBindings: source('lib/review-source-bindings').reconcileReviewSourceBindings,
    ensureDurable: async () => { if (!await write(authoritativeState.current)) throw new Error('write failed'); },
    persist: state => write(state), persistedQualificationIds: () => [],
    dispatch: action => (authoritativeState.current = reduceState(authoritativeState.current, action)),
  };
  const stage = evaluate(`exports.stage = ${stageNode.getText(storeAst)};`, 'stage.ts', callbacks).stage;
  return { stage, get state() { return authoritativeState.current; }, get generation() { return stateGeneration.current; },
    update(patch) { authoritativeState.current = { ...authoritativeState.current, ...patch }; },
    setWrite(fn) { write = fn; }, replace() { stateGeneration.current++; authoritativeState.current = { ...authoritativeState.current, reviewTray: tray.emptyAlertReviewTray() }; },
    dismiss(item) { authoritativeState.current = { ...authoritativeState.current,
      reviewTray: tray.resolveReviewAlert(authoritativeState.current.reviewTray, item.id, 'dismissed', now) }; } };
}
for (const count of [49, 50, 51, 59]) test(`actual store stage retains a bounded subset of ${count} sources with truthful durable receipts`, async () => {
  const h = storeHarness(); const items = Array.from({ length: count }, (_, i) => payment(i));
  const first = h.stage(items); const receipts = await tray.settleReviewStage(items, first);
  assert.equal(first.admitted, Math.min(count, 50));
  assert.equal(receipts.filter(x => x.outcome === 'pending').length, Math.min(count, 50));
  assert.equal(receipts.filter(x => x.outcome === 'deferred').length, Math.max(0, count - 50));
  for (const entry of h.state.reviewTray.pending) h.dismiss(entry);
  const retry = h.stage(items); const final = await tray.settleReviewStage(items, retry);
  assert.equal(retry.admitted, Math.max(0, count - 50));
  assert.equal(final.filter(x => x.outcome === 'resolved').length, Math.min(count, 50));
  assert.equal(final.filter(x => x.outcome === 'pending').length, Math.max(0, count - 50));
  assert.equal(h.state.reviewTray.tombstones.filter(x => x.outcome === 'evicted').length, 0);
  for (const item of h.state.reviewTray.pending) {
    const original = items.find(x => x.id === item.id);
    assert.equal(item.expiresAt, original.expiresAt);
    assert.deepEqual(item.event.amount.value, original.event.amount.value);
  }
});
test('full and preoccupied trays make partial progress without replacing prior acknowledged repayments', async () => {
  for (const occupiedCount of [1, 49, 50]) {
    const occupied = Array.from({ length: occupiedCount }, (_, i) => payment(100 + i));
    const h = storeHarness(occupied); const items = Array.from({ length: 59 }, (_, i) => payment(i));
    const first = h.stage(items); await first.durable;
    assert.equal(first.admitted, 50 - occupiedCount);
    for (const old of occupied) assert.ok(h.state.reviewTray.pending.some(x => x.id === old.id));
    for (const item of [...h.state.reviewTray.pending]) h.dismiss(item);
    const next = h.stage(items); await next.durable;
    assert.equal(next.admitted, Math.min(50, 59 - (50 - occupiedCount)));
  }
});
test('persist failure and replacement cannot become durable success; retry persists optimistic pending state', async () => {
  const h = storeHarness(); const items = [payment(0)];
  h.setWrite(async () => false);
  await assert.rejects(tray.settleReviewStage(items, h.stage(items)), /Encrypted review-tray write failed/);
  h.setWrite(async () => true);
  const retry = h.stage(items); assert.equal(retry.admitted, 0);
  assert.equal((await tray.settleReviewStage(items, retry))[0].outcome, 'pending');
  let finish; h.setWrite(() => new Promise(resolve => { finish = resolve; }));
  const replaced = h.stage([payment(1)]); h.replace(); finish(true);
  assert.equal((await tray.settleReviewStage([payment(1)], replaced))[0].outcome, 'deferred');
});

function iosHarness(items, store) {
  let discards = 0, reads = 0;
  const records = items.map((item, i) => JSON.stringify({ id: (i + 1).toString(16).padStart(64, '0'),
    receivedAt: new Date(item.observedAt).toISOString(), text: 'Synthetic retention fixture', sender: 'FIXTURE' }));
  const ios = evaluate(fs.readFileSync(path.join(root, 'src/lib/ios-history-import.ts'), 'utf8'), 'ios-history-import.ts', {}, {
    '@/lib/alert-review-tray': tray,
    '@/lib/country': { activeCountryDateOrder: () => 'dmy', getActiveCountry: () => 'AE' },
    '@/lib/markets': { detectLaunchMarketFromAlert: () => null, detectLaunchMarketFromSender: () => null },
    // Classification is already supplied exact-money data. This fixture tests
    // the actual loader/stage/store/session contracts, not bank grammar.
    '@/lib/historical-import': { MAX_HISTORICAL_RECORDS: 10000,
      parseHistoricalMessageRecords: rows => ({ parsed: [], declined: [], ignoredCount: 0,
        duplicateCount: 0, invalidCount: 0, reviewCandidates: rows.map(row => items[parseInt(JSON.parse(row).id, 16) - 1]) }) },
    '@/lib/launch-alert-parser': { createLaunchAlertSession: () => ({}) },
    '@/lib/ai-alert-reader': { createAiAlertReviewSession: () => ({ read: async () => null }) },
    '@/lib/private-alert-format-runtime': { createPrivateAlertFormatSession: () => ({ read: async () => null }) },
    '@/lib/private-alert-format-review': { canEnrichPrivateFormatReview: () => false },
  });
  const native = { purgeExpired: async () => 0,
    getCompletedSession: async () => ({ chunkIndices: Array.from({ length: Math.ceil(items.length / 50) }, (_, i) => i),
      found: items.length, attempted: items.length, accepted: items.length, skipped: 0 }),
    readChunk: async (_, chunk) => { reads++; return records.slice(chunk * 50, chunk * 50 + 50); },
    discardSession: async () => { discards++; },
  };
  const setupAst = ts.createSourceFile('setup.ts', fs.readFileSync(path.join(root, 'src/lib/ios-history-setup.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const finalizer = setupAst.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations[0].name.getText(setupAst) === 'finalizeIosHistorySession');
  const finalize = evaluate(finalizer.getText(setupAst) + '\nexports.finalize = finalizeIosHistorySession;', 'finalize.ts').finalize;
  return { ios, native, get reads() { return reads; }, get discards() { return discards; },
    async load(extra = {}) { return ios.loadIosHistorySession({ sessionId: 'synthetic_capacity_session', native,
      overrides: {}, now: new Date(now), stageReviews: store.stage, ...extra }); },
    finalize: () => finalize({ save: async () => {}, discard: () => ios.discardIosHistorySession(native, 'synthetic_capacity_session') }) };
}
for (const count of [49, 50, 51, 59]) test(`actual iOS session retains source across ${count}-row stage/resolution/retry`, async () => {
  const items = Array.from({ length: count }, (_, i) => payment(i)); const store = storeHarness(); const h = iosHarness(items, store);
  if (count > 50) {
    await assert.rejects(h.load(), error => error.code === 'review-capacity');
    assert.equal(h.discards, 0);
    assert.equal(store.state.reviewTray.pending.length, 50);
    for (const item of [...store.state.reviewTray.pending]) store.dismiss(item);
  }
  const loaded = await h.load();
  assert.equal(loaded.reviewCandidates.length, 0, 'streamed reviews are not accumulated into another queue');
  assert.equal(loaded.summary.reviewed, count > 50 ? count - 50 : count);
  assert.equal(store.state.reviewTray.pending.length, count > 50 ? count - 50 : count);
  await loaded.verifyReviewRetention();
  assert.equal(await h.finalize(), 'complete'); assert.equal(h.discards, 1);
  const receipts = tray.reviewRetentionReceipts(store.state.reviewTray, items, now);
  assert.ok(receipts.every(x => x.outcome === 'pending' || x.outcome === 'resolved'));
});
test('iOS write failure, cancellation and ledger replacement keep native payloads recoverable', async () => {
  for (const failure of ['write', 'cancel', 'replace']) {
    const store = storeHarness(); let cancelled = false;
    store.setWrite(async () => {
      if (failure === 'write') return false;
      if (failure === 'cancel') cancelled = true;
      if (failure === 'replace') store.replace();
      return true;
    });
    const h = iosHarness(Array.from({ length: 59 }, (_, i) => payment(i)), store);
    await assert.rejects(h.load({ cancelled: () => cancelled }));
    assert.equal(h.discards, 0); assert.ok(h.reads <= 2);
  }
});

function androidHarness(items, store) {
  const history = source('lib/history-import'); let coordinator, acks = 0, allowed = true;
  store.update({ historyImport: history.createHistoryImportProgress(now), merchantOverrides: {}, marketId: 'AE',
    onboarded: true, captureOptOut: false });
  const adapter = {
    get state() { return store.state; }, getStateSnapshot: () => store.state, getStateGeneration: () => store.generation,
    stageReviewAlerts: store.stage, setMarket: () => true,
    setHistoryImportProgress: async progress => { store.update({ historyImport: progress }); },
    importBatch: batch => { store.update({ historyImport: batch.historyImport }); return { durable: Promise.resolve() }; },
  };
  const hook = evaluate(fs.readFileSync(path.join(root, 'src/hooks/use-history-import.ts'), 'utf8'), 'use-history-import.ts', {}, {
    react: { useMemo: fn => fn(), useCallback: fn => fn, useEffect() {}, useRef: current => ({ current }) },
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'background' } },
    '@/lib/store': { useStore: () => adapter },
    '@/lib/alert-review-tray': tray,
    '@/lib/history-import': { ...history, createHistoryImportCoordinator: deps => {
      coordinator = history.createHistoryImportCoordinator(deps); return coordinator;
    } },
    '@/lib/auto-import': { hasSmsPermission: async () => true, isSmsInboxAccessError: () => false,
      scanInbox: async (_, _overrides, _unused, _locale, options) => {
        const claims = new Set(options.knownReviewSourceKeys ?? []);
        const canonical = source('lib/capture-source-identity').canonicalCaptureSourceKey;
        const unknown = items.filter(x => !claims.has(canonical(x.sourceKey, x.observedAt)));
        return { parsed: [], declined: [], reviewCandidates: unknown.slice(0, 50), newestTs: now,
          scannedCount: items.length, inboxHistoryComplete: true, nextCursor: null,
          deferredInboxReviews: unknown.length > 50,
          skippedKnownInboxReviewSourceKeys: items.filter(x => claims.has(canonical(x.sourceKey, x.observedAt))).map(x => canonical(x.sourceKey, x.observedAt)),
          commit: async () => { acks++; } };
      }, buildImportPlan: () => ({ batch: {}, walletNearMatches: [] }) },
    '@/lib/android-history-background': { historyBackground: { canContinue: () => allowed } },
    '@/lib/android-capture-sources': { androidSmsCaptureEnabled: () => true },
    '@/lib/purchases': { isProActive: () => true },
    '@/lib/foreground-history-priority': { waitForForegroundHistoryIdle: async () => {} },
    '@/lib/runtime-performance': { recordRuntimeOperation() {} },
    '@/lib/launch-performance': { markLaunchPhase() {} },
  });
  hook.useHistoryImport();
  return { run: () => coordinator.run(), get acks() { return acks; }, cancel() { allowed = false; } };
}
test('59-source actual Android History hook/coordinator holds cursor, then completes once without count inflation', async () => {
  const items = Array.from({ length: 59 }, (_, i) => payment(i)); const store = storeHarness();
  const h = androidHarness(items, store);
  const held = await h.run();
  assert.equal(held.status, 'paused'); assert.equal(held.error, 'review-capacity'); assert.equal(held.cursor, null);
  assert.equal(held.scanned, 0); assert.equal(held.found, 0); assert.equal(h.acks, 0);
  assert.equal(store.state.reviewTray.pending.length, 50);
  const stillHeld = await h.run(); assert.equal(stillHeld.status, 'paused'); assert.equal(h.acks, 0);
  for (const item of [...store.state.reviewTray.pending]) store.dismiss(item);
  const done = await h.run();
  assert.equal(done.status, 'complete'); assert.equal(done.scanned, 59); assert.equal(done.found, 59);
  assert.equal(store.state.reviewTray.pending.length, 9); assert.equal(h.acks, 1);
  await h.run(); assert.equal(h.acks, 1);
});
test('expiry is explicit, counted once, never resolved or renewed by replay', async () => {
  const item = payment(0); const expired = { ...item, expiresAt: now - 1, observedAt: now - tray.REVIEW_ALERT_TTL_MS - 1 };
  const batch = tray.admitPreparedReviewAlerts(tray.emptyAlertReviewTray(), [expired], now);
  assert.equal(batch.outcomes[0], 'expired'); assert.equal(batch.state.pending.length, 0);
  assert.equal(batch.state.tombstones.filter(x => x.outcome === 'expired').length, 1);
  const freshReplay = { ...expired, expiresAt: now + tray.REVIEW_ALERT_TTL_MS };
  const replay = tray.admitPreparedReviewAlerts(batch.state, [freshReplay], now);
  assert.equal(replay.outcomes[0], 'expired'); assert.equal(replay.state.pending.length, 0);
  assert.equal(tray.reviewRetentionReceipts(replay.state, [freshReplay], now)[0].outcome, 'expired');
});
test('retention policy never grants ordinary card-payment expense or income confirmation', () => {
  const item = payment(0); assert.equal(tray.requiresReviewRetention(item), true);
  assert.equal(tray.isMoneyMovementReview(item), false);
  const importer = source('lib/universal-import');
  for (const direction of ['debit', 'credit']) {
    const result = importer.planConfirmedUniversalImport({ hydrated: true }, item.event, { confirmed: true, postingStatus: 'posted', direction });
    assert.equal(result.reason, 'unsupported-event');
  }
});
test('iOS final discard barrier revalidates after expiry or ledger replacement while preview was open', async () => {
  for (const change of ['expiry', 'replace']) {
    const store = storeHarness(); const h = iosHarness([payment(0)], store); const loaded = await h.load();
    if (change === 'replace') store.replace();
    else store.update({ reviewTray: { ...store.state.reviewTray, pending: store.state.reviewTray.pending.map(item =>
      ({ ...item, observedAt: now - tray.REVIEW_ALERT_TTL_MS - 1, expiresAt: now - 1 })) } });
    // Same cancellation/generation signal supplied by the real import route.
    if (change === 'replace') {
      const freshStore = storeHarness(); let cancelled = false;
      const guarded = iosHarness([payment(0)], freshStore); const guardedLoaded = await guarded.load({ cancelled: () => cancelled });
      cancelled = true; freshStore.replace();
      await assert.rejects(guardedLoaded.verifyReviewRetention(), error => error.code === 'cancelled');
      assert.equal(guarded.discards, 0);
    } else {
      await assert.rejects(loaded.verifyReviewRetention(), error => error.code === 'review-expired');
      assert.equal(h.discards, 0);
    }
  }
});
test('a receipt cannot borrow a later optimistic stage as evidence of its own durable retention', async () => {
  const occupied = Array.from({ length: 50 }, (_, i) => payment(100 + i)); const store = storeHarness(occupied);
  const finishes = [];
  store.setWrite(() => new Promise(resolve => finishes.push(resolve)));
  const first = store.stage([payment(0)]); assert.equal(first.admitted, 0);
  store.dismiss(occupied[0]);
  const later = store.stage([payment(0)]); assert.equal(later.admitted, 1);
  const failedLater = assert.rejects(later.durable, /Encrypted review-tray write failed/);
  finishes[0](true);
  const receipts = await tray.settleReviewStage([payment(0)], first);
  finishes[1](false); await failedLater;
  assert.equal(receipts[0].outcome, 'deferred', 'the first persisted snapshot never contained this payload');
});

for (const intent of ['supplemental', 'setup-verification']) test(`${intent} ACK cannot borrow a later failed stage's live claim`, { timeout: 5000 }, async () => {
  const existing = payment(100);
  const candidate = { ...payment(0), id: existing.id }; // Valid facts, conflicting identity must not be ACKed.
  const store = storeHarness([existing]); store.update({ privateMode: false, captureOptOut: false, lastScanTs: 0, marketId: 'AE' });
  const finishes = []; let staged;
  const stageStarted = new Promise(resolve => { staged = resolve; });
  store.setWrite(() => new Promise(resolve => finishes.push(resolve)));
  const acked = [];
  const cfg = { market: 'AE', deviceId: 'fixture-device', automationGeneration: 1, verifiedAt: now };
  const queued = { parsed: [], reviewCandidates: [candidate], ids: ['review-row', 'safe-row', 'probe'],
    reviewIds: ['review-row'], testIds: ['probe'], testReceived: 1,
    reviewSourceKeysById: new Map([['review-row', candidate.sourceKey]]) };
  const emptyPlan = () => ({ txCount: 0, dueCount: 0, healedCount: 0, newAccountCount: 0, batch: { newBills: [] } });
  const executor = evaluate(fs.readFileSync(path.join(root, 'src/lib/capture-executor.ts'), 'utf8'), 'capture-executor.ts', {}, {
    '@/lib/alert-review-tray': tray,
    '@/lib/auto-import': { buildImportPlan: emptyPlan },
    '@/lib/capture': { collectNewMessages: async () => { throw new Error('explicit relay only'); } },
    '@/lib/relay': {},
    '@/lib/statement-import-flow': { StatementFilingError: class extends Error {} },
    '@/lib/runtime-performance': { recordRuntimeOperation() {} },
    '@/lib/capture-trace': { captureTrace() {}, captureTraceEnabled: () => false },
  }).createCaptureExecutor({ ledger: {
    getState: () => store.state, getStateGeneration: () => store.generation,
    stageReviewAlerts: items => { const receipt = store.stage(items); staged(); return receipt; },
    ensureDurable: async () => {},
  }, dependencies: { getRelay: async () => cfg, sync: async () => queued,
    planRows: emptyPlan, acknowledge: async (_, ids) => { acked.push(...ids); },
    markVerified: async current => current, recordAutomationProof: async () => {} } });
  const run = executor.execute(intent);
  await stageStarted;
  store.dismiss(existing);
  const later = store.stage([candidate]); assert.equal(later.admitted, 1);
  const failedLater = assert.rejects(later.durable, /Encrypted review-tray write failed/);
  finishes[0](true);
  await run;
  finishes[1](false); await failedLater;
  assert.ok(!acked.includes('review-row'), 'no persisted snapshot qualified the required review');
  assert.ok(acked.includes('safe-row'), 'independent safe siblings still progress');
  assert.equal(acked.includes('probe'), intent === 'setup-verification', 'only setup owns probe ACK');
});
