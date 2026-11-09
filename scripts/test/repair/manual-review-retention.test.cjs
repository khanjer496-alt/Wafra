'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { evaluate, source, root, tray, payment, storeHarness } = require('./retention-harness.cjs');
const screen = ts.createSourceFile('import-sms.tsx', fs.readFileSync(path.join(root, 'src/app/import-sms.tsx'), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.set(node.name.text, node.initializer);
  ts.forEachChild(node, visit);
}
visit(screen);
const runNode = declarations.get('runScan'); assert.ok(runNode);

function harness(items, occupied = [], options = {}) {
  const store = storeHarness(occupied);
  store.update({ merchantOverrides: {}, marketId: 'AE', captureOptOut: false });
  const result = { writes: [], commits: 0, notice: null, pending: null, commit: null, plan: null, capacity: false };
  const parsed = options.preview ? [{ kind: 'transaction' }] : [];
  const bindings = { ...tray, state: store.state,
    requiresPro: () => false, isProActive: () => true,
    router: { push() { throw new Error('unexpected route'); } },
    clearPasteSource() {}, setScanning() {}, setProgress() {}, setPasteVerdict() {}, reportScanProgress() {},
    setNotice: value => { result.notice = value; }, setPendingInboxResult: value => { result.pending = value; },
    setPendingScanCommit: value => { result.commit = value ? value() : null; },
    setSkippedCount() {}, setPlan: value => { result.plan = value; }, setTrackedBills() {},
    setHistoryCapacityWaiting: value => { result.capacity = value; },
    requestSmsPermission: async () => true,
    getStateSnapshot: () => store.state, getStateGeneration: () => store.generation,
    pasteMounted: { current: true },
    collectLegacyReviewSourceKeys: () => [],
    stageReviewAlerts: store.stage,
    scanInbox: async (_since, _overrides, _progress, _locale, scanOptions) => {
      const known = new Set(scanOptions.knownReviewSourceKeys ?? []);
      const remaining = items.filter(item => !known.has(item.sourceKey) &&
        !known.has(source('lib/capture-source-identity').canonicalCaptureSourceKey(item.sourceKey, item.observedAt)));
      return { parsed, declined: [], newestTs: 1234, inboxHistoryComplete: true,
        reviewCandidates: remaining.slice(0, 50), reviewSourceBindings: [],
        skippedKnownInboxReviewSourceKeys: items.filter(item => !remaining.includes(item)).map(item =>
          source('lib/capture-source-identity').canonicalCaptureSourceKey(item.sourceKey, item.observedAt)),
        deferredInboxReviews: remaining.length > 50,
        commit: async () => { result.commits++; } };
    },
    buildImportPlan: () => ({ txCount: parsed.length, dueCount: 0, healedCount: 0, billDues: [],
      batch: { transactions: [] } }),
    stageWalletNearMatches: plan => ({ plan, settle: async () => {} }),
    importBatch: batch => { result.writes.push({ ...batch }); return { durable: Promise.resolve() }; },
    ImportMoneyError: class extends Error {},
    t: key => key, tf: key => key,
  };
  const holdClass = screen.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ReviewImportHold');
  if (holdClass) bindings.ReviewImportHold = evaluate(holdClass.getText(screen) + '\nexports.Hold = ReviewImportHold;', 'hold.ts').Hold;
  const showHold = declarations.get('showReviewRetentionHold');
  if (showHold) bindings.showReviewRetentionHold = evaluate(`exports.show = ${showHold.getText(screen)};`, 'show-hold.ts', bindings).show;
  const run = evaluate(`exports.run = ${runNode.getText(screen)};`, 'run-scan.ts', bindings).run;
  return { run, store, result };
}

test('actual manual scan cannot complete a new required review behind fifty occupied slots', { timeout: 10000 }, async () => {
  const occupied = Array.from({ length: 50 }, (_, i) => payment(100 + i));
  const h = harness([payment(0)], occupied);
  await h.run();
  assert.equal(h.result.commits, 0);
  assert.ok(!h.result.writes.some(batch => batch.parserRereadComplete));
  assert.equal(h.store.state.reviewTray.pending.length, 50);
  assert.equal(h.result.capacity, true);
});
test('actual manual scan holds a cropped 59-source page after staging its available fifty', { timeout: 10000 }, async () => {
  const h = harness(Array.from({ length: 59 }, (_, i) => payment(i)));
  await h.run();
  assert.equal(h.result.commits, 0);
  assert.ok(!h.result.writes.some(batch => batch.parserRereadComplete));
  assert.equal(h.store.state.reviewTray.pending.length, 50);
  assert.equal(h.result.capacity, true);
});
test('actual manual preview commit refuses a replacement generation', { timeout: 10000 }, async () => {
  const h = harness([payment(0)], [], { preview: true });
  await h.run(); assert.equal(typeof h.result.commit, 'function');
  h.store.replace();
  await assert.rejects(h.result.commit());
  assert.equal(h.result.commits, 0);
});
